"""
EDINET financial data service.

Fetches annual financial figures (有価証券報告書, docTypeCode=120) for a stock
using the free EDINET API v2.

Strategy to avoid brute-force date scanning:
  1. Search the last 30 days (catches very recent filings).
  2. Search June–August for the last 2 years (peak filing season for Mar FY-end companies).
  3. If still not found, scan backwards 4 weeks at a time up to 18 months.
Results are cached in jp_listings.fins_data (30-day TTL).

EDINET type-5 response format:
  - A ZIP archive containing one or more CSVs
  - The main 有価証券報告書 CSV has "asr" in its filename
  - Encoding: UTF-16 LE with BOM
  - Delimiter: tab
  - Columns: 要素ID | 項目名 | コンテキストID | 相対年度 | 連結・個別 | 期間・時点 | ユニットID | 単位 | 値
  - Element IDs use jpcrp_cor: namespace for summary-level data
"""
import csv
import io
import json
import logging
import zipfile
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


# jpcrp_cor element names for the key-financial-data summary section of the annual report.
# These are standard across all companies; try in order — first non-empty wins.
# IFRS variants have "IFRS" in the name; J-GAAP variants do not.
_ELEMENT_MAP = {
    "revenue": [
        "jpcrp_cor:NetSalesIFRSSummaryOfBusinessResults",
        "jpcrp_cor:OperatingRevenueIFRSSummaryOfBusinessResults",
        "jpcrp_cor:NetSalesSummaryOfBusinessResults",
        "jpcrp_cor:RevenuesSummaryOfBusinessResults",
    ],
    "op_income": [
        "jpcrp_cor:OperatingProfitIFRSSummaryOfBusinessResults",
        "jpcrp_cor:OperatingIncomeSummaryOfBusinessResults",
        "jpcrp_cor:OperatingProfitSummaryOfBusinessResults",
        "jppfs_cor:OperatingIncome",           # full-XBRL element present in type-5 for J-GAAP
        "jppfs_cor:OperatingProfit",
    ],
    "ord_income": [
        "jpcrp_cor:OrdinaryIncomeLossSummaryOfBusinessResults",
        "jpcrp_cor:OrdinaryIncomeSummaryOfBusinessResults",
        "jppfs_cor:OrdinaryIncome",
    ],
    "net_income": [
        "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
        "jpcrp_cor:ProfitLossAttributableToOwnersOfParentSummaryOfBusinessResults",
        "jpcrp_cor:NetIncomeSummaryOfBusinessResults",
        "jpcrp_cor:ProfitLossSummaryOfBusinessResults",
    ],
    "total_assets": [
        "jpcrp_cor:TotalAssetsIFRSSummaryOfBusinessResults",
        "jpcrp_cor:TotalAssetsSummaryOfBusinessResults",
    ],
    "net_assets": [
        "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
        "jpcrp_cor:NetAssetsSummaryOfBusinessResults",
    ],
    "eps": [
        "jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults",
        "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults",
        "jpcrp_cor:EarningsPerShareSummaryOfBusinessResults",
    ],
    "dividend": [
        "jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults",
        "jpcrp_cor:AnnualDividendsPerShareSummaryOfBusinessResults",
        "jpcrp_cor:DividendsPerShareSummaryOfBusinessResults",
        "jpcrp_cor:CashDividendsPerShareSummaryOfBusinessResults",
    ],
    "equity_ratio": [
        "jpcrp_cor:RatioOfOwnersEquityToGrossAssetsIFRSSummaryOfBusinessResults",
        "jpcrp_cor:RatioOfEquityToTotalAssetsSummaryOfBusinessResults",
        "jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults",
    ],
    "bvps": [
        # "EquityToAssetRatio" in IFRS is misleadingly named — it stores BVPS in yen
        "jpcrp_cor:EquityToAssetRatioIFRSSummaryOfBusinessResults",
        "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults",
        "jpcrp_cor:BookValuePerShareSummaryOfBusinessResults",
    ],
}

# Keyword sets for context scoring: prefer consolidated / current year
_PREFER_CONTEXT = {"CurrentYear", "Consolidated", "Current"}
_AVOID_CONTEXT  = {"Prior", "Previous", "NonConsolidated", "NonConsolidatedMember"}


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
    for i in range(30):
        dates.append(today - timedelta(days=i))
    for year_offset in (0, 1):
        year = today.year - year_offset
        for m in (7, 6, 8):
            d = date(year, m, 28)
            while d.month == m:
                dates.append(d)
                d -= timedelta(days=1)
    d = today - timedelta(days=35)
    for _ in range(18):
        dates.append(d)
        d -= timedelta(weeks=4)
    seen: set = set()
    unique: list[date] = []
    for d in dates:
        if d not in seen:
            seen.add(d)
            unique.append(d)
    return unique


async def _fetch_csv(http: httpx.AsyncClient, doc_id: str, api_key: str = "") -> str:
    """
    Download the type-5 ZIP from EDINET and return the decoded CSV text.
    The response is a ZIP archive; the main annual-report CSV has "asr" in its name.
    Encoding is UTF-16 LE with BOM; delimiter is tab.
    """
    r = await http.get(
        f"{_EDINET_BASE}/documents/{doc_id}",
        params={"type": "5"},
        headers=_headers(api_key),
        timeout=60,
    )
    r.raise_for_status()
    data = r.content
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
            target = next((n for n in names if "asr" in n), names[0] if names else None)
            if target is None:
                raise ValueError("Empty ZIP from EDINET")
            return zf.read(target).decode("utf-16")
    except zipfile.BadZipFile:
        return data.decode("utf-16", errors="replace")


