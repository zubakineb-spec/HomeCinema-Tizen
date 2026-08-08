# Развёртывание backend непосредственно на NAS

Целевая схема: Samsung UE49NU7500U -> Home Cinema backend на NAS `192.168.0.101:8096` -> локальная файловая медиатека NAS.

## Docker/Container Manager

1. Скопируйте репозиторий на NAS.
2. Создайте `.env` рядом с `docker-compose.nas.yml`:

```env
MEDIA_BASE_URL=http://192.168.0.101/
NAS_MEDIA_PATH=/volume1/media
NAS_APP_DATA=/volume1/docker/home-cinema/data
TMDB_BEARER_TOKEN=...
```

`NAS_MEDIA_PATH` должен указывать на корень той же медиатеки, которая доступна телевизору через `MEDIA_BASE_URL`.

3. Запустите:

```sh
docker compose -f docker-compose.nas.yml up -d --build
```

4. Проверка:

```text
http://192.168.0.101:8096/api/health
```

5. Сканирование:

```sh
curl -X POST http://192.168.0.101:8096/api/scan
```

Backend сканирует `/media` локально, `ffprobe`/`ffmpeg` также читают `/media` напрямую. TV получает публичные URL NAS и использует Direct Play. Только DTS-only контент проходит через HLS fallback на порту 8096.
