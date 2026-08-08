# Home Cinema for Samsung Tizen

Локальный домашний кинотеатр для Samsung Smart TV. Целевая домашняя схема пользователя: Samsung UE49NU7500U и NAS `192.168.0.101`.

## Текущая версия

`0.3.2`

## Целевая схема QNAP D1

```text
Samsung UE49NU7500U
        |
        | LAN
        v
QNAP D1 192.168.0.101
  ├─ локальная медиатека
  ├─ Home Cinema native ARMv7 backend :8096
  ├─ catalog.json / progress.json
  ├─ /media/ с HTTP Range для Direct Play
  └─ TMDb metadata; FFmpeg fallback опционален
```

Для **QNAP D1 / ARMv7 / 2 ядра / 1 ГБ / QTS 4.3.6.2805** используется специальный нативный runtime из `native-qnap-d1`. Он не требует Docker и системного Python. Установка выполняется скриптами из `qnap-d1`.

Backend сам публикует видео как `http://192.168.0.101:8096/media/...`. Телевизор поэтому не зависит от отдельной настройки QNAP Web Server. `http.FileServer` обеспечивает byte-range ответы, необходимые для перемотки/seek больших видеофайлов.

## Возможности

- фильмы и сериалы из локальных каталогов NAS;
- распознавание `S01E02`, `1x02`, `Season 01`, `Сезон 01`, `S01` и числовых файлов серий;
- TMDb: русские названия/описания, постеры, backdrop, рейтинг, жанры и данные эпизодов;
- поиск;
- «Продолжить просмотр»;
- сезоны и серии;
- Samsung Smart Remote: D-pad, OK, Back, Play/Pause, перемотка;
- Samsung AVPlay + HTML5 fallback;
- выбор аудиодорожек и встроенных субтитров через AVPlay;
- сохранение позиции просмотра;
- Direct Play с NAS;
- профиль совместимости Samsung UE49NU7500U / Tizen 4.0;
- обнаружение DTS/совместимой аудиодорожки;
- опциональный DTS-only HLS fallback через FFmpeg.

## Хранение данных на D1

D1-runtime использует два небольших JSON-файла вместо SQLite:

- `catalog.json` — фильмы, сериалы, эпизоды и TMDb metadata;
- `progress.json` — только позиции просмотра.

Разделение снижает количество записей большого каталога при частом сохранении позиции воспроизведения.

## Установка на QNAP D1

Готовый ARMv7 install bundle содержит:

```text
homecinema-d1
VERIFY-QNAP-D1.sh
INSTALL-QNAP-D1.sh
UNINSTALL-QNAP-D1.sh
README-QNAP-D1.md
VERSION
www/
```

После копирования пакета на NAS и временного включения SSH:

```sh
chmod +x *.sh homecinema-d1
./VERIFY-QNAP-D1.sh
./INSTALL-QNAP-D1.sh
```

Установщик:

- проверяет ARMv7 и запуск бинарника;
- определяет QNAP data volume и share `Multimedia`;
- устанавливает backend в `.qpkg/HomeCinemaD1`;
- хранит каталог/прогресс отдельно в `.homecinema-d1`;
- регистрирует сервис в `/etc/config/qpkg.conf` через QNAP `setcfg`;
- создаёт резервную копию `qpkg.conf` перед изменением;
- включает автозапуск и порт `8096`.

После установки:

```text
UI/API:  http://192.168.0.101:8096/
Health:  http://192.168.0.101:8096/api/health
Media:   http://192.168.0.101:8096/media/...
```

Первое сканирование:

```sh
curl -X POST http://127.0.0.1:8096/api/scan
```

Подробно: `qnap-d1/README-QNAP-D1.md`.

## TMDb

В созданном установщиком `homecinema.conf` можно добавить:

```sh
export TMDB_BEARER_TOKEN="ВАШ_TOKEN"
```

После изменения перезапустите сервис `homecinema.sh restart`.

Без токена медиатека индексируется, но внешние описания и изображения не загружаются.

## DTS и QNAP D1

Samsung UE49NU7500U не должен получать DTS-only поток как единственный звук. Если MKV содержит альтернативную совместимую дорожку, TV-клиент пытается выбрать её через AVPlay без транскодирования.

На D1 `HC_ENABLE_DTS_FALLBACK=false` по умолчанию. Если на NAS доступны `ffprobe` и `ffmpeg`, fallback можно включить после аппаратного теста. В этом режиме видео копируется без перекодирования, а только звук преобразуется в AAC. Для двухъядерного ARM это опциональный режим, а не основной сценарий.

## Samsung Tizen client

Каталог `tv-app` — Samsung Tizen Web Application. Для установленного приложения API по умолчанию:

```text
http://192.168.0.101:8096
```

Для установки `.wgt` на телевизор нужны Samsung TV SDK/Tizen Studio, Developer Mode телевизора и Samsung certificate profile. Скрипты:

```powershell
.\BUILD-SAMSUNG-WGT.ps1 -CertificateProfile "ИмяПрофиля"
.\INSTALL-SAMSUNG-WGT.ps1 -Target "имя-target"
```

Подробно: `docs/SAMSUNG-INSTALL.md`.

## Более мощные NAS

Python/FastAPI backend, SQLite, Dockerfile и `docker-compose.nas.yml`, разработанные в `0.3.1`, сохраняются для современных x86-64/ARM64 NAS с контейнерной средой. **Для QNAP D1 целевым является native ARMv7 runtime `0.3.2`, а не Docker.**

## CI и versioning

SemVer. Репозиторий: `zubakineb-spec/HomeCinema-Tizen`.

GitHub Actions проверяет Python regression suite, JavaScript Tizen-клиента, Go-тесты D1-runtime и делает cross-build:

```text
GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0
```

CI формирует artifact `HomeCinema-D1-armv7-v0.3.2`.

## Атрибуция TMDb

TV-клиент содержит экран «О приложении» с уведомлением TMDb. Перед публичным распространением необходимо использовать утверждённый TMDb logo asset в соответствии с их правилами атрибуции.
