from datetime import datetime
from pydantic import BaseModel, Field


class SectorCreate(BaseModel):
    name: str
    top_n: int = Field(default=5, ge=1, le=20)


class SectorUpdate(BaseModel):
    name: str | None = None
    top_n: int | None = Field(default=None, ge=1, le=20)
    active: bool | None = None


class SectorOut(BaseModel):
    id: int
    name: str
    top_n: int
    active: bool
    created_at: datetime
    updated_at: datetime


class JobTriggerRequest(BaseModel):
    language: str = "en"


class JobOut(BaseModel):
    id: int
    triggered_by: str
    status: str
    language: str
    started_at: datetime | None
    finished_at: datetime | None
    error_msg: str | None
    created_at: datetime


class TickerOut(BaseModel):
    id: int
    job_id: int
    sector_id: int
    symbol: str
    company: str | None
    mention_count: int
    rank: int
    created_at: datetime


class ArticleOut(BaseModel):
    id: int
    ticker_id: int
    source: str
    title: str
    url: str | None
    published_at: datetime | None
    snippet: str | None
    title_translated: str | None = None
    snippet_translated: str | None = None


class TargetCompanyCreate(BaseModel):
    symbol: str
    name: str


class TargetCompanyOut(BaseModel):
    id: int
    symbol: str
    name: str
    created_at: datetime


class ReportOut(BaseModel):
    ticker: TickerOut
    sentiment_score: float | None
    sentiment_label: str | None
    summary: str | None
    top_news: list[str]
    community: dict
    articles: list[ArticleOut]
