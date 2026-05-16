import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.database import create_pool, close_pool, init_db, get_pool
from app.routers import sectors, jobs, reports, companies, targets, jquants, config
from app.scheduler import setup_scheduler
from app import prompts

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_pool()
    await init_db()
    await prompts.load_from_db(await get_pool())
    setup_scheduler()
    yield
    await close_pool()


app = FastAPI(title="Trading Guidance API", version="0.1.0", lifespan=lifespan, redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sectors.router, prefix="/sectors")
app.include_router(jobs.router, prefix="/jobs")
app.include_router(reports.router, prefix="/reports")
app.include_router(companies.router, prefix="/companies")
app.include_router(targets.router, prefix="/targets")
app.include_router(jquants.router, prefix="/jquants")
app.include_router(config.router, prefix="/config")


@app.get("/health")
async def health():
    return {"status": "ok"}
