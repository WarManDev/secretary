# Аудит текущего состояния проекта Secretary Bot

> **Дата аудита:** 2026-02-12
> **Версия проекта:** 1.0.0 (package.json)
> **Статус:** Рабочий прототип (MVP) с критическими проблемами

---

## Стек технологий

| Технология | Версия | Назначение |
|---|---|---|
| **Node.js + Express** | Express 4.21.2 | Веб-сервер, API endpoints. ES6 modules (`"type": "module"` в package.json) |
| **Sequelize ORM** | 6.37.5 | ORM для PostgreSQL, определение моделей и ассоциаций |
| **PostgreSQL** | 16 (Docker) | Основная база данных. Запускается через `docker-compose-local.yml` |
| **Telegram Bot API** | node-telegram-bot-api 0.66.0 | Telegram-бот в режиме polling |
| **OpenAI GPT-4-0613** | API (raw fetch) | Понимание намерений пользователя, function calling |
| **Google Calendar API v3** | googleapis 144.0.0 + raw fetch | Управление событиями календаря. Два способа обращения: googleapis SDK и сырой fetch |
| **Yandex SpeechKit** | API (axios) | STT (speech-to-text) -- распознавание голосовых сообщений |
| **FFmpeg** | fluent-ffmpeg 2.1.3 | Конвертация аудио OGG в WAV для Yandex STT |
| **Winston** | 3.17.0 | Логирование (настроен только console transport, не экспортируется) |
| **node-schedule** | 2.1.1 | Cron-задачи (утренний дайджест в 08:00) |
| **moment-timezone** | 0.5.47 | Работа с часовыми поясами в dateUtils.js |
| **dotenv** | 16.4.7 | Загрузка переменных окружения из .env |
| **axios** | 1.7.9 | HTTP-клиент (используется только в yandexSpeechService.js) |

---

## Структура файлов

### Корневые файлы

| Файл | Строки | Описание | Проблемы |
|---|---|---|---|
| `index.js` | 77 | Точка входа. Express-сервер, health check `/api/health`, endpoints `/api/users` (GET/POST), подключение Sequelize, импорт telegramBot и morningDigest | **БАГ:** `models` не импортирован -- строки 47 и 63 используют `models.User`, но переменная `models` нигде не определена. Endpoints `/api/users` полностью сломаны. `body-parser` импортирован отдельно, хотя Express 4.16+ имеет встроенный `express.json()` и `express.urlencoded()`. |
| `package.json` | 31 | 14 зависимостей (включая `openai` не используется, `nodemon` в dependencies). `"type": "module"`. Скрипты: `dev` (nodemon), `start` (node). Тесты: `echo "Error: no test specified"` | `nodemon` должен быть в `devDependencies`. Нет тестового фреймворка. |
| `docker-compose-local.yml` | 17 | Только PostgreSQL 16. Сервис назван `parser` (неверное имя, должно быть `db` или `postgres`). Пароль: `mypassword` | Имя сервиса `parser` не соответствует назначению. Пароль в открытом виде. |
| `.gitignore` | 1 | Содержит только одну строку: `.env` | Минимальный. Отсутствуют: `node_modules/`, `*.log`, `.DS_Store`, `dist/`, `ffmpeg/`, и другие стандартные исключения. |
| `.env` | -- | Содержит ВСЕ реальные API ключи: `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`, `GCAL_REFRESH_TOKEN`, `GOOGLE_ACCESS_TOKEN`, `YANDEX_API_KEY`, `DATABASE_URL`, `BOSS_CHAT_ID` | Файл с секретами. Не должен попасть в git (защищен .gitignore, но .gitignore минимальный). |

### Модели (`models/`)