def _parse_csv(csv_text: str) -> dict:
    """
    Parse EDINET type-5 tab-delimited CSV and extract key financial metrics.
    Returns {key: value_in_yen_or_unit} for each recognised element.
    """
    raw: dict[str, list[tuple[str, str]]] = {}  # element_id → [(context, value)]
    try:
        reader = csv.reader(io.StringIO(csv_text, newline=""), delimiter="\t")
        headers = next(reader, [])
        col_element = col_context = col_value = -1
        for i, h in enumerate(headers):
            h_stripped = h.strip()
            if "要素ID" in h_stripped or h_stripped == "要素":
                col_element = i
            elif "コンテキストID" in h_stripped or "コンテキスト" in h_stripped:
                col_context = i
            elif h_stripped == "値":
                col_value = i
        if col_element == -1 or col_value == -1:
            col_element, col_context, col_value = 0, 2, 8

        for row in reader:
            if not row:
                continue
            eid = row[col_element].strip() if col_element < len(row) else ""
            ctx = row[col_context].strip() if 0 <= col_context < len(row) else ""
            val = row[col_value].strip() if col_value < len(row) else ""
            if eid and val:
                raw.setdefault(eid, []).append((ctx, val))
    except Exception as exc:
        logger.warning(f"EDINET CSV parse error: {exc}")
        return {}

    def _score(ctx: str) -> int:
        s = 0
        for kw in _PREFER_CONTEXT:
            if kw in ctx:
                s += 1
        for kw in _AVOID_CONTEXT:
            if kw in ctx:
                s -= 2
        return s

    def _pick_best(candidates: list[tuple[str, str]]) -> tuple[Optional[str], int]:
        """Return (value, best_score) for the highest-scoring context among candidates."""
        if not candidates:
            return None, -999
        best_cand = max(candidates, key=lambda t: _score(t[0]))
        sc = _score(best_cand[0])
        v = best_cand[1]
        if v in ("", "null", "-", "－"):
            return None, sc
        return v, sc

    def _pick(element_ids: list[str]) -> Optional[float]:
        """Try each element ID in order; accept the first with a non-negative context score.
        If all contexts are negative (e.g. only NonConsolidated exists), return None so
        that a different element in the list can be tried instead of silently using bad data."""
        for eid in element_ids:
            val_str, sc = _pick_best(raw.get(eid, []))
            if val_str is None:
                continue
            if sc >= 0:
                try:
                    return float(val_str)
                except ValueError:
                    continue
            # sc < 0: context is unfavourable (NonConsolidated / Prior) — skip this element
        return None

    result: dict = {}
    for key, eids in _ELEMENT_MAP.items():
        result[key] = _pick(eids)

    # Detect IFRS from whether any IFRS-keyed element exists in the raw map
    is_ifrs = any("IFRS" in eid for eid in raw)

    # Dividend per share is always reported for the parent company only (non-consolidated),
    # because dividends are paid by the parent entity, not the consolidated group.
    # Relax the threshold: accept any current-year context regardless of consolidation scope.
    if result.get("dividend") is None:
        for eid in _ELEMENT_MAP["dividend"]:
            current_year_cands = [
                (ctx, v) for ctx, v in raw.get(eid, [])
                if "CurrentYear" in ctx and "Prior" not in ctx
            ]
            for _, v in current_year_cands:
                if v and v not in ("", "null", "-", "－"):
                    try:
                        result["dividend"] = float(v)
                        break
                    except ValueError:
                        pass
            if result.get("dividend") is not None:
                break

    # Fallback for IFRS companies with company-specific revenue element IDs.
    # Accept only if the best context scores >= 0 (i.e. consolidated / current year).
    if result.get("revenue") is None:
        for eid, candidates in raw.items():
            eid_l = eid.lower()
            if any(kw in eid_l for kw in ("revenue", "netsales", "operatingrevenue")):
                val_str, sc = _pick_best(candidates)
                if val_str and sc >= 0:
                    try:
                        result["revenue"] = float(val_str)
                        break
                    except ValueError:
                        pass

    return result, is_ifrs


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
        best_doc: Optional[dict] = None
        best_period: str = ""
        for check_date in candidate_dates:
            doc = await _doc_list_for_date(http, check_date, sec_code_4, api_key)
            if doc:
                period_end = doc.get("periodEnd") or ""
                if period_end > best_period:
                    best_doc = doc
                    best_period = period_end
                    if best_period >= (today - timedelta(days=600)).isoformat():
                        break

        if not best_doc:
            logger.info(f"EDINET: no annual report found for {sec_code}")
            return None

        doc_id = best_doc["docID"]
        filer  = best_doc.get("filerName", "")
        period = best_period[:7].replace("-", "/")
        logger.info(f"EDINET: found {doc_id} for {sec_code} ({filer}) period={period}")

        try:
            csv_text = await _fetch_csv(http, doc_id, api_key)
        except Exception as exc:
            logger.warning(f"EDINET CSV download failed for {doc_id}: {exc}")
            return None

        metrics, is_ifrs = _parse_csv(csv_text)
        if not metrics:
            return None

        er_raw = metrics.get("equity_ratio")
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
                "is_ifrs":      is_ifrs,
                "revenue":      _to_m(metrics.get("revenue")),
                "op_income":    _to_m(metrics.get("op_income")),
                "ord_income":   _to_m(metrics.get("ord_income")),
                "net_income":   _to_m(metrics.get("net_income")),
                "eps":          _to_f(metrics.get("eps")),
                "dividend":     _to_f(metrics.get("dividend")),
                "equity":       _to_m(metrics.get("net_assets")),
                "total_assets": _to_m(metrics.get("total_assets")),
                "equity_ratio": er,
                "bvps":         _to_f(metrics.get("bvps")),
            }],
        }
