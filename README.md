# Home Cinema for Samsung Tizen

Локальный домашний кинотеатр для Samsung Smart TV. Медиаконтент остаётся на домашнем HTTP-сервере, по умолчанию `http://192.168.0.101/`. Сервер приложения индексирует фильмы и сериалы, добавляет метаданные TMDb и отдаёт каталог Tizen-клиенту.

## Версия

`0.3.2`

## Что уже реализовано

- рекурсивное сканирование HTTP-каталогов;
- фильмы из одиночных видеофайлов;
- сериалы, хранящиеся в папках;
- шаблоны серий `S01E02`, `1x02`;
- папки `Season 01`, `Сезон 01`, `S01`;
- файлы `01.mkv`, `02.mkv` внутри папки сезона;
- SQLite-каталог;
- русские метаданные TMDb;
- афиша, backdrop, описание, рейтинг, жанры;
- данные эпизодов и изображения серий;
- Samsung Smart Remote: D-pad, OK, Back, Play/Pause, перемотка;
- Samsung AVPlay с HTML5 video fallback;
- сохранение позиции просмотра;
- строка «Продолжить просмотр»;
- поиск по фильмам и сериалам;
- отдельный выбор сезона и серий;
- переключение аудиодорожек и встроенных субтитров через Samsung AVPlay.

## Рекомендуемая структура медиатеки

```text
http://192.168.0.101/
├── Films/
│   ├── Interstellar.2014.2160p.HDR.mkv
│   └── Dune.Part.Two.2024.mkv
└── Series/
    ├── Fallout/
    │   └── Season 01/
    │       ├── Fallout.S01E01.mkv
    │       └── Fallout.S01E02.mkv
    └── Игра престолов/
        └── Сезон 01/
            ├── 01.mkv
            └── 02.mkv
```

Переименование существующей медиатеки не является обязательным: сканер умеет использовать структуру каталогов как источник названия сериала и номера сезона.

## Запуск backend на Windows

Из корня проекта:

```powershell
Copy-Item .env.example .env
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r .\backend\requirements.txt
$env:PYTHONPATH = (Resolve-Path .\backend).Path
python .\backend\run.py
```

Открыть на ПК:

```text
http://localhost:8096/
```

Проверка:

```text
http://localhost:8096/api/health
```

Запустить индексирование:

```powershell
Invoke-RestMethod -Method Post http://localhost:8096/api/scan
```

## TMDb

В `.env` укажите API Read Access Token:

```env
TMDB_BEARER_TOKEN=...
```

Без токена медиатека всё равно индексируется, но останется без внешних описаний и изображений.

## Samsung Tizen

Каталог `tv-app` — Tizen Web Application. Для установки на телевизор нужны Samsung TV SDK/Tizen Studio, Developer Mode телевизора и сертификат разработчика.

В `index.html` подключён Samsung Product API (`$WEBAPIS/webapis/webapis.js`). Для воспроизведения приложение сначала использует `webapis.avplay`; если AVPlay недоступен, используется HTML5 `<video>`.

Перед сборкой под конкретный телевизор backend должен быть доступен телевизору по LAN. Для установленного Tizen-пакета адрес backend задаётся в `tv-app/js/config.js`; по умолчанию стоит `http://192.168.0.101:8096`. Если TV-приложение будет обслуживаться самим backend, URL интерфейса — `http://<IP-ПК>:8096/`.

## Git/versioning

SemVer. Базовый релиз: `v0.1.0`. Текущая версия: `v0.3.2`.

Рекомендуемый репозиторий: `zubakineb-spec/HomeCinema-Tizen`.

## Управление

- `← ↑ ↓ →` — перемещение по интерфейсу.
- `OK` — открыть карточку / запустить / пауза в плеере.
- `Back` — назад.
- В плеере `←/→` — перемотка на 10 секунд.
- В плеере `↑` — открыть выбор аудиодорожки и субтитров.

Для сериалов сервер группирует найденные эпизоды по сезонам независимо от того, называются ли каталоги `Season 01`, `Сезон 01` или `S01`. Файлы внутри сезона могут быть вида `S01E01.mkv`, `1x01.mkv` или `01 - Название серии.mkv`.

## Сборка и установка на Samsung TV

После установки Tizen Studio + Samsung TV Extension + Web CLI и создания Samsung certificate profile:

```powershell
.\BUILD-SAMSUNG-WGT.ps1 -CertificateProfile "ИмяПрофиля"
sdb devices
.\INSTALL-SAMSUNG-WGT.ps1 -Target "имя-target"
```

Подробно: `docs/SAMSUNG-INSTALL.md`.

## Атрибуция TMDB

TV-клиент содержит экран «О приложении» с обязательным уведомлением TMDB. Перед распространением приложения необходимо также добавить утверждённый TMDB logo asset из официального раздела Logos & Attribution; произвольно перерисовывать логотип нельзя.

## Samsung UE49NU7500U / Tizen 4.0

Начиная с `0.3.1` Samsung UE49NU7500U является первым целевым аппаратным профилем проекта. Backend проверяет дорожки через `ffprobe` перед запуском. Совместимые файлы воспроизводятся напрямую. Если контейнер содержит DTS и другую совместимую аудиодорожку, AVPlay автоматически выбирает не-DTS дорожку. Если DTS — единственная аудиодорожка, backend формирует локальный HLS-поток: видеопоток копируется без перекодирования, звук преобразуется FFmpeg в AAC stereo 256 kbps.

Для этого режима на backend-компьютере должны быть доступны `ffmpeg` и `ffprobe`. Их пути можно задать в `.env` через `FFMPEG_PATH` и `FFPROBE_PATH`. HLS-кэш хранится в `HLS_CACHE_DIR` и не попадает в Git.

## Backend на NAS

Целевая схема v0.3.1: backend работает непосредственно на NAS `192.168.0.101`. Медиатека монтируется в контейнер read-only как `/media`; сканирование и FFmpeg/ffprobe работают с локальными файлами NAS, а Samsung получает прямые URL через `MEDIA_BASE_URL`. См. `docs/NAS-DEPLOY.md`.

## QNAP D1 — native ARMv7 runtime

Для конкретного NAS **QNAP D1 / ARMv7 / 2 ядра / 1 ГБ / QTS 4.3.6.2805** целевой runtime начиная с `0.3.2` — нативный, без Docker и без Python. Исходники находятся в `native-qnap-d1`, установочные скрипты — в `qnap-d1`.

Backend сам публикует медиатеку как `http://192.168.0.101:8096/media/...`, поэтому Tizen-клиент не зависит от QNAP Web Server. Совместимые файлы идут Direct Play с HTTP Range. Каталог хранится в `catalog.json`, прогресс — отдельно в `progress.json`.

Готовый CI artifact и локальный релизный пакет содержат ARMv7 ELF-бинарник `homecinema-d1`. Установка на D1 выполняется через SSH командами `VERIFY-QNAP-D1.sh` и `INSTALL-QNAP-D1.sh`; сервис регистрируется в QTS и запускается на порту `8096`.

DTS→AAC через FFmpeg на D1 оставлен опциональным и по умолчанию выключен. Если в MKV есть альтернативная AAC/AC3/E-AC3 дорожка, Samsung AVPlay выбирает совместимый звук без транскодирования.
