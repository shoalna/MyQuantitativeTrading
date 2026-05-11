"""
Company information service using Claude with web search.

Generates bilingual (English + Japanese) company overviews via the
Anthropic API with the built-in web_search tool.  Results are cached
in jp_listings.company_info (30-day TTL).
"""
import logging
import re
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)

_MODEL = "claude-sonnet-4-6"


async def fetch_company_info(
    name: str,
    name_en: str,
    code: str,
    api_key: str,
) -> Optional[dict]:
    """
    Use Claude with web search to generate a bilingual company overview.
    Returns {"en": str, "ja": str} or None on failure / missing API key.
    """
    if not api_key or api_key.startswith("your_"):
        logger.info(f"Skipping company info for {code}: ANTHROPIC_API_KEY not configured")
        return None

    client = anthropic.AsyncAnthropic(api_key=api_key)

    company_display = name_en or name
    prompt = (
        f"Research the Japanese listed company: {company_display} "
        f"(Japanese name: {name}, TSE stock code: {code}).\n\n"
        "Using web search, write a concise business overview covering:\n"
        "- Core business and industry\n"
        "- Key products, services, or market segments\n"
        "- Market position, scale, or notable characteristics\n\n"
        "Format your response EXACTLY as:\n"
        "<en>\n[2-3 paragraph English overview]\n</en>\n"
        "<ja>\n[2〜3段落の日本語概要]\n</ja>"
    )

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=2048,
            tools=[{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 3,
            }],
            messages=[{"role": "user", "content": prompt}],
            extra_headers={"anthropic-beta": "web-search-2025-03-05"},
        )

        text = "\n".join(
            b.text for b in response.content
            if hasattr(b, "text") and b.text
        )

        en_match = re.search(r"<en>(.*?)</en>", text, re.DOTALL)
        ja_match = re.search(r"<ja>(.*?)</ja>", text, re.DOTALL)

        en = en_match.group(1).strip() if en_match else ""
        ja = ja_match.group(1).strip() if ja_match else ""

        if not en and not ja:
            en = text.strip()

        logger.info(f"Company info fetched for {code} ({name})")
        return {"en": en, "ja": ja}

    except anthropic.APIStatusError as exc:
        body = getattr(exc, "body", {}) or {}
        if "credit" in str(body).lower() or "credit" in str(exc).lower():
            logger.warning(f"Company info: Anthropic credit balance too low for {code}")
            return {"error": "no_credits"}
        logger.warning(f"Company info API error for {code}: {exc}")
        return None
    except Exception as exc:
        logger.warning(f"Company info fetch failed for {code}: {exc}")
        return None
