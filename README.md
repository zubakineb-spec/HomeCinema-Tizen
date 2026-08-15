# Home Cinema for Samsung Tizen

Локальный домашний кинотеатр для Samsung Smart TV. Целевая домашняя схема: Samsung UE49NU7500U и NAS `192.168.0.101`.

## Текущая версия

`0.3.18` — RC-ready функциональный baseline.

Код TV-клиента, QNAP D1 runtime и постоянные TV regression gates находятся в `main`. Установка WGT на целевой Samsung 2018 / Tizen 4.0 остаётся отдельным внешним blocker и отслеживается в issue #10 и `docs/TIZEN4-DEPLOYMENT-BLOCKER.md`.

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
- «Продолжить просмотр» с устойчивым сохранением позиции;
- сезоны, серии и дополнительные материалы;
- Okko-style TV UI и отдельная focus model для Samsung Smart Remote;
- Samsung Smart Remote: D-pad, OK, Back, MediaPlayPause, отдельные MediaPlay/MediaPause, Stop, Rewind/FastForward;
- Samsung AVPlay lifecycle с сериализацией seek/restore seek и `suspend()/restore()`;
- сохранение PAUSED через background/restore и смену аудиодорожки;
- выбор аудиодорожек и встроенных субтитров через AVPlay;
- автоматический выбор совместимой не-DTS аудиодорожки;
- Direct Play с NAS;
- browser AVPlay shim для desktop/CI проверок без подмены native AVPlay на Samsung TV;
- профиль совместимости Samsung UE49NU7500U / Tizen 4.0 / Chromium M56;
- экран «О приложении / Credits» с TMDB attribution.

## Хранение данных на D1

D1-runtime использует два небольших JSON-файла вместо SQLite:

- `catalog.json` — фильмы, сериалы, эпизоды и TMDb metadata;
- `progress.json` — позиции просмотра.

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

Samsung UE49NU7500U не должен получать DTS-only поток как единственный звук. Если MKV содержит альтернативную совместимую дорожку, TV-клиент выбирает её через AVPlay без транскодирования.

На D1 `HC_ENABLE_DTS_FALLBACK=false` по умолчанию. Если на NAS доступны `ffprobe` и `ffmpeg`, fallback можно включить после аппаратного теста. В этом режиме видео копируется без перекодирования, а только звук преобразуется в AAC. Для двухъядерного ARM это опциональный режим, а не основной сценарий.

## Samsung Tizen client

Каталог `tv-app` — Samsung Tizen Web Application. Для установленного приложения API по умолчанию:

```text
http://192.168.0.101:8096
```

Для установки `.wgt` на телевизор нужны Samsung TV SDK/Tizen Studio, Developer Mode телевизора и Samsung certificate profile. Базовые скрипты:

```powershell
.\BUILD-SAMSUNG-WGT.ps1 -CertificateProfile "ИмяПрофиля"
.\INSTALL-SAMSUNG-WGT.ps1 -Target "имя-target"
```

Подробно: `docs/SAMSUNG-INSTALL.md`.

### Samsung 2018 / Tizen 4 deployment blocker

На UE49NU7500 WGT в текущем окружении передаётся на TV, но установка обрывается до `installing[n]`. Уже исключены приложение/manifest/размер пакета, current и legacy packager, старый и свежий Samsung certificate profile, неправильный DUID, SDB connectivity и отсутствие `Install Permitted`.

Следующий контролируемый эксперимент — импорт уже подписанного `.wgt` обратно в Tizen Studio как нового Tizen Web project с целью Tizen 4.0 и установка импортированного проекта на тот же TV.

Полная матрица: `docs/TIZEN4-DEPLOYMENT-BLOCKER.md`. Tracking: issue #10.

## Более мощные NAS

Python/FastAPI backend, SQLite, Dockerfile и `docker-compose.nas.yml` сохраняются для современных x86-64/ARM64 NAS с контейнерной средой. Для QNAP D1 целевым остаётся native ARMv7 runtime.

## CI и versioning

SemVer. Репозиторий: `zubakineb-spec/HomeCinema-Tizen`.

GitHub Actions проверяет:

- Python backend regression suite и compile check;
- JavaScript syntax;
- player state smoke;
- progress consistency smoke;
- AVPlay lifecycle smoke;
- Tizen 4 / Chromium M56 compatibility gate;
- release-candidate Smart Remote UX / attribution gate;
- Go tests D1-runtime;
- ARMv7 cross-build и install artifact.

Cross-build:

```text
GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0
```

CI формирует artifact `HomeCinema-D1-armv7-v0.3.18`.

## Атрибуция TMDb

TV-клиент содержит экран «О приложении / Credits» с TMDB logo asset и уведомлением:

`This product uses the TMDB API but is not endorsed or certified by TMDB.`
