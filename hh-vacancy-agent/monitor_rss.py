from __future__ import annotations

import html
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

RSS_URL = "https://hh.ru/search/vacancy/rss"
TG_API = "https://api.telegram.org"
STATE = Path(os.getenv("STATE_PATH", "hh-vacancy-agent/data/state.json"))
UA = os.getenv("HH_USER_AGENT", "HH-Vacancy-Monitor/1.2 (+https://github.com/zubakineb-spec/HomeCinema-Tizen)")
MIN_SCORE = int(os.getenv("MIN_SCORE", "70"))
MAX_PER_RUN = int(os.getenv("MAX_PER_RUN", "10"))
PERIOD_DAYS = int(os.getenv("HH_PERIOD_DAYS", "3"))

# RSS yields the newest items per query, so keep several focused searches instead of one broad query.
QUERIES = (
    "международное сотрудничество",
    "международные отношения",
    "внешние связи",
    "международные проекты",
    "зарубежные партнеры",
    "project coordinator",
    "external relations",
    "внешнеэкономическая деятельность",
)

PROFILE = (
    "международ", "внешн", "international", "external relations",
    "зарубежн", "партнер", "партнёр", "проект", "project",
    "аналит", "английск", "english", "экспорт", "вэд",
    "внешнеэконом", "делегац", "протокол", "координатор",
    "сотрудничеств", "коммуникац", "agreement", "partner",
)
NEGATIVE = (
    "холодные звонки", "активные продажи", "продажи физическим лицам",
    "b2c", "call-центр", "колл-центр", "торговый представитель",
    "риелтор", "кассир",
)
PRIORITY_EMPLOYERS = (
    "агентство стратегических инициатив", "росконгресс", "россотрудничество",
    "росатом", "российский экспортный центр", "торгово-промышленная палата",
    "минэкономразвития", "минпромторг", "дом.рф", "ростех", "ржд",
)


@dataclass(frozen=True)
class Vacancy:
    vacancy_id: str
    title: str
    company: str
    url: str
    salary: str
    location: str
    description: str
    published: str


@dataclass(frozen=True)
class Match:
    vacancy: Vacancy
    score: int
    reasons: tuple[str, ...]


class HHFeedError(RuntimeError):
    pass


def now() -> datetime:
    return datetime.now(timezone.utc)


def load_state() -> dict[str, Any]:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("sent", {})
            data.setdefault("alerts", {})
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"sent": {}, "alerts": {}}


