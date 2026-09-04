from __future__ import annotations

import html
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

HH_API = "https://api.hh.ru/vacancies"
TG_API = "https://api.telegram.org"
STATE = Path(os.getenv("STATE_PATH", "hh-vacancy-agent/data/state.json"))
UA = os.getenv("HH_USER_AGENT", "HH-Vacancy-Monitor/1.1 github.com/zubakineb-spec/HomeCinema-Tizen")
MIN_SCORE = int(os.getenv("MIN_SCORE", "70"))
MAX_PER_RUN = int(os.getenv("MAX_PER_RUN", "10"))
PERIOD_DAYS = int(os.getenv("HH_PERIOD_DAYS", "1"))

# Deliberately simple queries: fewer requests and no dependence on advanced query syntax.
QUERIES = (
    "международные",
    "внешние связи",
    "project coordinator",
)

PROFILE = (
    "международ", "внешн", "international", "external relations",
    "зарубежн", "партнер", "партнёр", "проект", "project",
    "аналит", "английск", "english", "экспорт", "вэд",
    "внешнеэконом", "делегац", "протокол", "координатор",
)
NEGATIVE = (
    "холодные звонки", "активные продажи", "продажи физическим лицам",
    "b2c", "call-центр", "колл-центр", "торговый представитель",
    "риелтор", "кассир",
)
REMOTE = ("remote", "удален", "удалён", "дистанц")
HYBRID = ("hybrid", "гибрид")
ONSITE = ("on_site", "on-site", "на месте работодателя", "в офисе", "офисный формат")
PRIORITY_EMPLOYERS = (
    "агентство стратегических инициатив", "росконгресс", "россотрудничество",
    "росатом", "российский экспортный центр", "торгово-промышленная палата",
    "минэкономразвития", "минпромторг", "дом.рф", "ростех", "ржд",
)


@dataclass(frozen=True)
class Match:
    item: dict[str, Any]
    score: int
    reasons: tuple[str, ...]


class HHError(RuntimeError):
    def __init__(self, message: str, *, captcha: bool = False) -> None:
        super().__init__(message)
        self.captcha = captcha


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
    for key, value in list(state.setdefault("sent", {}).items()):
        try:
            dt = datetime.fromisoformat(str(value))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < cutoff:
                del state["sent"][key]
        except ValueError:
            del state["sent"][key]
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def hh_get(query: str) -> list[dict[str, Any]]:
    params = {
        "text": query,
        "area": "1",
        "period": str(PERIOD_DAYS),
        "per_page": "100",
        "page": "0",
    }
    url = f"{HH_API}?{urlencode(params)}"
    req = Request(
        url,
        headers={
            "User-Agent": UA,
            "HH-User-Agent": UA,
            "Accept": "application/json",
            "Accept-Language": "ru-RU,ru;q=0.9",
        },
    )
    try:
        with urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        details: list[str] = []
        captcha = False
        try:
            error_payload = json.loads(body)
            for entry in error_payload.get("errors") or []:
                if not isinstance(entry, dict):
                    continue
                error_type = str(entry.get("type") or "")
                error_value = str(entry.get("value") or "")
                details.append(f"{error_type}:{error_value}".strip(":"))
                if error_type == "captcha_required" or error_value == "captcha_required":
                    captcha = True
        except json.JSONDecodeError:
            details.append("non-json-error")
        label = ",".join(details[:4]) or "no-error-details"
        raise HHError(f"HTTP {exc.code} [{label}]", captcha=captcha) from exc
    except URLError as exc:
        raise HHError(f"network [{type(exc.reason).__name__}]") from exc

    items = payload.get("items") or []
    if not isinstance(items, list):
        raise HHError("invalid items payload")
    return [item for item in items if isinstance(item, dict)]


