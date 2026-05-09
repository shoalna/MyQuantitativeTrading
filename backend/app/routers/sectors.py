from fastapi import APIRouter, HTTPException
from app.database import get_pool
from app.models import SectorCreate, SectorOut, SectorUpdate

router = APIRouter(tags=["sectors"])


@router.get("", response_model=list[SectorOut])
async def list_sectors():
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM sectors ORDER BY name")
    return [dict(r) for r in rows]


@router.post("", response_model=SectorOut, status_code=201)
async def create_sector(body: SectorCreate):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO sectors (name, top_n) VALUES ($1, $2) RETURNING *",
        body.name, body.top_n,
    )
    return dict(row)


@router.patch("/{sector_id}", response_model=SectorOut)
async def update_sector(sector_id: int, body: SectorUpdate):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM sectors WHERE id = $1", sector_id)
    if not row:
        raise HTTPException(status_code=404, detail="Sector not found")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return dict(row)
    set_clauses = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates))
    set_clauses += f", updated_at = NOW()"
    values = list(updates.values())
    row = await pool.fetchrow(
        f"UPDATE sectors SET {set_clauses} WHERE id = $1 RETURNING *",
        sector_id, *values,
    )
    return dict(row)


@router.delete("/{sector_id}")
async def delete_sector(sector_id: int):
    pool = await get_pool()
    result = await pool.execute("DELETE FROM sectors WHERE id = $1", sector_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Sector not found")
    return {"deleted": True}
