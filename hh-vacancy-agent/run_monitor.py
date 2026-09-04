from __future__ import annotations

import json
import os
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import monitor_rss as monitor

TG_API = "https://api.telegram.org"
UA = os.getenv("HH_USER_AGENT", "HH-Vacancy-Monitor/1.3 (+https://github.com/zubakineb-spec/HomeCinema-Tizen)")


def token() -> str:
    value = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not value:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is missing")
    return value


def telegram_request(method: str, payload: dict[str, Any] | None = None, query: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{TG_API}/bot{token()}/{method}"
    if query:
        url = f"{url}?{urlencode(query)}"
    data = None
    headers = {"User-Agent": UA}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    with urlopen(request, timeout=30) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError(f"Telegram {method} failed")
    return result


def direct_send(chat_id: str, text: str, url: str | None = None) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if url:
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": "Открыть вакансию на HH", "url": url}]]
        }
    telegram_request("sendMessage", payload=payload)


def bootstrap_owner(state: dict[str, Any]) -> None:
    owner_chat = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    subscribers = state.setdefault("telegram_subscribers", {})
    if owner_chat and owner_chat not in subscribers:
        subscribers[owner_chat] = {
            "source": "bootstrap_secret",
            "started_at": monitor.now().isoformat(),
        }


def command_name(text: str) -> str:
    if not text.startswith("/"):
        return ""
    first = text.split(maxsplit=1)[0]
    return first.split("@", 1)[0].lower()


def sync_subscribers(state: dict[str, Any]) -> tuple[int, int]:
    bootstrap_owner(state)
    subscribers = state.setdefault("telegram_subscribers", {})
    offset = int(state.get("telegram_update_offset") or 0)

    try:
        result = telegram_request(
            "getUpdates",
            query={
                "offset": offset,
                "timeout": 0,
                "allowed_updates": json.dumps(["message"]),
            },
        )
    except (HTTPError, URLError, RuntimeError) as exc:
        print(f"Telegram getUpdates warning: {type(exc).__name__}", file=sys.stderr)
        return len(subscribers), 0

    processed = 0
    next_offset = offset
    for update in result.get("result", []):
        try:
            update_id = int(update.get("update_id"))
        except (TypeError, ValueError):
            continue
        next_offset = max(next_offset, update_id + 1)

        message = update.get("message") or {}
        chat = message.get("chat") or {}
        if chat.get("type") != "private":
            continue
        chat_id = str(chat.get("id") or "").strip()
        text = str(message.get("text") or "").strip()
        if not chat_id or not text:
            continue

        cmd = command_name(text)
        if cmd == "/start":
            already = chat_id in subscribers
            user = message.get("from") or {}
            subscribers[chat_id] = {
                "source": "telegram_start",
                "first_name": str(user.get("first_name") or ""),
                "username": str(user.get("username") or ""),
                "started_at": subscribers.get(chat_id, {}).get("started_at") or monitor.now().isoformat(),
                "last_start_at": monitor.now().isoformat(),
            }
            try:
                direct_send(
                    chat_id,
                    "<b>✅ Подписка на вакансии включена</b>\n"
                    "Буду присылать новые подходящие вакансии по мере их появления.\n\n"
                    "Команды: /status — проверить подписку, /stop — отключить уведомления."
                    if not already
                    else "<b>✅ Подписка уже активна</b>\nНовые подходящие вакансии будут приходить сюда.",
                )
            except Exception as exc:
                print(f"Telegram /start reply warning for {chat_id}: {type(exc).__name__}", file=sys.stderr)
            processed += 1

        elif cmd == "/stop":
            was_subscribed = chat_id in subscribers
            subscribers.pop(chat_id, None)
            try:
                direct_send(
                    chat_id,
                    "<b>🔕 Подписка отключена</b>\nЧтобы включить снова, отправьте /start."
                    if was_subscribed
                    else "Подписка уже была отключена. Чтобы включить её, отправьте /start.",
                )
            except Exception as exc:
                print(f"Telegram /stop reply warning for {chat_id}: {type(exc).__name__}", file=sys.stderr)
            processed += 1

        elif cmd == "/status":
            active = chat_id in subscribers
            try:
                direct_send(
                    chat_id,
                    "<b>✅ Подписка активна</b>" if active else "<b>🔕 Подписка не активна</b>\nОтправьте /start, чтобы получать вакансии.",
                )
            except Exception as exc:
                print(f"Telegram /status reply warning for {chat_id}: {type(exc).__name__}", file=sys.stderr)
            processed += 1

    state["telegram_update_offset"] = next_offset
    return len(subscribers), processed


def main() -> int:
    state = monitor.load_state()
    subscriber_count, processed = sync_subscribers(state)
    monitor.save_state(state)

    blocked: set[str] = set()

    def broadcast_send(text: str, url: str | None = None) -> None:
        recipients = list(state.setdefault("telegram_subscribers", {}).keys())
        if not recipients:
            raise RuntimeError("No Telegram subscribers")

        delivered = 0
        for chat_id in recipients:
            try:
                direct_send(chat_id, text, url)
                delivered += 1
            except HTTPError as exc:
                if exc.code in (400, 403):
                    blocked.add(chat_id)
                print(f"Telegram send warning for {chat_id}: HTTP {exc.code}", file=sys.stderr)
            except Exception as exc:
                print(f"Telegram send warning for {chat_id}: {type(exc).__name__}", file=sys.stderr)

        if delivered == 0:
            raise RuntimeError("Telegram broadcast delivered to zero subscribers")

    monitor.telegram_send = broadcast_send
    result = monitor.main()

    if blocked:
        fresh_state = monitor.load_state()
        fresh_subscribers = fresh_state.setdefault("telegram_subscribers", {})
        for chat_id in blocked:
            fresh_subscribers.pop(chat_id, None)
        monitor.save_state(fresh_state)

    print(json.dumps({
        "telegram_subscribers": subscriber_count,
        "telegram_commands_processed": processed,
        "telegram_blocked_removed": len(blocked),
    }, ensure_ascii=False))
    return result


if __name__ == "__main__":
    raise SystemExit(main())
