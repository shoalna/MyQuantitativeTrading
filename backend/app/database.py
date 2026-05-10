import json
import asyncpg
from app.config import settings

_pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog", format="text")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sectors (
    id         SERIAL PRIMARY KEY,
    name       TEXT        NOT NULL UNIQUE,
    top_n      INTEGER     NOT NULL DEFAULT 5,
    active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id           SERIAL PRIMARY KEY,
    triggered_by TEXT        NOT NULL,
    status       TEXT        NOT NULL DEFAULT 'pending',
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ,
    error_msg    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickers (
    id            SERIAL PRIMARY KEY,
    job_id        INTEGER     NOT NULL REFERENCES jobs(id),
    sector_id     INTEGER     NOT NULL REFERENCES sectors(id),
    symbol        TEXT        NOT NULL,
    company       TEXT,
    mention_count INTEGER     NOT NULL DEFAULT 0,
    rank          INTEGER     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
    id           SERIAL PRIMARY KEY,
    ticker_id    INTEGER     NOT NULL REFERENCES tickers(id),
    source       TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    url          TEXT,
    published_at TIMESTAMPTZ,
    snippet      TEXT,
    raw_json     JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
    id              SERIAL PRIMARY KEY,
    ticker_id       INTEGER     NOT NULL REFERENCES tickers(id),
    sentiment_score FLOAT,
    sentiment_label TEXT,
    summary         TEXT,
    top_news_json   JSONB,
    community_json  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS target_companies (
    id         SERIAL PRIMARY KEY,
    symbol     TEXT        NOT NULL UNIQUE,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickers_job     ON tickers(job_id);
CREATE INDEX IF NOT EXISTS idx_articles_ticker ON articles(ticker_id);
CREATE INDEX IF NOT EXISTS idx_reports_ticker  ON reports(ticker_id);

-- Japan market stock data (fed by JQuants API)
CREATE TABLE IF NOT EXISTS jp_listings (
    code        TEXT        PRIMARY KEY,
    name        TEXT,
    name_en     TEXT,
    sector      TEXT,
    market      TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jp_stock_summary (
    code            TEXT        PRIMARY KEY,
    current_price   NUMERIC(15,2),
    price_6m_ago    NUMERIC(15,2),
    change_6m       NUMERIC(10,4),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jp_chart_cache (
    code        TEXT        PRIMARY KEY,
    chart_data  JSONB,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jp_listings_name   ON jp_listings(name);
CREATE INDEX IF NOT EXISTS idx_jp_summary_price   ON jp_stock_summary(current_price);
CREATE INDEX IF NOT EXISTS idx_jp_summary_change  ON jp_stock_summary(change_6m);

CREATE TABLE IF NOT EXISTS jp_daily_prices (
    code    TEXT        NOT NULL,
    date    DATE        NOT NULL,
    open    NUMERIC(15,2),
    high    NUMERIC(15,2),
    low     NUMERIC(15,2),
    close   NUMERIC(15,2),
    volume  BIGINT,
    PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_jp_prices_date ON jp_daily_prices(date);
CREATE INDEX IF NOT EXISTS idx_jp_prices_code ON jp_daily_prices(code);
"""


async def create_pool() -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(settings.database_url, min_size=2, max_size=10, init=_init_conn)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool() -> asyncpg.Pool:
    return _pool


MIGRATION_SQL = """
ALTER TABLE jobs     ADD COLUMN IF NOT EXISTS language          TEXT NOT NULL DEFAULT 'en';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS title_translated  TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS snippet_translated TEXT;
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS abs_change_6m  NUMERIC(15,2);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS change_months  SMALLINT;
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS aqr_score      NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS aqr_mom        NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS aqr_vol        NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS score_tsmom    NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS score_rsi2     NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS score_bb       NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS score_pair     NUMERIC(5,1);
ALTER TABLE jp_stock_summary ADD COLUMN IF NOT EXISTS score_cs_mom   NUMERIC(5,1);
ALTER TABLE jp_listings ADD COLUMN IF NOT EXISTS wiki_title        TEXT;
ALTER TABLE jp_listings ADD COLUMN IF NOT EXISTS wiki_summary      TEXT;
ALTER TABLE jp_listings ADD COLUMN IF NOT EXISTS wiki_url          TEXT;
ALTER TABLE jp_listings ADD COLUMN IF NOT EXISTS wiki_lang         TEXT;
ALTER TABLE jp_listings ADD COLUMN IF NOT EXISTS wiki_fetched_at   TIMESTAMPTZ;
ALTER TABLE jp_listings ADD COLUMN IF NOT EXISTS wiki_translations TEXT;
"""


async def init_db() -> None:
    async with _pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
        await conn.execute(MIGRATION_SQL)
