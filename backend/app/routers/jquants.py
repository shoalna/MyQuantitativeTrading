import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.config import settings
from app.database import get_pool
from app.services.jquants import JQuantsClient, get_chart_data, refresh_listings, refresh_prices

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

_SORT_MAP = {
    "code":               "l.code",
    "name":               "l.name",
    "market":             "l.market",
    "sector":             "l.sector",
    "current_price":      "s.current_price",
    "change_6m":          "s.change_6m",
    "abs_change_6m":      "s.abs_change_6m",
    "price_updated_at":   "s.updated_at",
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


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status():
    pool = await get_pool()
    async with pool.acquire() as conn:
        listings_db_count = await conn.fetchval("SELECT COUNT(*) FROM jp_listings")
        listings_db_updated = await conn.fetchval("SELECT MAX(updated_at) FROM jp_listings")
        prices_db_count = await conn.fetchval("SELECT COUNT(*) FROM jp_stock_summary")
        prices_db_updated = await conn.fetchval("SELECT MAX(updated_at) FROM jp_stock_summary")

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


@router.post("/refresh/prices")
async def trigger_refresh_prices(background_tasks: BackgroundTasks):
    """Fetch latest price data for all companies from JQuants and update the database."""
    if not settings.jquants_api_key:
        raise HTTPException(status_code=400, detail="JQUANTS_API_KEY is not set in .env")
    if _prices_status["running"]:
        return {"message": "Price update already in progress"}
    background_tasks.add_task(_do_refresh_prices)
    return {"message": "Price data update started"}


@router.get("/stocks")
async def list_stocks(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    sort_by: str = Query("code"),
    sort_dir: str = Query("asc"),
    search: str = Query(""),
):
    pool = await get_pool()
    sort_col = _SORT_MAP.get(sort_by, "l.code")
    order = "DESC" if sort_dir.lower() == "desc" else "ASC"
    offset = (page - 1) * limit

    async with pool.acquire() as conn:
        if search:
            like = f"%{search}%"
            total = await conn.fetchval(
                "SELECT COUNT(*) FROM jp_listings WHERE code ILIKE $1 OR name ILIKE $1 OR name_en ILIKE $1",
                like,
            )
            rows = await conn.fetch(
                f"""
                SELECT l.code, l.name, l.name_en, l.sector, l.market,
                       s.current_price, s.change_6m, s.abs_change_6m, s.updated_at AS price_updated_at
                FROM jp_listings l
                LEFT JOIN jp_stock_summary s ON l.code = s.code
                WHERE l.code ILIKE $1 OR l.name ILIKE $1 OR l.name_en ILIKE $1
                ORDER BY {sort_col} {order} NULLS LAST
                LIMIT $2 OFFSET $3
                """,
                like, limit, offset,
            )
        else:
            total = await conn.fetchval("SELECT COUNT(*) FROM jp_listings")
            rows = await conn.fetch(
                f"""
                SELECT l.code, l.name, l.name_en, l.sector, l.market,
                       s.current_price, s.change_6m, s.abs_change_6m, s.updated_at AS price_updated_at
                FROM jp_listings l
                LEFT JOIN jp_stock_summary s ON l.code = s.code
                ORDER BY {sort_col} {order} NULLS LAST
                LIMIT $1 OFFSET $2
                """,
                limit, offset,
            )

    def _row(r):
        d = dict(r)
        if d.get("price_updated_at"):
            # Strip timezone offset from asyncpg datetime then add explicit Z
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
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=1000),
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
                """
                SELECT code, name, name_en, sector, market
                FROM jp_listings
                WHERE code ILIKE $1 OR name ILIKE $1 OR name_en ILIKE $1
                ORDER BY code LIMIT $2 OFFSET $3
                """,
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
