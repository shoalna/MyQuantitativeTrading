import asyncio
import calendar
import json
import logging
from datetime import date, datetime, timedelta
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.jquants.com/v2"
_MASTER_ENDPOINT = "/equities/master"   # V2 company name/code list
_DAILY_ENDPOINT  = "/equities/bars/daily"

_RATE_LIMIT = 60  # requests per minute (JQuants free plan)


class _RateLimiter:
    """Sliding-window: ensures ≤ rate calls per 60 s, shared across all instances."""
    def __init__(self, rate: int = 60):
        self._interval = 60.0 / rate
        self._lock = asyncio.Lock()
        self._next_slot: float = 0.0

    async def wait(self) -> None:
        async with self._lock:
            now = asyncio.get_event_loop().time()
            delay = self._next_slot - now
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_slot = asyncio.get_event_loop().time() + self._interval


_limiter: _RateLimiter | None = None


def _get_limiter() -> _RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = _RateLimiter(rate=_RATE_LIMIT)
    return _limiter


# ── HTTP client ────────────────────────────────────────────────────────────────

class JQuantsClient:
    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("JQUANTS_API_KEY is not configured")
        self.headers = {"x-api-key": api_key}

    async def _get(self, endpoint: str, params: dict | None = None) -> dict:
        """Rate-limited GET with automatic 429 retry (honours Retry-After)."""
        clean_params = {k: v for k, v in (params or {}).items() if v is not None}
        limiter = _get_limiter()
        backoffs = [10, 30, 60]
        for attempt, backoff in enumerate(backoffs, start=1):
            await limiter.wait()
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.get(
                        f"{BASE_URL}{endpoint}",
                        headers=self.headers,
                        params=clean_params,
                    )
                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", backoff))
                    logger.warning(f"Rate limited (attempt {attempt}/3). Waiting {wait}s.")
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError:
                raise
            except httpx.RequestError as exc:
                if attempt == len(backoffs):
                    raise
                logger.warning(f"Request error attempt {attempt}: {exc}. Retry in {backoff}s.")
                await asyncio.sleep(backoff)
        raise httpx.HTTPError("JQuants API: max retries exceeded")

    async def get_eq_master(
        self,
        code: Optional[str] = None,
        date_str: Optional[str] = None,
        on_page: Optional[Callable] = None,
    ) -> list[dict]:
        """
        Fetch all companies from /equities/master, following pagination_key automatically.
        on_page(page_num, total_so_far) is called after each page if provided.
        """
        params: dict = {}
        if code:
            params["code"] = code
        if date_str:
            params["date"] = date_str

        all_records: list[dict] = []
        page_num = 0
        while True:
            data = await self._get(_MASTER_ENDPOINT, params)
            # V2 actual response key is "data"; keep fallbacks for API evolution
            records = (
                data.get("data")
                or data.get("master")
                or data.get("info")
                or data.get("listings")
                or data.get("companies")
                or []
            )
            all_records.extend(records)
            page_num += 1

            if on_page:
                await on_page(page_num, len(all_records))

            pagination_key = data.get("pagination_key") or ""
            if not pagination_key:
                break
            params["pagination_key"] = pagination_key

        return all_records

    async def probe(self) -> dict:
        """Fetch one record to verify API key + expose raw field names (1 rate-limit slot)."""
        data = await self._get(_MASTER_ENDPOINT, {"code": "13010"})
        records = (
            data.get("data")
            or data.get("master") or data.get("info")
            or data.get("listings") or data.get("companies") or []
        )
        return {
            "endpoint": f"{BASE_URL}{_MASTER_ENDPOINT}",
            "response_top_keys": list(data.keys()),
            "record_count": len(records),
            "sample_record": records[0] if records else {},
            "field_names": list(records[0].keys()) if records else [],
        }

    async def get_fins_statements(self, code: str) -> list[dict]:
        """Fetch all financial statements for a stock from JQuants /fins/statements."""
        all_records: list[dict] = []
        params: dict = {"code": code}
        while True:
            data = await self._get("/fins/statements", params)
            records = data.get("statements", [])
            all_records.extend(records)
            pk = data.get("pagination_key", "")
            if not pk:
                break
            params["pagination_key"] = pk
        return all_records

    async def get_daily_quotes(
        self,
        code: Optional[str] = None,
        date_str: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> list[dict]:
        params = {"code": code, "date": date_str, "from": from_date, "to": to_date}
        data = await self._get(_DAILY_ENDPOINT, params)
        # V2 confirmed response key is "data"; keep legacy fallbacks
        return (
            data.get("data")
            or data.get("daily_quotes") or data.get("bars")
            or data.get("quotes") or []
        )


# ── Field normalisation ────────────────────────────────────────────────────────

def _normalize_listing(row: dict) -> dict:
    # V2 /equities/master confirmed field names (as of 2026-05):
    #   Code, CoName, CoNameEn, S33Nm (sector), MktNm (market)
    # Legacy V1 / fallback names kept for forward-compatibility.
    return {
        "code": str(row.get("Code") or row.get("code") or "").strip(),
        "name": str(
            row.get("CoName") or row.get("CompanyName") or row.get("companyName")
            or row.get("company_name") or row.get("name") or ""
        ),
        "name_en": str(
            row.get("CoNameEn") or row.get("CompanyNameEnglish") or row.get("companyNameEnglish")
            or row.get("company_name_en") or row.get("nameEn") or row.get("name_en") or ""
        ),
        "sector": str(
            row.get("S33Nm") or row.get("Sector33CodeName") or row.get("sector33CodeName")
            or row.get("sector_name") or row.get("sector") or ""
        ),
        "market": str(
            row.get("MktNm") or row.get("MarketCodeName") or row.get("marketCodeName")
            or row.get("market_name") or row.get("market") or ""
        ),
    }


def _normalize_quote(q: dict) -> dict:
    # V2 /equities/bars/daily confirmed field names (as of 2026-05):
    #   AdjC (adj. close), C (close), AdjO, O, AdjH, H, AdjL, L, AdjVo, Vo
    # Legacy long-form names kept for forward-compatibility.
    close = float(
        q.get("AdjC") or q.get("AdjustmentClose") or q.get("adjustment_close")
        or q.get("C") or q.get("Close") or q.get("close") or 0
    )
    return {
        "code": str(q.get("Code") or q.get("code", "")).strip(),
        "date": str(q.get("Date") or q.get("date", "")),
        "close": close,
        "open":   float(q.get("AdjO") or q.get("AdjustmentOpen")   or q.get("O") or q.get("Open")   or q.get("open")   or 0),
        "high":   float(q.get("AdjH") or q.get("AdjustmentHigh")   or q.get("H") or q.get("High")   or q.get("high")   or 0),
        "low":    float(q.get("AdjL") or q.get("AdjustmentLow")    or q.get("L") or q.get("Low")    or q.get("low")    or 0),
        "volume": int(  q.get("AdjVo") or q.get("AdjustmentVolume") or q.get("Vo") or q.get("Volume") or q.get("volume") or 0),
    }


def _to_yyyymmdd(d: date) -> str:
    return d.strftime("%Y%m%d")


def _month_end_dates(n_months: int, reference: Optional[date] = None) -> list[date]:
    """Returns the last calendar day of each of the past n_months months (index 0 = current month)."""
    if reference is None:
        reference = date.today()
    result = []
    y, m = reference.year, reference.month
    for _ in range(n_months):
        last_day = calendar.monthrange(y, m)[1]
        result.append(date(y, m, last_day))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return result


# ── DB helpers for jp_daily_prices ────────────────────────────────────────────

async def _store_daily_prices(pool, quotes: list[dict]) -> None:
    """Upsert normalized OHLCV quotes into jp_daily_prices."""
    records = []
    for q in quotes:
        if not q.get("code") or not q.get("close"):
            continue
        raw = q.get("date", "")
        try:
            if len(raw) == 8:
                d = date(int(raw[:4]), int(raw[4:6]), int(raw[6:8]))
            elif len(raw) >= 10:
                d = date.fromisoformat(raw[:10])
            else:
                continue
        except (ValueError, TypeError):
            continue
        records.append((
            q["code"], d,
            q.get("open") or None,
            q.get("high") or None,
            q.get("low") or None,
            q["close"],
            q.get("volume") or None,
        ))
    if not records:
        return
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                INSERT INTO jp_daily_prices (code, date, open, high, low, close, volume)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (code, date) DO UPDATE SET
                    open   = EXCLUDED.open,
                    high   = EXCLUDED.high,
                    low    = EXCLUDED.low,
                    close  = EXCLUDED.close,
                    volume = EXCLUDED.volume
                """,
                records,
            )


async def _find_latest_trading_day(client: JQuantsClient, start: date, max_lookback: int = 7) -> tuple[date, list[dict]]:
    """
    Walk backwards from `start` until we find a date the API has price data for.
    Returns (trading_date, raw_records) so the caller can reuse the fetched data
    without making a second bulk API call for the same date.
    """
    for offset in range(max_lookback):
        candidate = start - timedelta(days=offset)
        records = await client.get_daily_quotes(date_str=_to_yyyymmdd(candidate))
        if records:
            logger.info(f"Latest trading day with data: {candidate}")
            return candidate, records
    raise RuntimeError(f"No trading data found in the last {max_lookback} days")


async def _fetch_daily_for_month(
    pool,
    client: JQuantsClient,
    month_end: date,
    on_step: Optional[Callable] = None,
) -> tuple[date, dict[str, float]]:
    """
    DB-first: check jp_daily_prices for any trading day within the target month.
    Falls back to JQuants API on cache miss, then stores result in DB.
    Returns (actual_trading_date, {code: close_price}).
    """
    upper_bound = min(date.today(), month_end)
    month_start = month_end.replace(day=1)

    # Check DB for the latest trading day we have within this month
    async with pool.acquire() as conn:
        cached_date = await conn.fetchval(
            "SELECT MAX(date) FROM jp_daily_prices WHERE date >= $1 AND date <= $2",
            month_start, upper_bound,
        )

    if cached_date:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT code, close FROM jp_daily_prices WHERE date = $1 AND close IS NOT NULL",
                cached_date,
            )
        # Reject suspiciously small cache hits — they indicate a partial previous write
        if len(rows) >= 100:
            logger.info(f"Cache hit for {month_end.strftime('%Y-%m')}: {len(rows)} rows from {cached_date}")
            return cached_date, {r["code"]: float(r["close"]) for r in rows}
        logger.warning(f"Cache for {month_end.strftime('%Y-%m')} has only {len(rows)} rows — treating as miss")

    # Cache miss — fetch from API; reuse the records already pulled by the probe
    logger.info(f"Cache miss for {month_end.strftime('%Y-%m')}: fetching from API")
    if on_step:
        await on_step(f"Fetching {month_end.strftime('%Y-%m')} from API…", 0)

    trading_day, raw = await _find_latest_trading_day(client, upper_bound)
    quotes = [_normalize_quote(r) for r in raw]
    await _store_daily_prices(pool, quotes)

    price_map = {q["code"]: q["close"] for q in quotes if q["code"] and q["close"]}
    return trading_day, price_map


# ── DB refresh helpers ─────────────────────────────────────────────────────────

async def refresh_listings(
    pool,
    client: JQuantsClient,
    on_step: Optional[Callable] = None,
) -> int:
    """
    Fetch all listed companies via /equities/master (paginated) and upsert into jp_listings.
    on_step(message, count) is called at key stages to allow live progress reporting.
    """
    if on_step:
        await on_step("Connecting to JQuants /equities/master…", 0)

    async def _on_page(page_num: int, total: int) -> None:
        logger.info(f"  listings page {page_num}: {total} companies so far")
        if on_step:
            await on_step(f"Fetching page {page_num} — {total} companies received…", total)

    raw = await client.get_eq_master(on_page=_on_page)
    companies = [c for c in (_normalize_listing(r) for r in raw) if c["code"]]

    if on_step:
        await on_step(f"Storing {len(companies)} companies to database…", len(companies))

    now = datetime.utcnow()
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO jp_listings (code, name, name_en, sector, market, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (code) DO UPDATE SET
                name       = EXCLUDED.name,
                name_en    = EXCLUDED.name_en,
                sector     = EXCLUDED.sector,
                market     = EXCLUDED.market,
                updated_at = EXCLUDED.updated_at
            """,
            [(c["code"], c["name"], c["name_en"], c["sector"], c["market"], now) for c in companies],
        )

    logger.info(f"Upserted {len(companies)} listings")
    return len(companies)


