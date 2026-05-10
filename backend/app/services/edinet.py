"""
EDINET financial data service.

Fetches annual financial figures (有価証券報告書, docTypeCode=120) for a stock
using the free EDINET API v2 (no key required for public disclosure data).

Strategy to avoid brute-force date scanning:
  1. Search the last 30 days (catches very recent filings).
  2. Search June–August for the last 2 years (peak filing season for Mar FY-end companies).
  3. If still not found, scan backwards 4 weeks at a time up to 18 months.
Results are cached in jp_listings.fins_data (30-day TTL).
"""
import csv
import io
import json
import logging
from datetime import date, timedelta
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_EDINET_BASE = "https://api.edinet-fsa.go.jp/api/v2"

def _headers(api_key: str = "") -> dict:
    h = {"User-Agent": "MyQuantitativeTrading/1.0 (research tool)"}
    if api_key:
        h["Ocp-Apim-Subscription-Key"] = api_key
    return h

# XBRL element names → internal key (try in order; first non-empty wins)
_ELEMENT_MAP = {
    "revenue": [
        "jppfs_cor:NetSales",
        "jpigp_cor:Revenue",
        "ifrs-full:Revenue",
        "jppfs_cor:Revenues",
    ],
    "op_income": [
        "jppfs_cor:OperatingIncome",
        "jpigp_cor:OperatingProfit",
        "ifrs-full:ProfitLossFromOperatingActivities",
    ],
    "ord_income": [
        "jppfs_cor:OrdinaryIncome",
    ],
    "net_income": [
        "jppfs_cor:ProfitLoss",
        "jppfs_cor:NetIncome",
        "jpigp_cor:ProfitLossAttributableToOwnersOfParent",
        "ifrs-full:ProfitLossAttributableToOwnersOfParent",
    ],
    "total_assets": [
        "jppfs_cor:Assets",
        "ifrs-full:Assets",
    ],
    "net_assets": [
        "jppfs_cor:NetAssets",
        "ifrs-full:Equity",
    ],
    "eps": [
        "jppfs_cor:BasicEarningsPerShare",
        "ifrs-full:BasicEarningsLossPerShare",
        "jppfs_cor:NetIncomePerShare",
    ],
    "dividend": [
        "jppfs_cor:DividendsPerShareOfCommonStock",
        "jppfs_cor:DividendPaidPerShare",
    ],
    "equity_ratio": [
        "jppfs_cor:EquityToAssetRatio",
        "jpigp_cor:EquityAttributableToOwnersOfParentToTotalEquityRatio",
    ],
    "bvps": [
        "jppfs_cor:BookValuePerShare",
        "jppfs_cor:NetAssetsPerShare",
        "ifrs-full:NetAssetsPerShare",
    ],
}

# Prefer consolidated, current year context keywords
_PREFER_CONTEXT = {"CurrentYear", "Consolidated", "Current"}
_AVOID_CONTEXT  = {"Prior", "Previous", "NonConsolidated", "Individual"}


async def _doc_list_for_date(
    http: httpx.AsyncClient,
    check_date: date,
    sec_code_4: str,
    api_key: str = "",
) -> Optional[dict]:
    """Return the latest 有価証券報告書 metadata dict for the company on a specific date."""
    try:
        r = await http.get(
            f"{_EDINET_BASE}/documents.json",
            params={"date": check_date.isoformat(), "type": "2"},
            headers=_headers(api_key),
            timeout=15,
        )
        if r.status_code in (204, 404):
            return None
        r.raise_for_status()
        docs = r.json().get("results", []) or []
        for doc in docs:
            if (
                doc.get("docTypeCode") == "120"           # 有価証券報告書
                and doc.get("withdrawalStatus") == "0"
                and doc.get("csvFlag") == "1"
                and str(doc.get("secCode", "")).startswith(sec_code_4)
            ):
                return doc
    except Exception as exc:
        logger.debug(f"EDINET date {check_date} error: {exc}")
    return None


def _candidate_dates(today: date) -> list[date]:
    """
    Return a prioritised list of dates to probe.
    Covers the last 30 days densely, then the Jun-Aug filing windows
    for the past 2 years (March FY-end companies), then monthly back-fills.
    """
    dates: list[date] = []
    # Last 30 days (daily)
    for i in range(30):
        dates.append(today - timedelta(days=i))
    # June–August for last 2 years (peak season)
    for year_offset in (0, 1):
        year = today.year - year_offset
        for m in (7, 6, 8):          # July most common deadline
            d = date(year, m, 28)
            while d.month == m:
                dates.append(d)
                d -= timedelta(days=1)
    # Monthly probe: every 4 weeks back up to 18 months
    d = today - timedelta(days=35)
    for _ in range(18):
        dates.append(d)
        d -= timedelta(weeks=4)
    # Deduplicate preserving order
    seen: set = set()
    unique: list[date] = []
    for d in dates:
        if d not in seen:
            seen.add(d)
            unique.append(d)
    return unique


async def _fetch_csv(http: httpx.AsyncClient, doc_id: str, api_key: str = "") -> str:
    """Download the type-5 financial CSV for a document."""
    r = await http.get(
        f"{_EDINET_BASE}/documents/{doc_id}",
        params={"type": "5"},
        headers=_headers(api_key),
        timeout=60,
    )
    r.raise_for_status()
    return r.text


