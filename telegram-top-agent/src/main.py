from __future__ import annotations

import html
import math
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from typing import Iterable
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag

TOP_N = int(os.getenv("TOP_N", "25"))
TZ_NAME = os.getenv("TZ_NAME", "Asia/Yekaterinburg")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
WIKI_TIMEOUT = int(os.getenv("WIKI_TIMEOUT", "8"))
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151 Safari/537.36",
)

PAREN_YEAR_RE = re.compile(r"\((19\d{2}|20\d{2})(?:-(?:19|20)\d{2})?\)")
ANY_YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
TECH_RE = re.compile(
    r"(?ix)\b(?:2160p|1080p|1080i|720p|480p|4k|uhd|hdr10\+?|dolby\s*vision|dv|"
    r"web[- .]?dl|web[- .]?rip|blu[- ]?ray|bdremux|bdrip|hdrip|dvdrip|hdtv|iptv|"
    r"x26[45]|hevc|avc|remux|proper|repack|satrip|tsrip)\b"
)
NON_VIDEO_RE = re.compile(
    r"(?ix)\b(?:mp3|flac|aac|wav|fb2|epub|pdf|djvu|audiobook|аудиокниг|"
    r"pc\s*\||repack\s+от|driver|windows|android|portable|software|софт|игр[аы]|"
    r"ufc|футбол|хоккей|бокс|формула\s*1)\b"
)


@dataclass
class Item:
    title: str
    year: int | None
    kind: str
    source: str
    metric_name: str
    metric_value: int
    metric_display: str = ""
    description: str = ""
    source_rank: int = 0
    aggregate_score: float = 0.0
    source_count: int = 1
    source_notes: str = ""


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.5",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    return s


def response_text(r: requests.Response) -> str:
    # Several Russian trackers still use Windows-1251. requests sometimes
    # assumes ISO-8859-1, so prefer the page-declared/apparent encoding.
    if not r.encoding or r.encoding.lower() in {"iso-8859-1", "ascii"}:
        apparent = r.apparent_encoding
        if apparent:
            r.encoding = apparent
    return r.text


def fetch_first(urls: Iterable[str]) -> tuple[str, str]:
    s = session()
    errors: list[str] = []
    for url in urls:
        try:
            r = s.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            text = response_text(r)
            if r.status_code == 200 and len(text) > 500:
                return text, r.url
            errors.append(f"{url}: HTTP {r.status_code}")
        except requests.RequestException as exc:
            errors.append(f"{url}: {type(exc).__name__}")
    raise RuntimeError("; ".join(errors))


def clean_title(raw: str) -> str:
    text = html.unescape(raw)
    return re.sub(r"\s+", " ", text).strip(" \t\r\n-|•")


def extract_year(title: str) -> int | None:
    m = ANY_YEAR_RE.search(title)
    return int(m.group(1)) if m else None


def base_title(title: str) -> str:
    t = clean_title(title)
    m = PAREN_YEAR_RE.search(t)
    if m:
        t = t[:m.start()]
    # Release metadata in square brackets: season/episodes, years, codecs, genres.
    t = re.sub(
        r"\[[^\]]*(?:S\d|\d{1,2}[xх]\d|из\s+\d|19\d{2}|20\d{2}|1080|720|2160|BDRip|WEB)[^\]]*\]",
        " ",
        t,
        flags=re.I,
    )
    t = re.sub(r"(?i)\b(?:сезон|season)\s*[:№#-]?\s*\d+\b.*$", " ", t)
    t = TECH_RE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip(" /-|,")


