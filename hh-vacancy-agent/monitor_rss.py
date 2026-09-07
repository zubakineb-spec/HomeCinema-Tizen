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
UA = os.getenv(
    "HH_USER_AGENT",
    "HH-Vacancy-Monitor/1.5 (+https://github.com/zubakineb-spec/HomeCinema-Tizen)",
)
MIN_SCORE = int(os.getenv("MIN_SCORE", "70"))
MAX_PER_RUN = int(os.getenv("MAX_PER_RUN", "10"))
PERIOD_DAYS = int(os.getenv("HH_PERIOD_DAYS", "7"))

TITLE_SEARCHES = (
    "международное сотрудничество",
    "международные отношения",
    "внешние связи",
    "международные проекты",
    "координатор международных проектов",
    "специалист международных проектов",
    "менеджер международных проектов",
    "аналитик международных проектов",
    "ассистент международных проектов",
    "международные коммуникации",
    "внешние коммуникации",
    "зарубежные партнеры",
    "работа с зарубежными партнерами",
    "партнерские проекты",
    "partner relations",
    "partnerships",
    "external relations",
    "international relations",
    "international cooperation",
    "international project coordinator",
    "international project assistant",
    "координатор международных мероприятий",
    "специалист международных мероприятий",
    "международный протокол",
    "координатор делегаций",
    "координатор проектов",
    "ассистент проекта",
    "project assistant",
    "project coordinator",
    "program coordinator",
    "program assistant",
    "project support",
    "специалист проектного офиса",
    "аналитик проектного офиса",
    "координатор проектного офиса",
    "межведомственное взаимодействие",
    "взаимодействие с государственными органами",
    "government relations",
    "GR coordinator",
    "внешнеэкономическая деятельность",
    "координатор ВЭД",
    "специалист ВЭД",
    "экспортные проекты",
    "координатор экспорта",
    "экспорт",
)

FULL_TEXT_SEARCHES = (
    "международное сотрудничество",
    "международные проекты английский язык",
    "зарубежные партнеры",
    "официальная переписка английский",
    "международные соглашения",
    "подготовка соглашений международные",
    "проектная координация партнеры",
    "международные мероприятия делегации",
    "протокол делегации английский",
    "внешние коммуникации партнеры",
    "межведомственное взаимодействие проекты",
    "взаимодействие с госорганами международные проекты",
    "аналитические материалы международные",
    "research international projects",
    "project coordination international",
    "project support international",
    "partner relations international",
    "external communications international",
    "foreign partners english",
    "внешнеэкономическая деятельность",
    "экспортные проекты английский",
    "ВЭД английский язык",
)

PROFILE = (
    "международ", "внешн", "international", "external relations",
    "external communications", "global", "зарубежн", "партнер", "партнёр",
    "partner", "partnership", "project", "проект", "program", "программ",
    "аналит", "research", "исслед", "английск", "english", "экспорт",
    "export", "вэд", "внешнеэконом", "делегац", "протокол", "координатор",
    "coordinator", "assistant", "ассистент", "сотрудничеств", "коммуникац",
    "agreement", "соглашен", "переписк", "correspondence", "stakeholder",
    "cross-border", "межведомствен", "госорган", "government",
    "project office", "проектного офиса", "project support", "поддержка проекта",
)

INTERNATIONAL_MARKERS = (
    "международ", "international", "зарубежн", "foreign partner", "экспорт",
    "export", "вэд", "внешнеэконом", "cross-border",
)

STRONG_TITLE_MARKERS = (
    "международ", "international", "external relations", "внешн", "экспорт",
    "export", "вэд", "partnership", "partner relations", "межведомствен",
    "government relations",
)

ADJACENT_TITLE_MARKERS = (
    "координатор", "coordinator", "ассистент проекта", "project assistant",
    "project support", "project office", "проектного офиса", "program coordinator",
    "program assistant", "протокол", "делегац",
)

NEGATIVE = (
    "холодные звонки", "активные продажи", "продажи физическим лицам", "b2c",
    "call-центр", "колл-центр", "торговый представитель", "риелтор", "кассир",
    "план продаж", "воронка продаж", "лидогенерац", "поиск новых клиентов",
    "привлечение новых клиентов", "выполнение плана продаж", "продажа услуг",
    "прямые продажи", "активный поиск клиентов", "работа с возражениями",
)

