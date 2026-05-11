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
        "Using web search, write the following about the company:\n"
        "1. A concise general overview (2-3 paragraphs)\n"
        "2. Core business operations and main products/services (1 paragraph)\n"
        "3. Key competitive strengths and advantages (1 paragraph)\n"
        "4. Relationship to semiconductor / AI industry — describe direct involvement, "
        "supply chain position, or indirect exposure; if unrelated, briefly note that (1 paragraph)\n\n"
        "Format your response EXACTLY as:\n"
        "<en>[English general overview]</en>\n"
        "<ja>[日本語の一般概要]</ja>\n"
        "<en_business>[English: core business operations]</en_business>\n"
        "<ja_business>[日本語: 業務内容]</ja_business>\n"
        "<en_strengths>[English: competitive strengths]</en_strengths>\n"
        "<ja_strengths>[日本語: 強み]</ja_strengths>\n"
        "<en_ai>[English: semiconductor/AI industry relation]</en_ai>\n"
        "<ja_ai>[日本語: 半導体/AI産業との関係性]</ja_ai>"
    )

    def _extract(tag: str) -> str:
        m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
        return m.group(1).strip() if m else ""

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=3000,
            tools=[{
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 4,
            }],
            messages=[{"role": "user", "content": prompt}],
            extra_headers={"anthropic-beta": "web-search-2025-03-05"},
        )

        text = "\n".join(
            b.text for b in response.content
            if hasattr(b, "text") and b.text
        )

        en = _extract("en")
        ja = _extract("ja")
        if not en and not ja:
            en = text.strip()

        logger.info(f"Company info fetched for {code} ({name})")
        return {
            "en": en,
            "ja": ja,
            "analysis": {
                "business":   {"en": _extract("en_business"),  "ja": _extract("ja_business")},
                "strengths":  {"en": _extract("en_strengths"), "ja": _extract("ja_strengths")},
                "ai_relation": {"en": _extract("en_ai"),       "ja": _extract("ja_ai")},
            },
        }

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