def canonical_title(title: str) -> str:
    t = base_title(title).lower().replace("ё", "е")
    t = re.sub(r"[^0-9a-zа-я]+", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def looks_like_video(title: str) -> bool:
    if NON_VIDEO_RE.search(title):
        return False
    return bool(
        ANY_YEAR_RE.search(title)
        and (
            TECH_RE.search(title)
            or re.search(r"(?i)\b(?:film|movie|сезон|серии|series|season)\b", title)
        )
    )


def shorten_description(text: str, max_chars: int = 280) -> str:
    t = BeautifulSoup(html.unescape(text), "html.parser").get_text(" ", strip=True)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\[[0-9]+\]", "", t)
    if not t:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", t)
    chosen = ""
    for sentence in sentences[:3]:
        candidate = (chosen + " " + sentence).strip()
        if len(candidate) > max_chars:
            break
        chosen = candidate
        if len(chosen) >= 120 and len(re.findall(r"[.!?]", chosen)) >= 2:
            break
    if not chosen:
        chosen = t[:max_chars].rsplit(" ", 1)[0]
    if len(chosen) < len(t) and not chosen.endswith((".", "!", "?", "…")):
        chosen += "…"
    return chosen


def parse_peer_metric(cell) -> int | None:
    nums = [int(x) for x in re.findall(r"(?<![\d.])\d+(?![\d.])", cell.get_text(" ", strip=True))]
    nums = [n for n in nums if 0 <= n < 1_000_000]
    if not nums:
        return None
    return sum(nums[-2:]) if len(nums) >= 2 else nums[-1]


def parse_rutor_category_table(table, kind: str) -> list[Item]:
    items: list[Item] = []
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        anchors = [clean_title(a.get_text(" ", strip=True)) for a in row.find_all("a")]
        title_candidates = [x for x in anchors if PAREN_YEAR_RE.search(x)]
        if not title_candidates:
            continue
        title = max(title_candidates, key=len)
        metric = parse_peer_metric(cells[-1])
        if metric is None or metric <= 0:
            continue
        items.append(Item(
            title=title,
            year=extract_year(title),
            kind=kind,
            source="Rutor",
            metric_name="активных пиров",
            metric_value=metric,
        ))
    return items


def parse_rutor() -> list[Item]:
    page, _ = fetch_first([
        "https://rutor.info/top",
        "https://rutor.is/top",
        "https://new-rutor.org/top",
    ])
    soup = BeautifulSoup(page, "html.parser")
    category_kinds = {
        "зарубежные фильмы": "movie",
        "наши фильмы": "movie",
        "зарубежные сериалы": "series",
        "наши сериалы": "series",
    }
    items: list[Item] = []
    matched_categories: set[str] = set()
    for heading in soup.find_all(["h1", "h2", "h3"]):
        text = clean_title(heading.get_text(" ", strip=True)).lower()
        if "самые популярные торренты в категории" not in text:
            continue
        category = next((name for name in category_kinds if name in text), None)
        if not category or category in matched_categories:
            continue
        table = heading.find_next("table")
        if not table:
            continue
        parsed = parse_rutor_category_table(table, category_kinds[category])
        if parsed:
            matched_categories.add(category)
            items.extend(parsed)
    if not items:
        raise RuntimeError("movie/series category tables not found")
    print("Rutor categories: " + ", ".join(sorted(matched_categories)), file=sys.stderr)
    return dedupe_source(items)


def nearby_text_after_heading(heading: Tag, max_chars: int = 12000) -> str:
    pieces: list[str] = []
    chars = 0
    for node in heading.next_elements:
        if node is heading:
            continue
        if isinstance(node, Tag) and node.name == "h2":
            break
        if isinstance(node, NavigableString):
            text = str(node)
            pieces.append(text)
            chars += len(text)
        elif isinstance(node, Tag):
            for attr in ("alt", "title"):
                value = node.get(attr)
                if value:
                    text = str(value)
                    pieces.append(text)
                    chars += len(text)
        if chars >= max_chars:
            break
    return clean_title(" ".join(pieces))


def parse_nnm_peer_metric(text: str) -> int | None:
    up = re.search(r"(?<!\d)(\d{1,6})\s*(?:↑|сид(?:ы|ов|еры?)?|seed(?:er)?s?)", text, re.I)
    down = re.search(r"(?<!\d)(\d{1,6})\s*(?:↓|лич(?:и|ей|еры?)?|leech(?:er)?s?)", text, re.I)
    values = []
    if up:
        values.append(int(up.group(1)))
    if down:
        values.append(int(down.group(1)))
    if values:
        return sum(values)
    pair = re.search(
        r"Размер\s+[\d.,]+\s*(?:KB|MB|GB|TB).*?\|\s*(\d{1,6}).{0,80}?\|\s*(\d{1,6})",
        text,
        re.I,
    )
    if pair:
        return int(pair.group(1)) + int(pair.group(2))
    return None


def extract_nnm_description(text: str) -> str:
    patterns = [
        r"(?:Описание|О\s+фильме|О\s+сериале)\s*[:\-]?\s*(.*?)(?=(?:Качество|Видео|Аудио|Продолжительность|Размер|Доп\.?\s*информация|Релиз)\s*[:\-])",
        r"(?:Сюжет)\s*[:\-]?\s*(.*?)(?=(?:Качество|Видео|Аудио|Продолжительность|Размер|Доп\.?\s*информация)\s*[:\-])",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.I | re.S)
        if m:
            candidate = shorten_description(m.group(1))
            if len(candidate) >= 45:
                return candidate
    return ""


def parse_nnm_category(url: str, kind: str, label: str) -> list[Item]:
    page, _ = fetch_first([url])
    soup = BeautifulSoup(page, "html.parser")
    items: list[Item] = []
    for heading in soup.find_all("h2"):
        title = clean_title(heading.get_text(" ", strip=True))
        if not ANY_YEAR_RE.search(title) or not looks_like_video(title):
            continue
        block_text = nearby_text_after_heading(heading)
        metric = parse_nnm_peer_metric(block_text)
        if not metric or metric <= 0:
            continue
        items.append(Item(
            title=title,
            year=extract_year(title),
            kind=kind,
            source="NNM-Club",
            metric_name="активных пиров",
            metric_value=metric,
            description=extract_nnm_description(block_text),
        ))
    print(f"NNM {label}: {len(items)} parsed", file=sys.stderr)
    return items


def parse_nnmclub() -> list[Item]:
    categories = [
        ("https://nnmclub.to/portal.php?c=10", "movie", "новинки кино"),
        ("https://nnmclub.to/portal.php?c=11", "movie", "HD/UHD кино"),
        ("https://nnmclub.to/forum/portal.php?c=6", "movie", "зарубежное кино"),
        ("https://nnmclub.to/portal.php?c=13", "movie", "наше кино"),
        ("https://nnmclub.to/portal.php?c=3", "series", "зарубежные сериалы"),
        ("https://nnmclub.to/portal.php?c=4", "series", "наши сериалы"),
    ]
    items: list[Item] = []
    failures = 0
    for url, kind, label in categories:
        try:
            items.extend(parse_nnm_category(url, kind, label))
        except Exception as exc:
            failures += 1
            print(f"NNM {label} failed: {exc}", file=sys.stderr)
    if not items:
        raise RuntimeError(f"all NNM category parsers failed or returned 0 ({failures} failures)")
    return dedupe_source(items)


def decode_tapochek(r: requests.Response) -> str:
    raw = r.content
    for enc in ("cp1251", "windows-1251", "utf-8"):
        try:
            text = raw.decode(enc)
            if "Tapochek" in text or "Торрент" in text or "Темы" in text:
                return text
        except UnicodeDecodeError:
            pass
    return raw.decode("cp1251", errors="replace")


def parse_tapochek_metric(row_text: str) -> tuple[int, str] | None:
    # Typical forum row around torrent stats:
    # seeders | leechers 23.31 GB replies | views downloads dd-mm-yyyy
    m = re.search(
        r"(?<!\d)(\d{1,5})\s*\|\s*(\d{1,5})\s+"
        r"[\d.,]+\s*(?:KB|MB|GB|TB)\s+"
        r"\d{1,6}\s*\|\s*[\d\s]{1,10}\s+([\d\s]{1,10})\s+"
        r"\d{2}-\d{2}-\d{4}",
        row_text,
        re.I,
    )
    if m:
        downloads = int(re.sub(r"\D", "", m.group(3)))
        if downloads > 0:
            return downloads, "скачиваний"
    # Fallback: active peers are still a valid current popularity signal.
    p = re.search(
        r"(?<!\d)(\d{1,5})\s*\|\s*(\d{1,5})\s+[\d.,]+\s*(?:KB|MB|GB|TB)",
        row_text,
        re.I,
    )
    if p:
        peers = int(p.group(1)) + int(p.group(2))
        if peers > 0:
            return peers, "активных пиров"
    return None


def parse_tapochek_category(forum_id: int, kind: str, label: str) -> list[Item]:
    s = session()
    url = f"https://tapochek.net/viewforum.php?f={forum_id}"
    r = s.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    page = decode_tapochek(r)
    if "login.php" in r.url.lower() and "viewforum" not in r.url.lower():
        raise RuntimeError("login redirect")
    soup = BeautifulSoup(page, "html.parser")
    items: list[Item] = []
    for row in soup.find_all("tr"):
        links = [
            a for a in row.find_all("a", href=True)
            if re.search(r"viewtopic\.php\?(?:[^#]*&)?t=\d+", a.get("href", ""), re.I)
        ]
        if not links:
            continue
        titles = [clean_title(a.get_text(" ", strip=True)) for a in links]
        titles = [t for t in titles if ANY_YEAR_RE.search(t) and len(t) >= 8]
        if not titles:
            continue
        title = max(titles, key=len)
        if NON_VIDEO_RE.search(title):
            continue
        metric = parse_tapochek_metric(clean_title(row.get_text(" ", strip=True)))
        if not metric:
            continue
        metric_value, metric_name = metric
        items.append(Item(
            title=title,
            year=extract_year(title),
            kind=kind,
            source="Tapochek",
            metric_name=metric_name,
            metric_value=metric_value,
        ))
    print(f"Tapochek {label}: {len(items)} parsed", file=sys.stderr)
    return items


def parse_tapochek() -> list[Item]:
    categories = [
        (74, "movie", "зарубежное кино"),
        (75, "movie", "отечественное кино"),
        (980, "series", "зарубежные сериалы"),
        (981, "series", "русские сериалы"),
    ]
    items: list[Item] = []
    failures = 0
    for forum_id, kind, label in categories:
        try:
            items.extend(parse_tapochek_category(forum_id, kind, label))
        except Exception as exc:
            failures += 1
            print(f"Tapochek {label} failed: {exc}", file=sys.stderr)
    if not items:
        raise RuntimeError(f"all Tapochek category parsers failed or returned 0 ({failures} failures)")
    return dedupe_source(items)


def parse_kinozal() -> list[Item]:
    page, _ = fetch_first([
        "https://kinozal.tv/top.php",
        "https://kinozal.me/top.php",
    ])
    soup = BeautifulSoup(page, "html.parser")
    items: list[Item] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_text = clean_title(rows[0].get_text(" ", strip=True)).lower()
        if not any(k in header_text for k in ("название", "раздач")):
            continue
        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            anchors = [clean_title(a.get_text(" ", strip=True)) for a in row.find_all("a")]
            candidates = [x for x in anchors if ANY_YEAR_RE.search(x)]
            if not candidates:
                continue
            title = max(candidates, key=len)
            if not looks_like_video(title):
                continue
            lower = title.lower()
            series = bool(re.search(r"(?:\[(?:s\d|\d{1,2}[xх]\d)|сезон|серии)", lower, re.I))
            nums = [int(x) for x in re.findall(r"\d+", cells[-1].get_text(" ", strip=True))]
            nums = [n for n in nums if 0 < n < 1_000_000]
            if not nums:
                continue
            items.append(Item(
                title=title,
                year=extract_year(title),
                kind="series" if series else "movie",
                source="Kinozal",
                metric_name="показатель популярности",
                metric_value=max(nums),
            ))
    return dedupe_source(items)


def item_key(item: Item) -> tuple[str, int | None, str]:
    # A series is one work even when different seasons are released in different years.
    # Movies keep the year to prevent remakes with identical titles from collapsing.
    return (
        canonical_title(item.title),
        None if item.kind == "series" else item.year,
        item.kind,
    )


def dedupe_source(items: list[Item]) -> list[Item]:
    best: dict[tuple[str, int | None, str], Item] = {}
    for item in items:
        key = item_key(item)
        if not key[0]:
            continue
        prev = best.get(key)
        if prev is None or item.metric_value > prev.metric_value:
            if prev and not item.description:
                item.description = prev.description
            best[key] = item
        elif prev and not prev.description and item.description:
            prev.description = item.description
        if prev and item.kind == "series" and item.year and prev.year:
            best[key].year = min(item.year, prev.year)
    return sorted(best.values(), key=lambda x: x.metric_value, reverse=True)[:300]


def rank_items(items: list[Item]) -> list[Item]:
    by_source_kind: dict[tuple[str, str], list[Item]] = {}
    for item in items:
        by_source_kind.setdefault((item.source, item.kind), []).append(item)
    for group in by_source_kind.values():
        group.sort(key=lambda x: x.metric_value, reverse=True)
        max_metric = max((x.metric_value for x in group), default=1)
        for rank, item in enumerate(group, 1):
            item.source_rank = rank
            volume = math.log1p(item.metric_value) / math.log1p(max_metric) if max_metric > 1 else 1.0
            item.aggregate_score = 0.65 * volume + 0.35 * (1.0 / math.sqrt(rank))
    return items


def same_work(a: Item, b: Item) -> bool:
    if a.kind != b.kind:
        return False
    ca, cb = canonical_title(a.title), canonical_title(b.title)
    if not ca or not cb:
        return False
    similarity = 1.0 if ca == cb else SequenceMatcher(None, ca, cb).ratio()
    if a.kind == "series":
        # Ignore release-year differences between seasons of the same series.
        return similarity >= 0.90
    if a.year and b.year and abs(a.year - b.year) > 1:
        return False
    return similarity >= 0.92


def metric_note(item: Item) -> str:
    shown = item.metric_display or f"{item.metric_value} {item.metric_name}"
    return f"{item.source}: {shown}"


def merge_sources(items: list[Item]) -> list[Item]:
    merged: list[Item] = []
    for item in sorted(items, key=lambda x: x.aggregate_score, reverse=True):
        target = next((m for m in merged if same_work(m, item)), None)
        if not target:
            item.source_notes = metric_note(item)
            merged.append(item)
            continue
        target.aggregate_score += item.aggregate_score * 0.85
        target.source_count += 1
        target.source_notes += f"; {metric_note(item)}"
        if not target.description and item.description:
            target.description = item.description
        if item.kind == "series":
            years = [y for y in (target.year, item.year) if y]
            if years:
                target.year = min(years)
        elif len(base_title(item.title)) < len(base_title(target.title)):
            target.title = item.title
            target.year = item.year or target.year
    return merged


def title_variants(title: str) -> list[str]:
    base = base_title(title)
    parts = [clean_title(x) for x in re.split(r"\s+/\s+|\s+\|\s+", base)]
    out: list[str] = []
    for part in [base, *parts]:
        part = re.sub(r"[«»\"']", "", part).strip()
        if len(part) >= 2 and part not in out:
            out.append(part)
    return out[:4]


def wikipedia_description(item: Item) -> str:
    variants = title_variants(item.title)
    if not variants:
        return ""
    primary = variants[0]
    media_word = "телесериал" if item.kind == "series" else "фильм"
    query = f"{primary} {media_word}"
    if item.kind == "movie" and item.year:
        query += f" {item.year}"
    try:
        r = requests.get(
            "https://ru.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "generator": "search",
                "gsrsearch": query,
                "gsrlimit": 4,
                "prop": "extracts",
                "exintro": 1,
                "explaintext": 1,
                "exsentences": 4,
                "redirects": 1,
                "format": "json",
                "formatversion": 2,
            },
            headers={
                "User-Agent": "FilmSeriesTopBot/1.0 (https://github.com/zubakineb-spec/HomeCinema-Tizen)",
                "Accept-Language": "ru",
            },
            timeout=WIKI_TIMEOUT,
        )
        if r.status_code != 200:
            return ""
        pages = r.json().get("query", {}).get("pages", [])
    except (requests.RequestException, ValueError):
        return ""

    canonical_variants = [canonical_title(v) for v in variants]
    best_extract = ""
    best_score = 0.0
    for page in pages:
        page_title = canonical_title(str(page.get("title", "")))
        extract = clean_title(str(page.get("extract", "")))
        if not page_title or len(extract) < 45:
            continue
        score = max((SequenceMatcher(None, v, page_title).ratio() for v in canonical_variants if v), default=0.0)
        low = extract.lower()
        if item.kind == "series" and ("сериал" in low or "телесериал" in low):
            score += 0.12
        if item.kind == "movie" and "фильм" in low:
            score += 0.12
        if item.year and str(item.year) in extract:
            score += 0.08
        if score > best_score:
            best_score = score
            best_extract = extract
    if best_score < 0.52:
        return ""
    return shorten_description(best_extract)


