"""
Company information service using Claude with web search.

Generates trilingual (EN / JA / ZH) company overviews via the Anthropic API.
The main call uses the built-in web_search tool; a second lightweight call
translates any missing JA and always produces ZH.  Results are cached in
jp_listings.company_info (30-day TTL).
"""
import logging
import re
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)

_MODEL = "claude-sonnet-4-6"

# Short tag names (no underscore overlap with en/ja/zh prefix)
_FIELDS = ["overview", "business", "strengths", "airel"]


def _extract(tag: str, text: str) -> str:
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
    return m.group(1).strip() if m else ""


async def _translate(en_texts: dict[str, str], api_key: str) -> dict[str, dict[str, str]]:
    """
    Given {field: en_text}, return {field: {"ja": ..., "zh": ...}}.
    Single Claude call, no web search.
    """
    filled = {k: v for k, v in en_texts.items() if v and v.strip()}
    if not filled:
        return {}

    prompt = (
        "Translate the following English texts into natural Japanese and Simplified Chinese.\n\n"
        + "\n\n".join(f"[{k}]\n{v}" for k, v in filled.items())
        + "\n\nOutput EXACTLY in this format (no extra text):\n"
        + "".join(
            f"<{k}ja>[Japanese translation]</{k}ja>\n"
            f"<{k}zh>[Chinese translation]</{k}zh>\n"
            for k in filled
        )
    )

    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=_MODEL,
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "\n".join(b.text for b in response.content if hasattr(b, "text") and b.text)
    logger.debug(f"Translation raw ({len(text)} chars): {text[:300]}")

    return {
        k: {
            "ja": _extract(f"{k}ja", text),
            "zh": _extract(f"{k}zh", text),
        }
        for k in filled
    }


async def fetch_company_info(
    name: str,
    name_en: str,
    code: str,
    api_key: str,
) -> Optional[dict]:
    """
    Use Claude + web search to generate a trilingual company overview.
    Returns {"en", "ja", "zh", "analysis": {business/strengths/ai_relation: {en,ja,zh}}}
    or None on failure.
    """
    if not api_key or api_key.startswith("your_"):
        logger.info(f"Skipping company info for {code}: ANTHROPIC_API_KEY not configured")
        return None

    client = anthropic.AsyncAnthropic(api_key=api_key)
    company_display = name_en or name

    prompt = (
        f"Research the Japanese listed company: {company_display} "
        f"(Japanese name: {name}, TSE stock code: {code}).\n\n"
        "Using web search, write ALL of the following sections. "
        "Every section is REQUIRED — do not skip any.\n\n"
        "1. General overview (2-3 paragraphs)\n"
        "2. Core business operations and main products/services (1 paragraph)\n"
        "3. Key competitive strengths and advantages (1 paragraph)\n"
        "4. Relationship to semiconductor / AI industry — describe direct involvement, "
        "supply chain position, or indirect exposure; if unrelated say so briefly (1 paragraph)\n\n"
        "Write EACH section in BOTH English and Japanese. "
        "Format your response EXACTLY as shown below — all 8 tags required:\n\n"
        "<overview>[English general overview]</overview>\n"
        "<overviewja>[日本語の一般概要]</overviewja>\n"
        "<business>[English: core business operations]</business>\n"
        "<businessja>[日本語: 業務内容]</businessja>\n"
        "<strengths>[English: competitive strengths]</strengths>\n"
        "<strengthsja>[日本語: 強み]</strengthsja>\n"
        "<airel>[English: semiconductor/AI industry relation]</airel>\n"
        "<airlja>[日本語: 半導体/AI産業との関係性]</airlja>"
    )

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=4000,
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
        logger.info(
            f"Company info raw for {code} ({len(text)} chars): {text[:600]}"
        )

        en_overview  = _extract("overview",   text)
        ja_overview  = _extract("overviewja", text)
        en_business  = _extract("business",   text)
        ja_business  = _extract("businessja", text)
        en_strengths = _extract("strengths",  text)
        ja_strengths = _extract("strengthsja",text)
        en_airel     = _extract("airel",      text)
        ja_airel     = _extract("airlja",     text)

        if not en_overview and not ja_overview:
            en_overview = text.strip()

        logger.info(
            f"Company info extracted for {code}: "
            f"en={bool(en_overview)}, ja={bool(ja_overview)}, airel_en={bool(en_airel)}, airel_ja={bool(ja_airel)}"
        )

        # Build result with whatever was extracted
        result = {
            "en": en_overview,
            "ja": ja_overview,
            "zh": "",
            "analysis": {
                "business":    {"en": en_business,  "ja": ja_business,  "zh": ""},
                "strengths":   {"en": en_strengths, "ja": ja_strengths, "zh": ""},
                "ai_relation": {"en": en_airel,     "ja": ja_airel,     "zh": ""},
            },
        }

        # Always fill missing JA and generate ZH via a second translation call
        to_translate = {
            "overview": en_overview,
            "business": en_business,
            "strengths": en_strengths,
            "airel":    en_airel,
        }
        translations = await _translate(to_translate, api_key)

        def _fill(field: str, result_key: str) -> None:
            t = translations.get(field, {})
            if not result[result_key]:
                result[result_key] = t.get("ja", "")
            result[f"{result_key}_zh"] = t.get("zh", "")

        result["zh"] = translations.get("overview", {}).get("zh", "")
        if not result["ja"]:
            result["ja"] = translations.get("overview", {}).get("ja", "")

        for field, key in [("business", "business"), ("strengths", "strengths"), ("airel", "ai_relation")]:
            t = translations.get(field, {})
            sec = result["analysis"][key]
            if not sec["ja"]:
                sec["ja"] = t.get("ja", "")
            sec["zh"] = t.get("zh", "")

        logger.info(f"Company info complete for {code} ({name})")
        return result

    except anthropic.APIStatusError as exc:
        body = getattr(exc, "body", {}) or {}
        if "credit" in str(body).lower() or "credit" in str(exc).lower():
            logger.warning(f"Company info: Anthropic credits too low for {code}")
            return {"error": "no_credits"}
        logger.warning(f"Company info API error for {code}: {exc}")
        return None
    except Exception as exc:
        logger.warning(f"Company info fetch failed for {code}: {exc}")
        return None
