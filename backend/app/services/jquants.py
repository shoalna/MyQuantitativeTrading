import asyncio
import calendar
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


async def _find_latest_trading_day(client: JQuantsClient, start: date, max_lookback: int = 7) -> date:
    """
    Walk backwards from `start` until we find a date the API has price data for.
    Needed because today's data isn't published until market close, and weekends/
    holidays return empty results.
    """
    for offset in range(max_lookback):
        candidate = start - timedelta(days=offset)
        records = await client.get_daily_quotes(date_str=_to_yyyymmdd(candidate))
        if records:
            logger.info(f"Latest trading day with data: {candidate}")
            return candidate
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
        logger.info(f"Cache hit for {month_end.strftime('%Y-%m')}: using DB data from {cached_date}")
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT code, close FROM jp_daily_prices WHERE date = $1 AND close IS NOT NULL",
                cached_date,
            )
        return cached_date, {r["code"]: float(r["close"]) for r in rows}

    # Cache miss — fetch from API
    logger.info(f"Cache miss for {month_end.strftime('%Y-%m')}: fetching from API")
    if on_step:
        await on_step(f"Fetching {month_end.strftime('%Y-%m')} from API…", 0)

    trading_day = await _find_latest_trading_day(client, upper_bound)
    raw = await client.get_daily_quotes(date_str=_to_yyyymmdd(trading_day))
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

        # Compute month-over-month % change for each of the 6 pairs
        changes = []
        for i in range(6):
            p_now = prices[i]
            p_prev = prices[i + 1]
            if p_now and p_prev and p_prev != 0:
                changes.append((p_now - p_prev) / p_prev * 100)

        mean_change = sum(changes) / len(changes) if changes else None
        # price_6m_ago is the furthest month we have (index 6)
        price_6m_ago = prices[6] if len(prices) > 6 else None
        abs_change = (current_price - price_6m_ago) if current_price and price_6m_ago else None

        records.append((code, current_price, price_6m_ago, mean_change, abs_change, now))

    if on_step:
        await on_step(f"Writing {len(records)} summaries to database…", len(records))

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO jp_stock_summary (code, current_price, price_6m_ago, change_6m, abs_change_6m, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (code) DO UPDATE SET
                current_price = EXCLUDED.current_price,
                price_6m_ago  = EXCLUDED.price_6m_ago,
                change_6m     = EXCLUDED.change_6m,
                abs_change_6m = EXCLUDED.abs_change_6m,
                updated_at    = EXCLUDED.updated_at
            """,
            records,
        )

    logger.info(f"Updated {len(records)} price summaries")
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
