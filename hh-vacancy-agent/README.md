# HH Vacancy Agent

GitHub-hosted vacancy monitor that publishes matching HeadHunter vacancies to the same Telegram destination used by the cinema digest.

## Purpose

This is the pre-OAuth deployment shim for the private `HH-Resume-Bot` project while the HeadHunter developer application is still awaiting approval.

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

- geography: Moscow (`area=1`);
- format: employer location / office only (`work_format=ON_SITE`);
- salary below 40,000 RUB is excluded when the advertised monthly salary can be compared;
- salary not specified is allowed;
- 100,000 RUB+ receives ranking priority;
- formal experience requirement is intentionally ignored;
- priority profile: international cooperation, external relations, international projects, project coordination, analytics, partner work, English, export / foreign-economic activity;
- obvious cold-sales/call-center mismatches receive a strong score penalty.

Default Telegram threshold: `70/100`.

Default per-run cap: `10` new vacancy cards.

## Search transport

The production monitor uses HeadHunter's public vacancy-search RSS feed:

`https://hh.ru/search/vacancy/rss`

The unauthenticated JSON API `api.hh.ru/vacancies` was tested from a GitHub-hosted runner and returned HTTP 403 `forbidden`, so it is not used for this deployment. No bypass is attempted.

RSS queries are narrow and explicitly include Moscow and `ON_SITE`, so remote/hybrid roles are not intentionally admitted by the source query.

The current production entry point is:

`hh-vacancy-agent/monitor_rss.py`

## Search directions

The monitor combines several focused RSS feeds and deduplicates by HH vacancy id, including:

- international cooperation;
- international relations;
- external relations;
- international projects;
- foreign partners;
- project coordinator;
- external relations (English);
- foreign-economic activity.

RSS returns the newest items for each query, so focused searches provide better coverage than one broad expression.

## Deduplication

Runtime state is written to:

`hh-vacancy-agent/data/state.json`

The GitHub workflow persists this state between ephemeral runners through `actions/cache`, so a recorded HH vacancy id is not posted repeatedly. Sent ids older than 45 days are pruned.

## Telegram card

Vacancy messages are visually separated from the cinema feed with:

`💼 ВАКАНСИЯ`

Each card includes relevance score, title, employer, salary, Moscow/office indication, matching reasons, HH vacancy id and a button opening the vacancy on hh.ru.

## Schedule

See `.github/workflows/hh-vacancy-monitor.yml`.

The workflow runs twice per hour (`8,38 * * * *`) and can also be launched manually with `workflow_dispatch`.

## Acceptance

Control GitHub Actions run `33865395187`:

- workflow: SUCCESS;
- all 8 RSS queries: PASS;
- query errors: 0;
- matches above threshold: 27;
- first-run Telegram cards sent: 10;
- state cache: PASS.
