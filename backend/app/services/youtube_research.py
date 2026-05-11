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
) -> list[str]:
    """Build keyword-based search queries. Channel filtering is handled separately."""
    company = name_en or name
    kws = keywords if keywords else ["決算 業績", "stock analysis", "株価 評論", "earnings results", "投資家 IR", "news business"]
    queries = [f"{company} {kw}" for kw in kws[:6]]
    if name and name != company and not keywords:
        queries[2] = f"{name} 株価 評論"
        queries[4] = f"{name} 投資家 IR"
    return queries[:10]


# ── Video search ───────────────────────────────────────────────────────────────

def _make_video_dict(vid_id: str, snippet: dict) -> dict:
    return {
        "video_id": vid_id,
        "title": snippet.get("title", ""),
        "channel": snippet.get("channelTitle", ""),
        "published_at": snippet.get("publishedAt", "")[:10],
        "description": snippet.get("description", "")[:300],
        "url": f"https://www.youtube.com/watch?v={vid_id}",
    }


async def _resolve_channel_id(name: str, youtube_api_key: str, http: httpx.AsyncClient) -> str | None:
    """Resolve a channel display name to its YouTube channel ID."""
    try:
        resp = await http.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={"q": name, "type": "channel", "part": "id", "maxResults": 1, "key": youtube_api_key},
        )
        if resp.status_code == 200:
            items = resp.json().get("items", [])
            if items:
                return items[0]["id"]["channelId"]
    except Exception as exc:
        logger.warning(f"Channel ID lookup failed for '{name}': {exc}")
    return None


async def _search_youtube_api(
    queries: list[str],
    youtube_api_key: str,
    channels: list[str] | None = None,
    max_per_query: int = 3,
) -> dict[str, dict]:
    """
    Search YouTube Data API v3.

    When channels are provided: resolve names → channel IDs → search within each
    channel (channel-specific search). Skipped entirely when channels is empty.

    When channels are not provided: general keyword search across all channels.
    """
    videos: dict[str, dict] = {}
    async with httpx.AsyncClient(timeout=20) as http:

        if channels:
            # ── Channel search ────────────────────────────────────────────────
            channel_ids: list[str] = []
            for ch_name in channels[:5]:
                ch_id = await _resolve_channel_id(ch_name, youtube_api_key, http)
                if ch_id:
                    channel_ids.append(ch_id)
            logger.info(f"Resolved {len(channel_ids)}/{len(channels)} channel IDs for channel search")

            if channel_ids:
                for ch_id in channel_ids:
                    for query in queries[:3]:
                        try:
                            resp = await http.get(
                                "https://www.googleapis.com/youtube/v3/search",
                                params={
                                    "q": query, "type": "video", "part": "snippet",
                                    "maxResults": max_per_query, "order": "date",
                                    "channelId": ch_id, "key": youtube_api_key,
                                },
                            )
                            if resp.status_code != 200:
                                logger.warning(f"YouTube channel search {resp.status_code} ch={ch_id} q='{query}'")
                                continue
                            for item in resp.json().get("items", []):
                                vid_id = item["id"]["videoId"]
                                if vid_id not in videos:
                                    videos[vid_id] = _make_video_dict(vid_id, item["snippet"])
                        except Exception as exc:
                            logger.warning(f"YouTube channel search error: {exc}")
            # If no channel IDs resolved, fall through to general search below
            if videos:
                return videos
            logger.warning("No channel IDs resolved — falling back to general search")

        # ── General search (no channels, or channel search yielded nothing) ──
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
                        videos[vid_id] = _make_video_dict(vid_id, item["snippet"])
            except Exception as exc:
                logger.warning(f"YouTube API query failed '{query}': {exc}")
    return videos