PRIORITY_EMPLOYERS = (
    "агентство стратегических инициатив", "росконгресс", "россотрудничество",
    "росатом", "российский экспортный центр", "торгово-промышленная палата",
    "минэкономразвития", "минпромторг", "дом.рф", "ростех", "ржд", "вэб.рф",
    "вэб рф", "сколково", "московский экспортный центр", "правительство москвы",
    "департамент внешнеэкономических",
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


@dataclass(frozen=True)
class SearchSpec:
    query: str
    title_only: bool

    @property
    def label(self) -> str:
        return "title" if self.title_only else "full-text"


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


def fetch_feed(spec: SearchSpec) -> list[Vacancy]:
    params: dict[str, str] = {
        "text": spec.query,
        "area": "1",
        "period": str(PERIOD_DAYS),
        "work_format": "ON_SITE",
    }
    if spec.title_only:
        params["search_field"] = "name"

    request = Request(
        f"{RSS_URL}?{urlencode(params)}",
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
        result.append(
            Vacancy(
                vid,
                title,
                field(desc_html, "Вакансия компании"),
                link,
                field(desc_html, "Предполагаемый уровень месячного дохода"),
                field(desc_html, "Регион") or "Москва",
                clean(desc_html),
                clean(item.findtext("pubDate") or ""),
            )
        )
    return result


def salary_numbers(text: str) -> list[int]:
    normalized = (text or "").replace("\u00a0", " ").replace("\u202f", " ")
    values: list[int] = []
    for raw in re.findall(r"\d[\d ]*", normalized):
        compact = raw.replace(" ", "")
        if compact.isdigit():
            values.append(int(compact))
    return [value for value in values if value >= 1000]


def salary_ok(vacancy: Vacancy) -> bool:
    text = vacancy.salary.lower().strip()
    if not text or "не указан" in text:
        return True
    if any(cur in text for cur in ("usd", "$", "eur", "€", "kzt", "byn")):
        return True
    values = salary_numbers(text)
    return not values or max(values) >= 40_000


def profile_hits(vacancy: Vacancy) -> int:
    text = f"{vacancy.title} {vacancy.description}".lower()
    return sum(1 for marker in PROFILE if marker in text)


def relevance_gate(vacancy: Vacancy) -> bool:
    title = vacancy.title.lower()
    text = f"{vacancy.title} {vacancy.description}".lower()
    hits = profile_hits(vacancy)
    international = any(marker in text for marker in INTERNATIONAL_MARKERS)
    priority = any(marker in vacancy.company.lower() for marker in PRIORITY_EMPLOYERS)

    if any(marker in title for marker in STRONG_TITLE_MARKERS):
        return True
    if any(marker in title for marker in ADJACENT_TITLE_MARKERS):
        return international and hits >= 3
    if priority and international and hits >= 3:
        return True
    return international and hits >= 5


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

    matched = sum(1 for marker in PROFILE if marker in text)
    if matched:
        points = min(26, matched * 2)
        value += points
        reasons.append(f"совпадение с профилем +{points}")
    if matched >= 7:
        value += 12
        reasons.append("очень глубокое совпадение обязанностей +12")
    elif matched >= 5:
        value += 9
        reasons.append("глубокое совпадение обязанностей +9")
    elif matched >= 3:
        value += 5
        reasons.append("сильное совпадение обязанностей +5")

    if any(marker in title for marker in ADJACENT_TITLE_MARKERS) and any(
        marker in text for marker in INTERNATIONAL_MARKERS
    ):
        value += 6
        reasons.append("смежная роль с международным содержанием +6")

    bad_hits = sum(1 for marker in NEGATIVE if marker in text)
    if bad_hits:
        penalty = min(50, 22 + (bad_hits - 1) * 7)
        value -= penalty
        reasons.append(f"непрофильные продажи −{penalty}")

    company = vacancy.company.lower()
    if company and any(marker in company for marker in PRIORITY_EMPLOYERS):
        value += 15
        reasons.append("приоритетный работодатель +15")

    values = salary_numbers(vacancy.salary)
    salary_lower = vacancy.salary.lower()
    if not vacancy.salary or "не указан" in salary_lower:
        value += 3
        reasons.append("зарплата не указана")
    elif values and not any(cur in salary_lower for cur in ("usd", "$", "eur", "€", "kzt", "byn")):
        reference = max(values)
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
        return parsedate_to_datetime(vacancy.published).timestamp()
    except (TypeError, ValueError, OverflowError):
        return 0.0


def published_text(vacancy: Vacancy) -> str:
    try:
        dt = parsedate_to_datetime(vacancy.published)
        return dt.astimezone(timezone(timedelta(hours=3))).strftime("%d.%m.%Y %H:%M")
    except (TypeError, ValueError, OverflowError):
        return vacancy.published


def collect() -> tuple[list[Match], list[str]]:
    searches = [SearchSpec(query, True) for query in TITLE_SEARCHES]
    searches.extend(SearchSpec(query, False) for query in FULL_TEXT_SEARCHES)
    unique: dict[str, Vacancy] = {}
    errors: list[str] = []

    for index, spec in enumerate(searches):
        if index:
            time.sleep(0.8)
        try:
            items = fetch_feed(spec)
            print(f"HH RSS OK [{spec.label}]: {spec.query!r}, items={len(items)}")
        except HHFeedError as exc:
            print(f"HH RSS FAIL [{spec.label}]: {spec.query!r}, {exc}", file=sys.stderr)
            errors.append(str(exc))
            continue
        for item in items:
            unique[item.vacancy_id] = item

    if not unique and errors:
        raise HHFeedError("all RSS queries failed: " + " | ".join(errors[:4]))

    matches: list[Match] = []
    rejected_relevance = rejected_salary = below_score = 0
    for vacancy in unique.values():
        if "москва" not in vacancy.location.lower():
            continue
        if not salary_ok(vacancy):
            rejected_salary += 1
            continue
        if not relevance_gate(vacancy):
            rejected_relevance += 1
            continue
        points, reasons = score(vacancy)
        if points >= MIN_SCORE:
            matches.append(Match(vacancy, points, reasons))
        else:
            below_score += 1

    matches.sort(key=lambda item: (item.score, published_ts(item.vacancy)), reverse=True)
    print(json.dumps({
        "rss_unique": len(unique),
        "rejected_relevance": rejected_relevance,
        "rejected_salary": rejected_salary,
        "below_score": below_score,
        "matches_after_score": len(matches),
    }, ensure_ascii=False))
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
    why = "; ".join(match.reasons[:6])
    desc = re.sub(
        r"^(Вакансия компании|Регион|Предполагаемый уровень месячного дохода).*",
        "",
        vacancy.description,
        flags=re.I,
    )
    parts = [
        "<b>💼 ВАКАНСИЯ</b>",
        f"<b>🎯 {match.score}/100 — {html.escape(vacancy.title)}</b>",
        f"🏢 {html.escape(vacancy.company or 'работодатель на HH')}",
        f"💰 {html.escape(vacancy.salary if vacancy.salary and 'не указан' not in vacancy.salary.lower() else 'не указана')}",
        f"📍 {html.escape(vacancy.location or 'Москва')} • офис",
    ]
    if published_text(vacancy):
        parts.append(f"🗓 {html.escape(published_text(vacancy))}")
    if desc.strip():
        parts.append(f"<b>Кратко:</b> {html.escape(desc.strip()[:700])}")
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
                    "<b>⚠️ HH Vacancy Monitor</b>\n"
                    "RSS-выдача HH временно недоступна. Следующий GitHub-запуск повторит попытку автоматически."
                )
                state["alerts"]["hh_rss_unavailable"] = now().isoformat()
            except Exception as send_exc:
                print(f"Service alert failed: {type(send_exc).__name__}", file=sys.stderr)
        save_state(state)
        print(f"HH RSS monitor warning: {exc}")
        return 0

    sent = state.setdefault("sent", {})
    new_matches = [match for match in matches if match.vacancy.vacancy_id not in sent]
    sent_count = 0
    for match in new_matches[:MAX_PER_RUN]:
        try:
            telegram_send(card(match), match.vacancy.url)
            sent[match.vacancy.vacancy_id] = now().isoformat()
            sent_count += 1
        except Exception as exc:
            print(
                f"Telegram send FAIL for {match.vacancy.vacancy_id}: {type(exc).__name__}",
                file=sys.stderr,
            )
        time.sleep(0.5)

    save_state(state)
    print(json.dumps({
        "source": "hh_rss_adjacent_roles",
        "matches": len(matches),
        "new": len(new_matches),
        "sent": sent_count,
        "query_errors": len(query_errors),
        "min_score": MIN_SCORE,
        "period_days": PERIOD_DAYS,
        "title_searches": len(TITLE_SEARCHES),
        "full_text_searches": len(FULL_TEXT_SEARCHES),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