| Файл | Строки | Модель | Поля | Проблемы |
|---|---|---|---|---|
| `models/index.js` | 74 | -- (инициализация) | Sequelize init, 8 моделей, ассоциации, `sequelize.sync()` на строке 68 | `sequelize.sync()` вызывается здесь И в `index.js:33` -- **двойная синхронизация**. `dotenv.config()` вызывается повторно. Timezone `+04:00` жестко закодирован. |
| `models/user.js` | 15 | User | `id`, `username`, `password` (STRING 255), `role` (STRING 20), `created_at`, `updated_at` | **CRITICAL:** пароль хранится в **PLAIN TEXT** без хеширования. Нет валидации `role` (ожидается 'admin', 'boss', 'employee'). `timestamps: false` при наличии ручных полей `created_at`/`updated_at`. |
| `models/employee.js` | 17 | Employee | `id`, `user_id`, `full_name`, `telegram_id`, `email`, `phone`, `created_at`, `updated_at` | Нет уникального ограничения на `telegram_id`. Нет валидации email/phone. |
| `models/event.js` | 42 | Event | `id`, `title`, `description`, `event_date`, `end_date`, `google_calendar_event_id`, `created_at`, `updated_at` | Поле `created_by` используется в ассоциации (`models/index.js:50`) но **отсутствует в схеме модели**. Sequelize создаст его автоматически, но это неявно и может привести к ошибкам. |
| `models/task.js` | 18 | Task | `id`, `title`, `description`, `status` (default: 'pending'), `due_date`, `assigned_employee_id`, `created_by`, `created_at`, `updated_at` | Модель определена, но функционал задач **не реализован** ("ещё не реализовано"). |
| `models/note.js` | 33 | Note | `id`, `content`, `completed` (boolean, default: false), `created_at`, `updated_at` | **Нет `user_id`** -- заметки глобальные, не привязаны к пользователю. В многопользовательском режиме все видят все заметки. |
| `models/session.js` | 15 | Session | `id`, `user_id`, `session_type` ('work'/'personal'), `started_at`, `ended_at`, `current_summary` | Модель определена, ассоциации настроены, но **нигде не используется** в коде бота. |
| `models/message.js` | 16 | Message | `id`, `session_id`, `sender` ('user'/'bot'), `message_text`, `message_type` (default: 'text'), `created_at`, `function_call` (JSONB) | Модель определена, ассоциации настроены, но **нигде не используется**. История хранится в `chatHistories` (в памяти). |
| `models/summary.js` | 13 | Summary | `id`, `session_id`, `summary_text`, `created_at` | Модель определена, ассоциации настроены, но **нигде не используется**. |

### Сервисы (`services/`)

| Файл | Строки | Описание | Проблемы |
|---|---|---|---|
| `services/telegramBot.js` | 442 | Главный обработчик бота. `chatHistories` в памяти. `handleGPTResponse()` парсит JSON из GPT и маршрутизирует: event (create/update/delete), show_events, note (create/show/complete), task (заглушка), chat. Обработка голосовых и текстовых сообщений. | **Memory leak:** `chatHistories` -- объект в памяти, ключи никогда не удаляются. При росте пользователей память будет расти бесконечно. Timezone `"Asia/Dubai"` жестко закодирован в 4+ местах (строки 102, 103, 208, 209, 219, 220). Нет обработки `polling_error`. Нет ограничения доступа (любой пользователь Telegram может использовать бота). |
| `services/chatgptHandler.js` | 147 | OpenAI API wrapper. Системный промпт с инструкциями по JSON-ответам. `processChatMessage()` отправляет историю (последние 10 сообщений) в GPT-4-0613. Определяет функцию `createMeeting` для function calling. | **49 из 147 строк ЗАКОММЕНТИРОВАНЫ** (33% файла -- две старые версии системного промпта). Функция `createMeeting` определена в `functions` массиве, но результат function_call обрабатывается обобщенно в `telegramBot.js` -- функция по имени нигде не вызывается. `API_URL` определена на строке 1, но не используется (fetch идет на литеральную строку на строке 123). |
| `services/googleCalendarService.js` | 101 | Google Calendar API. `createEvent`, `updateEvent`, `deleteEvent` через googleapis SDK (OAuth2 с refresh token). `getEventsForPeriod` через **сырой fetch** с `GOOGLE_ACCESS_TOKEN`. | **Два разных способа авторизации в одном файле:** создание/обновление/удаление используют OAuth2 с refresh token (работает), чтение событий использует **статический access token** из `.env` (истекает через 1 час!). `import fetch from 'node-fetch'` -- в Node.js 18+ fetch встроен. |
| `services/yandexSpeechService.js` | 98 | Yandex SpeechKit STT. `convertOggToWav()` через fluent-ffmpeg. `speechToTextYandex()` через axios POST. | Путь к ffmpeg жестко закодирован: `path.join(__dirname, '..', 'ffmpeg', 'bin', 'ffmpeg.exe')` -- **только Windows!** Не будет работать на Linux/Mac/Docker. Ошибки STT молча проглатываются (return ""). |
| `services/noteService.js` | 34 | CRUD для заметок. `createNote`, `getPendingNotes`, `markNotesCompleted`. | Нет валидации входных данных. Нет проверки существования заметки перед обновлением. Нет привязки к пользователю. |
| `services/morningDigest.js` | 84 | Утренний дайджест в 08:00 (node-schedule cron). Собирает события и невыполненные заметки за день, отправляет в `BOSS_CHAT_ID`. | **CRITICAL:** Создает **ВТОРОЙ экземпляр TelegramBot** (строка 11: `new TelegramBot(telegramToken, { polling: false })`). Хотя polling отключен, это создает лишнее подключение и потенциальный конфликт. Дайджест берет события из **локальной базы** (models.Event), а не из Google Calendar -- данные могут расходиться. Timezone для начала/конца дня использует **локальный серверный** часовой пояс (new Date()), а не Asia/Dubai. |

