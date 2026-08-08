# Home Cinema for Samsung Tizen

Локальный домашний кинотеатр для Samsung Smart TV. Медиаконтент хранится на NAS `192.168.0.101`; Home Cinema backend также работает непосредственно на NAS, индексирует фильмы и сериалы, добавляет метаданные TMDb и отдаёт каталог Tizen-клиенту.

## Версия

`0.3.1`

## Целевая архитектура

```text
Samsung UE49NU7500U
        |
        | LAN
        v
NAS 192.168.0.101
  ├─ медиатека Films / Series
  ├─ Home Cinema backend :8096
  ├─ SQLite
  ├─ ffprobe / FFmpeg
  └─ HLS fallback для DTS-only
```

Медиатека монтируется в контейнер read-only как `/media`. Сканирование, `ffprobe` и `ffmpeg` работают с локальными файлами NAS. Телевизор получает прямые URL через `MEDIA_BASE_URL`, поэтому совместимый контент идёт Direct Play и не проксируется через backend.

## Что уже реализовано

- локальное сканирование файловой медиатеки NAS;
- fallback-сканирование HTTP-каталогов;
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
- переключение аудиодорожек и встроенных субтитров через Samsung AVPlay;
- профиль совместимости Samsung UE49NU7500U / Tizen 4.0;
- DTS-only HLS fallback с копированием видео и конвертацией только звука в AAC.

## Рекомендуемая структура медиатеки

```text
/media
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

Переименование существующей медиатеки не является обязательным: сканер использует структуру каталогов как источник названия сериала и номера сезона.

## Развёртывание backend на NAS

Целевой способ — Docker/Container Manager непосредственно на NAS.

Создайте `.env` рядом с `docker-compose.nas.yml`:

```env
MEDIA_BASE_URL=http://192.168.0.101/
NAS_MEDIA_PATH=/volume1/media
NAS_APP_DATA=/volume1/docker/home-cinema/data
TMDB_BEARER_TOKEN=...
```

Пути `/volume1/...` приведены как пример. Реальные пути зависят от модели и ОС NAS.

Запуск:

```sh
docker compose -f docker-compose.nas.yml up -d --build
```

Проверка:

```text
http://192.168.0.101:8096/api/health
```

Сканирование:

```sh
curl -X POST http://192.168.0.101:8096/api/scan
```

Подробно: `docs/NAS-DEPLOY.md`.

## TMDb

В `.env` укажите API Read Access Token:

```env
TMDB_BEARER_TOKEN=...
```

Без токена медиатека всё равно индексируется, но останется без внешних описаний и изображений.

## Samsung Tizen

Каталог `tv-app` — Tizen Web Application. Для установки на телевизор нужны Samsung TV SDK/Tizen Studio, Developer Mode телевизора и сертификат разработчика.

В `index.html` подключён Samsung Product API (`$WEBAPIS/webapis/webapis.js`). Для воспроизведения приложение сначала использует `webapis.avplay`; если AVPlay недоступен, используется HTML5 `<video>`.

Адрес backend для установленного Tizen-пакета задаётся в `tv-app/js/config.js`; целевой адрес — `http://192.168.0.101:8096`.

## Git/versioning

SemVer. Базовый релиз: `v0.1.0`. Текущая версия: `v0.3.1`.

Репозиторий: `zubakineb-spec/HomeCinema-Tizen`.

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

Samsung UE49NU7500U является первым целевым аппаратным профилем проекта. Backend проверяет дорожки через `ffprobe` перед запуском. Совместимые файлы воспроизводятся напрямую. Если контейнер содержит DTS и другую совместимую аудиодорожку, AVPlay выбирает не-DTS дорожку. Если DTS — единственная аудиодорожка, backend формирует локальный HLS-поток: видеопоток копируется без перекодирования, звук преобразуется FFmpeg в AAC stereo 256 kbps.
