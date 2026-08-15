# Home Cinema for Samsung Tizen

Локальный домашний кинотеатр для Samsung Smart TV с NAS-first архитектурой. Целевая система — Samsung UE49NU7500U и QNAP D1 / ARMv7 / QTS 4.3.6.

## Статус релизов

**TV-validated baseline:** `0.3.18 RC3.6`.

- package: `HomeCinema-Tizen-v0.3.18-rc3.6.wgt`;
- source: `32a1f962264adebf1fb85bfeea4a0e0f5dffd19e`;
- физическая установка и запуск на Samsung UE49NU7500U подтверждены;
- Back с главного экрана завершает приложение;
- D-pad после выхода из плеера восстановлен и закрыт regression-gate.

**Next candidate:** `0.3.18 RC3.7 engineering`.

RC3.7 содержит крупный reliability/UX pass. Код проходит CI, но до отдельного TV-теста RC3.6 остаётся стабильным rollback. Сам engineering workflow не устанавливает RC3.7 на телевизор.

## Архитектура

```text
Samsung UE49NU7500U / Tizen 4
        |
        | LAN / HTTP
        v
QNAP D1 192.168.0.101:8096
  ├─ native ARMv7 Home Cinema backend
  ├─ catalog.json + backups
  ├─ progress.json + backups
  ├─ image-cache/                 TMDB artwork cache
  ├─ /media/                      Direct Play + HTTP Range
  ├─ /api/catalog
  ├─ /api/history /api/next
  ├─ /api/diagnostics /api/health
  └─ optional FFmpeg DTS fallback
```

Для QNAP D1 используется нативный Go runtime из `native-qnap-d1`: без Docker и системного Python. Python/FastAPI backend остаётся альтернативой для более мощных NAS.

## TV-клиент

Базовые возможности:

- фильмы, сериалы, сезоны, серии и дополнительные материалы;
- русские TMDB metadata, постеры, backdrop, stills, рейтинги и жанры;
- поиск и «Продолжить просмотр»;
- Samsung AVPlay Direct Play;
- выбор аудиодорожек и встроенных субтитров;
- автоматический выбор совместимой non-DTS дорожки;
- Smart Remote: D-pad, OK, Back, Play/Pause, Stop, Rewind/FastForward;
- AVPlay lifecycle: seek serialization, background suspend/restore, сохранение PAUSED;
- Tizen 4 / Chromium M56 compatibility gates.

RC3.7 дополнительно вводит:

- восстановление TV↔NAS после временного сетевого сбоя;
- локальный кеш каталога/details и offline search;
- очередь progress POST с доставкой после reconnect;
- локальную прокси-кеш выдачу TMDB artwork через NAS `/api/image`;
- Историю просмотра и просмотренные элементы;
- Избранное;
- сортировку по новым/названию/рейтингу/году и фильтр жанра;
- Continue / «С начала»;
- next episode + опциональный 7-секундный autoplay countdown;
- compatibility badges;
- сохранение аудио/субтитров для сериала;
- размер субтитров 36/44/52/60 px;
- timeline scrub 10→30→60 секунд при удержании Left/Right;
- экран диагностики и изменение NAS endpoint.

## QNAP D1 backend

### Сканирование

RC3.7 использует incremental scan. Для каждого источника сохраняются `file_size` и `file_mtime`. Неизменившийся файл повторно не прогоняется через ffprobe; новый или изменённый получает новый media profile. Исчезнувшие источники исключаются при ReplaceScan.

Media profile хранит:

- container;
- video codec;
- width/height;
- HDR flag;
- audio codecs;
- subtitle codecs;
- compatibility: `direct`, `direct_expected`, `dts_only`, `review`.

### Persistence

`catalog.json` и `progress.json` пишутся отдельно. RC3.7 добавляет:

1. запись во временный файл;
2. file `fsync`;
3. atomic rename;
4. directory sync;
5. три поколения `.bak1/.bak2/.bak3`;
6. автоматическое восстановление primary JSON из первого валидного backup.

Это особенно важно для слабого NAS, где прогресс обновляется значительно чаще каталога.

