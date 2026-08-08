# Установка Home Cinema на Samsung Tizen TV

## 1. Подготовить ПК

Установите Tizen Studio, Samsung TV Extension и Web CLI. В Tizen Studio откройте **Tools → Certificate Manager** и создайте профиль сертификата Samsung TV.

Приложение для телевизора должно быть подписано действительным сертификатом; неподписанный WGT на реальный Samsung TV не устанавливается.

## 2. Включить Developer Mode на телевизоре

ПК и телевизор должны находиться в одной локальной сети.

1. На Samsung TV откройте **Apps → App Settings**.
2. Наберите `12345` с пульта/экранной цифровой клавиатуры.
3. Включите **Developer mode**.
4. Укажите IP-адрес ПК, на котором установлен Tizen Studio.
5. Перезагрузите телевизор.
6. В Tizen Studio откройте **Tools → Device Manager**, добавьте телевизор как Remote Device и включите соединение.
7. Для подключенного устройства выполните **Permit to install applications**.

## 3. Настроить адрес backend

В `tv-app/js/config.js` должен быть LAN-адрес ПК/сервера, на котором работает Home Cinema backend, например:

```javascript
window.HOME_CINEMA_API = 'http://192.168.0.101:8096';
```

Важно: `192.168.0.101` в исходной постановке — адрес источника медиатеки. Если backend запускается на другом компьютере, в `config.js` нужен именно адрес backend, а `MEDIA_BASE_URL` в `.env` должен оставаться адресом файлового HTTP-сервера.

## 4. Собрать подписанный WGT

PowerShell из корня репозитория:

```powershell
.\BUILD-SAMSUNG-WGT.ps1 -CertificateProfile "ИмяПрофиля"
```

Скрипт выполняет официальную последовательность Tizen CLI:

```text
tizen build-web -- <project>
tizen package -t wgt -s <certificate profile> -- <project>\.buildResult
```

Результат копируется в:

```text
dist\HomeCinema-Tizen-v0.2.0.wgt
```

## 5. Установить на телевизор

Получите имя target:

```powershell
sdb devices
```

Затем:

```powershell
.\INSTALL-SAMSUNG-WGT.ps1 -Target "имя-target"
```

Скрипт вызывает `tizen install -t <target> --name <package.wgt> -- <directory>`.

## 6. Что проверить на телевизоре

- запуск главной витрины;
- управление стрелками/OK/Back;
- сканирование медиатеки;
- открытие фильма;
- открытие сериала → выбор сезона → выбор серии;
- Direct Play MKV/MP4 через AVPlay;
- перемотка;
- сохранение позиции и «Продолжить просмотр»;
- переключение аудиодорожек;
- включение/выключение встроенных субтитров.

## Совместимость

В `config.xml` оставлен `required_version="2.3"`, чтобы проект можно было импортировать с ориентацией на Samsung Smart TV начиная с моделей 2015 года. Реальная мультимедийная совместимость зависит от года/модели телевизора, кодеков и контейнера; финальная проверка должна выполняться на конкретном TV.