### Роуты (`routes/`)

| Файл | Строки | Описание | Проблемы |
|---|---|---|---|
| `routes/gcalAuthRouter.js` | 82 | Google Calendar OAuth2 flow. GET `/api/gcal/auth` -- генерация URL авторизации. GET `/api/gcal/callback` -- обработка callback, получение токенов. | Refresh token **не сохраняется автоматически** в .env или БД. Токены просто возвращаются в JSON-ответе -- пользователь должен вручную скопировать их в .env. Нет middleware для защиты endpoints. |

### Утилиты (`utils/`)

| Файл | Строки | Описание | Проблемы |
|---|---|---|---|
| `utils/dateUtils.js` | 104 | Утилиты для работы с датами. `expectedDateForUserInput` (сегодня/завтра/послезавтра), `correctYear`, `isValidDateTime`, `formatLocalDate`, `computeEndDateTime` (+1 час), `extractEndTime`, `getLocalDateTime`, `nextDay`. | Timezone `"Asia/Dubai"` жестко закодирован в `getLocalDateTime()` (строка 96). `computeEndDateTime` определена, но **не используется** нигде в проекте. `expectedDateForUserInput` поддерживает только 3 слова (сегодня, завтра, послезавтра) -- нет поддержки дат типа "в понедельник", "через неделю", "25 февраля". `nextDay` использует UTC (`toISOString()`), что может дать неверный результат вблизи полуночи. |

### Прочие файлы

| Файл | Описание |
|---|---|
| `testChat.js` | Тестовый файл (не задокументирован в package.json scripts) |
| `testGoogleCalendar.js` | Тестовый файл для Google Calendar |
| `testYandexSpeech.js` | Тестовый файл для Yandex Speech |
| `ffmpeg/` | Директория с бинарниками ffmpeg (Windows) |
| `docs/` | Директория с документацией |
| `node_modules/` | Зависимости (не в .gitignore явно, но генерируется npm install) |

---

## Текущий flow обработки сообщений

```
Пользователь (Telegram)
    |
    v
TelegramBot.js (bot.on 'message')
    |--- msg.voice --> yandexSpeech.convertOggToWav() --> speechToTextYandex() --> текст
    |                       |
    |                       v
    |               bot.sendMessage("Распознанный текст: ...")
    |                       |
    |                       v
    +--- msg.text --> добавляет в chatHistories[chatId] (в памяти!)
            |
            v
    chatgptHandler.processChatMessage()
    (OpenAI GPT-4-0613, системный промпт + последние 10 сообщений)
    (function calling: createMeeting определена, но не обрабатывается отдельно)
            |
            v
    handleGPTResponse() -- парсит JSON из ответа GPT
        |--- type: "event"
        |       |--- action: "create" --> googleCalendarService.createEvent()
        |       |                         + models.Event.create() (локальная БД)
        |       |--- action: "update" --> googleCalendarService.updateEvent()
        |       +--- action: "delete" --> googleCalendarService.deleteEvent()
        |
        |--- type: "show_events" --> googleCalendarService.getEventsForPeriod()
        |                           (сырой fetch + статический GOOGLE_ACCESS_TOKEN!)
        |
        |--- type: "note"
        |       |--- action: "create" --> noteService.createNote()
        |       |--- action: "show"   --> models.Note.findAll()
        |       +--- action: "complete" --> noteService.markNotesCompleted()
        |
        |--- type: "task" --> "Создание задачи ещё не реализовано."
        |
        +--- type: "chat" --> текстовый ответ (parsed.text)
            |
            v
    bot.sendMessage(chatId, textToSend)


Ежедневно 08:00 (node-schedule cron):
    morningDigest.js
        |
        +--> models.Event.findAll() (события из ЛОКАЛЬНОЙ базы за сегодня)
        +--> models.Note.findAll()  (невыполненные заметки)
        |
        v
    Формирует текст дайджеста
        |
        v
    bot.sendMessage(BOSS_CHAT_ID, digestMessage)
    (ВТОРОЙ экземпляр TelegramBot, polling: false)
```