def save_state(state: dict[str, Any]) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    cutoff = now() - timedelta(days=45)
    sent = state.setdefault("sent", {})
    for key, value in list(sent.items()):
        try:
            dt = datetime.fromisoformat(str(value))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < cutoff:
                del sent[key]
        except ValueError:
            del sent[key]
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def clean(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def field(description_html: str, label: str) -> str:
    plain = html.unescape(description_html or "")
    match = re.search(rf"{re.escape(label)}:\s*([^<]*)", plain, flags=re.IGNORECASE)
    return clean(match.group(1)) if match else ""


def vacancy_id(url: str) -> str:
    match = re.search(r"/vacancy/(\d+)", url or "")
    return match.group(1) if match else ""


def fetch_feed(query: str) -> list[Vacancy]:
    params = {
        "text": query,
        "search_field": "name",
        "area": "1",                  # Moscow
        "period": str(PERIOD_DAYS),
        "work_format": "ON_SITE",     # employer location / office only
    }
    url = f"{RSS_URL}?{urlencode(params)}"
    request = Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
    except HTTPError as exc:
        raise HHFeedError(f"RSS HTTP {exc.code}") from exc
    except URLError as exc:
        raise HHFeedError(f"RSS network {type(exc.reason).__name__}") from exc

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise HHFeedError("RSS XML parse error") from exc

    result: list[Vacancy] = []
    for item in root.findall(".//item"):
        title = clean(item.findtext("title") or "")
        link = clean(item.findtext("link") or "")
        vid = vacancy_id(link)
        if not vid:
            continue
        desc_html = item.findtext("description") or ""
        company = field(desc_html, "Вакансия компании")
        salary = field(desc_html, "Предполагаемый уровень месячного дохода")
        location = field(desc_html, "Регион") or "Москва"
        description = clean(desc_html)
        published = clean(item.findtext("pubDate") or "")
        result.append(Vacancy(vid, title, company, link, salary, location, description, published))
    return result


def salary_numbers(text: str) -> list[int]:
    # Salary strings may contain spaces, nbsp/narrow nbsp and currency labels.
    normalized = (text or "").replace("\u00a0", " ").replace("\u202f", " ")
    numbers = []
    for raw in re.findall(r"\d[\d ]*", normalized):
        compact = raw.replace(" ", "")
        if compact.isdigit():
            numbers.append(int(compact))
    return [n for n in numbers if n >= 1000]


def salary_ok(vacancy: Vacancy) -> bool:
    text = vacancy.salary.lower().strip()
    if not text or "не указан" in text:
        return True
    if any(cur in text for cur in ("usd", "$", "eur", "€", "kzt", "byn")):
        return True
    nums = salary_numbers(text)
    if not nums:
        return True
    # Reject only when the whole advertised range is below the hard minimum.
    return max(nums) >= 40_000


def score(vacancy: Vacancy) -> tuple[int, tuple[str, ...]]:
    value = 18
    reasons: list[str] = []
    title = vacancy.title.lower()
    text = f"{vacancy.title} {vacancy.description}".lower()

    title_hits = sum(1 for marker in PROFILE if marker in title)
    if title_hits:
        points = min(34, 10 + title_hits * 6)
        value += points
        reasons.append(f"профильная должность +{points}")

    profile_hits = sum(1 for marker in PROFILE if marker in text)
    if profile_hits:
        points = min(24, profile_hits * 2)
        value += points
        reasons.append(f"совпадение с профилем +{points}")

    bad_hits = sum(1 for marker in NEGATIVE if marker in text)
    if bad_hits:
        penalty = min(35, 20 + (bad_hits - 1) * 5)
        value -= penalty
        reasons.append(f"непрофильные продажи −{penalty}")

    company = vacancy.company.lower()
    if company and any(marker in company for marker in PRIORITY_EMPLOYERS):
        value += 15
        reasons.append("приоритетный работодатель +15")

    nums = salary_numbers(vacancy.salary)
    salary_lower = vacancy.salary.lower()
    if not vacancy.salary or "не указан" in salary_lower:
        value += 3
        reasons.append("зарплата не указана")
    elif nums and not any(cur in salary_lower for cur in ("usd", "$", "eur", "€", "kzt", "byn")):
        reference = max(nums)
        if reference >= 130_000:
            value += 15
            reasons.append("зарплата 130 тыс.+ +15")
        elif reference >= 100_000:
            value += 12
            reasons.append("зарплата 100 тыс.+ +12")
        elif reference >= 40_000:
            value += 4
            reasons.append("зарплата выше минимума +4")

    value += 8
    reasons.append("Москва +8")
    value += 10
    reasons.append("только офис/ON_SITE +10")
    return max(0, min(100, value)), tuple(reasons)


def published_ts(vacancy: Vacancy) -> float:
    try:
        dt = parsedate_to_datetime(vacancy.published)
        return dt.timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0


def collect() -> tuple[list[Match], list[str]]:
    unique: dict[str, Vacancy] = {}
    errors: list[str] = []
    for index, query in enumerate(QUERIES):
        if index:
            time.sleep(2.0)
        try:
            items = fetch_feed(query)
            print(f"HH RSS OK: {query!r}, items={len(items)}")
        except HHFeedError as exc:
            print(f"HH RSS FAIL: {query!r}, {exc}", file=sys.stderr)
            errors.append(str(exc))
            continue
        for item in items:
            unique[item.vacancy_id] = item

    if not unique and errors:
        raise HHFeedError("all RSS queries failed: " + " | ".join(errors[:4]))

    matches: list[Match] = []
    for vacancy in unique.values():
        if "москва" not in vacancy.location.lower():
            continue
        if not salary_ok(vacancy):
            continue
        points, reasons = score(vacancy)
        if points >= MIN_SCORE:
            matches.append(Match(vacancy, points, reasons))
    matches.sort(key=lambda item: (item.score, published_ts(item.vacancy)), reverse=True)
    return matches, errors


def telegram_send(text: str, url: str | None = None) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat:
        raise RuntimeError("Telegram secrets missing")
    payload: dict[str, Any] = {
        "chat_id": chat,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": "Открыть вакансию на HH", "url": url}]]
        }
    request = Request(
        f"{TG_API}/bot{token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError("Telegram sendMessage failed")


def card(match: Match) -> str:
    vacancy = match.vacancy
    why = "; ".join(match.reasons[:5])
    desc = vacancy.description
    # RSS description contains labeled fields; keep a compact excerpt only when useful.
    desc = re.sub(r"^(Вакансия компании|Регион|Предполагаемый уровень месячного дохода).*", "", desc, flags=re.I)
    parts = [
        "<b>💼 ВАКАНСИЯ</b>",
        f"<b>🎯 {match.score}/100 — {html.escape(vacancy.title)}</b>",
        f"🏢 {html.escape(vacancy.company or 'работодатель на HH')}",
        f"💰 {html.escape(vacancy.salary if vacancy.salary and 'не указан' not in vacancy.salary.lower() else 'не указана')}",
        f"📍 {html.escape(vacancy.location or 'Москва')} • офис",
    ]
    if desc.strip():
        parts.append(f"<b>Кратко:</b> {html.escape(desc.strip()[:650])}")
    parts.append(f"<b>Почему подходит:</b> {html.escape(why)}")
    parts.append(f"ID HH: <code>{html.escape(vacancy.vacancy_id)}</code>")
    return "\n".join(parts)


def alert_due(state: dict[str, Any], key: str, hours: int = 12) -> bool:
    raw = str(state.setdefault("alerts", {}).get(key) or "")
    if not raw:
        return True
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return now() - dt >= timedelta(hours=hours)
    except ValueError:
        return True


def main() -> int:
    state = load_state()
    try:
        matches, query_errors = collect()
    except HHFeedError as exc:
        if alert_due(state, "hh_rss_unavailable"):
            try:
                telegram_send(
                    "<b>⚠️ HH Vacancy Monitor</b>\nRSS-выдача HH временно недоступна. Следующий GitHub-запуск повторит попытку автоматически."
                )
                state["alerts"]["hh_rss_unavailable"] = now().isoformat()
            except Exception as send_exc:
                print(f"Service alert failed: {type(send_exc).__name__}", file=sys.stderr)
        save_state(state)
        print(f"HH RSS monitor warning: {exc}")
        return 0

    sent = state.setdefault("sent", {})
    new_matches = [m for m in matches if m.vacancy.vacancy_id not in sent]
    sent_count = 0
    for match in new_matches[:MAX_PER_RUN]:
        try:
            telegram_send(card(match), match.vacancy.url)
            sent[match.vacancy.vacancy_id] = now().isoformat()
            sent_count += 1
        except Exception as exc:
            print(f"Telegram send FAIL for {match.vacancy.vacancy_id}: {type(exc).__name__}", file=sys.stderr)
        time.sleep(0.5)

    save_state(state)
    print(json.dumps({
        "source": "hh_rss",
        "matches": len(matches),
        "new": len(new_matches),
        "sent": sent_count,
        "query_errors": len(query_errors),
        "min_score": MIN_SCORE,
        "period_days": PERIOD_DAYS,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
