import logging
from datetime import date, datetime, timedelta

import pydantic
from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Query

from app.config import settings
from app.database import get_pool
from app.services.jquants import (
    JQuantsClient, get_chart_data, get_stock_detail,
    refresh_listings, refresh_prices, compute_aqr_scores,
    _normalize_quote, _store_daily_prices, _to_yyyymmdd, get_quarterly_fins,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["jquants"])

# ── Per-operation status dicts (updated in-place by background tasks) ──────────

_listings_status: dict = {
    "running": False,
    "message": "Not started",
    "count": 0,
    "error": None,
    "last_run": None,
}

_prices_status: dict = {
    "running": False,
    "message": "Not started",
    "count": 0,
    "error": None,
    "last_run": None,
}

_aqr_status: dict = {
    "running": False,
    "message": "Not started",
    "count": 0,
    "error": None,
    "last_run": None,
}

_SORT_MAP = {
    "code":               "l.code",
    "name":               "l.name",
    "market":             "l.market",
    "sector":             "l.sector",
    "current_price":      "s.current_price",
    "change_6m":          "s.change_6m",
    "abs_change_6m":      "s.abs_change_6m",
    "price_updated_at":   "s.updated_at",
    "aqr_score":          "s.aqr_score",
    "aqr_mom":            "s.aqr_mom",
    "aqr_vol":            "s.aqr_vol",
    "score_tsmom":        "s.score_tsmom",
    "score_rsi2":         "s.score_rsi2",
    "score_bb":           "s.score_bb",
    "score_pair":         "s.score_pair",
    "score_cs_mom":       "s.score_cs_mom",
    "score_tsmom_1m":     "s.score_tsmom_1m",
    "score_tsmom_5d":     "s.score_tsmom_5d",
    "score_tsmom_3d":     "s.score_tsmom_3d",
    "score_pair_3d":      "s.score_pair_3d",
    "score_pair_5d":      "s.score_pair_5d",
    "score_pair_1m":      "s.score_pair_1m",
    "score_cs_mom_3d":    "s.score_cs_mom_3d",
    "score_cs_mom_5d":    "s.score_cs_mom_5d",
    "score_cs_mom_1m":    "s.score_cs_mom_1m",
}


# ── Background task runners ────────────────────────────────────────────────────