### Важные детали flow:

1. **Двойная обработка голосовых:** Сначала отправляется "Распознанный текст: ...", затем результат GPT -- пользователь получает 2 сообщения на каждое голосовое.
2. **Sliding window:** Только последние 10 сообщений отправляются в GPT (`chatHistories[chatId].slice(-10)`), но весь массив `chatHistories[chatId]` растет бесконечно.
3. **JSON-парсинг:** GPT может вернуть ответ как в `function_call.arguments`, так и в `reply.content` -- код пытается парсить оба варианта.
4. **Нет retry логики:** При ошибке OpenAI/Google Calendar -- одна попытка, затем сообщение об ошибке.
5. **Нет rate limiting:** Любой пользователь может отправлять неограниченное количество сообщений.

---

## Таблица критических проблем

| # | Проблема | Severity | Файл:Строка | Описание | Приоритет |
|---|---|---|---|---|---|
| 1 | .env содержит реальные API ключи | **CRITICAL** | `.env` | Все секреты (Telegram, OpenAI, Google, Yandex API ключи) хранятся в .env. При случайном коммите -- полная компрометация. `.gitignore` содержит только `.env`, но нет `node_modules/`, что означает .gitignore создавался вручную и может быть забыт при пересоздании репозитория. | **P0** |
| 2 | Пароли хранятся в plain text | **CRITICAL** | `models/user.js:7` | Поле `password` -- обычный `STRING(255)` без хеширования (bcrypt/argon2). При утечке БД все пароли скомпрометированы. `POST /api/users` принимает пароль и сохраняет как есть. | **P0** |
| 3 | API endpoints без аутентификации | **CRITICAL** | `index.js:45-69` | `GET /api/users` возвращает список пользователей, `POST /api/users` создает пользователей -- без какой-либо аутентификации или авторизации. Любой может создать пользователя с ролью 'admin'. | **P0** |
| 4 | `models` не импортирован в index.js | **CRITICAL** | `index.js:47,63` | Endpoints `/api/users` используют `models.User.findAll()` и `models.User.create()`, но переменная `models` нигде не объявлена и не импортирована в `index.js`. Оба endpoints **полностью сломаны** -- при обращении падают с `ReferenceError: models is not defined`. | **P0** |
| 5 | morningDigest создает 2-й экземпляр бота | **CRITICAL** | `services/morningDigest.js:11` | `const bot = new TelegramBot(telegramToken, { polling: false })` -- создается второй экземпляр бота. Хотя polling отключен, это лишний объект. Правильное решение: импортировать бот из `telegramBot.js` или вынести в общий модуль. Может вызывать проблемы при масштабировании (лишние подключения к Telegram API). | **P0** |
| 6 | chatHistories в памяти -- memory leak | **HIGH** | `services/telegramBot.js:29` | `const chatHistories = {}` -- объект растет бесконечно. Ключи (chatId) добавляются при каждом новом пользователе и НИКОГДА не удаляются. Каждое сообщение добавляется в массив. При 1000 пользователей по 100 сообщений = ~100K объектов в памяти. При перезагрузке -- вся история теряется. | **P1** |
| 7 | getEventsForPeriod использует статический access_token | **HIGH** | `services/googleCalendarService.js:83-99` | `getEventsForPeriod()` использует `process.env.GOOGLE_ACCESS_TOKEN` через raw fetch, в то время как `createEvent`/`updateEvent`/`deleteEvent` используют OAuth2 с refresh token. Access token **истекает через 1 час**. После этого просмотр событий перестает работать, пока не обновить токен вручную в .env. | **P1** |
| 8 | sequelize.sync() вызывается ДВАЖДЫ | **HIGH** | `models/index.js:68`, `index.js:33` | Синхронизация БД происходит два раза при запуске: сначала в `models/index.js` (при импорте), затем в `index.js`. Это может привести к race conditions, лишним запросам к БД и непредсказуемому поведению при параллельном выполнении. | **P1** |
| 9 | Note не привязана к пользователю | **HIGH** | `models/note.js` | Модель `Note` не содержит поля `user_id`. Все заметки глобальные -- в многопользовательском режиме любой пользователь видит, редактирует и завершает заметки всех остальных. Критично для коммерческого продукта. | **P1** |
| 10 | Hardcoded timezone "Asia/Dubai" | **HIGH** | `telegramBot.js:102,103,208,209`, `dateUtils.js:96`, `models/index.js:19` | Часовой пояс `"Asia/Dubai"` (UTC+4) жестко закодирован минимум в 5 местах. Невозможно использовать бот в другом часовом поясе без изменения кода. Должен быть вынесен в переменную окружения. | **P1** |
| 11 | Нет graceful shutdown | **HIGH** | `index.js` | Нет обработки сигналов `SIGTERM`/`SIGINT`. При остановке процесса: Telegram polling не останавливается корректно, Sequelize соединение не закрывается, scheduled jobs не отменяются. Может привести к потере данных и зависшим соединениям. | **P1** |
| 12 | Нет обработки polling_error | **MEDIUM** | `services/telegramBot.js` | Отсутствует `bot.on('polling_error', ...)`. При сетевых проблемах или невалидном токене ошибки не логируются и не обрабатываются. Бот может молча перестать работать. | **P2** |
| 13 | nodemon в dependencies | **MEDIUM** | `package.json:25` | `nodemon` (dev-инструмент для hot reload) находится в `dependencies` вместо `devDependencies`. Устанавливается в production окружении, увеличивая размер `node_modules` и время деплоя. | **P2** |
| 14 | body-parser не нужен | **MEDIUM** | `index.js:2,20-21` | `body-parser` импортирован и используется: `bodyParser.json()`, `bodyParser.urlencoded()`. Начиная с Express 4.16+ это встроено: `express.json()`, `express.urlencoded()`. Лишняя зависимость. | **P2** |
| 15 | Winston не экспортируется | **MEDIUM** | `index.js:24-27` | `logger` создан через Winston в `index.js`, но не экспортируется. Во всех остальных файлах используется `console.log` / `console.error`. Winston фактически бесполезен -- логирует только в `index.js`. Нет файлового транспорта, нет структурированных логов. | **P2** |
| 16 | 33% chatgptHandler.js закомментировано | **MEDIUM** | `services/chatgptHandler.js:14-49` | 49 из 147 строк -- закомментированные старые версии системного промпта (две предыдущие итерации). Засоряет код, затрудняет чтение. `API_URL` на строке 1 определена но не используется. | **P2** |
| 17 | ffmpeg path жестко закодирован (Windows only) | **MEDIUM** | `services/yandexSpeechService.js:15` | `path.join(__dirname, '..', 'ffmpeg', 'bin', 'ffmpeg.exe')` -- указывает на `.exe` файл. Не работает на Linux, Mac, Docker. Делает деплой на сервер невозможным без модификации кода. | **P2** |
| 18 | .gitignore минимальный | **MEDIUM** | `.gitignore` | Содержит только одну строку: `.env`. Отсутствуют стандартные исключения: `node_modules/`, `*.log`, `.DS_Store`, `dist/`, `coverage/`, `ffmpeg/`, `*.env.local`, `.env.*`, `nul` (файл `nul` уже существует в корне проекта -- артефакт Windows). | **P3** |