def enrich_descriptions(items: list[Item]) -> None:
    selected = (
        sorted((x for x in items if x.kind == "movie"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]
        + sorted((x for x in items if x.kind == "series"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]
    )
    cache: dict[tuple[str, str], str] = {}
    filled_from_source = sum(1 for x in selected if x.description)
    wiki_filled = 0
    for idx, item in enumerate(selected, 1):
        if item.description:
            item.description = shorten_description(item.description)
            continue
        key = (canonical_title(item.title), item.kind)
        if key not in cache:
            cache[key] = wikipedia_description(item)
            if idx < len(selected):
                time.sleep(0.08)
        item.description = cache[key]
        if item.description:
            wiki_filled += 1
    print(
        f"Descriptions: source={filled_from_source}, wikipedia={wiki_filled}, "
        f"missing={len(selected) - filled_from_source - wiki_filled}",
        file=sys.stderr,
    )


def safe_display_title(item: Item) -> str:
    t = base_title(item.title)
    return f"{t} ({item.year})" if item.year else t


def build_report(items: list[Item], errors: list[str]) -> str:
    now = datetime.now(ZoneInfo(TZ_NAME))
    movies = sorted((x for x in items if x.kind == "movie"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]
    series = sorted((x for x in items if x.kind == "series"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]

    lines = [
        f"🎬 Торрент-популярность — {now:%d.%m.%Y}",
        "Только названия, краткие описания и публичные показатели популярности. Без ссылок на раздачи.",
        "",
    ]
    if movies:
        lines.append(f"🔥 ФИЛЬМЫ — ТОП-{min(TOP_N, len(movies))}")
        for i, x in enumerate(movies, 1):
            multi = f" · {x.source_count} источника/релиза" if x.source_count > 1 else ""
            lines.append(f"{i}. {safe_display_title(x)}{multi}")
            lines.append(f"   📊 {x.source_notes}")
            lines.append(f"   📝 {x.description or 'Краткое описание пока не найдено автоматически.'}")
    else:
        lines.extend(["🔥 ФИЛЬМЫ", "Нет достаточных публичных данных сегодня."])

    lines.append("")
    if series:
        lines.append(f"📺 СЕРИАЛЫ — ТОП-{min(TOP_N, len(series))}")
        for i, x in enumerate(series, 1):
            multi = f" · {x.source_count} источника/релиза" if x.source_count > 1 else ""
            lines.append(f"{i}. {safe_display_title(x)}{multi}")
            lines.append(f"   📊 {x.source_notes}")
            lines.append(f"   📝 {x.description or 'Краткое описание пока не найдено автоматически.'}")
    else:
        lines.extend(["📺 СЕРИАЛЫ", "Нет достаточных публичных данных сегодня."])

    if errors:
        lines.extend(["", "⚠️ Недоступные источники: " + ", ".join(errors)])
    return "\n".join(lines)


def split_telegram(text: str, max_len: int = 3800) -> list[str]:
    chunks: list[str] = []
    current = ""
    for line in text.splitlines(True):
        if len(current) + len(line) > max_len and current:
            chunks.append(current.rstrip())
            current = ""
        current += line
    if current:
        chunks.append(current.rstrip())
    return chunks


def send_telegram(text: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured as GitHub Actions secrets")

    s = session()
    identity = s.get(f"https://api.telegram.org/bot{token}/getMe", timeout=REQUEST_TIMEOUT)
    if identity.status_code != 200:
        raise RuntimeError(f"Telegram getMe HTTP {identity.status_code}: {identity.text[:300]}")
    me = identity.json().get("result", {})
    print(f"Telegram bot identity: @{me.get('username', '?')} (id={me.get('id', '?')})", file=sys.stderr)

    api = f"https://api.telegram.org/bot{token}/sendMessage"
    for idx, chunk in enumerate(split_telegram(text)):
        r = s.post(api, json={
            "chat_id": chat_id,
            "text": chunk,
            "disable_web_page_preview": True,
        }, timeout=REQUEST_TIMEOUT)
        if r.status_code != 200:
            raise RuntimeError(f"Telegram API HTTP {r.status_code}: {r.text[:300]}")
        payload = r.json().get("result", {})
        print(
            f"Telegram delivered: message_id={payload.get('message_id', '?')} "
            f"chat_id={payload.get('chat', {}).get('id', '?')}",
            file=sys.stderr,
        )
        if idx:
            time.sleep(0.5)


def main() -> int:
    all_items: list[Item] = []
    errors: list[str] = []
    sources = [
        ("Rutor", parse_rutor),
        ("NNM-Club", parse_nnmclub),
        ("Tapochek", parse_tapochek),
        ("Kinozal", parse_kinozal),
    ]
    for name, parser in sources:
        try:
            source_items = parser()
            if not source_items:
                raise RuntimeError("0 parsed items")
            all_items.extend(source_items)
            print(f"{name}: {len(source_items)} items", file=sys.stderr)
        except Exception as exc:
            errors.append(name)
            print(f"{name} failed: {exc}", file=sys.stderr)

    ranked = rank_items(all_items)
    merged = merge_sources(ranked)
    enrich_descriptions(merged)
    report = build_report(merged, errors)
    print(report)

    if os.getenv("DRY_RUN", "0") != "1":
        send_telegram(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
