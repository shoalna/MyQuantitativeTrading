from fastapi import APIRouter, HTTPException
from asyncpg import UniqueViolationError
from app.database import get_pool
from app.models import TargetCompanyCreate, TargetCompanyOut

router = APIRouter(tags=["targets"])


@router.get("", response_model=list[TargetCompanyOut])
async def list_targets():
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM target_companies ORDER BY created_at")
    return [dict(r) for r in rows]


@router.post("", response_model=TargetCompanyOut, status_code=201)
async def create_target(body: TargetCompanyCreate):
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            "INSERT INTO target_companies (symbol, name) VALUES ($1, $2) RETURNING *",
            body.symbol.strip().upper(), body.name.strip(),
        )
        return dict(row)
    except UniqueViolationError:
        raise HTTPException(status_code=409, detail=f"{body.symbol.upper()} is already in the watchlist")


@router.delete("/{target_id}", status_code=204)
async def delete_target(target_id: int):
    pool = await get_pool()
    result = await pool.execute("DELETE FROM target_companies WHERE id = $1", target_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Target not found")