---

## Что работает

Следующий функционал протестирован и работает (при условии валидных API ключей):

1. **Обработка текстовых сообщений через GPT-4** -- пользователь пишет в Telegram, GPT-4 анализирует намерение и возвращает структурированный JSON-ответ.

2. **Создание событий в Google Calendar** -- бот парсит дату/время из текста, создает событие через googleapis SDK, сохраняет копию в локальную БД.

3. **Обновление событий в Google Calendar** -- по ID или по названию, через `updateEvent()`.

4. **Удаление событий из Google Calendar** -- по ID, через `deleteEvent()`.

5. **Просмотр событий за день** -- через `getEventsForPeriod()` (но зависит от статического access token -- работает только первый час после обновления токена).

6. **Распознавание голосовых сообщений** -- OGG загружается из Telegram, конвертируется в WAV через ffmpeg, отправляется в Yandex SpeechKit STT.

7. **Заметки (CRUD):**
   - Создание заметки (`note` + `action: create`)
   - Просмотр заметок (`note` + `action: show`, фильтр: pending/completed/all)
   - Завершение заметок (`note` + `action: complete`, по ID или по содержимому)

8. **Утренний дайджест** -- ежедневно в 08:00 отправляет BOSS_CHAT_ID сводку событий и невыполненных заметок.

