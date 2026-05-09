import json
from fastapi import APIRouter, HTTPException, Query
from app.database import get_pool
from app.models import ArticleOut, ReportOut, TickerOut

router = APIRouter(tags=["reports"])


def _parse_json_field(value):
    """Return parsed value whether asyncpg returns it as str or already decoded."""
    if value is None:
        return None
    if isinstance(value, str):
        return json.loads(value)
    return value


def _build_report(ticker: TickerOut, report, articles: list[ArticleOut]) -> ReportOut:
    if not report:
        return ReportOut(
            ticker=ticker, sentiment_score=None, sentiment_label=None,
            summary=None, top_news=[], community={}, articles=articles,
        )
    return ReportOut(
        ticker=ticker,
        sentiment_score=report["sentiment_score"],
        sentiment_label=report["sentiment_label"],
        summary=report["summary"],
        top_news=_parse_json_field(report["top_news_json"]) or [],
        community=_parse_json_field(report["community_json"]) or {},
        articles=articles,
    )


@router.get("", response_model=list[ReportOut])
async def list_reports(job_id: int = Query(...)):
    pool = await get_pool()
    tickers = await pool.fetch(
        "SELECT * FROM tickers WHERE job_id = $1 ORDER BY rank", job_id
    )
    result = []
    for t in tickers:
        ticker = TickerOut(**dict(t))
        report = await pool.fetchrow(
            "SELECT * FROM reports WHERE ticker_id = $1", t["id"]
        )
        articles_rows = await pool.fetch(
            "SELECT * FROM articles WHERE ticker_id = $1 AND source = 'newsapi' LIMIT 10",
            t["id"],
        )
        articles = [ArticleOut(**dict(a)) for a in articles_rows]
        result.append(_build_report(ticker, report, articles))
    return result


@router.get("/{ticker_id}", response_model=ReportOut)
async def get_report(ticker_id: int):
    pool = await get_pool()
    t = await pool.fetchrow("SELECT * FROM tickers WHERE id = $1", ticker_id)
    if not t:
        raise HTTPException(status_code=404, detail="Ticker not found")
    ticker = TickerOut(**dict(t))
    report = await pool.fetchrow(
        "SELECT * FROM reports WHERE ticker_id = $1", ticker_id
    )
    articles_rows = await pool.fetch(
        "SELECT * FROM articles WHERE ticker_id = $1 LIMIT 20", ticker_id
    )
    articles = [ArticleOut(**dict(a)) for a in articles_rows]
    return _build_report(ticker, report, articles)
