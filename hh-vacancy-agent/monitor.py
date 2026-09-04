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
TELEGRAM_API = "https://api.telegram.org"
STATE_PATH = Path(os.getenv("STATE_PATH", "hh-vacancy-agent/data/state.json"))
USER_AGENT = os.getenv(
    "HH_USER_AGENT",
    "HH-Vacancy-Monitor/1.0 (https://github.com/zubakineb-spec/HomeCinema-Tizen)",
)
MIN_SCORE = int(os.getenv("MIN_SCORE", "70"))
MAX_PER_RUN = int(os.getenv("MAX_PER_RUN", "10"))
PERIOD_DAYS = int(os.getenv("HH_PERIOD_DAYS", "1"))

QUERY_GROUPS = [
    '("международное сотрудничество" OR "международные связи" OR "внешние связи" OR "external relations" OR "international cooperation")',
    '("международные проекты" OR "зарубежные партнеры" OR "зарубежные партнёры" OR "international projects" OR "project coordinator" OR "внешнеэкономическая деятельность" OR "ВЭД")',
]

PRIORITY_TITLE_MARKERS = (
    "международ",
    "внешн",
    "international",
    "external relations",
    "координатор",
    "проект",
    "аналитик",
    "вэд",
    "экспорт",
)

PROFILE_MARKERS = (
    "международное сотрудничество",
    "международные проекты",
    "международные отношения",
    "международные экономические отношения",
    "внешние связи",
    "внешние коммуникации",
    "external relations",
    "international cooperation",
    "international projects",
    "зарубежные партнеры",
    "зарубежные партнёры",
    "работа с партнерами",
    "работа с партнёрами",
    "проектная координация",
    "координатор проектов",
    "проектный офис",
    "аналитические материалы",
    "аналитическая работа",
    "исследование рынков",
    "деловая переписка",
    "официальная переписка",
    "английский язык",
    "english",
    "международные соглашения",
    "делегации",
    "протокол",
    "экспорт",
    "внешнеэкономическая деятельность",
    "вэд",
    "международное технологическое сотрудничество",
    "excel",
)

NEGATIVE_MARKERS = (
    "холодные звонки",
    "активные продажи",
    "продажи физическим лицам",
    "b2c продажи",
    "оператор call-центра",
    "оператор колл-центра",
    "торговый представитель",
    "менеджер по продажам услуг",
    "риелтор",
    "кассир",
)

REMOTE_MARKERS = (
    "remote",
    "удален",
    "удалён",
    "дистанц",
)

HYBRID_MARKERS = (
    "hybrid",
    "гибрид",
)

ONSITE_MARKERS = (
    "on_site",
    "on-site",
    "на месте работодателя",
    "в офисе",
    "работа в офисе",
    "офисный формат",
)

PRIORITY_EMPLOYERS = (
    "агентство стратегических инициатив",
    "фонд росконгресс",
    "россотрудничество",
    "росатом",
    "российский экспортный центр",
    "торгово-промышленная палата",
    "минэкономразвития",
    "минпромторг",
    "дом.рф",
    "ростех",
    "ржд",
)


@dataclass(frozen=True)
class Match:
    vacancy: dict[str, Any]
    score: int
    reasons: list[str]


class HHRequestError(RuntimeError):
    def __init__(self, message: str, *, captcha_required: bool = False) -> None:
        super().__init__(message)
        self.captcha_required = captcha_required


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"sent": {}, "alerts": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"sent": {}, "alerts": {}}
    if not isinstance(data, dict):
        return {"sent": {}, "alerts": {}}
    data.setdefault("sent", {})
    data.setdefault("alerts", {})
    return data


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    cutoff = _now() - timedelta(days=45)
    sent = state.setdefault("sent", {})
    for vacancy_id, timestamp in list(sent.items()):
        try:
            dt = datetime.fromisoformat(str(timestamp))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except ValueError:
            del sent[vacancy_id]
            continue
        if dt < cutoff:
            del sent[vacancy_id]
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _http_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> Any:
    request_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    request = Request(url, data=data, headers=request_headers, method="POST" if data is not None else "GET")
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        captcha = False
        try:
            payload = json.loads(body)
            errors = payload.get("errors") or []
            captcha = any(
                str(item.get("type", "")) == "captcha_required"
                or str(item.get("value", "")) == "captcha_required"
                for item in errors
                if isinstance(item, dict)
            )
        except json.JSONDecodeError:
            payload = None
        raise HHRequestError(
            f"HTTP {exc.code} from {url.split('?')[0]}",
            captcha_required=captcha,
        ) from exc
    except URLError as exc:
        raise HHRequestError(f"Network error: {exc.reason}") from exc


