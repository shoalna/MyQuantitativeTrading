import yaml
from pathlib import Path

_PROMPTS_FILE = Path(__file__).parent / "prompts.yaml"

def _load() -> dict:
    with open(_PROMPTS_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)

# Load once at import time; restart the server to pick up edits.
_data: dict = _load()

def get_prompt(key: str, **kwargs) -> str:
    return _data[key]["prompt"].format(**kwargs)

def get_cfg(key: str) -> dict:
    return _data[key]
