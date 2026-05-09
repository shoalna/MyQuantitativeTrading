import logging
import time
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Query
import hashlib

logger = logging.getLogger(__name__)
router = APIRouter(tags=["companies"])

# ── ML scoring (deterministic dummy) ─────────────────────────────────────────

def _ml_history(symbol: str, days: int = 30) -> list[dict]:
    base_date = date(2026, 5, 4)
    score = 0.52
    result = []
    for i in range(days, 0, -1):
        d = base_date - timedelta(days=i)
        h = int(hashlib.md5(f"{symbol}{d}".encode()).hexdigest(), 16)
        score = max(0.15, min(0.9, score + (h % 100 - 50) / 1200))
        result.append({"date": d.isoformat(), "score": round(score, 3)})
    return result


def _attitude(score: float) -> str:
    if score > 0.55:
        return "bullish"
    if score < 0.45:
        return "bearish"
    return "neutral"


# ── Company-specific NewsAPI queries (override per symbol) ────────────────────
# Keys are uppercase symbols. Falls back to company name when missing.

_QUERIES: dict[str, dict[str, str]] = {
    "POWX": {
        "en": "PowerX Japan power storage energy",
        "zh": "PowerX 储能 日本",
    }
}

# ── News cache (in-memory, TTL 1 h) ──────────────────────────────────────────

_news_cache: dict[str, tuple[float, list]] = {}
_CACHE_TTL = 3600


async def _get_news(symbol: str, name: str, lang: str) -> list[dict]:
    from app.services.news import fetch_company_news, LANG_CODE
    from app.services.translation import translate_articles
    from app.config import settings

    cache_key = f"{symbol}:{lang}"
    now = time.time()
    cached = _news_cache.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    if not settings.news_api_key:
        return []

    queries = _QUERIES.get(symbol, {})
    api_lang = LANG_CODE.get(lang, "en")
    query = queries.get("zh" if api_lang == "zh" else "en", name)

    articles = await fetch_company_news(query, language=lang, page_size=20)

    # Translate when source is English but target language is not
    if articles and lang != "en" and api_lang == "en":
        articles = await translate_articles(articles, lang)

    _news_cache[cache_key] = (time.time(), articles)
    return articles


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_companies():
    from app.database import get_pool
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM target_companies ORDER BY created_at")
    result = []
    for r in rows:
        sym = r["symbol"]
        history = _ml_history(sym)
        score = history[-1]["score"]
        result.append({
            "symbol": sym,
            "name": r["name"],
            "news_attitude": _attitude(score),
            "sns_attitude": "neutral",
            "score": round(score, 2),
        })
    return result


@router.get("/{symbol}")
async def get_company(symbol: str, lang: str = Query("en")):
    from app.database import get_pool
    pool = await get_pool()
    sym = symbol.upper()
    row = await pool.fetchrow("SELECT * FROM target_companies WHERE symbol = $1", sym)
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")

    news = await _get_news(sym, row["name"], lang)
    history = _ml_history(sym)
    score = history[-1]["score"]

    return {
        "symbol": sym,
        "name": row["name"],
        "news": news,
        "sns": {},
        "ml_scoring": {
            "prediction": "buy" if score > 0.55 else "sell" if score < 0.45 else "hold",
            "score": round(score, 2),
            "confidence": 0.0,
            "history": history,
        },
    }