### TMDB artwork cache

Backend разрешает кешировать только HTTPS URL с `image.tmdb.org`. Изображение хранится в `HC_IMAGE_CACHE_DIR` и после первого обращения отдаётся с NAS. TV-клиент переводит известные TMDB URL на:

```text
/api/image?url=<encoded TMDB URL>
```

Размер отдельного кешируемого изображения ограничен 20 MiB.

### Диагностика

```text
GET /api/health
GET /api/diagnostics
```

Diagnostics включает runtime/version, размеры каталога, число media profiles, compatibility buckets, image cache, media root/base URL и доступность ffprobe/FFmpeg.

## Установка backend на QNAP D1

CI формирует ARMv7 bundle:

```text
homecinema-d1
VERIFY-QNAP-D1.sh
INSTALL-QNAP-D1.sh
UNINSTALL-QNAP-D1.sh
README-QNAP-D1.md
VERSION
www/
```

После копирования на NAS и временного включения SSH:

```sh
chmod +x *.sh homecinema-d1
./VERIFY-QNAP-D1.sh
./INSTALL-QNAP-D1.sh
```

Основные адреса после запуска:

```text
UI/API: http://192.168.0.101:8096/
Health: http://192.168.0.101:8096/api/health
Media:  http://192.168.0.101:8096/media/...
```

Первый/повторный scan:

```sh
curl -X POST http://127.0.0.1:8096/api/scan
```

## TMDB

В QNAP config:

```sh
export TMDB_BEARER_TOKEN="YOUR_TOKEN"
```

Без token локальная медиатека и воспроизведение продолжают работать, но новое TMDB enrichment не выполняется.

## DTS

Основной сценарий для D1 — Direct Play. Если файл содержит совместимую альтернативную audio track, TV-клиент выбирает её через AVPlay.

DTS-only fallback остаётся опциональным:

```sh
export HC_ENABLE_DTS_FALLBACK=false
```

Если fallback включён и доступны ffprobe/FFmpeg, video копируется, audio преобразуется в AAC. Полный realtime video transcoding не является целевым режимом для двухъядерного ARMv7 D1.

## TV release workflow

### Build-only — рекомендуемый режим RC3.7

```powershell
.\RELEASE-TV.ps1 -RC rc3.7 -CertificateProfile HomeCinemaTV-FRESH
```

По умолчанию скрипт **не подключается к телевизору и ничего на него не устанавливает**. Он запускает локальные gates, собирает/подписывает WGT, проверяет содержимое и подписи, копирует RC-файл на Рабочий стол и создаёт JSON manifest с SHA-256/source SHA.

Ожидаемый результат:

```text
HomeCinema-Tizen-v0.3.18-rc3.7.wgt
HomeCinema-Tizen-v0.3.18-rc3.7.json
```

Установка возможна только отдельным явным `-Install` либо через `INSTALL-SAMSUNG-WGT.ps1 -TvIp ...`. Подробно: `docs/SAMSUNG-INSTALL.md`.

## CI

GitHub Actions проверяет:

- Python backend tests + compile;
- JavaScript syntax;
- player state/progress/lifecycle;
- post-player remote navigation;
- root Back exit;
- RC3.7 resilience/UX markers;
- RC3.7 accelerated scrub;
- Tizen 4 / Chromium M56 compatibility;
- release candidate UX / TMDB attribution;
- API origin routing;
- Go formatting;
- QNAP native Go tests;
- ARMv7 cross-build;
- QNAP install bundle artifact.

## Versioning

`VERSION` и Tizen widget version остаются `0.3.18` внутри текущей RC-линейки. TV candidates отличаются RC suffix в имени подписанного пакета:

```text
HomeCinema-Tizen-v0.3.18-rc3.6.wgt
HomeCinema-Tizen-v0.3.18-rc3.7.wgt
```

`CHANGELOG.md` отдельно фиксирует подтверждённый TV baseline и engineering candidates.

## Attribution

Home Cinema использует TMDB metadata/images и содержит required TMDB attribution screen:

`This product uses the TMDB API but is not endorsed or certified by TMDB.`
