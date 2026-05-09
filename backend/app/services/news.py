import re
from collections import Counter
import httpx
from app.config import settings

# Sector keyword expansions per language
SECTOR_KEYWORDS: dict[str, dict[str, str]] = {
    "en": {
        "AI":           "artificial intelligence OR machine learning OR LLM OR generative AI",
        "energy":       "energy sector OR oil OR renewable energy OR solar OR wind power",
        "healthcare":   "healthcare OR biotech OR pharmaceutical OR FDA",
        "finance":      "banking OR fintech OR interest rates OR Federal Reserve",
        "semiconductor":"semiconductor OR chip OR wafer OR TSMC OR foundry",
        "ev":           "electric vehicle OR EV OR Tesla OR battery",
    },
    "ja": {
        "AI":           "人工知能 OR 機械学習 OR 生成AI OR LLM OR 大規模言語モデル",
        "energy":       "エネルギー OR 石油 OR 再生可能エネルギー OR 太陽光発電 OR 風力発電",
        "healthcare":   "医療 OR バイオテク OR 製薬 OR 臨床試験",
        "finance":      "銀行 OR フィンテック OR 金利 OR 日本銀行",
        "semiconductor":"半導体 OR チップ OR ウェハ OR TSMC OR 製造",
        "ev":           "電気自動車 OR EV OR バッテリー OR テスラ",
    },
    "zh": {
        "AI":           "人工智能 OR 机器学习 OR 生成式AI OR 大语言模型 OR LLM",
        "energy":       "能源 OR 石油 OR 可再生能源 OR 太阳能 OR 风能",
        "healthcare":   "医疗 OR 生物技术 OR 制药 OR 临床试验",
        "finance":      "银行 OR 金融科技 OR 利率 OR 中国人民银行",
        "semiconductor":"半导体 OR 芯片 OR 晶圆 OR 台积电 OR 代工",
        "ev":           "电动汽车 OR 新能源汽车 OR 电池 OR 特斯拉",
    },
}

# NewsAPI supported language codes (ja is not supported by free tier → fall back to en)
LANG_CODE = {"en": "en", "ja": "en", "zh": "zh"}

# SP500 ticker whitelist
SP500_TICKERS: dict[str, str] = {
    "NVDA": "NVIDIA", "AMD": "Advanced Micro Devices", "INTC": "Intel",
    "MSFT": "Microsoft", "GOOGL": "Alphabet", "AMZN": "Amazon",
    "META": "Meta Platforms", "AAPL": "Apple", "TSLA": "Tesla",
    "NFLX": "Netflix", "CRM": "Salesforce", "ORCL": "Oracle",
    "IBM": "IBM", "QCOM": "Qualcomm", "AVGO": "Broadcom",
    "ARM": "Arm Holdings", "SMCI": "Super Micro Computer",
    "MU": "Micron Technology", "AMAT": "Applied Materials",
    "XOM": "ExxonMobil", "CVX": "Chevron", "BP": "BP",
    "NEE": "NextEra Energy", "ENPH": "Enphase Energy",
    "JNJ": "Johnson & Johnson", "PFE": "Pfizer", "MRNA": "Moderna",
    "ABBV": "AbbVie", "LLY": "Eli Lilly", "UNH": "UnitedHealth",
    "JPM": "JPMorgan Chase", "BAC": "Bank of America", "GS": "Goldman Sachs",
    "V": "Visa", "MA": "Mastercard", "PYPL": "PayPal",
    "RIVN": "Rivian", "NIO": "NIO", "F": "Ford",
    "AI": "C3.ai", "PLTR": "Palantir", "SNOW": "Snowflake",
    "NET": "Cloudflare", "DDOG": "Datadog", "ZS": "Zscaler",
    "TSM": "TSMC", "SONY": "Sony", "TM": "Toyota", "BABA": "Alibaba",
    "BIDU": "Baidu", "JD": "JD.com", "PDD": "PDD Holdings",
}

STOPLIST = {"IT", "AT", "BE", "BY", "IN", "ON", "OR", "TO", "IS", "AS",
            "OF", "AN", "NO", "SO", "DO", "WE", "US", "MY", "UP", "IF"}

TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")

# Company name → ticker mapping for English articles that write names in full
COMPANY_ALIASES: dict[str, str] = {
    "nvidia":        "NVDA",
    "microsoft":     "MSFT",
    "alphabet":      "GOOGL",
    "google":        "GOOGL",
    "amazon":        "AMZN",
    "tesla":         "TSLA",
    "netflix":       "NFLX",
    "salesforce":    "CRM",
    "oracle":        "ORCL",
    "qualcomm":      "QCOM",
    "broadcom":      "AVGO",
    "intel":         "INTC",
    "palantir":      "PLTR",
    "snowflake":     "SNOW",
    "cloudflare":    "NET",
    "datadog":       "DDOG",
    "tsmc":          "TSM",
    "alibaba":       "BABA",
    "baidu":         "BIDU",
    "toyota":        "TM",
    "rivian":        "RIVN",
    "moderna":       "MRNA",
    "pfizer":        "PFE",
    "micron":        "MU",
    "exxon":         "XOM",
    "chevron":       "CVX",
    "goldman sachs": "GS",
    "goldman":       "GS",
    "mastercard":    "MA",
    "paypal":        "PYPL",
    "arm holdings":  "ARM",
    "jpmorgan":      "JPM",
}

_ALIAS_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(COMPANY_ALIASES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def _expand_sector_query(sector: str, language: str) -> str:
    lang_map = SECTOR_KEYWORDS.get(language, SECTOR_KEYWORDS["en"])
    sector_lower = sector.lower()
    for key, query in lang_map.items():
        if key.lower() == sector_lower:
            return query
    # Fall back to English if sector not found in target language
    en_map = SECTOR_KEYWORDS["en"]
    for key, query in en_map.items():
        if key.lower() == sector_lower:
            return query
    return sector


async def fetch_articles(sector: str, language: str = "en", page_size: int = 100) -> list[dict]:
    if not settings.news_api_key:
        return []
    api_lang = LANG_CODE.get(language, "en")
    # Use English queries for languages not supported by NewsAPI
    query_lang = language if api_lang != "en" or language == "en" else "en"
    query = _expand_sector_query(sector, query_lang)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": query,
                "sortBy": "publishedAt",
                "pageSize": page_size,
                "language": api_lang,
                "apiKey": settings.news_api_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    articles = []
    for a in data.get("articles", []):
        articles.append({
            "title":        a.get("title") or "",
            "url":          a.get("url"),
            "published_at": a.get("publishedAt"),
            "snippet":      a.get("description") or "",
            "source":       "newsapi",
            "raw_json":     a,
        })
    return articles


async def fetch_company_news(query: str, language: str = "en", page_size: int = 20) -> list[dict]:
    """Fetch news using a direct search query (no sector expansion)."""
    if not settings.news_api_key:
        return []
    api_lang = LANG_CODE.get(language, "en")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": query,
                    "sortBy": "publishedAt",
                    "pageSize": page_size,
                    "language": api_lang,
                    "apiKey": settings.news_api_key,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []
    return [
        {
            "title":        a.get("title") or "",
            "url":          a.get("url"),
            "published_at": a.get("publishedAt"),
            "snippet":      a.get("description") or "",
            "source":       a.get("source", {}).get("name") or "newsapi",
        }
        for a in data.get("articles", [])
        if a.get("title")
    ]


def extract_top_tickers(articles: list[dict], top_n: int) -> list[dict]:
    counts: Counter = Counter()
    for a in articles:
        text = f"{a['title']} {a.get('snippet', '')}"
        for match in TICKER_RE.finditer(text):
            sym = match.group(1)
            if sym in SP500_TICKERS and sym not in STOPLIST:
                counts[sym] += 1
        for match in _ALIAS_RE.finditer(text):
            sym = COMPANY_ALIASES[match.group(1).lower()]
            counts[sym] += 1
    return [
        {"symbol": sym, "company": SP500_TICKERS[sym], "mention_count": cnt, "rank": rank + 1}
        for rank, (sym, cnt) in enumerate(counts.most_common(top_n))
    ]