async def refresh_prices(
    pool,
    client: JQuantsClient,
    on_step: Optional[Callable] = None,
) -> int:
    """
    Fetch end-of-month closing prices for 7 months (current + 6 prior).
    Reads from jp_daily_prices DB cache before calling JQuants API.
    Computes 6 consecutive month-over-month changes and stores their mean
    as change_6m in jp_stock_summary.
    """
    month_ends = _month_end_dates(7)  # [current_month_end, 1m_ago, ..., 6m_ago]

    monthly_maps: list[dict[str, float]] = []
    for i, me in enumerate(month_ends):
        label = "current month" if i == 0 else f"{i}m ago"
        if on_step:
            await on_step(f"Getting prices for {me.strftime('%Y-%m')} ({label})…", i)
        try:
            _, price_map = await _fetch_daily_for_month(pool, client, me, on_step)
        except Exception as exc:
            logger.warning(f"Failed to fetch {me.strftime('%Y-%m')}: {exc}")
            price_map = {}
        monthly_maps.append(price_map)
        logger.info(f"  {me.strftime('%Y-%m')}: {len(price_map)} prices loaded")

    if on_step:
        await on_step("Computing mean monthly changes…", 0)

    # Use codes present in the current month as the master list
    all_codes = set(monthly_maps[0])
    now = datetime.utcnow()
    records = []

    for code in all_codes:
        prices = [m.get(code) for m in monthly_maps]  # [P0, P1, ..., P6]
        current_price = prices[0]

        # Compute consecutive month-over-month % changes from available pairs
        changes = []
        for i in range(6):
            p_now = prices[i]
            p_prev = prices[i + 1]
            if p_now and p_prev and p_prev != 0:
                changes.append((p_now - p_prev) / p_prev * 100)
        mean_change = sum(changes) / len(changes) if changes else None

        # price_6m_ago is the true 6-month-ago price (may be None)
        price_6m_ago = prices[6] if len(prices) > 6 else None

        # For abs_change, use oldest available monthly price as reference.
        # Walk backwards from month 6 to find the oldest price we have.
        ref_price: Optional[float] = None
        change_months: Optional[int] = None
        for i in range(6, 0, -1):
            if prices[i] is not None:
                ref_price = prices[i]
                change_months = i
                break
        abs_change = (current_price - ref_price) if current_price and ref_price else None

        records.append((code, current_price, price_6m_ago, mean_change, abs_change, change_months, now))

    if on_step:
        await on_step(f"Writing {len(records)} summaries to database…", len(records))

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO jp_stock_summary (code, current_price, price_6m_ago, change_6m, abs_change_6m, change_months, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (code) DO UPDATE SET
                current_price = EXCLUDED.current_price,
                price_6m_ago  = EXCLUDED.price_6m_ago,
                change_6m     = EXCLUDED.change_6m,
                abs_change_6m = EXCLUDED.abs_change_6m,
                change_months = EXCLUDED.change_months,
                updated_at    = EXCLUDED.updated_at
            """,
            records,
        )

    logger.info(f"Updated {len(records)} price summaries")
    if on_step:
        await on_step("Computing AQR factor scores…", 0)
    try:
        await compute_aqr_scores(pool)
    except Exception as exc:
        logger.warning(f"AQR computation failed (non-fatal): {exc}")
    return len(records)


async def compute_aqr_scores(pool) -> int:
    """
    Compute all 5 strategy scores for every stock (guide_search.md §7):

    1. TSMOM   (score_tsmom):  Percentile rank of 6-month return. >50=long, <50=short.
    2. RSI(2)  (score_rsi2):   2-period RSI from recent closes. <15=oversold, >85=overbought.
    3. BB Squeeze (score_bb):  Band-width compression 0–100. 100=maximum squeeze.
    4. Pair    (score_pair):   Sector deviation z-score → 0–100. >50=outperforming sector.
    5. CS Mom  (score_cs_mom): Percentile rank of 3-month return (skip last 1m). >50=top.

    Also recomputes legacy aqr_score / aqr_mom / aqr_vol for the AQR filter UI.
    """
    async with pool.acquire() as conn:
        # 1. TSMOM — percentile rank of 6m mean-monthly return
        # PERCENT_RANK() returns double precision; cast to numeric for ROUND
        tsmom_rows = await conn.fetch("""
            SELECT code,
                   ROUND((PERCENT_RANK() OVER (ORDER BY change_6m NULLS FIRST) * 100)::numeric, 1) AS score
            FROM jp_stock_summary WHERE change_6m IS NOT NULL
        """)

        # 2. RSI(2) — from whatever daily closes we have in the last 90 days
        #    (month-end snapshots give ~2–3 points; viewed stocks have full daily data)
        rsi2_rows = await conn.fetch("""
            WITH diffs AS (
                SELECT code,
                       close - LAG(close) OVER (PARTITION BY code ORDER BY date) AS diff
                FROM jp_daily_prices
                WHERE date >= CURRENT_DATE - INTERVAL '90 days' AND close IS NOT NULL
            ),
            agg AS (
                SELECT code,
                       AVG(CASE WHEN diff > 0 THEN diff ELSE 0   END) AS avg_gain,
                       AVG(CASE WHEN diff < 0 THEN ABS(diff) ELSE 0 END) AS avg_loss
                FROM diffs WHERE diff IS NOT NULL
                GROUP BY code HAVING COUNT(*) >= 2
            )
            SELECT code,
                   ROUND((
                       CASE WHEN avg_loss = 0 THEN 100.0
                            WHEN avg_gain = 0 THEN   0.0
                            ELSE 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
                       END)::numeric, 1) AS rsi2
            FROM agg
        """)

        # 3. BB Squeeze intensity — requires 15+ consecutive daily prices
        # STDDEV returns double precision; cast bandwidth chain to numeric
        bb_rows = await conn.fetch("""
            WITH bb AS (
                SELECT code, date,
                       AVG(close) OVER w           AS sma20,
                       STDDEV(close) OVER w        AS std20,
                       COUNT(close) OVER w          AS cnt
                FROM jp_daily_prices
                WHERE date >= CURRENT_DATE - INTERVAL '200 days' AND close IS NOT NULL
                WINDOW w AS (PARTITION BY code ORDER BY date ROWS 19 PRECEDING)
            ),
            bw AS (
                SELECT code, date,
                       CASE WHEN sma20 > 0 AND cnt >= 15
                            THEN (4.0 * std20 / sma20 * 100)::numeric
                            ELSE NULL END AS bandwidth
                FROM bb
            ),
            hist AS (
                SELECT code, date, bandwidth,
                       MIN(bandwidth) OVER (PARTITION BY code ORDER BY date
                                            ROWS 119 PRECEDING) AS min_bw,
                       MAX(bandwidth) OVER (PARTITION BY code ORDER BY date
                                            ROWS 119 PRECEDING) AS max_bw,
                       ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
                FROM bw WHERE bandwidth IS NOT NULL
            )
            SELECT code,
                   ROUND(CASE WHEN max_bw > min_bw
                              THEN (1.0 - (bandwidth - min_bw) / (max_bw - min_bw)) * 100
                              ELSE 50.0 END, 1) AS bb_score
            FROM hist WHERE rn = 1
        """)

        # 4. Pair trade proxy — sector deviation z-score mapped to 0–100
        # STDDEV returns double precision; cast the whole expression to numeric
        pair_rows = await conn.fetch("""
            WITH stats AS (
                SELECT l.sector,
                       AVG(s.change_6m)                         AS mean,
                       NULLIF(STDDEV(s.change_6m)::numeric, 0)  AS std
                FROM jp_stock_summary s
                JOIN jp_listings l ON l.code = s.code
                WHERE s.change_6m IS NOT NULL
                  AND l.sector NOT IN ('', 'その他')
                GROUP BY l.sector HAVING COUNT(*) >= 5
            )
            SELECT s.code,
                   ROUND(LEAST(100.0, GREATEST(0.0,
                       ((s.change_6m - st.mean) / st.std + 3.0) / 6.0 * 100.0
                   ))::numeric, 1) AS score
            FROM jp_stock_summary s
            JOIN jp_listings l ON l.code = s.code
            JOIN stats st ON st.sector = l.sector
            WHERE s.change_6m IS NOT NULL
        """)

        # 5. CS Momentum — 3m return skipping the most recent month, percentile rank
        cs_mom_rows = await conn.fetch("""
            WITH monthly AS (
                SELECT code,
                       DATE_TRUNC('month', date) AS month,
                       MAX(date)                 AS last_date
                FROM jp_daily_prices
                WHERE date >= CURRENT_DATE - INTERVAL '5 months' AND close IS NOT NULL
                GROUP BY code, DATE_TRUNC('month', date)
            ),
            prices AS (
                SELECT m.code, m.month, p.close
                FROM monthly m
                JOIN jp_daily_prices p ON p.code = m.code AND p.date = m.last_date
            ),
            ranked AS (
                SELECT code, close,
                       ROW_NUMBER() OVER (PARTITION BY code ORDER BY month DESC) AS mn
                FROM prices
            ),
            ret3m AS (
                SELECT b.code,
                       (b.close - c.close) / NULLIF(c.close, 0) * 100 AS ret
                FROM ranked b
                JOIN ranked c ON c.code = b.code AND c.mn = 5
                WHERE b.mn = 2 AND c.close > 0
            )
            SELECT code,
                   ROUND((PERCENT_RANK() OVER (ORDER BY ret NULLS FIRST) * 100)::numeric, 1) AS score
            FROM ret3m WHERE ret IS NOT NULL
        """)

        # Legacy low-vol factor (kept for aqr_vol / aqr_score composite)
        vol_rows = await conn.fetch("""
            WITH monthly_extremes AS (
                SELECT code,
                       DATE_TRUNC('month', date) AS month,
                       MAX(date) AS last_date
                FROM jp_daily_prices
                WHERE date >= CURRENT_DATE - INTERVAL '7 months'
                  AND close IS NOT NULL
                GROUP BY code, DATE_TRUNC('month', date)
            ),
            month_prices AS (
                SELECT me.code, me.month, p.close AS month_close
                FROM monthly_extremes me
                JOIN jp_daily_prices p ON p.code = me.code AND p.date = me.last_date
            ),
            monthly_returns AS (
                SELECT code,
                       month_close / NULLIF(LAG(month_close) OVER (
                           PARTITION BY code ORDER BY month
                       ), 0) - 1 AS monthly_ret
                FROM month_prices
            ),
            vol_stats AS (
                SELECT code, STDDEV(monthly_ret) AS ret_stddev
                FROM monthly_returns
                WHERE monthly_ret IS NOT NULL
                GROUP BY code HAVING COUNT(monthly_ret) >= 2
            )
            SELECT code,
                   PERCENT_RANK() OVER (ORDER BY ret_stddev DESC NULLS LAST) * 100 AS vol_pct
            FROM vol_stats
        """)

    tsmom_map  = {r["code"]: float(r["score"])    for r in tsmom_rows}
    rsi2_map   = {r["code"]: float(r["rsi2"])     for r in rsi2_rows}
    bb_map     = {r["code"]: float(r["bb_score"]) for r in bb_rows}
    pair_map   = {r["code"]: float(r["score"])    for r in pair_rows}
    cs_mom_map = {r["code"]: float(r["score"])    for r in cs_mom_rows}
    vol_map    = {r["code"]: float(r["vol_pct"])  for r in vol_rows}

    # Base: all codes that have at least a TSMOM or Pair score
    all_codes = set(tsmom_map) | set(pair_map)
    if not all_codes:
        return 0

    records = []
    for code in all_codes:
        mom_pct = tsmom_map.get(code)
        vol_pct = vol_map.get(code)
        aqr = 0.6 * mom_pct + 0.4 * vol_pct if mom_pct is not None and vol_pct is not None else mom_pct
        records.append((
            round(aqr,     1) if aqr     is not None else None,
            round(mom_pct, 1) if mom_pct is not None else None,
            round(vol_pct, 1) if vol_pct is not None else None,
            tsmom_map.get(code),
            rsi2_map.get(code),
            bb_map.get(code),
            pair_map.get(code),
            cs_mom_map.get(code),
            code,
        ))

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.executemany(
                """
                UPDATE jp_stock_summary
                SET aqr_score   = $1, aqr_mom    = $2, aqr_vol    = $3,
                    score_tsmom = $4, score_rsi2 = $5, score_bb   = $6,
                    score_pair  = $7, score_cs_mom = $8
                WHERE code = $9
                """,
                records,
            )

    logger.info(f"Computed strategy scores for {len(records)} stocks")
    return len(records)


async def get_chart_data(pool, client: JQuantsClient, code: str) -> list[dict]:
    """
    2-year monthly closes + 6-month MA for one stock.
    Reads from jp_daily_prices DB first; falls back to API on cache miss.
    Chart metadata cached in jp_chart_cache for 7 days.
    """
    async with pool.acquire() as conn:
        cached = await conn.fetchrow(
            "SELECT chart_data, updated_at FROM jp_chart_cache WHERE code = $1", code
        )
    if cached and (datetime.utcnow() - cached["updated_at"]).days < 7:
        return cached["chart_data"]

    today = date.today()
    two_years_ago = today - timedelta(days=730)

    # Try DB first for 2-year history
    async with pool.acquire() as conn:
        db_rows = await conn.fetch(
            """
            SELECT date, close FROM jp_daily_prices
            WHERE code = $1 AND date >= $2 AND date <= $3 AND close IS NOT NULL
            ORDER BY date
            """,
            code, two_years_ago, today,
        )

    if db_rows:
        quotes = [{"date": r["date"].strftime("%Y%m%d"), "close": float(r["close"])} for r in db_rows]
    else:
        # API fallback — fetch and store for future use
        raw = await client.get_daily_quotes(
            code=code,
            from_date=_to_yyyymmdd(two_years_ago),
            to_date=_to_yyyymmdd(today),
        )
        quotes = sorted((_normalize_quote(r) for r in raw), key=lambda x: x["date"])
        await _store_daily_prices(pool, quotes)

    monthly: dict[str, float] = {}
    for q in quotes:
        d = q["date"] if isinstance(q["date"], str) else q["date"].strftime("%Y%m%d")
        month_key = f"{d[:4]}-{d[4:6]}" if len(d) == 8 else d[:7]
        if q["close"]:
            monthly[month_key] = q["close"]

    months = sorted(monthly)
    closes = [monthly[m] for m in months]

    result = [
        {
            "month": month,
            "close": round(closes[i], 2),
            "ma6": round(sum(closes[i - 5:i + 1]) / 6, 2) if i >= 5 else None,
        }
        for i, month in enumerate(months)
    ]

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO jp_chart_cache (code, chart_data, updated_at)
            VALUES ($1, $2::jsonb, $3)
            ON CONFLICT (code) DO UPDATE SET
                chart_data = EXCLUDED.chart_data,
                updated_at = EXCLUDED.updated_at
            """,
            code, result, datetime.utcnow(),
        )

    return result


