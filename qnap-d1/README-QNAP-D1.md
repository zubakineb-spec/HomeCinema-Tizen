# Home Cinema D1 native runtime — v0.3.2

Целевое устройство: QNAP D1, ARMv7, 2 ядра, 1 ГБ RAM, QTS 4.3.6.2805.

## Почему без Docker

Для аппаратной ветки TS-128/TS-228 на QTS 4.3.6 QNAP отключила Container Station из-за 32-битной архитектуры и нерасширяемой памяти. Поэтому Home Cinema D1 использует один статически связанный ARMv7 ELF-бинарник без Python и Docker.

## Установка

1. Распакуйте каталог пакета в общую папку NAS, например `Public/HomeCinemaD1-install`.
2. В QTS включите SSH только на время установки.
3. Подключитесь к `admin@192.168.0.101`.
4. Перейдите в каталог пакета и выполните:

```sh
chmod +x *.sh homecinema-d1
./VERIFY-QNAP-D1.sh
./INSTALL-QNAP-D1.sh
```

После запуска:

- UI/API: `http://192.168.0.101:8096/`
- media: `http://192.168.0.101:8096/media/...`
- health: `http://192.168.0.101:8096/api/health`
- scan: `POST http://192.168.0.101:8096/api/scan`

По умолчанию используется QNAP share `Multimedia`. Путь можно изменить в `homecinema.conf`, созданном установщиком в каталоге `.qpkg/HomeCinemaD1`.

## TMDB

Добавьте в `homecinema.conf`:

```sh
export TMDB_BEARER_TOKEN="ВАШ_TOKEN"
```

и перезапустите:

```sh
/path/to/.qpkg/HomeCinemaD1/homecinema.sh restart
```

## DTS на Samsung UE49NU7500U

DTS fallback на D1 по умолчанию выключен, чтобы не перегружать двухъядерный ARM. Если `VERIFY-QNAP-D1.sh` обнаружит `ffmpeg` и `ffprobe`, режим можно включить после теста одного файла:

```sh
export HC_ENABLE_DTS_FALLBACK="true"
```

Совместимые файлы всегда идут Direct Play. Если MKV содержит DTS и вторую поддерживаемую аудиодорожку, TV-клиент пытается выбрать не-DTS дорожку через AVPlay.