def _search(query: str) -> list[dict[str, Any]]:
    params = {
        "text": query,
        "area": "1",
        "period": str(PERIOD_DAYS),
        "per_page": "100",
        "page": "0",
        "order_by": "publication_time",
        "enable_snippets": "true",
    }
    payload = _http_json(f"{HH_API}?{urlencode(params)}")
    return [item for item in (payload.get("items") or []) if isinstance(item, dict)]


def _salary(vacancy: dict[str, Any]) -> tuple[int | None, int | None, str | None, bool | None]:
    salary = vacancy.get("salary") or {}
    if not isinstance(salary, dict):
        return None, None, None, None
    lower = salary.get("from") if isinstance(salary.get("from"), int) else None
    upper = salary.get("to") if isinstance(salary.get("to"), int) else None
    return lower, upper, salary.get("currency"), salary.get("gross")


def _salary_text(vacancy: dict[str, Any]) -> str:
    lower, upper, currency, gross = _salary(vacancy)
    if lower is None and upper is None:
        return "не указана"
    suffix = " до вычета налогов" if gross is True else ""
    cur = "₽" if currency == "RUR" else str(currency or "")
    if lower is not None and upper is not None:
        value = f"{lower:,}–{upper:,} {cur}".replace(",", " ")
    elif lower is not None:
        value = f"от {lower:,} {cur}".replace(",", " ")
    else:
        value = f"до {upper:,} {cur}".replace(",", " ")
    return value + suffix