def clean(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = text.replace("<highlighttext>", "").replace("</highlighttext>", "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def text_of(item: dict[str, Any]) -> str:
    snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else {}
    schedule = item.get("schedule") if isinstance(item.get("schedule"), dict) else {}
    formats = item.get("work_format") or []
    if isinstance(formats, dict):
        formats = [formats]
    format_text = " ".join(
        f"{x.get('id', '')} {x.get('name', '')}" if isinstance(x, dict) else str(x)
        for x in formats
    ) if isinstance(formats, list) else ""
    return " ".join(
        [
            str(item.get("name") or ""),
            clean(snippet.get("requirement")),
            clean(snippet.get("responsibility")),
            str(schedule.get("id") or ""), str(schedule.get("name") or ""),
            format_text,
        ]
    ).lower()


def moscow(item: dict[str, Any]) -> bool:
    area = item.get("area") if isinstance(item.get("area"), dict) else {}
    return "москва" in str(area.get("name") or "").lower()


def office(item: dict[str, Any]) -> bool:
    text = text_of(item)
    if any(x in text for x in REMOTE) or any(x in text for x in HYBRID):
        return False
    if any(x in text for x in ONSITE):
        return True
    address = item.get("address")
    return isinstance(address, dict) and any(address.get(k) for k in ("raw", "street", "building", "lat", "lng"))


def salary_parts(item: dict[str, Any]) -> tuple[int | None, int | None, str | None, bool | None]:
    salary = item.get("salary") if isinstance(item.get("salary"), dict) else {}
    lower = salary.get("from") if isinstance(salary.get("from"), int) else None
    upper = salary.get("to") if isinstance(salary.get("to"), int) else None
    return lower, upper, salary.get("currency"), salary.get("gross")


def salary_ok(item: dict[str, Any]) -> bool:
    lower, upper, currency, _ = salary_parts(item)
    if lower is None and upper is None:
        return True
    if currency and currency != "RUR":
        return True
    ceiling = upper if upper is not None else lower
    return ceiling is None or ceiling >= 40_000


def salary_text(item: dict[str, Any]) -> str:
    lower, upper, currency, gross = salary_parts(item)
    if lower is None and upper is None:
        return "не указана"
    cur = "₽" if currency == "RUR" else str(currency or "")
    suffix = " до вычета налогов" if gross is True else ""
    if lower is not None and upper is not None:
        s = f"{lower:,}–{upper:,} {cur}"
    elif lower is not None:
        s = f"от {lower:,} {cur}"
    else:
        s = f"до {upper:,} {cur}"
    return s.replace(",", " ") + suffix


def score(item: dict[str, Any]) -> tuple[int, tuple[str, ...]]:
    value = 20
    reasons: list[str] = []
    title = str(item.get("name") or "").lower()
    text = text_of(item)

    title_hits = sum(1 for x in PROFILE if x in title)
    if title_hits:
        pts = min(32, 8 + title_hits * 6)
        value += pts
        reasons.append(f"профильная должность +{pts}")

    hits = sum(1 for x in PROFILE if x in text)
    if hits:
        pts = min(22, hits * 2)
        value += pts
        reasons.append(f"совпадение с профилем +{pts}")

    bad = sum(1 for x in NEGATIVE if x in text)
    if bad:
        pts = min(35, 20 + (bad - 1) * 5)
        value -= pts
        reasons.append(f"непрофильные продажи −{pts}")

    employer = item.get("employer") if isinstance(item.get("employer"), dict) else {}
    employer_name = str(employer.get("name") or "").lower()
    if any(x in employer_name for x in PRIORITY_EMPLOYERS):
        value += 15
        reasons.append("приоритетный работодатель +15")

    lower, upper, currency, _ = salary_parts(item)
    nums = [x for x in (lower, upper) if x is not None]
    ref = max(nums) if nums else None
    if ref is None:
        value += 3
        reasons.append("зарплата не указана")
    elif not currency or currency == "RUR":
        if ref >= 130_000:
            value += 15
            reasons.append("зарплата 130 тыс.+ +15")
        elif ref >= 100_000:
            value += 12
            reasons.append("зарплата 100 тыс.+ +12")
        else:
            value += 4
            reasons.append("зарплата выше минимума +4")

    value += 8
    reasons.append("Москва +8")
    value += 8
    reasons.append("офис +8")
    return max(0, min(100, value)), tuple(reasons)


def published(item: dict[str, Any]) -> float:
    try:
        return datetime.fromisoformat(str(item.get("published_at") or "")).timestamp()
    except ValueError:
        return 0.0


def collect() -> tuple[list[Match], list[str]]:
    unique: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    captcha = False
    for query in QUERIES:
        try:
            items = hh_get(query)
            print(f"HH query OK: {query!r}, items={len(items)}")
        except HHError as exc:
            print(f"HH query FAIL: {query!r}, {exc}", file=sys.stderr)
            errors.append(str(exc))
            captcha = captcha or exc.captcha
            continue
        for item in items:
            vid = str(item.get("id") or "")
            if vid:
                unique[vid] = item
        time.sleep(0.35)

    if not unique and errors:
        raise HHError("all queries failed: " + " | ".join(errors[:3]), captcha=captcha)

    matches: list[Match] = []
    for item in unique.values():
        if not moscow(item) or not office(item) or not salary_ok(item):
            continue
        points, reasons = score(item)
        if points >= MIN_SCORE:
            matches.append(Match(item, points, reasons))
    matches.sort(key=lambda m: (m.score, published(m.item)), reverse=True)
    return matches, errors


def tg_send(text: str, url: str | None = None) -> None:
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
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть вакансию на HH", "url": url}]]}
    req = Request(
        f"{TG_API}/bot{token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urlopen(req, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError("Telegram sendMessage failed")


def card(match: Match) -> str:
    item = match.item
    employer = item.get("employer") if isinstance(item.get("employer"), dict) else {}
    area = item.get("area") if isinstance(item.get("area"), dict) else {}
    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else {}
    requirement = clean(snippet.get("requirement"))
    responsibility = clean(snippet.get("responsibility"))
    place = str(address.get("raw") or area.get("name") or "Москва")
    why = "; ".join(match.reasons[:5])
    parts = [
        "<b>💼 ВАКАНСИЯ</b>",
        f"<b>🎯 {match.score}/100 — {html.escape(str(item.get('name') or ''))}</b>",
        f"🏢 {html.escape(str(employer.get('name') or ''))}",
        f"💰 {html.escape(salary_text(item))}",
        f"📍 {html.escape(place)}",
    ]
    if requirement:
        parts.append(f"<b>Требования:</b> {html.escape(requirement[:450])}")
    if responsibility:
        parts.append(f"<b>Задачи:</b> {html.escape(responsibility[:450])}")
    parts.append(f"<b>Почему подходит:</b> {html.escape(why)}")
    parts.append(f"ID HH: <code>{html.escape(str(item.get('id') or ''))}</code>")
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
    except HHError as exc:
        key = "hh_captcha" if exc.captcha else "hh_unavailable"
        if alert_due(state, key):
            notice = (
                "<b>⚠️ HH Vacancy Monitor</b>\n"
                + ("HeadHunter запросил CAPTCHA. Обход не выполняется; монитор попробует позже."
                   if exc.captcha else
                   "HeadHunter временно не отдал поисковую выдачу. Следующий GitHub-запуск повторит попытку автоматически.")
            )
            try:
                tg_send(notice)
                state["alerts"][key] = now().isoformat()
            except Exception as send_exc:
                print(f"Service alert failed: {type(send_exc).__name__}", file=sys.stderr)
        save_state(state)
        print(f"HH monitor warning: {exc}")
        return 0

    sent = state.setdefault("sent", {})
    new_matches = [m for m in matches if str(m.item.get("id") or "") not in sent]
    sent_count = 0
    for match in new_matches[:MAX_PER_RUN]:
        vid = str(match.item.get("id") or "")
        try:
            tg_send(card(match), str(match.item.get("alternate_url") or "") or None)
            sent[vid] = now().isoformat()
            sent_count += 1
        except Exception as exc:
            print(f"Telegram send FAIL for {vid}: {type(exc).__name__}", file=sys.stderr)
        time.sleep(0.4)

    save_state(state)
    print(json.dumps({
        "matches": len(matches), "new": len(new_matches), "sent": sent_count,
        "query_errors": len(query_errors), "min_score": MIN_SCORE,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
