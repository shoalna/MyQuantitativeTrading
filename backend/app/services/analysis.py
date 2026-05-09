import json
import anthropic
from app.config import settings

LANG_INSTRUCTION = {
    "en": "Respond in English.",
    "ja": "必ず日本語で回答してください。",
    "zh": "请务必用简体中文回答。",
}

SYSTEM_PROMPT_TEMPLATE = """You are a financial sentiment analyst. {lang_instruction}
Given news headlines and community posts about a stock ticker, return ONLY a JSON object (no markdown) with:
- sentiment_score: float from -1.0 (very bearish) to 1.0 (very bullish)
- sentiment_label: "bullish" | "neutral" | "bearish"
- summary: 2-3 sentence prose summary of the current market sentiment
- top_news: list of up to 3 most significant headline strings"""


def _build_prompt(symbol: str, articles: list[dict], community: dict) -> str:
    headlines = "\n".join(f"- {a['title']}" for a in articles[:20])
    reddit_posts = "\n".join(f"- {p['title']}" for p in community.get("reddit", {}).get("posts", []))
    return f"""Ticker: {symbol}

News headlines:
{headlines or '(none)'}

Community discussion (Reddit):
{reddit_posts or '(none)'}

Return your analysis as JSON."""


def _fallback(articles: list[dict], reason: str) -> dict:
    return {
        "sentiment_score": None,
        "sentiment_label": "neutral",
        "summary": reason,
        "top_news": [a["title"] for a in articles[:3]],
    }


async def analyze_ticker(symbol: str, articles: list[dict], community: dict, language: str = "en") -> dict:
    key = settings.anthropic_api_key
    if not key or key == "your_anthropic_key_here" or not key.startswith("sk-"):
        return _fallback(articles, "Anthropic API key not configured.")

    lang_instruction = LANG_INSTRUCTION.get(language, LANG_INSTRUCTION["en"])
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(lang_instruction=lang_instruction)

    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": _build_prompt(symbol, articles, community)}],
        )
        text = response.content[0].text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}") + 1
            return json.loads(text[start:end]) if start != -1 else _fallback(articles, text)
    except Exception as exc:
        return _fallback(articles, f"Analysis unavailable: {exc}")
