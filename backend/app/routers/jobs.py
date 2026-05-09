from fastapi import APIRouter, HTTPException
from app.database import get_pool
from app.models import JobOut, JobTriggerRequest

router = APIRouter(tags=["jobs"])


@router.get("", response_model=list[JobOut])
async def list_jobs(limit: int = 20):
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1", limit)
    return [dict(r) for r in rows]


@router.get("/{job_id}", response_model=JobOut)
async def get_job(job_id: int):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)


@router.post("/trigger", response_model=JobOut, status_code=202)
async def trigger_job(body: JobTriggerRequest = JobTriggerRequest()):
    pool = await get_pool()
    running = await pool.fetchrow(
        "SELECT id FROM jobs WHERE status IN ('pending', 'running') LIMIT 1"
    )
    if running:
        row = await pool.fetchrow("SELECT * FROM jobs WHERE id = $1", running["id"])
        return dict(row)

    row = await pool.fetchrow(
        "INSERT INTO jobs (triggered_by, language) VALUES ('manual', $1) RETURNING *",
        body.language,
    )
    job = dict(row)

    import asyncio
    from app.scheduler import run_batch_job
    asyncio.create_task(run_batch_job(job["id"], body.language))

    return job
