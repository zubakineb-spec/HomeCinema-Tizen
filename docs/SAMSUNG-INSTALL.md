# Установка Home Cinema на Samsung Tizen TV

## Текущий статус

- Последняя подтверждённая на физическом Samsung UE49NU7500U сборка: `HomeCinema-Tizen-v0.3.18-rc3.6.wgt`.
- RC3.7 engineering готовится как следующий кандидат и **не устанавливается на телевизор автоматически**.
- Внутренняя версия Tizen widget остаётся `0.3.18`; RC-номер входит в имя релизного WGT.

## 1. Подготовка ПК

Нужны Tizen Studio, Samsung TV Extension, Web CLI/SDB и Samsung TV certificate profile. Для рабочего окружения Home Cinema используется локальный профиль `HomeCinemaTV-FRESH`; приватные ключи сертификата в репозиторий не входят.

Добавьте Tizen tools в `PATH`, если они ещё не доступны:

```powershell
$env:PATH = "C:\tizen-studio\tools;C:\tizen-studio\tools\ide\bin;$env:PATH"
```

## 2. Developer Mode и SDB

ПК и телевизор должны находиться в одной LAN. На TV должен быть включён Developer Mode и указан IP компьютера с Tizen Studio.

Проверка подключения:

```powershell
sdb connect 192.168.0.103
sdb devices
```

Для целевого телевизора рабочий идентификатор имеет вид:

```text
192.168.0.103:26101    device
```

Первая колонка — фактический SDB serial. Именованный target `SamsungTV` не требуется.

## 3. Backend/NAS endpoint

По умолчанию TV-клиент использует:

```text
http://192.168.0.101:8096
```

Начиная с RC3.7 endpoint можно сохранить из экрана **О приложении → Диагностика и настройки**. Значение хранится локально на TV. Клиент проверяет `/api/health`, повторяет временно неудачные GET-запросы, использует кеш каталога при кратком пропадании NAS и отправляет накопленные позиции просмотра после восстановления соединения.

## 4. Рекомендуемый релизный сценарий

В RC3.7 основной скрипт — `RELEASE-TV.ps1`.

Только собрать, подписать, проверить WGT и сохранить его на Рабочий стол:

```powershell
.\RELEASE-TV.ps1 -RC rc3.7 -CertificateProfile HomeCinemaTV-FRESH
```

**По умолчанию установка на телевизор не выполняется.**

Скрипт:

1. запускает локальные JS/Go release-gates, если соответствующие runtime доступны;
2. вызывает `BUILD-SAMSUNG-WGT.ps1`;
3. подписывает WGT через указанный Samsung certificate profile;
4. проверяет `config.xml`, подписи и обязательные RC3.7-файлы внутри архива;
5. проверяет ключевые regression-маркеры пульта/Back/перемотки;
6. копирует WGT на Рабочий стол с RC-именем;
7. создаёт рядом JSON manifest с source SHA, размером и SHA-256.

Пример результата:

```text
C:\Users\Home\Desktop\HomeCinema-Tizen-v0.3.18-rc3.7.wgt
C:\Users\Home\Desktop\HomeCinema-Tizen-v0.3.18-rc3.7.json
```

## 5. Установка — только отдельным явным действием

Когда конкретная RC будет разрешена для TV-теста:

```powershell
.\INSTALL-SAMSUNG-WGT.ps1 `
  -TvIp 192.168.0.103 `
  -PackagePath "$env:USERPROFILE\Desktop\HomeCinema-Tizen-v0.3.18-rc3.7.wgt" `
  -Run
```

Установщик сам:

- выполняет `sdb connect`;
- находит фактический serial из `sdb devices`;
- выполняет `tizen install-permit -s <serial>`;
- устанавливает через `tizen install -s <serial>`;
- при `-Run` запускает `HCINEMA001.HomeCinema`.

Старый вариант `-Target <name>` сохранён только для совместимости.

Можно выполнить build+install одной командой, но только с явным флагом:

```powershell
.\RELEASE-TV.ps1 -RC rc3.7 -Install
```

Без `-Install` скрипт принципиально не обращается к телевизору.

## 6. Проверка релиз-кандидата на TV

После будущей установки RC3.7 проверить минимум:

- старт и выход Back с главного экрана;
- Left/Right после выхода из плеера;
- обычный seek 10 сек и ускорение 10→30→60 сек при удержании;
- Continue / «С начала»;
- аудиодорожки, субтитры и сохранение предпочтений сериала;
- размер субтитров;
- История, Избранное, сортировка/жанры;
- просмотренные серии и следующую серию;
- Diagnostics / состояние NAS;
- кратковременное отключение NAS и восстановление progress queue;
- TMDB-постеры через локальный `/api/image` cache.

## 7. Стабильный rollback

До отдельного подтверждения RC3.7 на физическом TV стабильным rollback остаётся:

```text
HomeCinema-Tizen-v0.3.18-rc3.6.wgt
source: 32a1f962264adebf1fb85bfeea4a0e0f5dffd19e
```

RC3.6 уже прошла реальную установку/запуск и проверку Back/навигации на UE49NU7500U.
