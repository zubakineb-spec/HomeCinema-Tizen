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

YEAR_RE = re.compile(r"\((19\d{2}|20\d{2})\)")
SERIES_RE = re.compile(
    r"(?ix)(?:\bсезон(?:ы|а)?\b|\bсер(?:ия|ии|ий)\b|\bseason\b|\bepisodes?\b|"
    r"\bS\d{1,2}\b|\b\d{1,2}[xх]\d{1,3}\b|\[\s*\d{1,2}[xх]\d{1,3})"
)
TECH_RE = re.compile(
    r"(?ix)\b(?:2160p|1080p|1080i|720p|480p|4k|uhd|hdr10\+?|dolby\s*vision|dv|"
    r"web[- .]?dl|web[- .]?rip|blu[- ]?ray|bdremux|bdrip|hdrip|dvdrip|hdtv|"
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
    text = re.sub(r"\s+", " ", text).strip(" \t\r\n-|•")
    return text


def extract_year(title: str) -> int | None:
    m = YEAR_RE.search(title)
    return int(m.group(1)) if m else None


def detect_kind(title: str) -> str:
    return "series" if SERIES_RE.search(title) else "movie"


def canonical_title(title: str) -> str:
    t = title.lower().replace("ё", "е")
    t = YEAR_RE.sub(" ", t)
    t = re.sub(r"\[[^\]]*\]", " ", t)
    t = re.sub(r"\([^)]*(?:сезон|серии|series|episode|s\d|\d+[xх]\d+)[^)]*\)", " ", t, flags=re.I)
    t = TECH_RE.sub(" ", t)
    t = re.sub(r"\b(?:сезон(?:ы|а)?|сер(?:ия|ии|ий)|season|episodes?)\b.*$", " ", t, flags=re.I)
    t = re.sub(r"\b\d{1,2}[xх]\d{1,3}(?:-\d{1,3})?\b", " ", t)
    t = re.sub(r"[^0-9a-zа-я]+", " ", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()


def int_from_text(text: str) -> int | None:
    m = re.search(r"(?<!\d)(\d[\d\s.,]{0,12})(?!\d)", text)
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(1))
    return int(digits) if digits else None


def parse_rutor() -> list[Item]:
    urls = [
        "https://rutor.info/",
        "https://rutor.is/",
        "https://new-rutor.org/",
    ]
    page, _ = fetch_first(urls)
    soup = BeautifulSoup(page, "html.parser")
    items: list[Item] = []

    marker = soup.find(string=re.compile(r"Топ\s+фильмов\s+сейчас", re.I))
    container = marker.parent if marker else soup
    if marker:
        for _ in range(5):
            if container and container.name in {"table", "div", "section", "td"}:
                text = container.get_text(" ", strip=True)
                if "Топ фильмов" in text and len(text) > 150:
                    break
            container = container.parent if container else soup

    rows = (container or soup).find_all("tr")
    for row in rows:
        cells = row.find_all(["td", "th"])
        if len(cells) < 2:
            continue
        title_candidates = []
        for a in row.find_all("a"):
            txt = clean_title(a.get_text(" ", strip=True))
            if YEAR_RE.search(txt):
                title_candidates.append(txt)
        if not title_candidates:
            continue
        title = max(title_candidates, key=len)
        nums = [int_from_text(c.get_text(" ", strip=True)) for c in cells]
        nums = [n for n in nums if n is not None and n < 10_000_000]
        if not nums:
            continue
        metric = nums[-1]
        if metric <= 0:
            continue
        items.append(Item(
            title=title,
            year=extract_year(title),
            kind=detect_kind(title),
            source="Rutor",
            metric_name="скачивают сейчас",
            metric_value=metric,
        ))

    if len(items) < 10:
        text = soup.get_text("\n", strip=True)
        m = re.search(r"Топ\s+фильмов\s+сейчас(.*?)(?:Премьеры\s+сегодня|$)", text, flags=re.I | re.S)
        if m:
            lines = [clean_title(x) for x in m.group(1).splitlines() if clean_title(x)]
            for i, line in enumerate(lines[:-1]):
                if YEAR_RE.search(line):
                    n = int_from_text(lines[i + 1])
                    if n and n > 0:
                        items.append(Item(
                            title=line,
                            year=extract_year(line),
                            kind=detect_kind(line),
                            source="Rutor",
                            metric_name="скачивают сейчас",
                            metric_value=n,
                        ))
    return dedupe_source(items)


def parse_kinozal() -> list[Item]:
    urls = [
        "https://kinozal.tv/top.php",
        "https://kinozal.me/top.php",
    ]
    page, _ = fetch_first(urls)
    soup = BeautifulSoup(page, "html.parser")
    items: list[Item] = []

    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [clean_title(c.get_text(" ", strip=True)).lower() for c in rows[0].find_all(["th", "td"])]
        download_idx = next((i for i, h in enumerate(headers) if "скач" in h), None)
        seed_idx = next((i for i, h in enumerate(headers) if "сид" in h), None)
        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            anchors = [clean_title(a.get_text(" ", strip=True)) for a in row.find_all("a")]
            anchors = [x for x in anchors if YEAR_RE.search(x)]
            if not anchors:
                continue
            title = max(anchors, key=len)
            metric_name = "популярность"
            metric = None
            if download_idx is not None and download_idx < len(cells):
                metric = int_from_text(cells[download_idx].get_text(" ", strip=True))
                metric_name = "скачиваний"
            if (metric is None or metric <= 0) and seed_idx is not None and seed_idx < len(cells):
                metric = int_from_text(cells[seed_idx].get_text(" ", strip=True))
                metric_name = "сидов"
            if metric is None:
                all_nums = [int_from_text(c.get_text(" ", strip=True)) for c in cells]
                all_nums = [n for n in all_nums if n is not None and 0 < n < 10_000_000]
                metric = all_nums[-1] if all_nums else None
            if not metric:
                continue
            items.append(Item(
                title=title,
                year=extract_year(title),
                kind=detect_kind(title),
                source="Kinozal",
                metric_name=metric_name,
                metric_value=metric,
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
    return sorted(best.values(), key=lambda x: x.metric_value, reverse=True)[:100]


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
    if ca == cb:
        return True
    return SequenceMatcher(None, ca, cb).ratio() >= 0.90


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
        if len(item.title) < len(target.title):
            target.title = item.title
            target.year = item.year or target.year
    return merged


def safe_display_title(title: str) -> str:
    t = re.sub(r"\s+", " ", title).strip()
    t = re.sub(r"\s*[|/]\s*(?:WEB|BD|Blu|HDR|2160|1080|720).*$", "", t, flags=re.I)
    return t[:180]


def build_report(items: list[Item], errors: list[str]) -> str:
    now = datetime.now(ZoneInfo(TZ_NAME))
    movies = sorted((x for x in items if x.kind == "movie"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]
    series = sorted((x for x in items if x.kind == "series"), key=lambda x: x.aggregate_score, reverse=True)[:TOP_N]

    lines = [
        f"🎬 Торрент-популярность — {now:%d.%m.%Y}",
        "Только названия и агрегированные публичные показатели. Без ссылок на раздачи.",
        "",
    ]
    if movies:
        lines.append("🔥 ФИЛЬМЫ — ТОП-25")
        for i, x in enumerate(movies, 1):
            multi = f" · {x.source_count} ист." if x.source_count > 1 else ""
            lines.append(f"{i}. {safe_display_title(x.title)}{multi}")
            lines.append(f"   {x.source_notes}")
    else:
        lines.extend(["🔥 ФИЛЬМЫ", "Нет достаточных публичных данных сегодня."])

    lines.append("")
    if series:
        lines.append("📺 СЕРИАЛЫ — ТОП-25")
        for i, x in enumerate(series, 1):
            multi = f" · {x.source_count} ист." if x.source_count > 1 else ""
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
        if len(line) > max_len:
            for i in range(0, len(line), max_len):
                part = line[i:i + max_len]
                if current:
                    chunks.append(current.rstrip())
                    current = ""
                chunks.append(part.rstrip())
        else:
            current += line
    if current:
        chunks.append(current.rstrip())
    return chunks


def send_telegram(text: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured as GitHub Actions secrets")
    api = f"https://api.telegram.org/bot{token}/sendMessage"
    s = session()
    for idx, chunk in enumerate(split_telegram(text)):
        r = s.post(api, json={
            "chat_id": chat_id,
            "text": chunk,
            "disable_web_page_preview": True,
        }, timeout=REQUEST_TIMEOUT)
        if r.status_code != 200:
            raise RuntimeError(f"Telegram API HTTP {r.status_code}: {r.text[:300]}")
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
