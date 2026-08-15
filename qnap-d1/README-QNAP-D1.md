# Home Cinema D1 native runtime — 0.3.18 / RC3.7 engineering

Целевое устройство: QNAP D1, ARMv7, 2 ядра, 1 ГБ RAM, QTS 4.3.6.2805.

Home Cinema D1 использует один статически связанный ARMv7 Go-бинарник без Docker и системного Python. Основной режим воспроизведения — Direct Play по HTTP Range.

## Установка

1. Распакуйте CI bundle в общую папку NAS, например `Public/HomeCinemaD1-install`.
2. Временно включите SSH.
3. Подключитесь к `admin@192.168.0.101`.
4. Выполните:

```sh
chmod +x *.sh homecinema-d1
./VERIFY-QNAP-D1.sh
./INSTALL-QNAP-D1.sh
```

После запуска:

```text
UI/API:      http://192.168.0.101:8096/
health:      http://192.168.0.101:8096/api/health
diagnostics: http://192.168.0.101:8096/api/diagnostics
media:       http://192.168.0.101:8096/media/...
scan:        POST http://192.168.0.101:8096/api/scan
```

## RC3.7: incremental scan

Scan сохраняет для каждого movie/episode размер и mtime. Если `source_url + size + mtime` не изменились, существующий media profile используется повторно. Новый/изменённый файл профилируется через ffprobe, если он доступен.

Ответ `/api/scan` содержит:

```text
scan_reused
scan_profiled
scan_removed
```

Media profile включает container, video codec, resolution, HDR, audio/subtitle codecs и compatibility status.

## RC3.7: безопасное хранение данных

Отдельно хранятся:

```text
catalog.json
progress.json
```

Каждая запись выполняется через temp file → file sync → atomic rename → directory sync. Перед заменой создаются три поколения:

```text
catalog.json.bak1 ... bak3
progress.json.bak1 ... bak3
```

Если primary JSON повреждён, runtime при старте ищет первое валидное backup и автоматически восстанавливает primary.

## RC3.7: TMDB image cache

TV-клиент может запрашивать TMDB artwork через:

```text
GET /api/image?url=<encoded https://image.tmdb.org/...>
```

Backend принимает только `image.tmdb.org`, ограничивает одно изображение 20 MiB и сохраняет его в:

```text
$HC_IMAGE_CACHE_DIR
```

По умолчанию это `<data-dir>/image-cache`.

После первого запроса изображение обслуживается локально с NAS и не требует повторного обращения TV к TMDB CDN.

## RC3.7: история и следующая серия

```text
GET /api/history
GET /api/next?source_url=<source>
```

`/api/history` возвращает последние позиции, включая completed. `/api/next` вычисляет следующую обычную серию внутри того же show и не включает extras.

## TMDB metadata

Добавьте в `homecinema.conf`:

```sh
export TMDB_BEARER_TOKEN="ВАШ_TOKEN"
```

После изменения перезапустите сервис:

```sh
/path/to/.qpkg/HomeCinemaD1/homecinema.sh restart
```

Без token локальный catalog/scan/playback работают; новое TMDB enrichment пропускается.

## Настройки RC3.7

Необязательные переменные:

```sh
export HC_MEDIA_ROOT="/share/Multimedia"
export HC_MEDIA_BASE_URL="http://192.168.0.101:8096/media/"
export HC_DATA_DIR="/path/to/.homecinema-d1"
export HC_IMAGE_CACHE_DIR="/path/to/.homecinema-d1/image-cache"
export HC_ENABLE_DTS_FALLBACK="false"
```

## DTS на Samsung UE49NU7500U

DTS fallback по умолчанию выключен, чтобы не перегружать D1. Если файл содержит вторую совместимую audio track, TV-клиент выбирает её через AVPlay без transcoding.

Если файл DTS-only и на NAS доступны ffprobe/FFmpeg, fallback можно включить после отдельного аппаратного теста:

```sh
export HC_ENABLE_DTS_FALLBACK="true"
```

При fallback video stream копируется, только audio преобразуется в AAC. Полный realtime video transcoding не является целевым сценарием для D1.

## Проверка после будущего обновления NAS

```sh
curl http://127.0.0.1:8096/api/health
curl http://127.0.0.1:8096/api/diagnostics
curl -X POST http://127.0.0.1:8096/api/scan
```

Для RC3.7 deployment на NAS/TV выполнять только после зелёного CI и отдельного решения на установку; текущий TV-validated rollback остаётся RC3.6.