def _parse_csv(csv_text: str) -> dict:
    """
    Parse EDINET type-5 CSV and extract key financial metrics.
    Returns {key: value_in_yen} for each recognised element.
    """
    raw: dict[str, list[tuple[str, str]]] = {}  # element_id → [(context, value)]
    try:
        reader = csv.reader(io.StringIO(csv_text))
        headers = next(reader, [])
        # Column positions vary; find by header name
        col_element = col_context = col_value = -1
        for i, h in enumerate(headers):
            h_lower = h.strip().lower()
            if "要素" in h or "element" in h_lower:
                col_element = i
            elif "コンテキスト" in h or "context" in h_lower:
                col_context = i
            elif "値" in h or (col_value == -1 and "value" in h_lower):
                col_value = i
        if col_element == -1 or col_value == -1:
            # Fallback: assume element=0, context=1, value=last
            col_element, col_context, col_value = 0, 1, -1

        for row in reader:
            if not row:
                continue
            eid   = row[col_element].strip() if col_element < len(row) else ""
            ctx   = row[col_context].strip() if col_context >= 0 and col_context < len(row) else ""
            val   = row[col_value].strip()   if col_value < len(row) else ""
            if eid and val:
                raw.setdefault(eid, []).append((ctx, val))
    except Exception as exc:
        logger.warning(f"EDINET CSV parse error: {exc}")
        return {}

    def _best_value(candidates: list[tuple[str, str]]) -> Optional[str]:
        """Pick the value whose context best matches consolidated / current year."""
        if not candidates:
            return None
        # Score contexts
        def score(ctx: str) -> int:
            s = 0
            for kw in _PREFER_CONTEXT:
                if kw in ctx:
                    s += 1
            for kw in _AVOID_CONTEXT:
                if kw in ctx:
                    s -= 2
            return s
        best = max(candidates, key=lambda t: score(t[0]))
        return best[1] if best[1] not in ("", "null", "-") else None

    def _pick(element_ids: list[str]) -> Optional[float]:
        for eid in element_ids:
            candidates = raw.get(eid, [])
            val_str = _best_value(candidates)
            if val_str is not None:
                try:
                    return float(val_str)
                except ValueError:
                    continue
        return None

    result: dict = {}
    for key, eids in _ELEMENT_MAP.items():
        result[key] = _pick(eids)
    return result


def _to_m(v: Optional[float]) -> Optional[float]:
    if v is None:
        return None
    return round(v / 1_000_000, 0)


def _to_f(v: Optional[float], digits: int = 2) -> Optional[float]:
    if v is None:
        return None
    return round(v, digits)


async def fetch_edinet_financials(sec_code: str, api_key: str = "") -> Optional[dict]:
    """
    Find the latest 有価証券報告書 for a stock (4-digit code prefix match)
    and return parsed key financials.  Returns None if nothing found.
    """
    sec_code_4 = sec_code[:4]
    today = date.today()
    candidate_dates = _candidate_dates(today)

    async with httpx.AsyncClient(timeout=20) as http:
        # Find the most recent annual report
        best_doc: Optional[dict] = None
        best_period: str = ""
        for check_date in candidate_dates:
            doc = await _doc_list_for_date(http, check_date, sec_code_4, api_key)
            if doc:
                period_end = doc.get("periodEnd") or ""
                if period_end > best_period:
                    best_doc = doc
                    best_period = period_end
                    # Stop searching if the report is recent enough
                    if best_period >= (today - timedelta(days=600)).isoformat():
                        break

        if not best_doc:
            logger.info(f"EDINET: no annual report found for {sec_code}")
            return None

        doc_id = best_doc["docID"]
        filer  = best_doc.get("filerName", "")
        period = best_period[:7].replace("-", "/")
        logger.info(f"EDINET: found {doc_id} for {sec_code} ({filer}) period={period}")

        # Download and parse the type-5 CSV
        try:
            csv_text = await _fetch_csv(http, doc_id, api_key)
        except Exception as exc:
            logger.warning(f"EDINET CSV download failed for {doc_id}: {exc}")
            return None

        raw = _parse_csv(csv_text)
        if not raw:
            return None

        er_raw = raw.get("equity_ratio")
        er = round(er_raw * 100, 1) if er_raw is not None and er_raw <= 1.0 else (
            round(er_raw, 1) if er_raw is not None else None
        )

        return {
            "source": "edinet",
            "period": period,
            "doc_id": doc_id,
            "filer":  filer,
            "records": [{
                "period":       period,
                "fy_end":       best_period,
                "is_ifrs":      False,   # refined from CSV element namespace if needed
                "revenue":      _to_m(raw.get("revenue")),
                "op_income":    _to_m(raw.get("op_income")),
                "ord_income":   _to_m(raw.get("ord_income")),
                "net_income":   _to_m(raw.get("net_income")),
                "eps":          _to_f(raw.get("eps")),
                "dividend":     _to_f(raw.get("dividend")),
                "equity":       _to_m(raw.get("net_assets")),
                "total_assets": _to_m(raw.get("total_assets")),
                "equity_ratio": er,
                "bvps":         _to_f(raw.get("bvps")),
            }],
        }
