"""Dummy stubs for Reddit and YouTube — returns static fake data."""

_REDDIT_POSTS = [
    {"title": "[STUB] Bullish on ${{symbol}} heading into earnings", "score": 1240, "url": "https://reddit.com/r/stocks/stub1"},
    {"title": "[STUB] ${{symbol}} short squeeze potential?", "score": 872, "url": "https://reddit.com/r/wallstreetbets/stub2"},
    {"title": "[STUB] Why I'm holding ${{symbol}} long term", "score": 430, "url": "https://reddit.com/r/investing/stub3"},
]

_YOUTUBE_VIDEOS = [
    {"title": "[STUB] ${{symbol}} technical analysis 2025", "views": 48200, "url": "https://youtube.com/watch?v=stub1"},
    {"title": "[STUB] Should you buy ${{symbol}} now?", "views": 21500, "url": "https://youtube.com/watch?v=stub2"},
]


async def fetch_reddit(symbol: str) -> dict:
    posts = [{"title": p["title"].replace("{{symbol}}", symbol), "score": p["score"], "url": p["url"]} for p in _REDDIT_POSTS]
    return {"source": "reddit_stub", "symbol": symbol, "posts": posts}


async def fetch_youtube(symbol: str) -> dict:
    videos = [{"title": v["title"].replace("{{symbol}}", symbol), "views": v["views"], "url": v["url"]} for v in _YOUTUBE_VIDEOS]
    return {"source": "youtube_stub", "symbol": symbol, "videos": videos}
