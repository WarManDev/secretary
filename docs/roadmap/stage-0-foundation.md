# Stage 0: Фундамент проекта

> **Срок:** 1-2 дня
> **Зависимости:** нет (первый этап)
> **Цель:** Привести проект в профессиональное состояние перед началом любой работы над фичами.
>
> Этот этап НЕ меняет функциональность бота. После его завершения бот работает
> точно так же, как раньше, но кодовая база готова к масштабированию.

---

## Оглавление

1. [Реструктуризация файлов](#1-реструктуризация-файлов)
2. [ESLint + Prettier](#2-eslint--prettier)
3. [.gitignore](#3-gitignore)
4. [.env.example + валидация конфигурации](#4-envexample--валидация-конфигурации)
5. [Winston singleton](#5-winston-singleton)
6. [Удаление body-parser](#6-удаление-body-parser)
7. [Исправление nodemon](#7-исправление-nodemon)
8. [Исправление двойного sequelize.sync()](#8-исправление-двойного-sequelizesync)
9. [Graceful shutdown](#9-graceful-shutdown)
10. [Чеклист готовности](#10-чеклист-готовности)

---

## 1. Реструктуризация файлов

### Зачем

Сейчас все файлы лежат в корне проекта: `index.js`, `models/`, `services/`, `routes/`,
`utils/`. Это затрудняет навигацию, усложняет настройку ESLint/тестов и не соответствует
стандартам Node.js проектов. Целевая архитектура требует `src/` директорию.

### Текущая структура (до)

```
secretary/
├── index.js                    # Точка входа + Express + Winston + endpoints
├── models/
│   ├── index.js                # Sequelize init + sync + ассоциации
│   ├── user.js
│   ├── employee.js
│   ├── event.js
│   ├── task.js
│   ├── note.js
│   ├── session.js
│   ├── message.js
│   └── summary.js
├── services/
│   ├── telegramBot.js
│   ├── chatgptHandler.js
│   ├── googleCalendarService.js
│   ├── yandexSpeechService.js
│   ├── noteService.js
│   └── morningDigest.js
├── routes/
│   └── gcalAuthRouter.js
├── utils/
│   └── dateUtils.js
├── ffmpeg/                     # Бинарники (Windows)
├── testChat.js
├── testGoogleCalendar.js
├── testYandexSpeech.js
├── package.json
├── docker-compose-local.yml
├── .env
└── .gitignore
```

### Целевая структура (после Stage 0)

```
secretary/
├── src/
│   ├── config/
│   │   ├── index.js            # Централизованная конфигурация (zod)
│   │   └── logger.js           # Winston singleton
│   │
│   ├── models/
│   │   ├── index.js            # Sequelize init + ассоциации (БЕЗ sync)
│   │   ├── user.js
│   │   ├── employee.js
│   │   ├── event.js
│   │   ├── task.js
│   │   ├── note.js
│   │   ├── session.js
│   │   ├── message.js
│   │   └── summary.js
│   │
│   ├── services/
│   │   ├── telegramBot.js
│   │   ├── chatgptHandler.js
│   │   ├── googleCalendarService.js
│   │   ├── yandexSpeechService.js
│   │   ├── noteService.js
│   │   └── morningDigest.js
│   │
│   ├── routes/
│   │   └── gcalAuthRouter.js
│   │
│   ├── middleware/              # Пустая директория, подготовка
│   │   └── .gitkeep
│   │
│   ├── utils/
│   │   └── dateUtils.js
│   │
│   ├── app.js                  # Express setup (middleware + routes)
│   └── server.js               # Точка входа (запуск сервера + graceful shutdown)
│
├── tests/                      # Тестовые скрипты (перенесены)
│   ├── testChat.js
│   ├── testGoogleCalendar.js
│   └── testYandexSpeech.js
│
├── ffmpeg/                     # Бинарники (Windows) -- оставляем в корне
├── docker-compose-local.yml
├── .env
├── .env.example                # НОВЫЙ
├── .gitignore                  # ОБНОВЛЕННЫЙ
├── .eslintrc.json              # НОВЫЙ
├── .prettierrc                 # НОВЫЙ
└── package.json                # ОБНОВЛЕННЫЙ
```

### Порядок действий

#### 1.1. Создать директории

```bash
mkdir -p src/config src/models src/services src/routes src/middleware src/utils tests
```

На Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force -Path src/config, src/models, src/services, src/routes, src/middleware, src/utils, tests
```

#### 1.2. Переместить файлы

```bash
# Модели
mv models/*.js src/models/

# Сервисы
mv services/*.js src/services/

# Роуты
mv routes/*.js src/routes/

# Утилиты
mv utils/*.js src/utils/

# Тесты
mv testChat.js testGoogleCalendar.js testYandexSpeech.js tests/

# .gitkeep для пустых директорий
touch src/middleware/.gitkeep
```

На Windows (PowerShell):

```powershell
Move-Item models\*.js src\models\
Move-Item services\*.js src\services\
Move-Item routes\*.js src\routes\
Move-Item utils\*.js src\utils\
Move-Item testChat.js, testGoogleCalendar.js, testYandexSpeech.js tests\
New-Item src\middleware\.gitkeep -ItemType File
```

#### 1.3. Удалить старые пустые директории

```bash
rmdir models services routes utils
```

#### 1.4. Разделить index.js на app.js и server.js

Текущий `index.js` содержит: Express setup, Winston, Sequelize подключение, API endpoints
и запуск сервера -- все в одном файле. Разделяем на два:

**Файл: `src/app.js`** -- Express приложение (middleware + routes):

```js
import express from 'express';
import gcalAuthRouter from './routes/gcalAuthRouter.js';
import logger from './config/logger.js';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/gcal', gcalAuthRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Временные endpoints /api/users -- будут переписаны в Stage 2+
// Сейчас они сломаны (models не импортирован), поэтому отключаем до рефакторинга
// TODO: Реализовать через controllers + auth middleware

export default app;
```

**Файл: `src/server.js`** -- точка входа (запуск + shutdown):

```js
import './config/index.js'; // Загрузка и валидация конфигурации (первый импорт!)
import app from './app.js';
import { sequelize } from './models/index.js';
import logger from './config/logger.js';

// Импорт сайд-эффектов (запуск бота и дайджеста)
import './services/telegramBot.js';
import './services/morningDigest.js';

const port = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    logger.info('Sequelize: Подключение к БД успешно установлено.');

    // Синхронизация моделей (единственное место!)
    // TODO: Stage 1 -- заменить на миграции
    await sequelize.sync();
    logger.info('Sequelize: Модели синхронизированы.');

    const server = app.listen(port, () => {
      logger.info(`Сервер запущен на порту ${port}`);
    });

    // Graceful shutdown -- см. раздел 9
    setupGracefulShutdown(server);
  } catch (error) {
    logger.error('Ошибка запуска сервера:', error);
    process.exit(1);
  }
}

function setupGracefulShutdown(server) {
  // Реализация в разделе 9
}

start();
```

#### 1.5. Обновить все пути импортов

После переноса файлов в `src/` необходимо обновить **относительные** пути импортов.

**`src/models/index.js`:**
Пути внутри `models/` не меняются, так как файлы остались в одной директории друг
относительно друга. Единственное изменение -- убрать `sequelize.sync()` (см. раздел 8).

**`src/services/telegramBot.js`:**
```js
// БЫЛО:
import models from '../models/index.js';
import { expectedDateForUserInput, ... } from '../utils/dateUtils.js';
import { createNote, ... } from './noteService.js';

// СТАЛО (пути НЕ меняются -- относительные пути внутри src/ те же):
import models from '../models/index.js';        // src/services -> src/models -- OK
import { expectedDateForUserInput, ... } from '../utils/dateUtils.js';  // OK
import { createNote, ... } from './noteService.js';  // OK
```

Поскольку все файлы перемещены **вместе с сохранением структуры директорий**
внутрь `src/`, относительные пути между ними (`../models/`, `./noteService.js`,
`../utils/`) остаются корректными.

Что нужно обновить:

| Файл | Что менять |
|---|---|
| `src/services/yandexSpeechService.js` | Путь к ffmpeg: `path.join(__dirname, '..', '..', 'ffmpeg', 'bin', 'ffmpeg.exe')` -- добавить один уровень `..`, т.к. теперь файл на уровень глубже |
| `src/app.js` | Новый файл -- импорты уже указаны правильно |
| `src/server.js` | Новый файл -- импорты уже указаны правильно |

**`src/services/yandexSpeechService.js`** -- исправление пути ffmpeg:

```js
// БЫЛО (из корня проекта):
const ffmpegPath = path.join(__dirname, '..', 'ffmpeg', 'bin', 'ffmpeg.exe');

// СТАЛО (из src/services/):
const ffmpegPath = path.join(__dirname, '..', '..', 'ffmpeg', 'bin', 'ffmpeg.exe');
```

#### 1.6. Обновить package.json

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
```

#### 1.7. Удалить старый index.js

После создания `src/app.js` и `src/server.js`, удалить `index.js` из корня.

### Проверка

- `npm run dev` -- бот запускается без ошибок
- Telegram бот отвечает на сообщения
- `GET /api/health` возвращает `{ status: "OK" }`
- Утренний дайджест планируется (проверить логи)

---

## 2. ESLint + Prettier

### Зачем

В проекте нет линтера. Код содержит: неиспользуемые переменные (`API_URL` в
`chatgptHandler.js`), непоследовательное форматирование, отсутствие строгих правил.
ESLint ловит баги, Prettier унифицирует стиль.

### Установка

```bash
npm install --save-dev eslint prettier eslint-config-prettier eslint-plugin-prettier
```

### Файл: `.eslintrc.json` (корень проекта)

```json
{
  "env": {
    "node": true,
    "es2022": true
  },
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "extends": [
    "eslint:recommended",
    "prettier"
  ],
  "plugins": ["prettier"],
  "rules": {
    "prettier/prettier": "warn",
    "no-unused-vars": ["warn", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_"
    }],
    "no-console": "off",
    "no-constant-condition": "warn",
    "no-debugger": "error",
    "prefer-const": "warn",
    "no-var": "error",
    "eqeqeq": ["error", "always"],
    "curly": ["warn", "multi-line"],
    "no-throw-literal": "error",
    "no-return-await": "warn",
    "require-await": "warn"
  },
  "ignorePatterns": [
    "node_modules/",
    "ffmpeg/",
    "dist/",
    "coverage/",
    "tests/"
  ]
}
```

### Файл: `.prettierrc` (корень проекта)

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "es5",
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "auto"
}
```

### Файл: `.prettierignore` (корень проекта)

```
node_modules/
ffmpeg/
dist/
coverage/
*.md
```

### npm-скрипты

Добавить в `package.json` → `scripts`:

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
```

### Типичные проблемы, которые линтер найдет в текущем коде

| Проблема | Файл | Правило ESLint |
|---|---|---|
| `API_URL` объявлен, но не используется | `src/services/chatgptHandler.js:1` | `no-unused-vars` |
| `computeEndDateTime` определена, но нигде не вызывается | `src/utils/dateUtils.js:60` | Не баг, но при будущей проверке |
| `console.log` повсюду (49 вызовов) | Все сервисы | `no-console` (выключен, заменим в разделе 5) |
| Неконсистентные кавычки (двойные/одинарные) | Везде | `prettier/prettier` |
| `== null` вместо `=== null` | Возможны | `eqeqeq` |

### Первый запуск

```bash
npm run lint          # Посмотреть все проблемы
npm run lint:fix      # Автоматически исправить что можно
npm run format        # Форматирование Prettier
```

**Важно:** после `lint:fix` и `format` проверить, что бот по-прежнему работает.

### Проверка

- `npm run lint` завершается без ошибок (warnings допустимы на этом этапе)
- `npm run format` не ломает код
- Бот работает после форматирования

---

## 3. .gitignore

### Зачем

Текущий `.gitignore` содержит единственную строку: `.env`. Это означает, что
`node_modules/`, логи, бинарники ffmpeg и артефакты Windows могут попасть в
репозиторий.

### Файл: `.gitignore` (полная замена)

```gitignore
# Dependencies
node_modules/
package-lock.json

# Environment
.env
.env.*
!.env.example

# Logs
logs/
*.log
npm-debug.log*

# FFmpeg binaries
ffmpeg/

# Build output
dist/
build/

# Test coverage
coverage/
.nyc_output/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db
nul
desktop.ini

# Archives
*.tgz
*.tar.gz

# Temporary files
tmp/
temp/
*.tmp
```

### Удалить файл `nul`

В корне проекта существует файл `nul` -- артефакт Windows. Удалить его:

```powershell
# Windows PowerShell
Remove-Item -Force nul
```

### Проверка

- `git status` не показывает `node_modules/`, `ffmpeg/`, `nul` и другие артефакты
- `.env.example` НЕ игнорируется (есть исключение `!.env.example`)

---

## 4. .env.example + валидация конфигурации

### Зачем

Сейчас `dotenv.config()` вызывается в **6 разных файлах** (`index.js`,
`models/index.js`, `googleCalendarService.js`, `yandexSpeechService.js`,
`morningDigest.js`, `gcalAuthRouter.js`). Если хотя бы одна переменная не задана,
приложение запускается, но падает при первом обращении к этой переменной. Нужно:

1. Загружать `.env` **один раз** в точке входа.
2. Валидировать **все** переменные при старте.
3. Если обязательная переменная отсутствует -- **не запускать** приложение.

### Установка zod

```bash
npm install zod
```

### Файл: `.env.example` (корень проекта)

```env
# ============================================================
# Secretary Bot -- Environment Variables
# ============================================================
# Скопируйте этот файл в .env и заполните реальными значениями:
#   cp .env.example .env
# ============================================================

# ------ Основные ------
NODE_ENV=development
PORT=3000

# ------ База данных ------
DATABASE_URL=postgresql://user:password@localhost:5432/secretary

# ------ Telegram ------
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
BOSS_CHAT_ID=your_boss_chat_id

# ------ AI: OpenAI (legacy, будет заменен на Claude) ------
OPENAI_API_KEY=your_openai_api_key

# ------ AI: Anthropic Claude (будущее) ------
# ANTHROPIC_API_KEY=your_anthropic_api_key

# ------ Google Calendar OAuth2 ------
GCAL_CLIENT_ID=your_google_client_id
GCAL_CLIENT_SECRET=your_google_client_secret
GCAL_REFRESH_TOKEN=your_google_refresh_token
GOOGLE_ACCESS_TOKEN=your_google_access_token
# GCAL_REDIRECT_URI=http://localhost:3000/api/gcal/callback

# ------ Yandex SpeechKit ------
YANDEX_API_KEY=your_yandex_api_key

# ------ Безопасность (будущее) ------
# TOKEN_ENCRYPTION_KEY=your_32_byte_hex_key
# JWT_SECRET=your_jwt_secret
```

### Файл: `src/config/index.js`

```js
import dotenv from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import path from 'path';

// Определяем путь к .env (в корне проекта, на два уровня выше src/config/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '..', '.env');

// Загружаем .env ОДИН РАЗ
dotenv.config({ path: envPath });

// Схема валидации переменных окружения
const envSchema = z.object({
  // Основные
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .default('3000'),

  // База данных
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL обязательна')
    .url('DATABASE_URL должна быть валидным URL'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1, 'TELEGRAM_BOT_TOKEN обязателен'),
  BOSS_CHAT_ID: z
    .string()
    .min(1, 'BOSS_CHAT_ID обязателен'),

  // AI: OpenAI (legacy)
  OPENAI_API_KEY: z
    .string()
    .min(1, 'OPENAI_API_KEY обязателен')
    .optional(),

  // AI: Anthropic (будущее)
  ANTHROPIC_API_KEY: z
    .string()
    .min(1)
    .optional(),

  // Google Calendar
  GCAL_CLIENT_ID: z
    .string()
    .min(1)
    .optional(),
  GCAL_CLIENT_SECRET: z
    .string()
    .min(1)
    .optional(),
  GCAL_REFRESH_TOKEN: z
    .string()
    .min(1)
    .optional(),
  GOOGLE_ACCESS_TOKEN: z
    .string()
    .min(1)
    .optional(),
  GCAL_REDIRECT_URI: z
    .string()
    .url()
    .optional(),

  // Yandex SpeechKit
  YANDEX_API_KEY: z
    .string()
    .min(1)
    .optional(),

  // Безопасность (будущее)
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .length(64, 'TOKEN_ENCRYPTION_KEY должен быть 32 байта (64 hex символа)')
    .optional(),
  JWT_SECRET: z
    .string()
    .min(32)
    .optional(),
});

// Валидация
const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('========================================');
  console.error('  ОШИБКА КОНФИГУРАЦИИ');
  console.error('  Приложение НЕ МОЖЕТ запуститься.');
  console.error('========================================');
  console.error('Проблемы:');

  result.error.issues.forEach((issue) => {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  });

  console.error('');
  console.error('Проверьте файл .env (пример: .env.example)');
  console.error('========================================');
  process.exit(1);
}

const config = result.data;

export default config;
```

### Удалить все лишние `dotenv.config()` из остальных файлов

Следующие файлы содержат `import dotenv from 'dotenv'` и `dotenv.config()`,
которые нужно **удалить**:

| Файл | Строки для удаления |
|---|---|
| `src/models/index.js` | Строки 10-12: `import dotenv` + `dotenv.config()` |
| `src/services/googleCalendarService.js` | Строки 2-4: `import dotenv` + `dotenv.config()` |
| `src/services/yandexSpeechService.js` | Строки 6-7: `import dotenv` + `dotenv.config()` |
| `src/services/morningDigest.js` | Строки 5-6: `import dotenv` + `dotenv.config()` |
| `src/routes/gcalAuthRouter.js` | Строки 3-5: `import dotenv` + `dotenv.config()` |

`dotenv` загружается один раз в `src/config/index.js`, который импортируется
первым в `src/server.js`. Все последующие `process.env.X` обращения работают
корректно.

### Проверка

- Удалить (или переименовать) `.env` -> попробовать запуститься -> приложение должно
  упасть с понятным сообщением об ошибке
- Вернуть `.env` на место -> `npm run dev` -> всё работает
- Поставить `DATABASE_URL=invalid` -> приложение должно упасть

---

## 5. Winston singleton

### Зачем

Сейчас Winston настроен в `index.js` (строки 24-27), но:
1. Не экспортируется -- другие файлы не могут его использовать.
2. Только console transport без цветов и уровней.
3. Все остальные файлы используют `console.log` / `console.error`.

### Файл: `src/config/logger.js`

```js
import winston from 'winston';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Формат для development (человекочитаемый)
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (stack) msg += `\n${stack}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Формат для production (JSON для парсинга)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const isDev = process.env.NODE_ENV !== 'production';

const transports = [
  // Console -- всегда
  new winston.transports.Console({
    format: isDev ? devFormat : prodFormat,
  }),
];

// File транспорт -- только в production
if (!isDev) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,  // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,  // 10 MB
      maxFiles: 14,               // ~14 дней при 1 файле в день
      tailable: true,
    })
  );
}

const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  transports,
  // Не падать при ошибке логирования
  exitOnError: false,
});

export default logger;
```

### Создать директорию для логов

```bash
mkdir -p logs
echo "logs/" >> .gitignore   # Уже есть в нашем .gitignore
```

### Заменить все `console.log` / `console.error` на logger

Это большая, но механическая замена. В каждом файле внутри `src/`:

1. Добавить импорт в начало файла:
   ```js
   import logger from '../config/logger.js';
   ```
   (путь может отличаться в зависимости от расположения файла)

2. Заменить вызовы:
   ```js
   // БЫЛО:
   console.log("Событие создано:", event);
   console.error("Ошибка:", err);

   // СТАЛО:
   logger.info('Событие создано', { event });
   logger.error('Ошибка', { error: err.message, stack: err.stack });
   ```

**Таблица замен по файлам:**

| Файл | console.log | console.error | Путь импорта logger |
|---|---|---|---|
| `src/services/telegramBot.js` | 12 | 5 | `../config/logger.js` |
| `src/services/chatgptHandler.js` | 1 | 0 | `../config/logger.js` |
| `src/services/googleCalendarService.js` | 0 | 0 | -- (нет console вызовов) |
| `src/services/yandexSpeechService.js` | 2 | 2 | `../config/logger.js` |
| `src/services/noteService.js` | 0 | 0 | -- (нет console вызовов) |
| `src/services/morningDigest.js` | 1 | 1 | `../config/logger.js` |
| `src/models/index.js` | 0 | 1 | `../config/logger.js` |

**Примеры замен в `src/services/telegramBot.js`:**

```js
// БЫЛО (строка 375):
console.log(`Ваш chat_id: ${chatId}`);

// СТАЛО:
logger.debug('Входящее сообщение', { chatId });

// БЫЛО (строка 112):
console.log("Мероприятие обновлено:", updatedEvent);

// СТАЛО:
logger.info('Мероприятие обновлено', { eventId: updatedEvent.id, summary: updatedEvent.summary });

// БЫЛО (строка 248):
console.error("Ошибка при обработке запроса на создание события:", err);

// СТАЛО:
logger.error('Ошибка при создании события', { error: err.message, stack: err.stack });
```

### Удалить Winston из `src/app.js`

Winston больше не создается в app.js. Вместо этого импортируется singleton из
`src/config/logger.js`. Переменная `logger` из старого `index.js` (строки 24-27)
**удаляется**.

### Проверка

- `npm run dev` -- логи в консоли с цветами и временными метками
- При ошибке API -- видим `[error]` уровень с деталями
- При `NODE_ENV=production` -- логи пишутся в `logs/combined.log` и `logs/error.log`

---

## 6. Удаление body-parser

### Зачем

В `index.js` (ныне `src/app.js`) используется `body-parser`:

```js
import bodyParser from 'body-parser';
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
```

Начиная с Express 4.16+, body-parser встроен. Это лишняя зависимость.

### Действия

1. **В `src/app.js`** -- заменить (уже сделано в примере выше):

```js
// БЫЛО:
import bodyParser from 'body-parser';
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// СТАЛО:
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```

2. **Удалить пакет:**

```bash
npm uninstall body-parser
```

### Проверка

- `npm ls body-parser` -- пакет не установлен
- POST-запросы с JSON-телом по-прежнему работают (`/api/gcal/callback`)

---

## 7. Исправление nodemon

### Зачем

`nodemon` находится в `dependencies` вместо `devDependencies`. Это означает, что
он устанавливается в production-окружении, увеличивая размер `node_modules` и
время деплоя.

### Действия

```bash
npm uninstall nodemon
npm install --save-dev nodemon
```

### Проверка

Проверить `package.json`:

```json
{
  "dependencies": {
    // nodemon НЕ должен быть здесь
  },
  "devDependencies": {
    "nodemon": "^3.1.9"
    // ...
  }
}
```

- `npm run dev` -- nodemon работает, перезапускает при изменении файлов
- `npm start` -- запуск без nodemon

---

## 8. Исправление двойного sequelize.sync()

### Зачем

`sequelize.sync()` вызывается в двух местах:

1. `models/index.js` (строки 65-71) -- при импорте модуля
2. `index.js` (строка 33) -- при старте сервера

Это вызывает двойную синхронизацию при запуске, что приводит к лишним запросам к БД
и возможным race conditions.

### Действия

**`src/models/index.js`** -- убрать блок `try/catch` с `sequelize.authenticate()` и
`sequelize.sync()` (строки 64-71):

```js
// УДАЛИТЬ ЭТОТ БЛОК (строки 64-71 оригинального файла):
// try {
//   await sequelize.authenticate();
//   await sequelize.sync();
// } catch (error) {
//   console.error('Sequelize: Невозможно подключиться к базе данных:', error);
// }
```

Файл `src/models/index.js` после изменения должен заканчиваться так:

```js
// ... ассоциации ...

// Экспорт
export { sequelize };
export default models;
```

`sequelize.authenticate()` и `sequelize.sync()` вызываются **только** в
`src/server.js` -- единственном месте, контролирующем порядок инициализации.

### Также удалить `dotenv.config()` из `src/models/index.js`

Строки 10-12 в оригинальном `models/index.js`:

```js
// УДАЛИТЬ:
import dotenv from 'dotenv';
dotenv.config();
```

Конфигурация загружается один раз в `src/config/index.js`.

### Проверка

- `npm run dev` -- одно сообщение "Sequelize: Подключение успешно установлено"
  (раньше было два)
- Модели создаются корректно
- Нет ошибок race condition при запуске

---

## 9. Graceful shutdown

### Зачем

Текущий код не обрабатывает сигналы `SIGTERM`/`SIGINT`. При остановке процесса:
- Telegram polling не останавливается корректно
- Sequelize-соединение не закрывается
- Scheduled jobs (утренний дайджест) не отменяются
- Может привести к потере данных и зависшим соединениям

### Файл: `src/server.js` (полная версия с graceful shutdown)

```js
import './config/index.js';
import app from './app.js';
import { sequelize } from './models/index.js';
import logger from './config/logger.js';
import bot from './services/telegramBot.js';
import digestJob from './services/morningDigest.js';

const port = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT = 30_000; // 30 секунд

let server;

async function start() {
  try {
    // 1. Подключиться к БД
    await sequelize.authenticate();
    logger.info('Sequelize: Подключение к БД успешно.');

    // 2. Синхронизировать модели (TODO: Stage 1 -- заменить на миграции)
    await sequelize.sync();
    logger.info('Sequelize: Модели синхронизированы.');

    // 3. Запустить HTTP-сервер
    server = app.listen(port, () => {
      logger.info(`Сервер запущен на порту ${port} (${process.env.NODE_ENV || 'development'})`);
    });

    // 4. Настроить graceful shutdown
    setupGracefulShutdown();
  } catch (error) {
    logger.error('Критическая ошибка при запуске:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

function setupGracefulShutdown() {
  let isShuttingDown = false;

  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Получен сигнал ${signal}. Начинаем graceful shutdown...`);

    // Таймаут -- если не успеем за 30 секунд, принудительно завершаем
    const forceExit = setTimeout(() => {
      logger.error('Превышен таймаут graceful shutdown. Принудительное завершение.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      // 1. Остановить HTTP-сервер (прекратить прием новых соединений)
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        logger.info('HTTP-сервер остановлен.');
      }

      // 2. Остановить Telegram polling
      if (bot && typeof bot.stopPolling === 'function') {
        await bot.stopPolling();
        logger.info('Telegram polling остановлен.');
      }

      // 3. Отменить scheduled jobs
      if (digestJob && typeof digestJob.cancel === 'function') {
        digestJob.cancel();
        logger.info('Scheduled jobs отменены.');
      }

      // 4. Закрыть соединение с БД
      await sequelize.close();
      logger.info('Sequelize: Соединение с БД закрыто.');

      logger.info('Graceful shutdown завершен.');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error('Ошибка при graceful shutdown:', {
        error: error.message,
        stack: error.stack,
      });
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  // Обработка сигналов
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Обработка необработанных ошибок
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', {
      reason: reason?.message || reason,
      stack: reason?.stack,
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', {
      error: error.message,
      stack: error.stack,
    });
    // Uncaught exception -- нестабильное состояние, завершаем процесс
    shutdown('uncaughtException');
  });
}

start();
```

### Что нужно изменить в `src/services/telegramBot.js`

Убедиться, что бот экспортируется как default export (уже сделано в текущем коде):

```js
export default bot;  // Строка 441 -- уже есть
```

### Что нужно изменить в `src/services/morningDigest.js`

Убедиться, что job экспортируется:

```js
export default job;  // Строка 83 -- уже есть
```

### Проверка

- `npm run dev` -> нажать Ctrl+C -> видим в логах последовательность shutdown:
  ```
  12:34:56 [info]: Получен сигнал SIGINT. Начинаем graceful shutdown...
  12:34:56 [info]: HTTP-сервер остановлен.
  12:34:56 [info]: Telegram polling остановлен.
  12:34:56 [info]: Scheduled jobs отменены.
  12:34:56 [info]: Sequelize: Соединение с БД закрыто.
  12:34:56 [info]: Graceful shutdown завершен.
  ```
- Процесс завершается с кодом 0

---

## 10. Чеклист готовности

Перед переходом к Stage 1 убедиться, что **каждый** пункт выполнен:

### Структура проекта

- [ ] Все исходные файлы находятся в `src/`
- [ ] `src/config/index.js` -- конфигурация с zod-валидацией
- [ ] `src/config/logger.js` -- Winston singleton
- [ ] `src/app.js` -- Express setup
- [ ] `src/server.js` -- точка входа с graceful shutdown
- [ ] Старый `index.js` удален из корня
- [ ] Тестовые файлы перенесены в `tests/`
- [ ] `src/middleware/.gitkeep` существует

### Конфигурация

- [ ] `.env.example` создан и содержит все необходимые переменные
- [ ] `dotenv.config()` вызывается ТОЛЬКО в `src/config/index.js`
- [ ] Удалены `import dotenv` из: `models/index.js`, `googleCalendarService.js`, `yandexSpeechService.js`, `morningDigest.js`, `gcalAuthRouter.js`
- [ ] Приложение не запускается при отсутствии обязательных переменных

### Качество кода

- [ ] `.eslintrc.json` создан
- [ ] `.prettierrc` создан
- [ ] `npm run lint` проходит без ошибок (warnings допустимы)
- [ ] `npm run format` не ломает код
- [ ] ESLint и Prettier установлены в devDependencies

### Зависимости

- [ ] `body-parser` удален из dependencies
- [ ] `nodemon` перемещен в devDependencies
- [ ] `zod` добавлен в dependencies
- [ ] В `src/app.js` используется `express.json()` и `express.urlencoded()`

### Логирование

- [ ] Все `console.log` заменены на `logger.info` / `logger.debug`
- [ ] Все `console.error` заменены на `logger.error`
- [ ] Логи в development -- с цветами и временными метками
- [ ] Директория `logs/` создана и добавлена в `.gitignore`

### Стабильность

- [ ] `sequelize.sync()` вызывается ТОЛЬКО в `src/server.js`
- [ ] Graceful shutdown корректно завершает: HTTP-сервер, Telegram polling, scheduled jobs, Sequelize
- [ ] `unhandledRejection` и `uncaughtException` логируются
- [ ] `.gitignore` содержит все необходимые исключения

### Функциональность

- [ ] `npm run dev` -- бот запускается без ошибок
- [ ] Telegram бот отвечает на текстовые сообщения
- [ ] Telegram бот обрабатывает голосовые сообщения
- [ ] События создаются в Google Calendar
- [ ] Заметки создаются и показываются
- [ ] `GET /api/health` возвращает `{ status: "OK" }`
- [ ] Утренний дайджест запланирован (cron job)

### npm-скрипты

- [ ] `"dev": "nodemon src/server.js"` -- работает
- [ ] `"start": "node src/server.js"` -- работает
- [ ] `"lint": "eslint src/"` -- работает
- [ ] `"lint:fix": "eslint src/ --fix"` -- работает
- [ ] `"format": "prettier --write src/"` -- работает

---

## Итоговый package.json после Stage 0

```json
{
  "name": "secretary",
  "version": "1.0.0",
  "main": "src/server.js",
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "module",
  "description": "Secretary Bot -- AI-секретарь в Telegram",
  "dependencies": {
    "axios": "^1.7.9",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "fluent-ffmpeg": "^2.1.3",
    "googleapis": "^144.0.0",
    "moment-timezone": "^0.5.47",
    "node-schedule": "^2.1.1",
    "node-telegram-bot-api": "^0.66.0",
    "pg": "^8.13.2",
    "pg-hstore": "^2.3.4",
    "sequelize": "^6.37.5",
    "winston": "^3.17.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.2.0",
    "nodemon": "^3.1.9",
    "prettier": "^3.4.0"
  }
}
```

> **Следующий этап:** [Stage 1: Рефакторинг базы данных](stage-1-database-refactor.md)
