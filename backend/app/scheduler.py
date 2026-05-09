import json
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app.config import settings

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def run_batch_job(job_id: int, language: str = "en") -> None:
    from app.database import get_pool
    from app.services.news import fetch_articles, extract_top_tickers
    from app.services.sns import fetch_reddit, fetch_youtube
    from app.services.analysis import analyze_ticker
    from app.services.translation import translate_articles, translate_community

    pool = await get_pool()
    try:
        await pool.execute(
            "UPDATE jobs SET status='running', started_at=NOW() WHERE id=$1", job_id
        )
        sectors = await pool.fetch("SELECT * FROM sectors WHERE active = TRUE")

        for sector in sectors:
            try:
                from app.services.news import LANG_CODE
                articles = await fetch_articles(sector["name"], language=language, page_size=100)
                # Only translate when NewsAPI returns English but target is non-English
                # (e.g. ja → NewsAPI fetches en, so we need to translate to ja)
                if language != "en" and LANG_CODE.get(language, "en") == "en":
                    articles = await translate_articles(articles, language)
            except Exception as exc:
                logger.warning("News fetch failed for sector %s: %s", sector["name"], exc)
                continue
            top_tickers = extract_top_tickers(articles, sector["top_n"])
            logger.info("Sector %s [%s]: found %d tickers", sector["name"], language, len(top_tickers))

            for entry in top_tickers:
                try:
                    ticker_id = await pool.fetchval(
                        """INSERT INTO tickers (job_id, sector_id, symbol, company, mention_count, rank)
                           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
                        job_id, sector["id"], entry["symbol"], entry["company"],
                        entry["mention_count"], entry["rank"],
                    )

                    relevant = [a for a in articles if entry["symbol"] in f"{a['title']} {a.get('snippet','')}"]
                    for a in relevant[:30]:
                        pub_at = None
                        if a.get("published_at"):
                            try:
                                pub_at = datetime.fromisoformat(a["published_at"].replace("Z", "+00:00"))
                            except (ValueError, TypeError):
                                pass
                        await pool.execute(
                            """INSERT INTO articles
                               (ticker_id, source, title, url, published_at, snippet, raw_json,
                                title_translated, snippet_translated)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                            ticker_id, "newsapi", a["title"], a["url"],
                            pub_at, a.get("snippet"), a["raw_json"],
                            a.get("title_translated"), a.get("snippet_translated"),
                        )

                    reddit = await fetch_reddit(entry["symbol"])
                    youtube = await fetch_youtube(entry["symbol"])
                    community = await translate_community(
                        {"reddit": reddit, "youtube": youtube}, language
                    )

                    result = await analyze_ticker(entry["symbol"], relevant, community, language=language)

                    await pool.execute(
                        """INSERT INTO reports (ticker_id, sentiment_score, sentiment_label, summary, top_news_json, community_json)
                           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)""",
                        ticker_id,
                        result.get("sentiment_score"),
                        result.get("sentiment_label"),
                        result.get("summary"),
                        json.dumps(result.get("top_news", [])),
                        json.dumps(community),
                    )
                    logger.info("Ticker %s processed", entry["symbol"])
                except Exception as exc:
                    logger.warning("Failed to process ticker %s: %s", entry["symbol"], exc)

        await pool.execute(
            "UPDATE jobs SET status='done', finished_at=NOW() WHERE id=$1", job_id
        )
        logger.info("Batch job %d [%s] completed", job_id, language)

    except Exception as exc:
        logger.exception("Batch job %d failed: %s", job_id, exc)
        await pool.execute(
            "UPDATE jobs SET status='failed', finished_at=NOW(), error_msg=$2 WHERE id=$1",
            job_id, str(exc),
        )


async def _scheduled_run() -> None:
    from app.database import get_pool
    pool = await get_pool()
    running = await pool.fetchrow(
        "SELECT id FROM jobs WHERE status IN ('pending', 'running') LIMIT 1"
    )
    if running:
        logger.info("Skipping scheduled run — job %d already active", running["id"])
        return
    job_id = await pool.fetchval(
        "INSERT INTO jobs (triggered_by, language) VALUES ('scheduler', 'en') RETURNING id"
    )
    await run_batch_job(job_id, language="en")


def setup_scheduler() -> None:
    scheduler.add_job(
        _scheduled_run,
        CronTrigger(hour=settings.batch_cron_hour, minute=0),
        id="daily_batch",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started — daily batch at %02d:00 UTC", settings.batch_cron_hour)
