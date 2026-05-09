import json
import logging
import anthropic
from app.config import settings

logger = logging.getLogger(__name__)

LANG_NAME = {"ja": "Japanese", "zh": "Simplified Chinese"}


async def translate_batch(texts: list[str], target_lang: str) -> list[str]:
    """Translate a list of strings in one Claude Haiku call. Returns originals on failure."""
    if target_lang == "en" or not texts:
        return texts
    key = settings.anthropic_api_key
    if not key or not key.startswith("sk-"):
        return texts

    lang_name = LANG_NAME.get(target_lang, target_lang)
    prompt = (
        f"Translate these {len(texts)} financial news strings to {lang_name}.\n"
        "Rules:\n"
        "- Keep company names, ticker symbols ($NVDA, NVIDIA, etc.) and numbers unchanged.\n"
        "- Return ONLY a valid JSON array with exactly the same number of strings.\n\n"
        f"{json.dumps(texts, ensure_ascii=False)}"
    )

    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Strip markdown code fence if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        result = json.loads(text)
        if isinstance(result, list) and len(result) == len(texts):
            return result
        logger.warning("translate_batch: length mismatch (%d vs %d)", len(result), len(texts))
    except Exception as exc:
        logger.warning("translate_batch failed: %s", exc)
    return texts


async def translate_articles(articles: list[dict], target_lang: str) -> list[dict]:
    """Add title_translated / snippet_translated fields to article dicts."""
    if target_lang == "en" or not articles:
        return articles

    titles = [a.get("title") or "" for a in articles]
    snippets = [a.get("snippet") or "" for a in articles]

    translated_titles = await translate_batch(titles, target_lang)
    translated_snippets = await translate_batch(snippets, target_lang)

    return [
        {**a, "title_translated": t, "snippet_translated": s}
        for a, t, s in zip(articles, translated_titles, translated_snippets)
    ]


async def translate_community(community: dict, target_lang: str) -> dict:
    """Translate Reddit post titles and YouTube video titles inside a community dict."""
    if target_lang == "en":
        return community

    reddit_posts = community.get("reddit", {}).get("posts", [])
    yt_videos = community.get("youtube", {}).get("videos", [])

    all_titles = [p["title"] for p in reddit_posts] + [v["title"] for v in yt_videos]
    if not all_titles:
        return community

    translated = await translate_batch(all_titles, target_lang)
    split = len(reddit_posts)

    new_posts = [
        {**p, "title_translated": translated[i]} for i, p in enumerate(reddit_posts)
    ]
    new_videos = [
        {**v, "title_translated": translated[split + i]} for i, v in enumerate(yt_videos)
    ]

    return {
        **community,
        "reddit": {**community.get("reddit", {}), "posts": new_posts},
        "youtube": {**community.get("youtube", {}), "videos": new_videos},
    }
