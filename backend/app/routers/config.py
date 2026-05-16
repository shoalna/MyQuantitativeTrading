from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app import prompts
from app.database import get_pool

router = APIRouter()


class PromptUpdate(BaseModel):
    prompt: str
    max_tokens: int
    max_web_searches: Optional[int] = None


@router.get("/prompts")
async def get_prompts():
    return prompts.get_all()


@router.put("/prompts/{key}")
async def update_prompt(key: str, body: PromptUpdate):
    if key not in prompts.get_all():
        raise HTTPException(status_code=404, detail=f"Unknown prompt key: {key}")

    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO prompt_configs (key, prompt, max_tokens, max_web_searches, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (key) DO UPDATE SET
                prompt = EXCLUDED.prompt,
                max_tokens = EXCLUDED.max_tokens,
                max_web_searches = EXCLUDED.max_web_searches,
                updated_at = NOW()
            """,
            key, body.prompt, body.max_tokens, body.max_web_searches,
        )

    cfg = {**prompts.get_cfg(key), "prompt": body.prompt, "max_tokens": body.max_tokens}
    if body.max_web_searches is not None:
        cfg["max_web_searches"] = body.max_web_searches
    prompts.update(key, cfg)

    return {"ok": True}