async def _do_refresh_listings() -> None:
    if _listings_status["running"]:
        return
    _listings_status.update({"running": True, "error": None, "message": "Starting…"})
    try:
        pool = await get_pool()
        client = JQuantsClient(settings.jquants_api_key)

        async def on_step(msg: str, count: int = 0) -> None:
            _listings_status["message"] = msg
            if count:
                _listings_status["count"] = count

        count = await refresh_listings(pool, client, on_step=on_step)
        _listings_status.update({
            "count": count,
            "message": f"Completed — {count} companies stored",
            "last_run": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as exc:
        logger.error(f"Listings refresh failed: {exc}")
        _listings_status.update({"error": str(exc), "message": f"Error: {exc}"})
    finally:
        _listings_status["running"] = False


async def _do_compute_aqr() -> None:
    if _aqr_status["running"]:
        return
    _aqr_status.update({"running": True, "error": None, "message": "Computing AQR scores…"})
    try:
        pool = await get_pool()
        count = await compute_aqr_scores(pool)
        _aqr_status.update({
            "count": count,
            "message": f"Completed — {count} stocks scored",
            "last_run": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as exc:
        logger.error(f"AQR computation failed: {exc}")
        _aqr_status.update({"error": str(exc), "message": f"Error: {exc}"})
    finally:
        _aqr_status["running"] = False


async def _do_refresh_prices() -> None:
    if _prices_status["running"]:
        return
    _prices_status.update({"running": True, "error": None, "message": "Starting…"})
    try:
        pool = await get_pool()
        client = JQuantsClient(settings.jquants_api_key)

        async def on_step(msg: str, count: int = 0) -> None:
            _prices_status["message"] = msg
            if count:
                _prices_status["count"] = count

        count = await refresh_prices(pool, client, on_step=on_step)
        _prices_status.update({
            "count": count,
            "message": f"Completed — {count} companies updated",
            "last_run": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as exc:
        logger.error(f"Prices refresh failed: {exc}")
        _prices_status.update({"error": str(exc), "message": f"Error: {exc}"})
    finally:
        _prices_status["running"] = False


# ── Helper: dynamic WHERE builder ─────────────────────────────────────────────

_EXCLUDED_MARKETS = {"その他"}


def _build_where(
    search: str,
    market: str,
    sectors: list[str],
    codes: list[str] | None = None,
    aqr_min: float | None = None,
    aqr_max: float | None = None,
):
    """Return (where_clause, params_list, next_param_index)."""
    params: list = []
    p = 0

    if codes:
        # Watchlist mode: return exactly the requested codes, no market exclusion
        placeholders = ", ".join(f"${p + i + 1}" for i in range(len(codes)))
        params.extend(codes)
        p += len(codes)
        conditions: list[str] = [f"l.code IN ({placeholders})"]
    else:
        # Browse mode: exclude noisy markets and apply filters
        conditions = ["l.market NOT IN ('その他')"]

        if search:
            like = f"%{search}%"
            params.append(like)
            p += 1
            conditions.append(f"(l.code ILIKE ${p} OR l.name ILIKE ${p} OR l.name_en ILIKE ${p})")

        if market:
            params.append(market)
            p += 1
            conditions.append(f"l.market = ${p}")

        if sectors:
            placeholders = ", ".join(f"${p + i + 1}" for i in range(len(sectors)))
            params.extend(sectors)
            p += len(sectors)
            conditions.append(f"l.sector IN ({placeholders})")

        if aqr_min is not None:
            params.append(aqr_min)
            p += 1
            conditions.append(f"s.aqr_score >= ${p}")

        if aqr_max is not None:
            params.append(aqr_max)
            p += 1
            conditions.append(f"s.aqr_score <= ${p}")

    where = f"WHERE {' AND '.join(conditions)}"
    return where, params, p


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status():
    pool = await get_pool()
    async with pool.acquire() as conn:
        listings_db_count   = await conn.fetchval("SELECT COUNT(*) FROM jp_listings")
        listings_db_updated = await conn.fetchval("SELECT MAX(updated_at) FROM jp_listings")
        prices_db_count     = await conn.fetchval("SELECT COUNT(*) FROM jp_stock_summary")
        prices_db_updated   = await conn.fetchval("SELECT MAX(updated_at) FROM jp_stock_summary")

    return {
        "api_configured": bool(settings.jquants_api_key),
        "listings": {
            **_listings_status,
            "db_count": listings_db_count or 0,
            "db_last_update": listings_db_updated.isoformat() + "Z" if listings_db_updated else None,
        },
        "prices": {
            **_prices_status,
            "db_count": prices_db_count or 0,
            "db_last_update": prices_db_updated.isoformat() + "Z" if prices_db_updated else None,
        },
        "aqr": {**_aqr_status},
    }


@router.post("/refresh/listings")
async def trigger_refresh_listings(background_tasks: BackgroundTasks):
    """Fetch all company names and codes from JQuants and store in the database."""
    if not settings.jquants_api_key:
        raise HTTPException(status_code=400, detail="JQUANTS_API_KEY is not set in .env")
    if _listings_status["running"]:
        return {"message": "Company list update already in progress"}
    background_tasks.add_task(_do_refresh_listings)
    return {"message": "Company list update started"}


@router.post("/compute/aqr")
async def trigger_compute_aqr(background_tasks: BackgroundTasks):
    """Compute cross-sectional AQR factor scores (Momentum + Low-Vol) for all stocks."""
    if _aqr_status["running"]:
        return {"message": "AQR computation already in progress"}
    background_tasks.add_task(_do_compute_aqr)
    return {"message": "AQR score computation started"}


@router.post("/refresh/prices")
async def trigger_refresh_prices(background_tasks: BackgroundTasks):
    """Fetch latest price data for all companies from JQuants and update the database."""
    if not settings.jquants_api_key:
        raise HTTPException(status_code=400, detail="JQUANTS_API_KEY is not set in .env")
    if _prices_status["running"]:
        return {"message": "Price update already in progress"}
    background_tasks.add_task(_do_refresh_prices)
    return {"message": "Price data update started"}


@router.get("/filters")
async def get_filters():
    """Return distinct markets and sectors for filter dropdowns."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        markets = await conn.fetch(
            "SELECT DISTINCT market FROM jp_listings WHERE market != '' AND market NOT IN ('その他') ORDER BY market"
        )
        sectors = await conn.fetch(
            "SELECT DISTINCT sector FROM jp_listings WHERE sector != '' ORDER BY sector"
        )
    return {
        "markets": [r["market"] for r in markets],
        "sectors": [r["sector"] for r in sectors],
    }


@router.get("/stocks")
async def list_stocks(
    page:     int = Query(1, ge=1),
    limit:    int = Query(50, ge=1, le=500),
    sort_by:  str = Query("code"),
    sort_dir: str = Query("asc"),
    search:   str = Query(""),
    market:   str = Query(""),
    sector:   list[str] = Query(default=[]),
    code:     list[str] = Query(default=[]),
    aqr_min:  float | None = Query(default=None),
    aqr_max:  float | None = Query(default=None),
):
    pool = await get_pool()
    sort_col = _SORT_MAP.get(sort_by, "l.code")
    order    = "DESC" if sort_dir.lower() == "desc" else "ASC"
    offset   = (page - 1) * limit

    where_clause, base_params, base_p = _build_where(search, market, sector, code or None, aqr_min, aqr_max)

    async with pool.acquire() as conn:
        total = await conn.fetchval(
            f"SELECT COUNT(*) FROM jp_listings l LEFT JOIN jp_stock_summary s ON l.code = s.code {where_clause}",
            *base_params,
        )
        rows = await conn.fetch(
            f"""
            SELECT l.code, l.name, l.name_en, l.sector, l.market,
                   s.current_price, s.change_6m, s.abs_change_6m,
                   s.change_months, s.aqr_score, s.aqr_mom, s.aqr_vol,
                   s.score_tsmom, s.score_rsi2, s.score_bb, s.score_pair, s.score_cs_mom,
                   s.score_tsmom_1m, s.score_tsmom_5d, s.score_tsmom_3d,
                   s.score_pair_3d, s.score_pair_5d, s.score_pair_1m,
                   s.score_cs_mom_3d, s.score_cs_mom_5d, s.score_cs_mom_1m,
                   s.updated_at AS price_updated_at
            FROM jp_listings l
            LEFT JOIN jp_stock_summary s ON l.code = s.code
            {where_clause}
            ORDER BY {sort_col} {order} NULLS LAST
            LIMIT ${base_p + 1} OFFSET ${base_p + 2}
            """,
            *base_params, limit, offset,
        )

    def _row(r):
        d = dict(r)
        if d.get("price_updated_at"):
            d["price_updated_at"] = d["price_updated_at"].replace(tzinfo=None).isoformat() + "Z"
        return d

    return {
        "total": total or 0,
        "page": page,
        "limit": limit,
        "data": [_row(r) for r in rows],
    }


@router.get("/probe")
async def probe_api():
    """Test JQuants API key and return raw response shape (1 rate-limit slot)."""
    if not settings.jquants_api_key:
        raise HTTPException(status_code=400, detail="JQUANTS_API_KEY is not set in .env")
    client = JQuantsClient(settings.jquants_api_key)
    try:
        return {"success": True, **await client.probe()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"JQuants API error: {exc}")


@router.get("/listings")
async def list_companies(
    search: str = Query(""),
    page:   int = Query(1, ge=1),
    limit:  int = Query(100, ge=1, le=1000),
):
    """Cached company list from DB — no API call. Run /refresh/listings first."""
    pool = await get_pool()
    offset = (page - 1) * limit

    async with pool.acquire() as conn:
        if search:
            like = f"%{search}%"
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM jp_listings WHERE code ILIKE $1 OR name ILIKE $1 OR name_en ILIKE $1",
                like,
            )
            rows = await conn.fetch(
                """SELECT code, name, name_en, sector, market FROM jp_listings
                   WHERE code ILIKE $1 OR name ILIKE $1 OR name_en ILIKE $1
                   ORDER BY code LIMIT $2 OFFSET $3""",
                like, limit, offset,
            )
        else:
            total = await conn.fetchval("SELECT COUNT(*) FROM jp_listings")
            rows = await conn.fetch(
                "SELECT code, name, name_en, sector, market FROM jp_listings ORDER BY code LIMIT $1 OFFSET $2",
                limit, offset,
            )

    return {"total": total or 0, "page": page, "limit": limit, "data": [dict(r) for r in rows]}


@router.get("/stocks/{code}/chart")
async def get_stock_chart(code: str):
    if not settings.jquants_api_key:
        raise HTTPException(status_code=400, detail="JQUANTS_API_KEY is not set in .env")
    pool = await get_pool()
    client = JQuantsClient(settings.jquants_api_key)
    try:
        data = await get_chart_data(pool, client, code.upper())
        return {"code": code.upper(), "data": data}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"JQuants API error: {exc}")


@router.get("/stocks/{code}/detail")
async def get_stock_detail_endpoint(code: str):
    """Return full company detail: prices, Wikipedia summary, and stock info."""
    pool = await get_pool()
    client = JQuantsClient(settings.jquants_api_key) if settings.jquants_api_key else None
    try:
        return await get_stock_detail(pool, client, code.upper())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/stocks/{code}/company-info")
async def fetch_company_info_endpoint(code: str):
    """Trigger on-demand Claude web-search company overview for one stock."""
    from app.services.company_info import fetch_company_info
    import json
    if not settings.anthropic_api_key or settings.anthropic_api_key.startswith("your_"):
        raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY is not configured")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT name, name_en FROM jp_listings WHERE code=$1", code.upper())
    if not row:
        raise HTTPException(status_code=404, detail="Stock not found")
    result = await fetch_company_info(
        row["name"] or "", row["name_en"] or "", code.upper(), settings.anthropic_api_key
    )
    if result and "error" not in result:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE jp_listings SET company_info=$1, company_info_fetched_at=NOW() WHERE code=$2",
                json.dumps(result), code.upper(),
            )
    return result or {}


class _YoutubeRequest(pydantic.BaseModel):
    channels: list[str] = []
    keywords: list[str] = []


@router.post("/stocks/{code}/youtube")
async def fetch_youtube_report_endpoint(code: str, req: _YoutubeRequest = Body(default_factory=_YoutubeRequest)):
    """Trigger on-demand YouTube research report for one stock (7-day cache)."""
    from app.services.youtube_research import fetch_youtube_report
    import json
    if not settings.anthropic_api_key or settings.anthropic_api_key.startswith("your_"):
        raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY is not configured")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT name, name_en, youtube_fetched_at FROM jp_listings WHERE code=$1", code.upper()
        )
    if not row:
        raise HTTPException(status_code=404, detail="Stock not found")
    result = await fetch_youtube_report(
        row["name"] or "", row["name_en"] or "", code.upper(),
        settings.anthropic_api_key, settings.youtube_api_key,
        channels=req.channels, keywords=req.keywords,
    )
    if result and "error" not in result:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE jp_listings SET youtube_report=$1, youtube_fetched_at=NOW() WHERE code=$2",
                json.dumps(result), code.upper(),
            )
    return result or {}


@router.get("/stocks/{code}/ai-decision")
async def stock_ai_decision(code: str):
    """Call Claude with OHLCV data to produce a buy/wait/avoid technical decision."""
    if not settings.anthropic_api_key or settings.anthropic_api_key.startswith("your_"):
        raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY is not configured")
    import anthropic as _anthropic
    from datetime import date as _date, timedelta as _timedelta
    from collections import defaultdict
    from app.prompts import get_prompt, get_cfg
    pool = await get_pool()
    row = await pool.fetchrow("SELECT name, name_en FROM jp_listings WHERE code=$1", code.upper())
    if not row:
        raise HTTPException(status_code=404, detail="Stock not found")
    company = row["name_en"] or row["name"] or code
    from_d = _date.today() - _timedelta(days=180)
    price_rows = await pool.fetch(
        "SELECT date, open, high, low, close, volume FROM jp_daily_prices "
        "WHERE code=$1 AND date >= $2 ORDER BY date",
        code.upper(), from_d,
    )
    if len(price_rows) < 10:
        raise HTTPException(status_code=422, detail="Not enough price data. Open the detail page first to fetch history.")
    daily_csv = "date,open,high,low,close,volume\n" + "\n".join(
        f"{r['date']},{r['open']},{r['high']},{r['low']},{r['close']},{r['volume'] or 0}"
        for r in price_rows
    )
    weeks: dict = defaultdict(lambda: {"open": None, "high": -1e18, "low": 1e18, "close": None, "vol": 0})
    for r in price_rows:
        wk = r["date"].strftime("%G-W%V")
        w = weeks[wk]
        if w["open"] is None:
            w["open"] = r["open"]
        if r["high"] is not None:
            w["high"] = max(w["high"], r["high"])
        if r["low"] is not None:
            w["low"] = min(w["low"], r["low"])
        w["close"] = r["close"]
        w["vol"] += r["volume"] or 0
    weekly_csv = "week,open,high,low,close,volume\n" + "\n".join(
        f"{wk},{v['open']},{v['high']},{v['low']},{v['close']},{v['vol']}"
        for wk, v in sorted(weeks.items())
    )
    cfg = get_cfg("ai_decision")
    prompt = get_prompt("ai_decision", company=company, code=code.upper(), daily_csv=daily_csv, weekly_csv=weekly_csv)
    client = _anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=cfg["max_tokens"],
            messages=[{"role": "user", "content": prompt}],
        )
    except _anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="レート制限に達しました。1分後に再試行してください。")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    text = "\n\n".join(
        block.text for block in response.content if hasattr(block, "text") and block.text
    )
    return {"content": text, "company": company}


@router.get("/stocks/{code}/news-analysis")
async def stock_news_analysis(code: str):
    """Call Claude with web search to analyze recent news for a stock."""
    if not settings.anthropic_api_key or settings.anthropic_api_key.startswith("your_"):
        raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY is not configured")
    import anthropic as _anthropic
    from datetime import date as _date
    from app.prompts import get_prompt, get_cfg
    pool = await get_pool()
    row = await pool.fetchrow("SELECT name, name_en FROM jp_listings WHERE code=$1", code.upper())
    if not row:
        raise HTTPException(status_code=404, detail="Stock not found")
    company = row["name_en"] or row["name"] or code
    today = _date.today().strftime("%Y年%m月%d日")
    cfg = get_cfg("news_analysis")
    prompt = get_prompt("news_analysis", today=today, company=company, code=code.upper())
    client = _anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=cfg["max_tokens"],
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": cfg["max_web_searches"]}],
            messages=[{"role": "user", "content": prompt}],
        )
    except _anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="レート制限に達しました。1分後に再試行してください。")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    text = "\n\n".join(
        block.text for block in response.content if hasattr(block, "text") and block.text
    )
    return {"content": text, "company": company}


@router.get("/watchlist-insight")
async def watchlist_insight():
    """Call Claude with web search to get today's Japan market trade ideas."""
    if not settings.anthropic_api_key or settings.anthropic_api_key.startswith("your_"):
        raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY is not configured")
    import anthropic as _anthropic
    from datetime import date as _date
    from app.prompts import get_prompt, get_cfg
    today = _date.today().strftime("%Y年%m月%d日")
    cfg = get_cfg("watchlist_insight")
    prompt = get_prompt("watchlist_insight", today=today)
    client = _anthropic.Anthropic(api_key=settings.anthropic_api_key)
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=cfg["max_tokens"],
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": cfg["max_web_searches"]}],
            messages=[{"role": "user", "content": prompt}],
        )
    except _anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="レート制限に達しました。1分後に再試行してください。")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    text = "\n\n".join(
        block.text for block in response.content if hasattr(block, "text") and block.text
    )
    return {"content": text}


@router.post("/stocks/{code}/refresh")
async def refresh_stock(code: str):
    """Re-fetch 90-day prices and quarterly fins from JQuants for one stock."""
    if not settings.jquants_api_key:
        raise HTTPException(status_code=400, detail="JQUANTS_API_KEY is not set in .env")
    pool   = await get_pool()
    client = JQuantsClient(settings.jquants_api_key)
    today  = date.today()
    from_d = today - timedelta(days=90)
    try:
        # Invalidate fins cache so get_stock_detail re-fetches
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE jp_listings SET fins_fetched_at=NULL WHERE code=$1", code.upper()
            )
        raw    = await client.get_daily_quotes(code=code.upper(), from_date=_to_yyyymmdd(from_d), to_date=_to_yyyymmdd(today))
        quotes = sorted((_normalize_quote(r) for r in raw), key=lambda x: x["date"])
        await _store_daily_prices(pool, quotes)
        return await get_stock_detail(pool, client, code.upper())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