def _plain(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = text.replace("<highlighttext>", "").replace("</highlighttext>", "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _combined_text(vacancy: dict[str, Any]) -> str:
    snippet = vacancy.get("snippet") or {}
    if not isinstance(snippet, dict):
        snippet = {}
    work_format = vacancy.get("work_format") or []
    if isinstance(work_format, dict):
        work_format = [work_format]
    work_bits: list[str] = []
    if isinstance(work_format, list):
        for item in work_format:
            if isinstance(item, dict):
                work_bits.extend([str(item.get("id", "")), str(item.get("name", ""))])
            else:
                work_bits.append(str(item))
    schedule = vacancy.get("schedule") or {}
    if isinstance(schedule, dict):
        work_bits.extend([str(schedule.get("id", "")), str(schedule.get("name", ""))])
    return " ".join(
        [
            str(vacancy.get("name", "")),
            _plain(snippet.get("requirement")),
            _plain(snippet.get("responsibility")),
            *work_bits,
        ]
    ).lower()


def _is_moscow(vacancy: dict[str, Any]) -> bool:
    area = vacancy.get("area") or {}
    name = str(area.get("name", "")).lower() if isinstance(area, dict) else ""
    return name in {"москва", "moscow"} or "москва" in name or "moscow" in name


def _is_office(vacancy: dict[str, Any]) -> bool:
    text = _combined_text(vacancy)
    if any(marker in text for marker in REMOTE_MARKERS):
        return False
    if any(marker in text for marker in HYBRID_MARKERS):
        return False
    if any(marker in text for marker in ONSITE_MARKERS):
        return True
    address = vacancy.get("address")
    if isinstance(address, dict) and any(address.get(key) for key in ("raw", "street", "building", "lat", "lng")):
        return True
    return False


def _passes_salary(vacancy: dict[str, Any]) -> bool:
    lower, upper, currency, _ = _salary(vacancy)
    if lower is None and upper is None:
        return True
    if currency and currency != "RUR":
        return True
    ceiling = upper if upper is not None else lower
    return ceiling is None or ceiling >= 40_000


def _score(vacancy: dict[str, Any]) -> tuple[int, list[str]]:
    score = 20
    reasons: list[str] = []
    title = str(vacancy.get("name", "")).lower()
    text = _combined_text(vacancy)

    title_hits = sum(1 for marker in PRIORITY_TITLE_MARKERS if marker in title)
    if title_hits:
        points = min(30, 8 + title_hits * 6)
        score += points
        reasons.append(f"профильная должность +{points}")

    profile_hits = [marker for marker in PROFILE_MARKERS if marker in text]
    if profile_hits:
        points = min(20, len(profile_hits) * 2)
        score += points
        reasons.append(f"совпадение с профилем +{points}")

    negative_hits = [marker for marker in NEGATIVE_MARKERS if marker in text]
    if negative_hits:
        penalty = min(35, 20 + 5 * (len(negative_hits) - 1))
        score -= penalty
        reasons.append(f"непрофильные продажи −{penalty}")

    employer = vacancy.get("employer") or {}
    employer_name = str(employer.get("name", "")).lower() if isinstance(employer, dict) else ""
    if employer_name and any(marker in employer_name for marker in PRIORITY_EMPLOYERS):
        score += 15
        reasons.append("приоритетный работодатель +15")

    lower, upper, currency, _ = _salary(vacancy)
    reference = max(value for value in (lower, upper) if value is not None) if any(
        value is not None for value in (lower, upper)
    ) else None
    if reference is None:
        score += 3
        reasons.append("зарплата не указана")
    elif not currency or currency == "RUR":
        if reference >= 130_000:
            score += 15
            reasons.append("зарплата 130 тыс.+ +15")
        elif reference >= 100_000:
            score += 12
            reasons.append("зарплата 100 тыс.+ +12")
        elif reference >= 40_000:
            score += 4
            reasons.append("зарплата выше минимума +4")

    if _is_moscow(vacancy):
        score += 8
        reasons.append("Москва +8")
    if _is_office(vacancy):
        score += 8
        reasons.append("офис +8")

    return max(0, min(100, score)), reasons


def _published_ts(vacancy: dict[str, Any]) -> float:
    raw = str(vacancy.get("published_at") or "")
    try:
        return datetime.fromisoformat(raw).timestamp()
    except ValueError:
        return 0.0


def _collect() -> list[Match]:
    dedup: dict[str, dict[str, Any]] = {}
    errors: list[HHRequestError] = []
    for query in QUERY_GROUPS:
        try:
            items = _search(query)
        except HHRequestError as exc:
            errors.append(exc)
            continue
        for vacancy in items:
            vacancy_id = str(vacancy.get("id") or "")
            if vacancy_id:
                dedup[vacancy_id] = vacancy
        time.sleep(0.4)

    if not dedup and errors:
        captcha = any(error.captcha_required for error in errors)
        raise HHRequestError("All HH search queries failed", captcha_required=captcha)

    matches: list[Match] = []
    for vacancy in dedup.values():
        if not _is_moscow(vacancy):
            continue
        if not _is_office(vacancy):
            continue
        if not _passes_salary(vacancy):
            continue
        score, reasons = _score(vacancy)
        if score >= MIN_SCORE:
            matches.append(Match(vacancy=vacancy, score=score, reasons=reasons))

    matches.sort(key=lambda item: (item.score, _published_ts(item.vacancy)), reverse=True)
    return matches


def _telegram_request(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is missing")
    url = f"{TELEGRAM_API}/bot{token}/{method}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
    if not body.get("ok"):
        raise RuntimeError(f"Telegram {method} failed")
    return body


def _send_message(text: str, vacancy_url: str | None = None) -> None:
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not chat_id:
        raise RuntimeError("TELEGRAM_CHAT_ID is missing")
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if vacancy_url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": "Открыть вакансию на HH", "url": vacancy_url}]]
        }
    _telegram_request("sendMessage", payload)


def _vacancy_message(match: Match) -> str:
    vacancy = match.vacancy
    employer = vacancy.get("employer") or {}
    area = vacancy.get("area") or {}
    address = vacancy.get("address") or {}
    snippet = vacancy.get("snippet") or {}
    employer_name = employer.get("name", "") if isinstance(employer, dict) else ""
    area_name = area.get("name", "Москва") if isinstance(area, dict) else "Москва"
    address_text = ""
    if isinstance(address, dict):
        address_text = str(address.get("raw") or "").strip()
    if not address_text:
        address_text = str(area_name or "Москва")
    requirement = _plain(snippet.get("requirement")) if isinstance(snippet, dict) else ""
    responsibility = _plain(snippet.get("responsibility")) if isinstance(snippet, dict) else ""
    why = "; ".join(match.reasons[:5])

    parts = [
        "<b>💼 ВАКАНСИЯ</b>",
        f"<b>🎯 {match.score}/100 — {html.escape(str(vacancy.get('name') or ''))}</b>",
        f"🏢 {html.escape(str(employer_name))}",
        f"💰 {html.escape(_salary_text(vacancy))}",
        f"📍 {html.escape(address_text)}",
    ]
    if requirement:
        parts.append(f"<b>Требования:</b> {html.escape(requirement[:500])}")
    if responsibility:
        parts.append(f"<b>Задачи:</b> {html.escape(responsibility[:500])}")
    if why:
        parts.append(f"<b>Почему подходит:</b> {html.escape(why)}")
    parts.append(f"ID HH: <code>{html.escape(str(vacancy.get('id') or ''))}</code>")
    return "\n".join(parts)


def _alert_due(state: dict[str, Any], key: str, hours: int = 12) -> bool:
    raw = str(state.setdefault("alerts", {}).get(key) or "")
    if not raw:
        return True
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return _now() - dt >= timedelta(hours=hours)


def _mark_alert(state: dict[str, Any], key: str) -> None:
    state.setdefault("alerts", {})[key] = _now().isoformat()


def main() -> int:
    state = _load_state()
    try:
        matches = _collect()
    except HHRequestError as exc:
        key = "hh_captcha" if exc.captcha_required else "hh_unavailable"
        if _alert_due(state, key):
            text = (
                "<b>⚠️ HH Vacancy Monitor</b>\n"
                + (
                    "HeadHunter запросил CAPTCHA/ручную проверку. Робот её не обходит; ждём OAuth-доступ."
                    if exc.captcha_required
                    else "Не удалось получить выдачу HeadHunter. Следующий GitHub-запуск попробует снова автоматически."
                )
            )
            try:
                _send_message(text)
                _mark_alert(state, key)
            except Exception as send_exc:
                print(f"Telegram service alert failed: {type(send_exc).__name__}", file=sys.stderr)
        _save_state(state)
        print(f"HH monitor warning: {exc}")
        return 0

    sent_map = state.setdefault("sent", {})
    new_matches = [match for match in matches if str(match.vacancy.get("id") or "") not in sent_map]
    selected = new_matches[:MAX_PER_RUN]

    sent_count = 0
    for match in selected:
        vacancy_id = str(match.vacancy.get("id") or "")
        url = str(match.vacancy.get("alternate_url") or "") or None
        try:
            _send_message(_vacancy_message(match), url)
        except Exception as exc:
            print(f"Telegram send failed for vacancy {vacancy_id}: {type(exc).__name__}", file=sys.stderr)
            continue
        sent_map[vacancy_id] = _now().isoformat()
        sent_count += 1
        time.sleep(0.5)

    _save_state(state)
    print(
        json.dumps(
            {
                "matches": len(matches),
                "new": len(new_matches),
                "sent": sent_count,
                "min_score": MIN_SCORE,
                "period_days": PERIOD_DAYS,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
