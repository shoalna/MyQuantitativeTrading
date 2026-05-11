"""
YouTube company research service.

Flow:
  1. Search YouTube for company-related videos
     - Primary:  YouTube Data API v3  (if YOUTUBE_API_KEY is set)
     - Fallback: Claude web_search    (site:youtube.com queries)
  2. Fetch transcripts via youtube-transcript-api (Level 1)
     or fall back to title+description only        (Level 3)
  3. Analyze with Claude → trilingual structured report
  4. Result is cached in jp_listings.youtube_report (7-day TTL)
"""
import asyncio
import json
import logging
import re
from datetime import datetime
from typing import Optional

import anthropic
import httpx

logger = logging.getLogger(__name__)
_MODEL = "claude-sonnet-4-6"


# ── Query generation ───────────────────────────────────────────────────────────

def _generate_queries(
    name: str,
    name_en: str,
    keywords: list[str] | None = None,
    channels: list[str] | None = None,
) -> list[str]:
    company = name_en or name
    kws = keywords if keywords else ["決算 業績", "stock analysis", "株価 評論", "earnings results", "投資家 IR", "news business"]
    queries = [f"{company} {kw}" for kw in kws[:6]]
    if name and name != company and not keywords:
        # replace two English-only defaults with Japanese company name variants
        queries[2] = f"{name} 株価 評論"
        queries[4] = f"{name} 投資家 IR"
    if channels:
        for ch in channels[:3]:
            queries.append(f"{company} {ch}")
    return queries[:10]


# ── Video search ───────────────────────────────────────────────────────────────

async def _search_youtube_api(
    queries: list[str],
    youtube_api_key: str,
    max_per_query: int = 3,
) -> dict[str, dict]:
    """Search YouTube Data API v3. Returns {video_id: video_dict}."""
    videos: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=20) as http:
        for query in queries:
            try:
                resp = await http.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    params={
                        "q": query, "type": "video", "part": "snippet",
                        "maxResults": max_per_query, "order": "relevance",
                        "key": youtube_api_key,
                    },
                )
                if resp.status_code != 200:
                    logger.warning(f"YouTube API {resp.status_code} for '{query}': {resp.text[:200]}")
                    continue
                for item in resp.json().get("items", []):
                    vid_id = item["id"]["videoId"]
                    if vid_id not in videos:
                        s = item["snippet"]
                        videos[vid_id] = {
                            "video_id": vid_id,
                            "title": s.get("title", ""),
                            "channel": s.get("channelTitle", ""),
                            "published_at": s.get("publishedAt", "")[:10],
                            "description": s.get("description", "")[:300],
                            "url": f"https://www.youtube.com/watch?v={vid_id}",
                        }
            except Exception as exc:
                logger.warning(f"YouTube API query failed '{query}': {exc}")
    return videos


async def _search_youtube_claude(
    name: str,
    name_en: str,
    anthropic_api_key: str,
) -> dict[str, dict]:
    """Fallback: find YouTube videos via Claude web_search."""
    company = name_en or name
    prompt = (
        f"Find 6-8 recent YouTube videos (2024-2025) about the Japanese company {company} ({name}). "
        "Look for videos on financial results, stock analysis, business news, and investor commentary. "
        "Return ONLY a JSON array (no explanation):\n"
        '[{"url":"https://www.youtube.com/watch?v=VIDEO_ID","title":"...","channel":"...","published_at":"YYYY-MM-DD"}]'
    )
    client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
    response = await client.messages.create(
        model=_MODEL, max_tokens=1500,
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
        messages=[{"role": "user", "content": prompt}],
        extra_headers={"anthropic-beta": "web-search-2025-03-05"},
    )
    text = "\n".join(b.text for b in response.content if hasattr(b, "text") and b.text)

    videos: dict[str, dict] = {}
    try:
        m = re.search(r"\[.*?\]", text, re.DOTALL)
        if m:
            for v in json.loads(m.group()):
                vid_match = re.search(r"v=([A-Za-z0-9_-]{11})", v.get("url", ""))
                if vid_match:
                    vid_id = vid_match.group(1)
                    videos[vid_id] = {
                        "video_id": vid_id,
                        "title": v.get("title", ""),
                        "channel": v.get("channel", ""),
                        "published_at": v.get("published_at", ""),
                        "description": "",
                        "url": f"https://www.youtube.com/watch?v={vid_id}",
                    }
    except Exception as exc:
        logger.warning(f"Claude YouTube search parse failed: {exc}")
    return videos


# ── Transcript fetching ────────────────────────────────────────────────────────

