# HH Vacancy Agent

GitHub-hosted vacancy monitor that publishes matching HeadHunter vacancies to the same Telegram destination used by the cinema digest.

## Purpose

This is a deployment shim for the private `HH-Resume-Bot` project while the HeadHunter developer application is still awaiting approval.

The public deployment does **not** contain:

- the candidate's name;
- the candidate's full resume;
- Telegram Bot Token;
- Telegram chat/channel id;
- HeadHunter credentials or browser cookies.

Telegram delivery reuses the existing repository secrets already configured for the cinema workflow:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Matching policy

- geography: Moscow;
- format: office only;
- explicit remote and hybrid vacancies are excluded;
- an office/on-site marker or a concrete workplace address is required;
- salary below 40,000 RUB is excluded when a comparable advertised salary is available;
- salary not specified is allowed;
- 100,000 RUB+ receives ranking priority;
- formal experience requirement is intentionally ignored;
- priority profile: international cooperation, external relations, international projects, project coordination, analytics, partner work, export / foreign-economic activity;
- obvious cold-sales/call-center mismatches receive a strong score penalty.

Default Telegram threshold: `70/100`.

Default per-run cap: `10` new vacancy cards.

## Search transport

The monitor uses the official anonymous `GET https://api.hh.ru/vacancies` search endpoint with the required User-Agent header. No applicant-only API methods are called.

If HeadHunter returns `captcha_required`, the agent does not bypass it. It sends a throttled service notice to Telegram and waits for a later scheduled run / future OAuth integration.

## Deduplication

Runtime state is written to:

`hh-vacancy-agent/data/state.json`

The GitHub workflow persists this state between ephemeral runners through `actions/cache`, so the same HH vacancy id is not posted repeatedly. Sent ids older than 45 days are pruned.

## Telegram card

Vacancy messages are visually separated from the cinema feed with:

`💼 ВАКАНСИЯ`

Each card includes relevance score, title, employer, salary, Moscow/workplace, short requirements/tasks, matching reasons, HH vacancy id and a button opening the vacancy on hh.ru.

## Schedule

See `.github/workflows/hh-vacancy-monitor.yml`.

The monitor is intended to run every 30 minutes and can also be launched manually with `workflow_dispatch`.
