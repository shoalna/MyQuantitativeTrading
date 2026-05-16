import yaml
from pathlib import Path

_PROMPTS_FILE = Path(__file__).parent / "prompts.yaml"

def _load() -> dict:
    with open(_PROMPTS_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)

_data: dict = _load()

def get_prompt(key: str, **kwargs) -> str:
    return _data[key]["prompt"].format(**kwargs)

def get_cfg(key: str) -> dict:
    return _data[key]

def get_all() -> dict:
    return _data

def update(key: str, cfg: dict) -> None:
    _data[key] = cfg

async def load_from_db(pool) -> None:
    """Override YAML defaults with DB-persisted values at startup."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT key, prompt, max_tokens, max_web_searches FROM prompt_configs"
        )
    for row in rows:
        key = row["key"]
        if key in _data:
            entry = {**_data[key], "prompt": row["prompt"], "max_tokens": row["max_tokens"]}
            if row["max_web_searches"] is not None:
                entry["max_web_searches"] = row["max_web_searches"]
            _data[key] = entry
