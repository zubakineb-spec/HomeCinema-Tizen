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

TOP_N = int(os.getenv("TOP_N", "25"))
TZ_NAME = os.getenv("TZ_NAME", "Asia/Yekaterinburg")
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151 Safari/537.36",
)

YEAR_RE = re.compile(r"\((19\d{2}|20\d{2})(?:-(?:19|20)\d{2})?\)")
TECH_RE = re.compile(
    r"(?ix)\b(?:2160p|1080p|1080i|720p|480p|4k|uhd|hdr10\+?|dolby\s*vision|dv|"
    r"web[- .]?dl|web[- .]?rip|blu[- ]?ray|bdremux|bdrip|hdrip|dvdrip|hdtv|iptv|"
    r"x26[45]|hevc|avc|remux|proper|repack)\b"
)


@dataclass
class Item:
    title: str
    year: int | None
    kind: str
    source: str
    metric_name: str
    metric_value: int
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


def fetch_first(urls: Iterable[str]) -> tuple[str, str]:
    s = session()
    errors: list[str] = []
    for url in urls:
        try:
            r = s.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            if r.status_code == 200 and len(r.text) > 500:
                return r.text, r.url
            errors.append(f"{url}: HTTP {r.status_code}")
        except requests.RequestException as exc:
            errors.append(f"{url}: {type(exc).__name__}")
    raise RuntimeError("; ".join(errors))


def clean_title(raw: str) -> str:
    text = html.unescape(raw)
    return re.sub(r"\s+", " ", text).strip(" \t\r\n-|•")


def extract_year(title: str) -> int | None:
    m = YEAR_RE.search(title)
    return int(m.group(1)) if m else None


def base_title(title: str) -> str:
    t = clean_title(title)
    m = YEAR_RE.search(t)
    if m:
        t = t[:m.start()]
    t = re.sub(r"\[[^\]]*(?:S\d|\d{1,2}[xх]\d|из\s+\d)[^\]]*\]", " ", t, flags=re.I)
    t = TECH_RE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip(" /-|,")


def canonical_title(title: str) -> str:
    t = base_title(title).lower().replace("ё", "е")
    t = re.sub(r"[^0-9a-zа-я]+", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def parse_peer_metric(cell) -> int | None:
    # Rutor's final column is the peer column: seeders + leechers.
    nums = [int(x) for x in re.findall(r"(?<![\d.])\d+(?![\d.])", cell.get_text(" ", strip=True))]
    nums = [n for n in nums if 0 <= n < 1_000_000]
    if not nums:
        return None
    # Usually exactly two values (S and L). Summing them gives current active peers.
    return sum(nums[-2:]) if len(nums) >= 2 else nums[-1]


def parse_rutor_category_table(table, kind: str) -> list[Item]:
    items: list[Item] = []
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        anchors = [clean_title(a.get_text(" ", strip=True)) for a in row.find_all("a")]
        title_candidates = [x for x in anchors if YEAR_RE.search(x)]
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
    for heading in soup.find_all(["h1", "h2", "h3", "div", "td"]):
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
            candidates = [x for x in anchors if YEAR_RE.search(x)]
            if not candidates:
                continue
            title = max(candidates, key=len)
            lower = title.lower()
            series = bool(re.search(r"\[(?:s\d|\d{1,2}[xх]\d|\d+\s+из\s+\d)", lower, re.I))
            # Only video-looking releases; reject obvious audio/books/games/sport.
            if not re.search(r"(?i)(web|bd|blu|hdrip|dvdrip|hdtv|iptv|1080|720|2160|4k)", title):
                continue
            if re.search(r"(?i)\b(mp3|flac|fb2|pdf|djvu|pc\s*\||repack\s+от|ufc|футбол|бокс\.)\b", title):
                continue
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


def dedupe_source(items: list[Item]) -> list[Item]:
    best: dict[tuple[str, int | None, str], Item] = {}
    for item in items:
        key = (canonical_title(item.title), item.year, item.kind)
        if not key[0]:
            continue
        prev = best.get(key)
        if prev is None or item.metric_value > prev.metric_value:
            best[key] = item
    return sorted(best.values(), key=lambda x: x.metric_value, reverse=True)[:200]


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
    if a.year and b.year and abs(a.year - b.year) > 1:
        return False
    ca, cb = canonical_title(a.title), canonical_title(b.title)
    if not ca or not cb:
        return False
    return ca == cb or SequenceMatcher(None, ca, cb).ratio() >= 0.92


def merge_sources(items: list[Item]) -> list[Item]:
    merged: list[Item] = []
    for item in sorted(items, key=lambda x: x.aggregate_score, reverse=True):
        target = next((m for m in merged if same_work(m, item)), None)
        if not target:
            item.source_notes = f"{item.source}: {item.metric_value} {item.metric_name}"
            merged.append(item)
            continue
        target.aggregate_score += item.aggregate_score * 0.85
        target.source_count += 1
        target.source_notes += f"; {item.source}: {item.metric_value} {item.metric_name}"
        if len(base_title(item.title)) < len(base_title(target.title)):
            target.title = item.title
            target.year = item.year or target.year
    return merged


def safe_display_title(title: str) -> str:
    t = base_title(title)
    year = extract_year(title)
    return f"{t} ({year})" if year else t


def build_report(items: list[Item], errors: list[str]) -> str:
    now = datetime.now(ZoneInfo(TZ_NAME))
    movies = sorted((x for x in items if x.kind == "movie"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]
    series = sorted((x for x in items if x.kind == "series"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]

    lines = [
        f"🎬 Торрент-популярность — {now:%d.%m.%Y}",
        "Только названия и публичные показатели популярности. Без ссылок на раздачи.",
        "",
    ]
    if movies:
        lines.append(f"🔥 ФИЛЬМЫ — ТОП-{min(TOP_N, len(movies))}")
        for i, x in enumerate(movies, 1):
            multi = f" · {x.source_count} релиза/ист." if x.source_count > 1 else ""
            lines.append(f"{i}. {safe_display_title(x.title)}{multi}")
            lines.append(f"   {x.source_notes}")
    else:
        lines.extend(["🔥 ФИЛЬМЫ", "Нет достаточных публичных данных сегодня."])

    lines.append("")
    if series:
        lines.append(f"📺 СЕРИАЛЫ — ТОП-{min(TOP_N, len(series))}")
        for i, x in enumerate(series, 1):
            multi = f" · {x.source_count} релиза/ист." if x.source_count > 1 else ""
            lines.append(f"{i}. {safe_display_title(x.title)}{multi}")
            lines.append(f"   {x.source_notes}")
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
    sources = [("Rutor", parse_rutor), ("Kinozal", parse_kinozal)]
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
    report = build_report(merged, errors)
    print(report)

    if os.getenv("DRY_RUN", "0") != "1":
        send_telegram(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