# ── Quarterly financial statements (JQuants) ──────────────────────────────────

def _safe_float(v) -> Optional[float]:
    try:
        return None if v in (None, "", "-") else float(v)
    except (ValueError, TypeError):
        return None


def _parse_quarterly_fins(statements: list[dict]) -> list[dict]:
    """
    Convert JQuants cumulative quarterly statements into individual quarter values.
    De-cumulates within each fiscal year and computes YoY op-profit change.
    Returns up to 8 quarters sorted chronologically.
    """
    from collections import defaultdict

    valid_types = {"1Q", "2Q", "3Q", "FY"}
    best: dict[tuple, dict] = {}

    for s in statements:
        period_type = s.get("TypeOfCurrentPeriod", "")
        if period_type not in valid_types:
            continue
        doc_type = s.get("TypeOfDocument", "")
        if "Forecast" in doc_type or "Revision" in doc_type:
            continue
        fy_start = s.get("CurrentFiscalYearStartDate", "")
        if not fy_start or len(fy_start) < 4:
            continue
        fy_year = int(fy_start[:4])
        disclosed = s.get("DisclosedDate", "")
        is_consol = "Consolidated" in doc_type

        key = (fy_year, period_type)
        prev = best.get(key)
        prev_consol = "Consolidated" in (prev or {}).get("_doc_type", "")
        if prev is None or (is_consol and not prev_consol) or \
                (is_consol == prev_consol and disclosed > prev.get("_disclosed", "")):
            best[key] = {
                "fy_year": fy_year, "period_type": period_type,
                "_disclosed": disclosed, "_doc_type": doc_type,
                "net_sales":  _safe_float(s.get("NetSales")),
                "op_profit":  _safe_float(s.get("OperatingProfit") or s.get("OperatingIncome")),
                "net_income": _safe_float(s.get("Profit") or s.get("NetIncome")),
            }

    def _sub(a: Optional[dict], b: Optional[dict], key: str) -> Optional[float]:
        av = (a or {}).get(key)
        bv = (b or {}).get(key)
        return None if av is None else (av if bv is None else av - bv)

    by_fy: dict = defaultdict(dict)
    for s in best.values():
        by_fy[s["fy_year"]][s["period_type"]] = s

    quarters: list[dict] = []
    for fy_year in sorted(by_fy.keys()):
        fy = by_fy[fy_year]
        q1, q2, q3, fy_d = fy.get("1Q"), fy.get("2Q"), fy.get("3Q"), fy.get("FY")
        yr = str(fy_year)[2:]

        if q1:
            quarters.append({"fy_year": fy_year, "quarter": "1Q", "label": f"{yr}Q1",
                              "net_sales": q1["net_sales"], "op_profit": q1["op_profit"], "net_income": q1["net_income"]})
        if q2:
            quarters.append({"fy_year": fy_year, "quarter": "2Q", "label": f"{yr}Q2",
                              "net_sales": _sub(q2, q1, "net_sales"), "op_profit": _sub(q2, q1, "op_profit"), "net_income": _sub(q2, q1, "net_income")})
        if q3:
            prev = q2 or q1
            quarters.append({"fy_year": fy_year, "quarter": "3Q", "label": f"{yr}Q3",
                              "net_sales": _sub(q3, prev, "net_sales"), "op_profit": _sub(q3, prev, "op_profit"), "net_income": _sub(q3, prev, "net_income")})
        if fy_d:
            prev = q3 or q2 or q1
            quarters.append({"fy_year": fy_year, "quarter": "FY", "label": f"{yr}Q4",
                              "net_sales": _sub(fy_d, prev, "net_sales"), "op_profit": _sub(fy_d, prev, "op_profit"), "net_income": _sub(fy_d, prev, "net_income")})

    q_map = {(q["fy_year"], q["quarter"]): q for q in quarters}
    for q in quarters:
        prev = q_map.get((q["fy_year"] - 1, q["quarter"]))
        if prev and prev.get("op_profit") and q.get("op_profit") is not None:
            q["op_profit_yoy"] = round((q["op_profit"] - prev["op_profit"]) / abs(prev["op_profit"]) * 100, 1)
        else:
            q["op_profit_yoy"] = None

    return quarters[-8:]


