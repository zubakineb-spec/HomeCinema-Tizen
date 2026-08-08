# Home Cinema for Samsung Tizen

Локальный домашний кинотеатр для Samsung Smart TV. Медиаконтент остаётся на домашнем HTTP-сервере, по умолчанию `http://192.168.0.101/`. Сервер приложения индексирует фильмы и сериалы, добавляет метаданные TMDb и отдаёт каталог Tizen-клиенту.

## Версия

`0.2.0`

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

SemVer. Базовый релиз: `v0.1.0`. Текущая версия разработки: `v0.2.0`.

Рекомендуемый репозиторий: `zubakineb-spec/HomeCinema-Tizen`.

## Управление в v0.2.0

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