9. **Health check endpoint** -- `GET /api/health` возвращает `{ status: "OK", timestamp: ... }`.

10. **Google Calendar OAuth flow** -- `GET /api/gcal/auth` генерирует URL авторизации, `GET /api/gcal/callback` получает токены.

---

## Что НЕ работает / сломано

1. **API endpoints `/api/users`** -- полностью сломаны. `models` не импортирован в `index.js`. При обращении к `GET /api/users` или `POST /api/users` -- `ReferenceError: models is not defined`. Возвращает 500 Internal Server Error.

2. **Task функционал** -- модель `Task` определена, ассоциации настроены, но в `handleGPTResponse()` тип `"task"` возвращает заглушку: `"Создание задачи ещё не реализовано."`.

3. **Автоматическая регенерация Google Access Token** -- `getEventsForPeriod()` использует статический `GOOGLE_ACCESS_TOKEN` из `.env`. Токен истекает через 1 час. После этого просмотр событий перестает работать. Нет механизма автоматического обновления.

4. **Запоминание сессий при перезагрузке** -- `chatHistories` хранится в памяти (`const chatHistories = {}`). При перезагрузке бота вся история диалогов теряется. Модели `Session` и `Message` существуют для этого, но **не используются**.

5. **Session и Message модели** -- определены в `models/`, настроены ассоциации (Session.belongsTo User, Message.belongsTo Session), но нигде в коде бота не вызываются. `Summary` модель тоже не используется.

6. **Автоматическое сохранение refresh token** -- при OAuth callback (`/api/gcal/callback`) токены возвращаются в JSON-ответе, но **не сохраняются** ни в БД, ни в `.env`. Пользователь должен вручную скопировать `refresh_token` и обновить `.env`.

7. **Обработка ошибок polling** -- нет `bot.on('polling_error', ...)`. При проблемах с сетью или невалидном токене бот может молча перестать получать сообщения.

8. **Функция `createMeeting` (function calling)** -- определена в массиве `functions` в `chatgptHandler.js`, но результат function calling обрабатывается обобщенно через `reply.function_call.arguments` -- имя функции (`createMeeting`) нигде не проверяется. Функция фактически бесполезна.

9. **Логирование** -- Winston настроен только в `index.js` с console transport, не экспортируется. Все остальные файлы используют `console.log`/`console.error`. Нет файлового логирования, нет уровней, нет структурированных логов.

---

## Зависимости (package.json)

Всего **14 зависимостей** (13 перечислены в JSON + 1 неявная):