async def get_quarterly_fins(pool, client: Optional[JQuantsClient], code: str) -> Optional[list]:
    """Return quarterly financial data with 30-day DB cache."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT fins_data, fins_fetched_at FROM jp_listings WHERE code=$1", code
        )

    if row and row["fins_fetched_at"] and row["fins_data"]:
        age = (datetime.utcnow() - row["fins_fetched_at"].replace(tzinfo=None)).days
        if age < 30:
            cached = json.loads(row["fins_data"])
            if isinstance(cached, list):
                return cached

    if not client:
        return None

    try:
        statements = await client.get_fins_statements(code)
        quarterly = _parse_quarterly_fins(statements)
        if quarterly:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE jp_listings SET fins_data=$1, fins_fetched_at=NOW() WHERE code=$2",
                    json.dumps(quarterly), code,
                )
        return quarterly or None
    except Exception as exc:
        logger.warning(f"Quarterly fins fetch failed for {code}: {exc}")
        return None


# ── Wikipedia & stock detail ───────────────────────────────────────────────────

_EN_CORP_SUFFIXES = [
    "Co., Ltd.", "Co.,Ltd.", "Co. Ltd.", "Holdings Co., Ltd.", "Holdings Co.",
    "Holdings, Inc.", "Holdings", "Group Co., Ltd.", "Group Co.", "Group",
    "Ltd.", "Inc.", "Corp.", "Corporation", "K.K.", "G.K.", "& Co.", "plc", "PLC",
]

def _clean_en_name(name: str) -> str:
    for s in _EN_CORP_SUFFIXES:
        name = name.replace(s, "")
    return name.strip(" ,.")

def _clean_ja_name(name: str) -> str:
    return (
        name.replace("株式会社", "").replace("（株）", "").replace("(株)", "")
        .replace("合同会社", "").replace("有限会社", "").strip()
    )

_WIKI_BASES = {
    "en": "https://en.wikipedia.org",
    "ja": "https://ja.wikipedia.org",
    "zh": "https://zh.wikipedia.org",
}
_WIKI_HEADERS = {"User-Agent": "MyQuantitativeTrading/1.0 (research tool)"}

async def _wiki_search(http: httpx.AsyncClient, base_url: str, term: str) -> str | None:
    """Search Wikipedia and return the best-matching article title, or None."""
    r = await http.get(
        f"{base_url}/w/api.php",
        params={"action": "query", "list": "search", "srsearch": term,
                "srlimit": 1, "format": "json", "utf8": 1},
        headers=_WIKI_HEADERS,
    )
    r.raise_for_status()
    results = r.json().get("query", {}).get("search", [])
    return results[0]["title"] if results else None

async def _wiki_extract(http: httpx.AsyncClient, base_url: str, title: str) -> str | None:
    """Fetch the intro extract for a known article title."""
    r = await http.get(
        f"{base_url}/w/api.php",
        params={"action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
                "titles": title, "format": "json", "utf8": 1},
        headers=_WIKI_HEADERS,
    )
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", {})
    return next(iter(pages.values()), {}).get("extract") or None

async def _wiki_langlinks(http: httpx.AsyncClient, base_url: str, title: str) -> dict[str, str]:
    """Return {lang_code: article_title} for interlanguage links of a given article."""
    r = await http.get(
        f"{base_url}/w/api.php",
        params={"action": "query", "titles": title, "prop": "langlinks",
                "lllimit": "max", "format": "json", "utf8": 1},
        headers=_WIKI_HEADERS,
    )
    r.raise_for_status()
    pages = r.json().get("query", {}).get("pages", {})
    links = next(iter(pages.values()), {}).get("langlinks", [])
    return {ll["lang"]: ll["*"] for ll in links}

async def fetch_wikipedia_all_langs(name_en: str, name_ja: str) -> dict:
    """
    Fetch Wikipedia intro extracts in en, ja, zh using interlanguage links.
    Returns {lang: {title, extract, url}} for each language found.
    English is tried first; Japanese is the fallback primary source.
    """
    results: dict = {}
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            # 1. Find the primary article (English first, Japanese fallback)
            primary_lang = primary_title = primary_base = None
            if name_en:
                cleaned = _clean_en_name(name_en)
                if cleaned:
                    t = await _wiki_search(http, _WIKI_BASES["en"], cleaned)
                    if t:
                        ex = await _wiki_extract(http, _WIKI_BASES["en"], t)
                        if ex:
                            results["en"] = {"title": t, "extract": ex,
                                             "url": f"{_WIKI_BASES['en']}/wiki/{t.replace(' ', '_')}"}
                            primary_lang, primary_title, primary_base = "en", t, _WIKI_BASES["en"]
            if not primary_lang and name_ja:
                cleaned = _clean_ja_name(name_ja)
                if cleaned:
                    t = await _wiki_search(http, _WIKI_BASES["ja"], cleaned)
                    if t:
                        ex = await _wiki_extract(http, _WIKI_BASES["ja"], t)
                        if ex:
                            results["ja"] = {"title": t, "extract": ex,
                                             "url": f"{_WIKI_BASES['ja']}/wiki/{t.replace(' ', '_')}"}
                            primary_lang, primary_title, primary_base = "ja", t, _WIKI_BASES["ja"]
            if not primary_lang:
                return results

            # 2. Get interlanguage links from the primary article
            lang_map = await _wiki_langlinks(http, primary_base, primary_title)

            # 3. Fetch each missing target language via its linked title
            for tl in ("en", "ja", "zh"):
                if tl in results:
                    continue
                linked_title = lang_map.get(tl)
                if not linked_title:
                    continue
                try:
                    ex = await _wiki_extract(http, _WIKI_BASES[tl], linked_title)
                    if ex:
                        results[tl] = {
                            "title": linked_title,
                            "extract": ex,
                            "url": f"{_WIKI_BASES[tl]}/wiki/{linked_title.replace(' ', '_')}",
                        }
                except Exception:
                    pass
    except Exception as exc:
        logger.warning(f"Wikipedia fetch failed for '{name_en}' / '{name_ja}': {exc}")
    return results


async def get_stock_detail(pool, client: Optional[JQuantsClient], code: str) -> dict:
    """
    Return full company detail: listing info, 90-day daily prices (DB-first),
    and Wikipedia summary.
    """
    today = date.today()
    one_year_ago = today - timedelta(days=365)

    async with pool.acquire() as conn:
        listing = await conn.fetchrow(
            """SELECT code, name, name_en, sector, market,
                      company_info, company_info_fetched_at
               FROM jp_listings WHERE code = $1""",
            code,
        )
        summary = await conn.fetchrow(
            """SELECT current_price, change_6m, abs_change_6m, change_months, updated_at,
                      score_tsmom, score_rsi2, score_bb, score_pair, score_cs_mom
               FROM jp_stock_summary WHERE code = $1""",
            code,
        )
        price_rows = await conn.fetch(
            """SELECT date, open, high, low, close, volume
               FROM jp_daily_prices WHERE code = $1 AND date >= $2 ORDER BY date""",
            code, one_year_ago,
        )

    # API fallback when daily data is absent or too sparse (refresh_prices stores
    # only ~7 month-end snapshots, which is not enough for a candlestick chart).
    needs_fetch = len(price_rows) < 20
    if needs_fetch and client is not None:
        try:
            raw = await client.get_daily_quotes(
                code=code,
                from_date=_to_yyyymmdd(one_year_ago),
                to_date=_to_yyyymmdd(today),
            )
            quotes = sorted((_normalize_quote(r) for r in raw), key=lambda x: x["date"])
            await _store_daily_prices(pool, quotes)
            async with pool.acquire() as conn:
                price_rows = await conn.fetch(
                    "SELECT date, open, high, low, close, volume FROM jp_daily_prices "
                    "WHERE code = $1 AND date >= $2 ORDER BY date",
                    code, one_year_ago,
                )
        except Exception as exc:
            logger.warning(f"Price fetch failed for {code}: {exc}")

    daily_prices = [
        {
            "date": r["date"].isoformat(),
            "open":   float(r["open"])   if r["open"]   is not None else None,
            "high":   float(r["high"])   if r["high"]   is not None else None,
            "low":    float(r["low"])    if r["low"]    is not None else None,
            "close":  float(r["close"])  if r["close"]  is not None else None,
            "volume": r["volume"],
        }
        for r in price_rows
    ]

    # Company info: return from DB cache only — fetch is triggered on demand via POST endpoint
    company_info = None
    if listing:
        raw = listing["company_info"]
        if raw:
            company_info = json.loads(raw)

    quarterly_fins = None
    try:
        quarterly_fins = await get_quarterly_fins(pool, client, code)
    except Exception as exc:
        logger.warning(f"Quarterly fins failed for {code}: {exc}")

    return {
        "code": code,
        "name":     listing["name"]    if listing else code,
        "name_en":  listing["name_en"] if listing else "",
        "sector":   listing["sector"]  if listing else "",
        "market":   listing["market"]  if listing else "",
        "current_price": float(summary["current_price"]) if summary and summary["current_price"] is not None else None,
        "change_6m":     float(summary["change_6m"])     if summary and summary["change_6m"]     is not None else None,
        "abs_change_6m": float(summary["abs_change_6m"]) if summary and summary["abs_change_6m"] is not None else None,
        "change_months": summary["change_months"]         if summary else None,
        "price_updated_at": (
            summary["updated_at"].replace(tzinfo=None).isoformat() + "Z"
            if summary and summary["updated_at"] else None
        ),
        "daily_prices":    daily_prices,
        "company_info":    company_info,
        "quarterly_fins":  quarterly_fins,
        "fetched_at":   datetime.utcnow().isoformat() + "Z",
        "scores": {
            "tsmom":  float(summary["score_tsmom"])   if summary and summary["score_tsmom"]   is not None else None,
            "rsi2":   float(summary["score_rsi2"])    if summary and summary["score_rsi2"]    is not None else None,
            "bb":     float(summary["score_bb"])      if summary and summary["score_bb"]      is not None else None,
            "pair":   float(summary["score_pair"])    if summary and summary["score_pair"]    is not None else None,
            "cs_mom": float(summary["score_cs_mom"])  if summary and summary["score_cs_mom"]  is not None else None,
        } if summary else None,
    }