async def _search_youtube_claude(
    name: str,
    name_en: str,
    anthropic_api_key: str,
    channels: list[str] | None = None,
) -> dict[str, dict]:
    """Fallback: find YouTube videos via Claude web_search."""
    company = name_en or name
    channel_hint = (
        f" Prioritize videos from these channels if available: {', '.join(channels[:5])}."
        if channels else ""
    )
    prompt = (
        f"Find 6-8 recent YouTube videos (2024-2025) about the Japanese company {company} ({name}). "
        f"Look for videos on financial results, stock analysis, business news, and investor commentary.{channel_hint} "
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

def _extract_tag(tag: str, text: str) -> str:
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
    return m.group(1).strip() if m else ""


async def _analyze_with_claude(
    videos: list[dict],
    name: str,
    name_en: str,
    anthropic_api_key: str,
) -> dict:
    """Analyze videos and return a trilingual Markdown report."""
    company = name_en or name

    contexts = []
    for v in videos[:6]:
        content = v.get("transcript") or f"Description: {v.get('description', 'N/A')}"
        contexts.append(
            f"### {v['title']}\n"
            f"Channel: {v['channel']} | Date: {v.get('published_at', '')} | URL: {v['url']}\n"
            f"{content[:2000]}"
        )

    video_list = "\n".join(
        f"- [{v['title']}]({v['url']}) — {v.get('channel', '')} ({v.get('published_at', '')})"
        for v in videos
    )

    prompt = (
        f"You are analyzing YouTube videos about **{company}** ({name}), a Japanese listed company.\n\n"
        "## Video transcripts / descriptions\n\n"
        + "\n\n---\n\n".join(contexts)
        + "\n\n---\n\n"
        "Write a research report in **three languages**. "
        "Wrap each section with the exact XML tags shown below. "
        "Inside each tag write well-structured Markdown (use ## headers, bullet lists, **bold**).\n\n"
        "Required sections inside each language block:\n"
        "  ## Executive Summary  (2–3 paragraphs)\n"
        "  ## Key Findings  (5–7 bullet points)\n"
        "  ## Overall Sentiment  (positive / neutral / negative + one-sentence reason)\n"
        "  ## Video Analysis  (one ### subsection per video: title, channel, date, 2-sentence summary, 2-3 bullet key points)\n\n"
        "<EN>\n[English Markdown report here]\n</EN>\n\n"
        "<JA>\n[Japanese Markdown report here — 日本語]\n</JA>\n\n"
        "<ZH>\n[Simplified Chinese Markdown report here — 简体中文]\n</ZH>\n\n"
        "After </ZH>, on separate lines, output exactly:\n"
        "SENTIMENT: positive|neutral|negative\n"
        "SCORE: 0.0"
    )

    client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
    response = await client.messages.create(
        model=_MODEL, max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "\n".join(b.text for b in response.content if hasattr(b, "text") and b.text)

    en_md = _extract_tag("EN", text)
    ja_md = _extract_tag("JA", text)
    zh_md = _extract_tag("ZH", text)

    if not en_md:
        en_md = text[:2000]
        logger.warning(f"Could not parse EN section from YouTube report for {name}")

    sent_m  = re.search(r"SENTIMENT:\s*(positive|neutral|negative)", text, re.IGNORECASE)
    score_m = re.search(r"SCORE:\s*([0-9.]+)", text)

    return {
        "report": {"en": en_md, "ja": ja_md, "zh": zh_md},
        "overall_sentiment": sent_m.group(1).lower() if sent_m else "neutral",
        "sentiment_score": float(score_m.group(1)) if score_m else 0.5,
        "videos_analyzed": len(videos),
        "videos": [
            {
                "video_id": v["video_id"],
                "title": v["title"],
                "channel": v.get("channel", ""),
                "url": v["url"],
                "published_at": v.get("published_at", ""),
                "transcript_source": v.get("transcript_source", "metadata_only"),
            }
            for v in videos
        ],
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


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
        queries = _generate_queries(name, name_en, keywords=keywords)

        if youtube_api_key and not youtube_api_key.startswith("your_"):
            videos_map = await _search_youtube_api(queries, youtube_api_key, channels=channels or None)
        else:
            videos_map = await _search_youtube_claude(name, name_en, anthropic_api_key, channels=channels or None)

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