| # | Пакет | Версия | Назначение | Используется в | Примечания |
|---|---|---|---|---|---|
| 1 | `axios` | ^1.7.9 | HTTP-клиент | `yandexSpeechService.js` | Используется только для Yandex STT. Для OpenAI и Google Calendar используется встроенный `fetch`. Можно заменить на `fetch` и убрать зависимость. |
| 2 | `body-parser` | ^1.20.3 | Парсинг JSON и URL-encoded тел запросов | `index.js` | **Не нужен** -- Express 4.16+ имеет встроенные `express.json()` и `express.urlencoded()`. Лишняя зависимость. |
| 3 | `dotenv` | ^16.4.7 | Загрузка переменных окружения из `.env` | `index.js`, `models/index.js`, `services/googleCalendarService.js`, `services/yandexSpeechService.js`, `services/morningDigest.js`, `routes/gcalAuthRouter.js` | `dotenv.config()` вызывается в **6 файлах** -- избыточно. Достаточно вызвать один раз в точке входа. |
| 4 | `express` | ^4.21.2 | Веб-фреймворк | `index.js`, `routes/gcalAuthRouter.js` | Используется для health check, OAuth callback и API endpoints. |
| 5 | `fluent-ffmpeg` | ^2.1.3 | Node.js обертка над ffmpeg | `services/yandexSpeechService.js` | Конвертация OGG в WAV. Требует бинарник ffmpeg. |
| 6 | `googleapis` | ^144.0.0 | Официальный Google API клиент | `services/googleCalendarService.js`, `routes/gcalAuthRouter.js` | Используется для Calendar API (create/update/delete) и OAuth2 flow. getEventsForPeriod использует raw fetch вместо этого SDK. |
| 7 | `moment-timezone` | ^0.5.47 | Работа с часовыми поясами | `utils/dateUtils.js` | Используется только в одной функции `getLocalDateTime()`. Тяжелая зависимость (~4MB). Можно заменить на `Intl.DateTimeFormat` или `date-fns-tz`. |
| 8 | `node-schedule` | ^2.1.1 | Cron-подобный планировщик задач | `services/morningDigest.js` | Запуск утреннего дайджеста в 08:00. |
| 9 | `node-telegram-bot-api` | ^0.66.0 | Telegram Bot API обертка | `services/telegramBot.js`, `services/morningDigest.js` | Инстанцирован **дважды** -- в telegramBot.js (polling: true) и morningDigest.js (polling: false). |
| 10 | `nodemon` | ^3.1.9 | Auto-restart при изменении файлов (dev tool) | `package.json scripts.dev` | **Должен быть в devDependencies**, а не в dependencies. Устанавливается в production. |
| 11 | `pg` | ^8.13.2 | PostgreSQL драйвер для Node.js | Используется Sequelize внутренне | Необходим для работы Sequelize с PostgreSQL. |
| 12 | `pg-hstore` | ^2.3.4 | Сериализация/десериализация hstore для PostgreSQL | Используется Sequelize внутренне | Необходим для работы с JSONB полями (Message.function_call). |
| 13 | `sequelize` | ^6.37.5 | ORM для SQL баз данных | `models/index.js`, все модели, все сервисы | Основной ORM. Версия 6.x (актуальная -- 6.37.x). |
| 14 | `winston` | ^3.17.0 | Библиотека логирования | `index.js` | **Фактически не используется** -- настроен только в index.js, не экспортируется. Все файлы используют console.log. |

### Отсутствующие зависимости (необходимы для продакшна):

- `bcrypt` / `argon2` -- хеширование паролей
- `helmet` -- безопасность HTTP заголовков
- `cors` -- CORS middleware
- `express-rate-limit` -- ограничение запросов
- `jsonwebtoken` -- аутентификация JWT
- `jest` / `mocha` / `vitest` -- тестирование (devDependency)

---

## Статистика кодовой базы

| Метрика | Значение |
|---|---|
| Общее количество JS файлов | 16 (включая тесты) |
| Общее количество строк кода | ~1,330 |
| Закомментированный код | ~49 строк (chatgptHandler.js) |
| Модели | 8 определено, 5 используются (User только в сломанных endpoints) |
| Сервисы | 5 |
| Роуты | 1 (gcalAuthRouter) |
| Тесты | 0 (три тестовых файла -- не фреймворк, ручные скрипты) |
| Покрытие тестами | 0% |

---

## Резюме

Secretary Bot -- работающий прототип AI-секретаря в Telegram с базовым функционалом управления событиями, заметками и распознаванием голосовых сообщений. Проект находится на стадии MVP и имеет **5 критических проблем** (P0), которые необходимо исправить перед любым масштабированием:

1. Сломанные API endpoints (models не импортирован)
2. Пароли в plain text
3. Отсутствие аутентификации на API
4. Утечка памяти в chatHistories
5. Двойной экземпляр бота в morningDigest

Из 8 определенных моделей **3 не используются** (Session, Message, Summary), функционал задач не реализован, а 33% кода обработчика GPT закомментировано. Проект привязан к Windows (ffmpeg.exe) и часовому поясу Asia/Dubai.

Несмотря на проблемы, **ядро работает**: GPT-4 корректно распознает намерения, события создаются в Google Calendar, голосовые сообщения распознаются. Это хорошая основа для рефакторинга и масштабирования.