def _get_transcript_sync(video_id: str) -> tuple[str, str]:
    """Level-1 transcript fetch (synchronous — run in thread pool)."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        segments = YouTubeTranscriptApi.get_transcript(
            video_id, languages=["ja", "en", "en-US", "ja-JP", "zh-Hans", "zh"],
        )
        text = " ".join(seg["text"] for seg in segments)
        return text[:6000], "youtube"
    except Exception:
        return "", "metadata_only"


async def _get_transcript(video_id: str) -> tuple[str, str]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _get_transcript_sync, video_id)


# ── AI analysis ────────────────────────────────────────────────────────────────

def _fallback_report(text: str) -> dict:
    return {
        "executive_summary": {"en": text[:500], "ja": "", "zh": ""},
        "overall_sentiment": "neutral",
        "sentiment_score": 0.5,
        "key_findings": [],
        "videos": [],
    }


async def _analyze_with_claude(
    videos: list[dict],
    name: str,
    name_en: str,
    anthropic_api_key: str,
) -> dict:
    """Analyze videos and return a structured trilingual report."""
    company = name_en or name

    contexts = []
    for v in videos[:8]:
        content = v.get("transcript") or f"Description: {v.get('description', 'N/A')}"
        contexts.append(
            f"## {v['title']}\n"
            f"Channel: {v['channel']} | Date: {v.get('published_at', '')} | URL: {v['url']}\n"
            f"Transcript source: {v.get('transcript_source', 'unknown')}\n"
            f"{content[:2500]}"
        )

    prompt = (
        f"Analyze these YouTube videos about {company} ({name}), a Japanese listed company.\n\n"
        + "\n\n---\n\n".join(contexts)
        + "\n\n---\n\n"
        "Generate a structured research report in valid JSON (no markdown, no code blocks):\n\n"
        "{\n"
        '  "executive_summary": {"en": "2-3 paragraph English summary", "ja": "日本語サマリー", "zh": "中文摘要"},\n'
        '  "overall_sentiment": "positive|neutral|negative",\n'
        '  "sentiment_score": 0.0,\n'
        '  "key_findings": [{"en": "...", "ja": "...", "zh": "..."}],\n'
        '  "videos": [\n'
        '    {\n'
        '      "video_id": "...", "title": "...", "channel": "...", "url": "...", "published_at": "...",\n'
        '      "category": "financial|review|stock|pr|other",\n'
        '      "sentiment": "positive|neutral|negative", "sentiment_score": 0.0,\n'
        '      "summary": {"en": "2-3 sentences", "ja": "...", "zh": "..."},\n'
        '      "key_points": [{"en": "...", "ja": "...", "zh": "..."}],\n'
        '      "transcript_source": "youtube|metadata_only"\n'
        '    }\n'
        '  ]\n'
        "}"
    )

    client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
    response = await client.messages.create(
        model=_MODEL, max_tokens=5000,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "\n".join(b.text for b in response.content if hasattr(b, "text") and b.text)

    try:
        clean = re.sub(r"```(?:json)?", "", text).strip().strip("`")
        report = json.loads(clean)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        try:
            report = json.loads(m.group()) if m else _fallback_report(text)
        except Exception:
            report = _fallback_report(text)

    report["generated_at"] = datetime.utcnow().isoformat() + "Z"
    report["videos_analyzed"] = len(videos)
    return report


# ── Main entry point ───────────────────────────────────────────────────────────

async def fetch_youtube_report(
    name: str,
    name_en: str,
    code: str,
    anthropic_api_key: str,
    youtube_api_key: str = "",
    channels: list[str] | None = None,
    keywords: list[str] | None = None,
) -> Optional[dict]:
    """
    Search YouTube for company videos, fetch transcripts, analyze with Claude.
    Returns structured report dict, {"error": ...} on known failure, or None.
    """
    if not anthropic_api_key or anthropic_api_key.startswith("your_"):
        return None

    try:
        queries = _generate_queries(name, name_en, keywords=keywords, channels=channels)

        if youtube_api_key and not youtube_api_key.startswith("your_"):
            videos_map = await _search_youtube_api(queries, youtube_api_key)
        else:
            videos_map = await _search_youtube_claude(name, name_en, anthropic_api_key)

        if not videos_map:
            logger.warning(f"No YouTube videos found for {code} ({name})")
            return {"error": "no_videos", "videos_analyzed": 0, "videos": []}

        videos = list(videos_map.values())[:10]

        # Fetch transcripts concurrently
        transcripts = await asyncio.gather(*[_get_transcript(v["video_id"]) for v in videos])
        for v, (transcript, source) in zip(videos, transcripts):
            v["transcript"] = transcript
            v["transcript_source"] = source

        report = await _analyze_with_claude(videos, name, name_en, anthropic_api_key)
        logger.info(f"YouTube report done for {code}: {report['videos_analyzed']} videos")
        return report

    except anthropic.APIStatusError as exc:
        body = getattr(exc, "body", {}) or {}
        if "credit" in str(body).lower() or "credit" in str(exc).lower():
            return {"error": "no_credits"}
        logger.warning(f"YouTube report API error for {code}: {exc}")
        return None
    except Exception as exc:
        logger.exception(f"YouTube report failed for {code}: {exc}")
        return None
