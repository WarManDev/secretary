# Stage 9: DevOps, тестирование и production-readiness

> **Срок:** 4-5 дней
> **Зависимости:** Все предыдущие этапы (0-8)
> **Цель:** Добавить комплексное тестирование, CI/CD пайплайны, Docker-контейнеризацию,
> мониторинг, логирование и конфигурацию для production-деплоя.
>
> Этот этап превращает Secretary Bot из рабочего приложения в **production-grade продукт**
> с автоматизированным тестированием, контейнеризацией и непрерывной доставкой.

---

## Оглавление

1. [Тестовый фреймворк -- Vitest](#1-тестовый-фреймворк--vitest)
2. [Unit тесты](#2-unit-тесты)
3. [Integration тесты](#3-integration-тесты)
4. [Test fixtures](#4-test-fixtures)
5. [Docker -- Production](#5-docker--production)
6. [Docker -- Development](#6-docker--development)
7. [GitHub Actions CI](#7-github-actions-ci)
8. [GitHub Actions CD](#8-github-actions-cd)
9. [Мониторинг и алерты](#9-мониторинг-и-алерты)
10. [Error tracking](#10-error-tracking)
11. [Environment management](#11-environment-management)
12. [Database backups](#12-database-backups)
13. [Redis setup](#13-redis-setup)
14. [Performance optimization](#14-performance-optimization)
15. [Security audit checklist](#15-security-audit-checklist)
16. [Чеклист готовности к production](#16-чеклист-готовности-к-production)

---

## 1. Тестовый фреймворк -- Vitest

### Почему Vitest, а не Jest

| Критерий | Jest | Vitest |
|---|---|---|
| **ESM поддержка** | Частичная, требует `--experimental-vm-modules` или трансформации | Нативная -- `"type": "module"` в package.json работает из коробки |
| **Скорость** | Медленный старт, тяжёлый runtime | Работает на Vite, мгновенный HMR, параллельные workers |
| **Совместимость API** | Свой API | Полностью совместим с Jest API (`describe`, `it`, `expect`, `vi.fn()`) |
| **Конфигурация** | `jest.config.js` + babel transforms для ESM | `vitest.config.js` -- минимальная настройка |
| **Watch mode** | Медленный пересбор | Мгновенный благодаря Vite |
| **Coverage** | `--coverage` + istanbul/v8 | `@vitest/coverage-v8` -- встроен |

**Вывод:** Наш проект использует `"type": "module"` (ES Modules). Jest требует костылей для ESM,
а Vitest поддерживает его нативно. API полностью совместим -- если позже понадобится
перейти на Jest, замена будет минимальной.

### Установка

```bash
npm install --save-dev vitest @vitest/coverage-v8 supertest
```

| Пакет | Назначение |
|---|---|
| `vitest` | Тестовый фреймворк (runner, assertions, mocking) |
| `@vitest/coverage-v8` | Отчёт покрытия кода (V8 engine-based coverage) |
| `supertest` | HTTP-тестирование Express-приложения (для integration тестов) |

### Файл: `vitest.config.js` (корень проекта)

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Глобальные API (describe, it, expect) без импорта
    globals: true,

    // Окружение -- Node.js (не jsdom, у нас бэкенд)
    environment: 'node',

    // Паттерн поиска тестов
    include: ['tests/**/*.test.js'],

    // Исключения
    exclude: ['node_modules', 'dist', 'ffmpeg'],

    // Корневая директория
    root: '.',

    // Timeout для каждого теста (мс)
    testTimeout: 10_000,

    // Timeout для хуков (beforeAll, afterAll и т.д.)
    hookTimeout: 30_000,

    // Параллельное выполнение файлов
    fileParallelism: true,

    // Переменные окружения для тестов
    env: {
      NODE_ENV: 'test',
    },

    // Coverage настройки
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: [
        'src/config/logger.js',       // Логирование не тестируем
        'src/server.js',               // Точка входа
        'src/migrations/**',           // Миграции
        'src/seeders/**',              // Сидеры
      ],
      // Минимальные пороги покрытия
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },

    // Setup файл для интеграционных тестов
    setupFiles: ['tests/setup.js'],
  },
});
```

### npm-скрипты

Добавить в `package.json` -> `scripts`:

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:unit": "vitest run tests/unit/",
    "test:integration": "vitest run tests/integration/"
  }
}
```

| Скрипт | Назначение |
|---|---|
| `npm test` | Запустить все тесты один раз (CI-режим) |
| `npm run test:watch` | Watch-режим -- перезапуск при изменении файлов |
| `npm run test:coverage` | Запуск с отчётом покрытия |
| `npm run test:unit` | Только unit тесты |
| `npm run test:integration` | Только интеграционные тесты |

### Структура директории тестов

```
tests/
├── setup.js                        # Глобальная настройка (подключение тестовой БД, env)
├── fixtures/
│   ├── users.js                    # Фикстуры пользователей
│   ├── events.js                   # Фикстуры событий
│   ├── tasks.js                    # Фикстуры задач
│   └── notes.js                    # Фикстуры заметок
├── unit/
│   ├── services/
│   │   └── ai/
│   │       ├── modelRouter.test.js
│   │       └── intentParser.test.js
│   ├── services/
│   │   └── billing/
│   │       ├── creditService.test.js
│   │       └── tierLimits.test.js
│   ├── middleware/
│   │   ├── auth.test.js
│   │   └── rateLimiter.test.js
│   └── utils/
│       ├── crypto.test.js
│       └── validators.test.js
└── integration/
    ├── auth.test.js
    ├── events.test.js
    ├── chat.test.js
    └── billing.test.js
```

---

## 2. Unit тесты

Unit тесты -- изолированные, быстрые, не требуют БД или внешних сервисов.
Все зависимости мокаются через `vi.mock()`.

### 2.1. `tests/unit/services/ai/modelRouter.test.js`

Тестирует логику маршрутизации между Haiku (простые запросы) и Sonnet (сложные).

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectModel, MODEL_HAIKU, MODEL_SONNET } from '../../../../src/services/ai/modelRouter.js';

describe('modelRouter', () => {
  describe('selectModel()', () => {
    it('должен выбрать Haiku для простого чат-сообщения', () => {
      const context = {
        messageType: 'text',
        hasAttachments: false,
        intentHint: 'chat',
        userTier: 'free',
      };

      const result = selectModel(context);

      expect(result).toBe(MODEL_HAIKU);
    });

    it('должен выбрать Sonnet для создания события с контекстом', () => {
      const context = {
        messageType: 'text',
        hasAttachments: false,
        intentHint: 'complex_action',
        userTier: 'professional',
      };

      const result = selectModel(context);

      expect(result).toBe(MODEL_SONNET);
    });

    it('должен выбрать Sonnet для сообщений с изображениями (Vision)', () => {
      const context = {
        messageType: 'photo',
        hasAttachments: true,
        intentHint: null,
        userTier: 'professional',
      };

      const result = selectModel(context);

      expect(result).toBe(MODEL_SONNET);
    });

    it('должен всегда использовать Haiku для free-тарифа', () => {
      const context = {
        messageType: 'text',
        hasAttachments: false,
        intentHint: 'complex_action',
        userTier: 'free',
      };

      const result = selectModel(context);

      expect(result).toBe(MODEL_HAIKU);
    });

    it('должен выбрать Sonnet для длинной истории (>10 сообщений)', () => {
      const context = {
        messageType: 'text',
        hasAttachments: false,
        intentHint: 'chat',
        userTier: 'business',
        historyLength: 15,
      };

      const result = selectModel(context);

      expect(result).toBe(MODEL_SONNET);
    });

    it('должен использовать Haiku для коротких ответов (приветствие, подтверждение)', () => {
      const shortPhrases = ['привет', 'спасибо', 'ок', 'да', 'нет'];

      shortPhrases.forEach((phrase) => {
        const context = {
          messageType: 'text',
          hasAttachments: false,
          intentHint: 'chat',
          userTier: 'professional',
          messageText: phrase,
        };

        expect(selectModel(context)).toBe(MODEL_HAIKU);
      });
    });
  });
});
```

### 2.2. `tests/unit/services/ai/intentParser.test.js`

Тестирует парсинг tool_use ответов от Claude API.

```js
import { describe, it, expect } from 'vitest';
import { parseToolUse, extractTextResponse } from '../../../../src/services/ai/intentParser.js';

describe('intentParser', () => {
  describe('parseToolUse()', () => {
    it('должен распарсить tool_use блок для создания события', () => {
      const claudeResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01A',
            name: 'create_calendar_event',
            input: {
              title: 'Встреча с Иваном',
              start_time: '2026-02-13T10:00:00+04:00',
              end_time: '2026-02-13T11:00:00+04:00',
              description: 'Обсуждение проекта',
            },
          },
        ],
        stop_reason: 'tool_use',
      };

      const result = parseToolUse(claudeResponse);

      expect(result).toEqual({
        hasTool: true,
        toolName: 'create_calendar_event',
        toolId: 'toolu_01A',
        toolInput: {
          title: 'Встреча с Иваном',
          start_time: '2026-02-13T10:00:00+04:00',
          end_time: '2026-02-13T11:00:00+04:00',
          description: 'Обсуждение проекта',
        },
      });
    });

    it('должен вернуть hasTool: false для текстового ответа', () => {
      const claudeResponse = {
        content: [
          {
            type: 'text',
            text: 'Привет! Как я могу помочь?',
          },
        ],
        stop_reason: 'end_turn',
      };

      const result = parseToolUse(claudeResponse);

      expect(result).toEqual({
        hasTool: false,
        toolName: null,
        toolId: null,
        toolInput: null,
      });
    });

    it('должен обработать множественные tool_use в одном ответе', () => {
      const claudeResponse = {
        content: [
          {
            type: 'text',
            text: 'Создаю встречу и заметку...',
          },
          {
            type: 'tool_use',
            id: 'toolu_01A',
            name: 'create_calendar_event',
            input: { title: 'Встреча' },
          },
          {
            type: 'tool_use',
            id: 'toolu_01B',
            name: 'create_note',
            input: { content: 'Подготовить документы' },
          },
        ],
        stop_reason: 'tool_use',
      };

      const result = parseToolUse(claudeResponse);

      expect(result.hasTool).toBe(true);
      // Первый tool_use
      expect(result.toolName).toBe('create_calendar_event');
    });

    it('должен корректно обработать пустой content', () => {
      const claudeResponse = {
        content: [],
        stop_reason: 'end_turn',
      };

      const result = parseToolUse(claudeResponse);

      expect(result.hasTool).toBe(false);
    });

    it('должен корректно обработать null/undefined', () => {
      expect(parseToolUse(null)).toEqual({
        hasTool: false,
        toolName: null,
        toolId: null,
        toolInput: null,
      });

      expect(parseToolUse(undefined)).toEqual({
        hasTool: false,
        toolName: null,
        toolId: null,
        toolInput: null,
      });
    });
  });

  describe('extractTextResponse()', () => {
    it('должен извлечь текст из смешанного ответа', () => {
      const claudeResponse = {
        content: [
          { type: 'text', text: 'Встреча создана!' },
          { type: 'tool_use', id: 'toolu_01A', name: 'create_event', input: {} },
        ],
      };

      const text = extractTextResponse(claudeResponse);

      expect(text).toBe('Встреча создана!');
    });

    it('должен вернуть пустую строку если нет текстовых блоков', () => {
      const claudeResponse = {
        content: [
          { type: 'tool_use', id: 'toolu_01A', name: 'create_event', input: {} },
        ],
      };

      const text = extractTextResponse(claudeResponse);

      expect(text).toBe('');
    });

    it('должен объединить несколько текстовых блоков', () => {
      const claudeResponse = {
        content: [
          { type: 'text', text: 'Готово!' },
          { type: 'text', text: 'Что-нибудь ещё?' },
        ],
      };

      const text = extractTextResponse(claudeResponse);

      expect(text).toBe('Готово!\nЧто-нибудь ещё?');
    });
  });
});
```

### 2.3. `tests/unit/services/billing/creditService.test.js`

Тестирует расчёт кредитов за AI-вызовы.

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateCredits,
  hasEnoughCredits,
  CREDIT_RATES,
} from '../../../../src/services/billing/creditService.js';

// Мокаем модели БД
vi.mock('../../../../src/models/index.js', () => ({
  default: {
    CreditTransaction: {
      create: vi.fn(),
      findAll: vi.fn(),
      sum: vi.fn(),
    },
    User: {
      findByPk: vi.fn(),
    },
  },
}));

describe('creditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateCredits()', () => {
    it('должен рассчитать стоимость для Haiku (input + output)', () => {
      const result = calculateCredits({
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 1000,
        outputTokens: 500,
      });

      // Haiku: input $0.25/1M, output $1.25/1M
      // 1000 input = 0.00025, 500 output = 0.000625
      // Total в кредитах (1 кредит = $0.001): ~0.875 кредитов
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(2); // Haiku дешёвый
    });

    it('должен рассчитать стоимость для Sonnet (дороже Haiku)', () => {
      const haiku = calculateCredits({
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 1000,
        outputTokens: 500,
      });

      const sonnet = calculateCredits({
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 500,
      });

      expect(sonnet).toBeGreaterThan(haiku);
    });

    it('должен применить скидку при prompt caching (cache_read)', () => {
      const withoutCache = calculateCredits({
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 5000,
        outputTokens: 500,
      });

      const withCache = calculateCredits({
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 1000,
        cacheReadTokens: 4000,
        outputTokens: 500,
      });

      // cache_read стоит в 10 раз дешевле обычного input
      expect(withCache).toBeLessThan(withoutCache);
    });

    it('должен вернуть 0 при нулевых токенах', () => {
      const result = calculateCredits({
        model: 'claude-3-5-haiku-20241022',
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(result).toBe(0);
    });

    it('должен бросить ошибку при неизвестной модели', () => {
      expect(() =>
        calculateCredits({
          model: 'unknown-model',
          inputTokens: 1000,
          outputTokens: 500,
        })
      ).toThrow('Unknown model');
    });
  });

  describe('hasEnoughCredits()', () => {
    it('должен вернуть true если кредитов достаточно', async () => {
      const models = (await import('../../../../src/models/index.js')).default;
      models.User.findByPk.mockResolvedValue({
        id: 1,
        subscription_tier: 'professional',
        credit_balance: 1000,
      });

      const result = await hasEnoughCredits(1, 50);

      expect(result).toBe(true);
    });

    it('должен вернуть false если кредитов недостаточно', async () => {
      const models = (await import('../../../../src/models/index.js')).default;
      models.User.findByPk.mockResolvedValue({
        id: 1,
        subscription_tier: 'free',
        credit_balance: 5,
      });

      const result = await hasEnoughCredits(1, 50);

      expect(result).toBe(false);
    });

    it('должен всегда вернуть true для enterprise тарифа', async () => {
      const models = (await import('../../../../src/models/index.js')).default;
      models.User.findByPk.mockResolvedValue({
        id: 1,
        subscription_tier: 'enterprise',
        credit_balance: 0,
      });

      const result = await hasEnoughCredits(1, 999999);

      expect(result).toBe(true);
    });
  });

  describe('CREDIT_RATES', () => {
    it('должен содержать тарифы для Haiku и Sonnet', () => {
      expect(CREDIT_RATES).toHaveProperty('claude-3-5-haiku-20241022');
      expect(CREDIT_RATES).toHaveProperty('claude-sonnet-4-20250514');
    });

    it('тариф Haiku должен быть дешевле Sonnet', () => {
      const haikuRate = CREDIT_RATES['claude-3-5-haiku-20241022'];
      const sonnetRate = CREDIT_RATES['claude-sonnet-4-20250514'];

      expect(haikuRate.inputPer1M).toBeLessThan(sonnetRate.inputPer1M);
      expect(haikuRate.outputPer1M).toBeLessThan(sonnetRate.outputPer1M);
    });
  });
});
```

### Остальные unit тесты (описание)

**`tests/unit/services/billing/tierLimits.test.js`:**
- Тестирует лимиты для каждого тарифа (free: 50/день, professional: 500/день, business: безлимит)
- Проверяет `isWithinDailyLimit(userId, tier)` -- подсчёт сообщений за текущий день
- Проверяет `getRemainingMessages(userId, tier)` -- сколько сообщений осталось
- Проверяет корректную обработку полуночной перезагрузки счётчика

**`tests/unit/middleware/auth.test.js`:**
- Тестирует JWT верификацию -- валидный токен, истёкший токен, невалидная подпись
- Тестирует middleware `requireAuth()` -- добавляет `req.user` при валидном JWT
- Тестирует `requireRole('admin')` -- возвращает 403 при неверной роли
- Мокает `jsonwebtoken.verify()` через `vi.mock()`

**`tests/unit/middleware/rateLimiter.test.js`:**
- Тестирует глобальный rate limiter (100 req/15min по IP)
- Тестирует per-user rate limiter по тарифу
- Тестирует корректное формирование заголовков `X-RateLimit-*`
- Мокает Redis через `vi.mock()`

**`tests/unit/utils/crypto.test.js`:**
- Тестирует `hashPassword(plain)` -- возвращает bcrypt hash, длина >= 60
- Тестирует `comparePassword(plain, hash)` -- true для правильного, false для неправильного
- Тестирует `encryptToken(token)` -- AES-256-GCM шифрование
- Тестирует `decryptToken(encrypted)` -- расшифровка возвращает оригинал
- Тестирует `generateToken(length)` -- случайный hex-токен нужной длины

**`tests/unit/utils/validators.test.js`:**
- Тестирует zod-схемы: registerSchema, loginSchema, createEventSchema, createNoteSchema, createTaskSchema
- Тестирует валидные данные -- schema.parse() не бросает ошибку
- Тестирует невалидные данные -- schema.parse() бросает ZodError с правильными полями
- Тестирует граничные случаи: пустые строки, слишком длинные, невалидные форматы дат

---

## 3. Integration тесты

Интеграционные тесты проверяют полный HTTP-цикл: запрос -> middleware -> controller -> service -> БД -> ответ.
Используют **реальную тестовую базу данных** (отдельную от dev) и `supertest` для HTTP-запросов.

### 3.1. `tests/setup.js` -- настройка тестового окружения

```js
import { beforeAll, afterAll, afterEach } from 'vitest';
import { sequelize } from '../src/models/index.js';

// Подключение к тестовой БД и синхронизация моделей
beforeAll(async () => {
  // Проверяем, что мы в test-окружении
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'Тесты ДОЛЖНЫ запускаться с NODE_ENV=test! ' +
      'Иначе можно повредить production/development базу данных.'
    );
  }

  // Синхронизация с force: true -- пересоздание всех таблиц
  await sequelize.sync({ force: true });
});

// Очистка данных после каждого теста (но не пересоздание таблиц)
afterEach(async () => {
  // Truncate всех таблиц в правильном порядке (учёт FK constraints)
  const models = sequelize.models;
  const tableNames = Object.keys(models);

  // Отключаем FK constraints для truncate
  await sequelize.query('SET CONSTRAINTS ALL DEFERRED;');

  for (const tableName of tableNames) {
    await models[tableName].destroy({
      where: {},
      force: true,
      truncate: true,
      cascade: true,
    });
  }
});

// Закрытие соединения с БД после всех тестов
afterAll(async () => {
  await sequelize.close();
});
```

### 3.2. `tests/integration/auth.test.js`

Тестирует полный flow аутентификации: регистрация -> логин -> refresh token.

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';
import models from '../../src/models/index.js';

describe('Auth API', () => {
  describe('POST /api/v1/auth/register', () => {
    it('должен зарегистрировать нового пользователя', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'testuser',
          password: 'SecurePass123!',
          email: 'test@example.com',
          timezone: 'Europe/Moscow',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('access_token');
      expect(res.body.data).toHaveProperty('refresh_token');
      expect(res.body.data.user).toMatchObject({
        username: 'testuser',
        email: 'test@example.com',
        timezone: 'Europe/Moscow',
        subscription_tier: 'free',
      });
      // Пароль НЕ должен возвращаться в ответе
      expect(res.body.data.user).not.toHaveProperty('password_hash');
    });

    it('должен вернуть 409 при дублировании username', async () => {
      // Сначала создаём пользователя
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'duplicate',
          password: 'SecurePass123!',
        });

      // Повторная регистрация с тем же username
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'duplicate',
          password: 'AnotherPass456!',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('должен вернуть 400 при невалидных данных', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: '', // Пустой username
          password: '12', // Слишком короткий пароль
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toBeInstanceOf(Array);
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('должен хешировать пароль в БД (не plain text)', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'hashcheck',
          password: 'SecurePass123!',
        });

      const user = await models.User.findOne({
        where: { username: 'hashcheck' },
      });

      expect(user.password_hash).not.toBe('SecurePass123!');
      expect(user.password_hash.startsWith('$2b$')).toBe(true); // bcrypt prefix
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      // Создаём пользователя для тестов логина
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'loginuser',
          password: 'SecurePass123!',
        });
    });

    it('должен залогинить пользователя с правильными credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'loginuser',
          password: 'SecurePass123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('access_token');
      expect(res.body.data).toHaveProperty('refresh_token');
    });

    it('должен вернуть 401 при неправильном пароле', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'loginuser',
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('должен вернуть 401 при несуществующем пользователе', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent',
          password: 'SecurePass123!',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'refreshuser',
          password: 'SecurePass123!',
        });

      refreshToken = res.body.data.refresh_token;
    });

    it('должен обновить access token по валидному refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('access_token');
    });

    it('должен вернуть 401 при невалидном refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'invalid.token.here' });

      expect(res.status).toBe(401);
    });
  });
});
```

### 3.3. `tests/integration/events.test.js`

Тестирует CRUD операции над событиями календаря.

```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';

describe('Events API', () => {
  let accessToken;
  let userId;

  // Перед каждым тестом -- регистрация и получение токена
  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: `eventuser_${Date.now()}`,
        password: 'SecurePass123!',
        timezone: 'Asia/Dubai',
      });

    accessToken = res.body.data.access_token;
    userId = res.body.data.user.id;
  });

  describe('POST /api/v1/events', () => {
    it('должен создать новое событие', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(tomorrowEnd.getHours() + 1);

      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Встреча с Иваном',
          description: 'Обсуждение проекта',
          event_date: tomorrow.toISOString(),
          end_date: tomorrowEnd.toISOString(),
          reminder_minutes: 30,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        title: 'Встреча с Иваном',
        description: 'Обсуждение проекта',
        reminder_minutes: 30,
      });
      expect(res.body.data).toHaveProperty('id');
    });

    it('должен вернуть 401 без Authorization header', async () => {
      const res = await request(app)
        .post('/api/v1/events')
        .send({
          title: 'Встреча',
          event_date: new Date().toISOString(),
          end_date: new Date().toISOString(),
        });

      expect(res.status).toBe(401);
    });

    it('должен вернуть 400 без обязательных полей', async () => {
      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          description: 'Без title и дат',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/events', () => {
    beforeEach(async () => {
      // Создаём несколько событий
      const dates = [
        { offset: 1, title: 'Завтра' },
        { offset: 2, title: 'Послезавтра' },
        { offset: 7, title: 'Через неделю' },
      ];

      for (const { offset, title } of dates) {
        const start = new Date();
        start.setDate(start.getDate() + offset);
        const end = new Date(start);
        end.setHours(end.getHours() + 1);

        await request(app)
          .post('/api/v1/events')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            title,
            event_date: start.toISOString(),
            end_date: end.toISOString(),
          });
      }
    });

    it('должен вернуть список событий текущего пользователя', async () => {
      const res = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(3);
    });

    it('должен фильтровать события по диапазону дат', async () => {
      const from = new Date();
      from.setDate(from.getDate() + 1);
      const to = new Date();
      to.setDate(to.getDate() + 3);

      const res = await request(app)
        .get('/api/v1/events')
        .query({
          from: from.toISOString().split('T')[0],
          to: to.toISOString().split('T')[0],
        })
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      // Только "Завтра" и "Послезавтра" попадают в диапазон
      expect(res.body.data.length).toBe(2);
    });

    it('не должен возвращать события другого пользователя', async () => {
      // Регистрируем другого пользователя
      const otherRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: `otheruser_${Date.now()}`,
          password: 'SecurePass123!',
        });

      const otherToken = otherRes.body.data.access_token;

      const res = await request(app)
        .get('/api/v1/events')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0); // У другого пользователя нет событий
    });
  });

  describe('PUT /api/v1/events/:id', () => {
    let eventId;

    beforeEach(async () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setHours(end.getHours() + 1);

      const res = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Обновляемая встреча',
          event_date: start.toISOString(),
          end_date: end.toISOString(),
        });

      eventId = res.body.data.id;
    });

    it('должен обновить название события', async () => {
      const res = await request(app)
        .put(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Новое название' });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Новое название');
    });

    it('должен вернуть 404 для несуществующего события', async () => {
      const res = await request(app)
        .put('/api/v1/events/99999')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Обновление' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/events/:id', () => {
    it('должен удалить событие', async () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setHours(end.getHours() + 1);

      const createRes = await request(app)
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Удаляемая встреча',
          event_date: start.toISOString(),
          end_date: end.toISOString(),
        });

      const eventId = createRes.body.data.id;

      const deleteRes = await request(app)
        .delete(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(deleteRes.status).toBe(200);

      // Проверяем что событие действительно удалено
      const getRes = await request(app)
        .get(`/api/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(getRes.status).toBe(404);
    });
  });
});
```

---

## 4. Test fixtures

### `tests/fixtures/users.js`

```js
export const adminUser = {
  username: 'admin',
  password: 'AdminPass123!',
  email: 'admin@secretary.bot',
  role: 'admin',
  timezone: 'Asia/Dubai',
  subscription_tier: 'enterprise',
};

export const freeUser = {
  username: 'freeuser',
  password: 'FreePass123!',
  email: 'free@example.com',
  role: 'boss',
  timezone: 'Europe/Moscow',
  subscription_tier: 'free',
};

export const professionalUser = {
  username: 'prouser',
  password: 'ProPass123!',
  email: 'pro@example.com',
  role: 'boss',
  timezone: 'Asia/Dubai',
  subscription_tier: 'professional',
};

export const businessUser = {
  username: 'bizuser',
  password: 'BizPass123!',
  email: 'biz@company.com',
  role: 'boss',
  timezone: 'America/New_York',
  subscription_tier: 'business',
};
```

### `tests/fixtures/events.js`

```js
/**
 * Генерирует даты относительно текущего момента.
 * @param {number} daysOffset -- через сколько дней
 * @param {number} hour -- час начала (по умолчанию 10:00)
 * @param {number} durationHours -- длительность в часах (по умолчанию 1)
 */
function createDates(daysOffset, hour = 10, durationHours = 1) {
  const start = new Date();
  start.setDate(start.getDate() + daysOffset);
  start.setHours(hour, 0, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + durationHours);

  return { event_date: start.toISOString(), end_date: end.toISOString() };
}

export const tomorrowMeeting = {
  title: 'Встреча с Иваном',
  description: 'Обсуждение квартального отчёта',
  ...createDates(1, 10),
  reminder_minutes: 30,
};

export const nextWeekConference = {
  title: 'Конференция по AI',
  description: 'Доклад о применении AI в бизнесе',
  ...createDates(7, 9, 4),
  reminder_minutes: 60,
};

export const todayLunch = {
  title: 'Обед с партнёром',
  ...createDates(0, 13, 1),
  reminder_minutes: 15,
};
```

### `tests/fixtures/tasks.js`

```js
export const urgentTask = {
  title: 'Подготовить презентацию',
  description: 'Слайды для встречи с инвесторами',
  priority: 'urgent',
  status: 'pending',
  tags: ['presentation', 'investor'],
};

export const mediumTask = {
  title: 'Обновить документацию',
  description: 'README и API docs',
  priority: 'medium',
  status: 'pending',
  tags: ['docs'],
};

export const completedTask = {
  title: 'Настроить CI/CD',
  priority: 'high',
  status: 'done',
  tags: ['devops'],
};
```

### `tests/fixtures/notes.js`

```js
export const meetingNote = {
  content: 'Обсудить бюджет на Q2 с Алексеем',
  category: 'meeting',
  completed: false,
};

export const ideaNote = {
  content: 'Идея: добавить интеграцию с Notion для базы знаний',
  category: 'idea',
  completed: false,
};

export const completedNote = {
  content: 'Заказать визитки для конференции',
  category: 'personal',
  completed: true,
};
```

---

## 5. Docker -- Production

### Файл: `docker/Dockerfile`

Multi-stage build для минимального production-образа.

```dockerfile
# ============================================================
# Stage 1: Builder -- установка зависимостей и подготовка
# ============================================================
FROM node:20-alpine AS builder

# Metadata
LABEL maintainer="Secretary Bot Team"
LABEL description="Secretary Bot - AI Secretary"

WORKDIR /app

# Копируем только package*.json для кэширования npm install
COPY package.json package-lock.json ./

# Устанавливаем ТОЛЬКО production-зависимости
RUN npm ci --omit=dev && npm cache clean --force

# Копируем исходный код
COPY src/ ./src/

# ============================================================
# Stage 2: Runner -- минимальный production-образ
# ============================================================
FROM node:20-alpine AS runner

# Обновляем пакеты безопасности
RUN apk update && apk upgrade --no-cache && \
    # ffmpeg для обработки голосовых сообщений
    apk add --no-cache ffmpeg && \
    # Очистка кэша
    rm -rf /var/cache/apk/*

# Создаём непривилегированного пользователя
RUN addgroup -g 1001 -S secretary && \
    adduser -S secretary -u 1001 -G secretary

WORKDIR /app

# Копируем из builder только необходимое
COPY --from=builder --chown=secretary:secretary /app/node_modules ./node_modules
COPY --from=builder --chown=secretary:secretary /app/src ./src
COPY --from=builder --chown=secretary:secretary /app/package.json ./package.json

# Создаём директорию для логов
RUN mkdir -p logs && chown secretary:secretary logs

# Переключаемся на непривилегированного пользователя
USER secretary

# Порт приложения
EXPOSE 3000

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3000

# Health check -- проверка каждые 30 секунд
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1

# Запуск приложения
CMD ["node", "src/server.js"]
```

### Файл: `docker/docker-compose.yml`

Production-конфигурация: app + PostgreSQL + Redis.

```yaml
version: '3.9'

services:
  # ============================================================
  # Secretary Bot Application
  # ============================================================
  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    container_name: secretary_app
    restart: unless-stopped
    ports:
      - "${APP_PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://${POSTGRES_USER:-secretary}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-secretary_db}
      REDIS_URL: redis://redis:6379
    env_file:
      - ../.env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - secretary-network
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

  # ============================================================
  # PostgreSQL Database
  # ============================================================
  postgres:
    image: postgres:16-alpine
    container_name: secretary_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-secretary}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
      POSTGRES_DB: ${POSTGRES_DB:-secretary_db}
      PGDATA: /var/lib/postgresql/data/pgdata
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-secretary} -d ${POSTGRES_DB:-secretary_db}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - secretary-network
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "3"

  # ============================================================
  # Redis Cache
  # ============================================================
  redis:
    image: redis:7-alpine
    container_name: secretary_redis
    restart: unless-stopped
    command: >
      redis-server
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
      --appendfsync everysec
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - secretary-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  secretary-network:
    driver: bridge
```

### Файл: `.dockerignore` (корень проекта)

```
# Dependencies
node_modules/
npm-debug.log*

# Git
.git/
.gitignore

# Environment (секреты не копируем в образ)
.env
.env.*
!.env.example

# Documentation
docs/
*.md

# IDE
.idea/
.vscode/

# OS
.DS_Store
Thumbs.db
nul

# Tests (не нужны в production-образе)
tests/
coverage/
vitest.config.js

# FFmpeg Windows binaries (в Docker используется apk-версия)
ffmpeg/

# Development configs
docker/Dockerfile.dev
docker/docker-compose.dev.yml
.eslintrc.json
.prettierrc
.prettierignore
nodemon.json
```

### Запуск production

```bash
# Сборка и запуск
cd docker
docker compose up -d --build

# Проверка статуса
docker compose ps

# Логи приложения
docker compose logs -f app

# Остановка
docker compose down

# Остановка + удаление данных (ВНИМАНИЕ: удалит БД!)
docker compose down -v
```

---

## 6. Docker -- Development

### Файл: `docker/Dockerfile.dev`

Development-образ с nodemon и hot reload.

```dockerfile
FROM node:20-alpine

# ffmpeg для голосовых сообщений
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Копируем package.json и устанавливаем ВСЕ зависимости (включая dev)
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# Исходный код монтируется через volume (не копируем)
# COPY src/ ./src/  -- НЕ нужно

EXPOSE 3000

# nodemon для hot reload
CMD ["npx", "nodemon", "src/server.js"]
```

### Файл: `docker/docker-compose.dev.yml`

Development-конфигурация с hot reload, pgAdmin и открытыми портами.

```yaml
version: '3.9'

services:
  # ============================================================
  # Secretary Bot -- Development
  # ============================================================
  app:
    build:
      context: ..
      dockerfile: docker/Dockerfile.dev
    container_name: secretary_app_dev
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "9229:9229"  # Node.js debugger
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: postgresql://secretary:devpassword@postgres:5432/secretary_dev
      REDIS_URL: redis://redis:6379
    env_file:
      - ../.env
    volumes:
      # Монтируем исходный код для hot reload
      - ../src:/app/src:delegated
      # Монтируем package.json (для обновления зависимостей)
      - ../package.json:/app/package.json:ro
      # НЕ монтируем node_modules (используем из контейнера)
      - /app/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - secretary-dev-network

  # ============================================================
  # PostgreSQL -- Development
  # ============================================================
  postgres:
    image: postgres:16-alpine
    container_name: secretary_postgres_dev
    restart: unless-stopped
    environment:
      POSTGRES_USER: secretary
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: secretary_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U secretary -d secretary_dev"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - secretary-dev-network

  # ============================================================
  # PostgreSQL -- Test Database (для integration тестов)
  # ============================================================
  postgres-test:
    image: postgres:16-alpine
    container_name: secretary_postgres_test
    restart: unless-stopped
    environment:
      POSTGRES_USER: secretary_test
      POSTGRES_PASSWORD: testpassword
      POSTGRES_DB: secretary_test
    ports:
      - "5433:5432"  # Другой порт!
    # Без volume -- данные удаляются при перезапуске (это ок для тестов)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U secretary_test -d secretary_test"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - secretary-dev-network

  # ============================================================
  # Redis -- Development
  # ============================================================
  redis:
    image: redis:7-alpine
    container_name: secretary_redis_dev
    restart: unless-stopped
    command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"
    networks:
      - secretary-dev-network

  # ============================================================
  # pgAdmin -- Web UI для PostgreSQL
  # ============================================================
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: secretary_pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@secretary.local
      PGADMIN_DEFAULT_PASSWORD: admin
      PGADMIN_CONFIG_SERVER_MODE: 'False'
      PGADMIN_CONFIG_MASTER_PASSWORD_REQUIRED: 'False'
    ports:
      - "5050:80"
    depends_on:
      - postgres
    networks:
      - secretary-dev-network

volumes:
  postgres_dev_data:
    driver: local

networks:
  secretary-dev-network:
    driver: bridge
```

### Запуск development

```bash
# Запуск dev-окружения
cd docker
docker compose -f docker-compose.dev.yml up -d

# Запуск только БД и Redis (приложение запускается локально)
docker compose -f docker-compose.dev.yml up -d postgres redis

# pgAdmin доступен на http://localhost:5050
# PostgreSQL: host=localhost, port=5432, user=secretary, password=devpassword
# Test DB: host=localhost, port=5433, user=secretary_test, password=testpassword
```

---

## 7. GitHub Actions CI

### Файл: `.github/workflows/ci.yml`

Запускается на каждый push в `main` и на каждый pull request.
Три последовательных job: lint, unit-тесты, integration-тесты.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Отмена предыдущих workflow при новом push в тот же PR
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  NODE_VERSION: '20'

jobs:
  # ============================================================
  # Job 1: Lint
  # ============================================================
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Check Prettier formatting
        run: npx prettier --check src/

  # ============================================================
  # Job 2: Unit Tests
  # ============================================================
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit
        env:
          NODE_ENV: test

      - name: Run unit tests with coverage
        run: npx vitest run tests/unit/ --coverage
        env:
          NODE_ENV: test

      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

  # ============================================================
  # Job 3: Integration Tests
  # ============================================================
  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    needs: lint

    # PostgreSQL service container
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: secretary_test
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: secretary_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U secretary_test -d secretary_test"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run database migrations
        run: npx sequelize-cli db:migrate
        env:
          NODE_ENV: test
          DATABASE_URL: postgresql://secretary_test:testpassword@localhost:5432/secretary_test

      - name: Run integration tests
        run: npm run test:integration
        env:
          NODE_ENV: test
          DATABASE_URL: postgresql://secretary_test:testpassword@localhost:5432/secretary_test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: test-jwt-secret-for-ci-only-not-production
          TOKEN_ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          TELEGRAM_BOT_TOKEN: test-token
          BOSS_CHAT_ID: 123456789

  # ============================================================
  # Job 4: Build Docker Image
  # ============================================================
  build:
    name: Build Docker Image
    runs-on: ubuntu-latest
    needs: [unit-tests, integration-tests]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Docker image (test only, no push)
        uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: false
          tags: secretary-bot:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## 8. GitHub Actions CD

### Файл: `.github/workflows/deploy.yml`

Деплой при push в `main` после успешного CI.

```yaml
name: CD - Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

# Только один деплой одновременно
concurrency:
  group: deploy-production
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    # Запускаем только если CI прошёл успешно
    if: ${{ github.event.workflow_run.conclusion == 'success' }}

    permissions:
      contents: read
      packages: write

    steps:
      # ========================================================
      # Step 1: Checkout
      # ========================================================
      - name: Checkout code
        uses: actions/checkout@v4

      # ========================================================
      # Step 2: Login to Container Registry (GitHub Packages)
      # ========================================================
      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # ========================================================
      # Step 3: Build and Push Docker Image
      # ========================================================
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Extract metadata for Docker
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=raw,value=latest

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # ========================================================
      # Step 4: Deploy to Server via SSH
      # ========================================================
      - name: Deploy to server
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /opt/secretary-bot

            # Пулим новый образ
            docker compose pull app

            # Перезапускаем только приложение (БД и Redis не трогаем)
            docker compose up -d --no-deps app

            # Ждём health check
            sleep 10
            docker compose exec app wget --spider -q http://localhost:3000/api/v1/health

            # Очищаем старые образы
            docker image prune -f

            echo "Deploy completed successfully!"

      # ========================================================
      # Step 5: Notify about deployment
      # ========================================================
      - name: Notify via Telegram
        if: always()
        uses: appleboy/telegram-action@master
        with:
          to: ${{ secrets.TELEGRAM_DEPLOY_CHAT_ID }}
          token: ${{ secrets.TELEGRAM_BOT_TOKEN_DEPLOY }}
          message: |
            ${{ job.status == 'success' && 'Deploy successful' || 'Deploy FAILED' }}

            Repository: ${{ github.repository }}
            Commit: ${{ github.sha }}
            Author: ${{ github.actor }}
            Message: ${{ github.event.workflow_run.head_commit.message }}
```

### Необходимые GitHub Secrets

Добавить в **Settings -> Secrets and variables -> Actions**:

| Secret | Описание |
|---|---|
| `DEPLOY_HOST` | IP или hostname сервера (например, `1.2.3.4`) |
| `DEPLOY_USER` | SSH пользователь (например, `deploy`) |
| `DEPLOY_SSH_KEY` | Приватный SSH ключ для подключения к серверу |
| `TELEGRAM_DEPLOY_CHAT_ID` | Chat ID для уведомлений о деплое |
| `TELEGRAM_BOT_TOKEN_DEPLOY` | Токен бота для уведомлений (можно тот же, что у основного бота) |

`GITHUB_TOKEN` предоставляется автоматически GitHub Actions.

---

## 9. Мониторинг и алерты

### Существующие health endpoints

На этапе 3 (Universal API) были реализованы два health check endpoint:

| Endpoint | Назначение |
|---|---|
| `GET /api/v1/health` | Liveness probe -- приложение запущено |
| `GET /api/v1/health/ready` | Readiness probe -- PostgreSQL и Redis доступны |

### Prometheus metrics endpoint (опционально)

Для продвинутого мониторинга можно добавить `/metrics` endpoint в формате Prometheus.

#### Установка

```bash
npm install prom-client
```

#### Файл: `src/middleware/metrics.js`

```js
import client from 'prom-client';

// Создаём реестр метрик
const register = new client.Registry();

// Метрики по умолчанию (CPU, memory, event loop)
client.collectDefaultMetrics({ register });

// ============================================================
// Кастомные метрики
// ============================================================

// HTTP запросы -- счётчик
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// HTTP запросы -- гистограмма времени ответа
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// AI запросы -- счётчик
const aiRequestsTotal = new client.Counter({
  name: 'ai_requests_total',
  help: 'Total number of AI API requests',
  labelNames: ['model', 'status'],
  registers: [register],
});

// AI токены -- счётчик
const aiTokensTotal = new client.Counter({
  name: 'ai_tokens_total',
  help: 'Total AI tokens consumed',
  labelNames: ['model', 'type'],  // type: input, output, cache_read
  registers: [register],
});

// Активные пользователи -- gauge (текущее значение)
const activeUsersGauge = new client.Gauge({
  name: 'active_users',
  help: 'Number of active users in the last 5 minutes',
  registers: [register],
});

// Ошибки -- счётчик
const errorsTotal = new client.Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['type', 'code'],
  registers: [register],
});

// ============================================================
// Middleware для записи метрик HTTP-запросов
// ============================================================
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  // Перехватываем окончание ответа
  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode,
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });

  next();
}

// ============================================================
// Endpoint для Prometheus scraper
// ============================================================
async function metricsHandler(req, res) {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
}

export {
  metricsMiddleware,
  metricsHandler,
  httpRequestsTotal,
  httpRequestDuration,
  aiRequestsTotal,
  aiTokensTotal,
  activeUsersGauge,
  errorsTotal,
};
```

#### Подключение в `src/app.js`

```js
import { metricsMiddleware, metricsHandler } from './middleware/metrics.js';

// Middleware для записи метрик (до роутов)
app.use(metricsMiddleware);

// Endpoint для Prometheus (без авторизации, но можно ограничить IP)
app.get('/metrics', metricsHandler);
```

#### Ключевые метрики для дашборда

| Метрика | Тип | Описание |
|---|---|---|
| `http_requests_total` | Counter | Общее количество HTTP-запросов (method, route, status_code) |
| `http_request_duration_seconds` | Histogram | Время ответа (p50, p90, p99) |
| `ai_requests_total` | Counter | Количество AI-вызовов (model, status) |
| `ai_tokens_total` | Counter | Использованные токены (model, type) |
| `active_users` | Gauge | Активные пользователи за последние 5 минут |
| `errors_total` | Counter | Ошибки (type, code) |

### Winston structured logging в production

Логирование уже настроено в Stage 0 (`src/config/logger.js`). В production используется
JSON-формат с ротацией файлов.

#### Настройка ротации логов (обновление `src/config/logger.js`)

```js
// В production-блоке транспортов добавить параметры ротации:
if (!isDev) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,  // 10 MB на файл
      maxFiles: 14,                // Хранить 14 файлов (≈14 дней)
      tailable: true,              // Текущий лог всегда в error.log
      zippedArchive: false,        // Не архивировать (проще для grep)
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,  // 10 MB на файл
      maxFiles: 14,
      tailable: true,
    })
  );
}
```

#### Формат JSON-лога в production

```json
{
  "level": "info",
  "message": "Входящий HTTP запрос",
  "timestamp": "2026-02-12T14:30:00.123Z",
  "requestId": "req-abc123",
  "method": "POST",
  "path": "/api/v1/chat",
  "userId": 42,
  "duration": 1250,
  "statusCode": 200
}
```

---

## 10. Error tracking

### Structured error logging с контекстом запроса

#### Файл: `src/middleware/errorTracker.js`

```js
import logger from '../config/logger.js';

// ============================================================
// Уровни критичности ошибок
// ============================================================
const SEVERITY = {
  LOW: 'low',           // 400-ые ошибки (валидация, not found)
  MEDIUM: 'medium',     // 500-ые ошибки (внутренние ошибки)
  HIGH: 'high',         // Повторяющиеся 500-ые, ошибки внешних сервисов
  CRITICAL: 'critical', // Unhandled rejection, uncaught exception, DB down
};

/**
 * Определяет уровень критичности ошибки.
 */
function getSeverity(error, statusCode) {
  if (statusCode < 500) return SEVERITY.LOW;
  if (error.code === 'EXTERNAL_SERVICE_ERROR') return SEVERITY.HIGH;
  if (error.isOperational === false) return SEVERITY.CRITICAL;
  return SEVERITY.MEDIUM;
}

/**
 * Логирует ошибку со структурированным контекстом.
 */
function trackError(error, req = null) {
  const statusCode = error.statusCode || 500;
  const severity = getSeverity(error, statusCode);

  const errorContext = {
    // Информация об ошибке
    errorName: error.name || 'Error',
    errorCode: error.code || 'UNKNOWN_ERROR',
    errorMessage: error.message,
    statusCode,
    severity,
    stack: error.stack,

    // Контекст запроса (если есть)
    ...(req && {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id || null,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      body: sanitizeBody(req.body),
    }),

    // Время
    timestamp: new Date().toISOString(),
  };

  // Логируем с соответствующим уровнем
  if (severity === SEVERITY.CRITICAL || severity === SEVERITY.HIGH) {
    logger.error('CRITICAL ERROR', errorContext);
  } else if (severity === SEVERITY.MEDIUM) {
    logger.error('Server error', errorContext);
  } else {
    logger.warn('Client error', errorContext);
  }

  return { severity, errorContext };
}

/**
 * Очищает тело запроса от чувствительных данных перед логированием.
 */
function sanitizeBody(body) {
  if (!body) return null;
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'refresh_token'];
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  return sanitized;
}

export { trackError, SEVERITY };
```

### Unhandled rejection / uncaught exception handlers

Обработчики уже настроены в `src/server.js` (Stage 0, раздел 9 -- graceful shutdown).
Дополним их отправкой уведомлений:

#### Обновление `src/server.js` (блок setupGracefulShutdown)

```js
import { trackError, SEVERITY } from './middleware/errorTracker.js';
import { notifyAdmin } from './services/core/notificationService.js';

// ... внутри setupGracefulShutdown():

process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const { severity } = trackError(error);

  // Уведомляем администратора при критических ошибках
  if (severity === SEVERITY.CRITICAL || severity === SEVERITY.HIGH) {
    notifyAdmin(`Unhandled Rejection: ${error.message}`).catch(() => {});
  }
});

process.on('uncaughtException', (error) => {
  trackError(error);
  notifyAdmin(`CRITICAL: Uncaught Exception: ${error.message}`)
    .catch(() => {})
    .finally(() => {
      shutdown('uncaughtException');
    });
});
```

### Error notification -- Telegram message to admin

#### Файл: `src/services/core/notificationService.js` (дополнение)

```js
import logger from '../../config/logger.js';

// Telegram Bot API URL
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const ADMIN_CHAT_ID = process.env.BOSS_CHAT_ID;

// Дедупликация: не отправлять одинаковые ошибки чаще чем раз в 5 минут
const recentErrors = new Map();
const DEDUP_INTERVAL = 5 * 60 * 1000; // 5 минут

/**
 * Отправляет уведомление администратору в Telegram.
 * Включает дедупликацию -- повторяющиеся ошибки не спамят.
 */
async function notifyAdmin(message) {
  if (!ADMIN_CHAT_ID) {
    logger.warn('BOSS_CHAT_ID не задан, уведомление не отправлено');
    return;
  }

  // Дедупликация
  const errorKey = message.substring(0, 100);
  const lastSent = recentErrors.get(errorKey);
  if (lastSent && Date.now() - lastSent < DEDUP_INTERVAL) {
    logger.debug('Уведомление пропущено (дедупликация)', { errorKey });
    return;
  }
  recentErrors.set(errorKey, Date.now());

  // Очистка старых записей
  for (const [key, time] of recentErrors) {
    if (Date.now() - time > DEDUP_INTERVAL) {
      recentErrors.delete(key);
    }
  }

  const text = [
    '--- Secretary Bot Alert ---',
    '',
    message,
    '',
    `Server: ${process.env.NODE_ENV || 'unknown'}`,
    `Time: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      logger.error('Не удалось отправить уведомление администратору', {
        status: response.status,
      });
    }
  } catch (error) {
    logger.error('Ошибка отправки уведомления', { error: error.message });
  }
}

export { notifyAdmin };
```

---

## 11. Environment management

### Файл: `.env.example` (полная версия для Stage 9)

```env
# ============================================================
# Secretary Bot -- Environment Variables
# ============================================================
# Скопируйте этот файл в .env и заполните реальными значениями:
#   cp .env.example .env
# ============================================================

# ------ Основные ------
NODE_ENV=development                    # development | test | production
PORT=3000                               # Порт HTTP-сервера

# ------ База данных (PostgreSQL) ------
DATABASE_URL=postgresql://secretary:devpassword@localhost:5432/secretary_dev
# Для тестов (отдельная БД!):
# DATABASE_URL=postgresql://secretary_test:testpassword@localhost:5433/secretary_test

# ------ Redis ------
REDIS_URL=redis://localhost:6379        # Redis для кэша, rate limiting, pub/sub

# ------ Telegram Bot ------
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
BOSS_CHAT_ID=your_boss_chat_id          # Chat ID администратора (для уведомлений)

# ------ AI: Anthropic Claude ------
ANTHROPIC_API_KEY=your_anthropic_api_key

# ------ AI: OpenAI (legacy, будет удалён) ------
# OPENAI_API_KEY=your_openai_api_key

# ------ Google OAuth2 (для MCP-интеграций) ------
GCAL_CLIENT_ID=your_google_client_id
GCAL_CLIENT_SECRET=your_google_client_secret
GCAL_REFRESH_TOKEN=your_google_refresh_token
# GCAL_REDIRECT_URI=http://localhost:3000/api/v1/integrations/google/callback

# ------ Yandex SpeechKit ------
YANDEX_API_KEY=your_yandex_api_key

# ------ Безопасность ------
JWT_SECRET=your_jwt_secret_min_32_chars_long_random_string
JWT_REFRESH_SECRET=your_refresh_jwt_secret_min_32_chars
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
#                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
#                    64 hex символа = 32 байта для AES-256-GCM

# ------ Stripe (Биллинг) ------
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret
STRIPE_PRICE_PROFESSIONAL=price_xxx     # Stripe Price ID для Professional тарифа
STRIPE_PRICE_BUSINESS=price_yyy         # Stripe Price ID для Business тарифа

# ------ Мониторинг (опционально) ------
# SENTRY_DSN=https://xxx@sentry.io/yyy
# PROMETHEUS_ENABLED=true
```

### Паттерны окружений

Вместо нескольких `.env.*` файлов в репозитории (что небезопасно), используем
**один `.env.example`** как документацию и отдельные `.env` файлы на каждом окружении:

| Окружение | Файл | Где находится |
|---|---|---|
| Development | `.env` | Локальная машина разработчика |
| Test | `.env` (с `NODE_ENV=test`) | CI/CD (переменные заданы в GitHub Secrets) |
| Production | `.env` | Сервер (или Docker secrets) |

#### `.env.test` (для локального запуска тестов)

```env
NODE_ENV=test
PORT=3001
DATABASE_URL=postgresql://secretary_test:testpassword@localhost:5433/secretary_test
REDIS_URL=redis://localhost:6379
JWT_SECRET=test-jwt-secret-32-chars-minimum!!
JWT_REFRESH_SECRET=test-refresh-secret-32-chars-min!!
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
TELEGRAM_BOT_TOKEN=test-token-not-real
BOSS_CHAT_ID=123456789
```

### Docker secrets для production

В production НЕ используем `.env` файлы в docker-compose. Вместо этого -- Docker secrets:

```yaml
# docker/docker-compose.yml -- обновление для production с secrets
services:
  app:
    # ...
    secrets:
      - db_password
      - jwt_secret
      - anthropic_api_key
      - stripe_secret
    environment:
      DATABASE_URL: postgresql://secretary:${DB_PASSWORD}@postgres:5432/secretary_db

secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  anthropic_api_key:
    file: ./secrets/anthropic_api_key.txt
  stripe_secret:
    file: ./secrets/stripe_secret.txt
```

Файлы секретов создаются на сервере вручную и **никогда** не попадают в репозиторий.

---

## 12. Database backups

### Скрипт автоматического бэкапа

#### Файл: `scripts/backup-db.sh`

```bash
#!/bin/bash
# ============================================================
# Secretary Bot -- PostgreSQL Backup Script
# ============================================================
# Использование:
#   ./scripts/backup-db.sh
#
# Cron (ежедневно в 03:00):
#   0 3 * * * /opt/secretary-bot/scripts/backup-db.sh >> /var/log/secretary-backup.log 2>&1
# ============================================================

set -euo pipefail

# Конфигурация
BACKUP_DIR="${BACKUP_DIR:-/opt/secretary-bot/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/secretary_db_${TIMESTAMP}.sql.gz"

# PostgreSQL параметры (из переменных окружения или Docker)
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-secretary}"
PG_DB="${PG_DB:-secretary_db}"

echo "=========================================="
echo "Secretary Bot - Database Backup"
echo "=========================================="
echo "Время: $(date -Iseconds)"
echo "Файл:  ${BACKUP_FILE}"

# Создаём директорию для бэкапов
mkdir -p "${BACKUP_DIR}"

# Бэкап через pg_dump
# --format=custom для pg_restore, но gzip для простоты
echo "Создание бэкапа..."

if command -v docker &> /dev/null && docker ps | grep -q secretary_postgres; then
  # Бэкап из Docker-контейнера
  docker exec secretary_postgres \
    pg_dump -U "${PG_USER}" -d "${PG_DB}" \
    --no-owner \
    --no-privileges \
    --verbose \
    2>/dev/null | gzip > "${BACKUP_FILE}"
else
  # Бэкап напрямую (если PostgreSQL установлен локально)
  PGPASSWORD="${PG_PASSWORD}" pg_dump \
    -h "${PG_HOST}" \
    -p "${PG_PORT}" \
    -U "${PG_USER}" \
    -d "${PG_DB}" \
    --no-owner \
    --no-privileges \
    --verbose \
    2>/dev/null | gzip > "${BACKUP_FILE}"
fi

# Проверяем что файл создан и не пустой
if [ ! -s "${BACKUP_FILE}" ]; then
  echo "ОШИБКА: Файл бэкапа пустой или не создан!"
  rm -f "${BACKUP_FILE}"
  exit 1
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "Бэкап создан: ${BACKUP_FILE} (${BACKUP_SIZE})"

# Удаление старых бэкапов
echo "Удаление бэкапов старше ${RETENTION_DAYS} дней..."
DELETED=$(find "${BACKUP_DIR}" -name "secretary_db_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "Удалено старых бэкапов: ${DELETED}"

# Опционально: загрузка в S3 (раскомментировать при необходимости)
# echo "Загрузка в S3..."
# aws s3 cp "${BACKUP_FILE}" "s3://secretary-backups/db/${TIMESTAMP}/" \
#   --storage-class STANDARD_IA
# echo "Загружено в S3"

echo "=========================================="
echo "Бэкап завершён успешно"
echo "=========================================="
```

### Скрипт восстановления

#### Файл: `scripts/restore-db.sh`

```bash
#!/bin/bash
# ============================================================
# Secretary Bot -- PostgreSQL Restore Script
# ============================================================
# Использование:
#   ./scripts/restore-db.sh backups/secretary_db_20260212_030000.sql.gz
# ============================================================

set -euo pipefail

BACKUP_FILE="${1:?Укажите путь к файлу бэкапа}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ОШИБКА: Файл не найден: ${BACKUP_FILE}"
  exit 1
fi

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-secretary}"
PG_DB="${PG_DB:-secretary_db}"

echo "=========================================="
echo "ВНИМАНИЕ: Восстановление базы данных!"
echo "=========================================="
echo "Файл: ${BACKUP_FILE}"
echo "БД:   ${PG_DB}@${PG_HOST}:${PG_PORT}"
echo ""
echo "Это УНИЧТОЖИТ текущие данные в базе ${PG_DB}!"
read -p "Продолжить? (yes/no): " CONFIRM

if [ "${CONFIRM}" != "yes" ]; then
  echo "Отменено."
  exit 0
fi

echo "Восстановление из бэкапа..."

if command -v docker &> /dev/null && docker ps | grep -q secretary_postgres; then
  # Восстановление в Docker-контейнер
  gunzip -c "${BACKUP_FILE}" | docker exec -i secretary_postgres \
    psql -U "${PG_USER}" -d "${PG_DB}" --single-transaction
else
  gunzip -c "${BACKUP_FILE}" | PGPASSWORD="${PG_PASSWORD}" psql \
    -h "${PG_HOST}" \
    -p "${PG_PORT}" \
    -U "${PG_USER}" \
    -d "${PG_DB}" \
    --single-transaction
fi

echo "=========================================="
echo "Восстановление завершено"
echo "=========================================="
```

### Настройка cron

```bash
# Добавить в crontab на production-сервере:
# Ежедневный бэкап в 03:00
0 3 * * * /opt/secretary-bot/scripts/backup-db.sh >> /var/log/secretary-backup.log 2>&1

# Еженедельный полный бэкап с загрузкой в S3 (воскресенье, 04:00)
# 0 4 * * 0 UPLOAD_S3=true /opt/secretary-bot/scripts/backup-db.sh >> /var/log/secretary-backup.log 2>&1
```

---

## 13. Redis setup

### Назначение Redis в проекте

| Функция | Описание | Ключи |
|---|---|---|
| **Session cache** | Кэш активных сессий пользователей | `session:{userId}` |
| **Rate limit counters** | Счётчики запросов для rate limiting | `ratelimit:{userId}:{date}` |
| **Prompt cache** | Кэш системных промптов (5 мин TTL) | `prompt:{hash}` |
| **Pub/Sub** | Уведомления в реальном времени (для WebSocket) | Каналы: `notifications:{userId}` |
| **General cache** | Кэш частых запросов (события на сегодня и т.д.) | `cache:{type}:{key}` |

### Файл: `src/config/redis.js`

```js
import { createClient } from 'redis';
import logger from './logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Основной клиент
const redisClient = createClient({
  url: REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis: Превышено количество попыток переподключения');
        return new Error('Redis reconnect limit reached');
      }
      // Экспоненциальная задержка: 100ms, 200ms, 400ms, ..., max 30s
      const delay = Math.min(100 * Math.pow(2, retries), 30_000);
      logger.warn(`Redis: Переподключение через ${delay}ms (попытка ${retries + 1})`);
      return delay;
    },
    connectTimeout: 10_000,
  },
});

// Event handlers
redisClient.on('connect', () => {
  logger.info('Redis: Подключение установлено');
});

redisClient.on('ready', () => {
  logger.info('Redis: Готов к работе');
});

redisClient.on('error', (error) => {
  logger.error('Redis: Ошибка', { error: error.message });
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis: Переподключение...');
});

// Клиент для Pub/Sub (отдельный, т.к. в режиме подписки нельзя выполнять команды)
const redisPubClient = redisClient.duplicate();
const redisSubClient = redisClient.duplicate();

/**
 * Подключение к Redis (вызывается при старте приложения).
 */
async function connectRedis() {
  try {
    await redisClient.connect();
    await redisPubClient.connect();
    await redisSubClient.connect();
    logger.info('Redis: Все клиенты подключены');
  } catch (error) {
    logger.error('Redis: Не удалось подключиться', { error: error.message });
    // Redis не является обязательным -- приложение может работать без него
    // (rate limiting будет in-memory, кэш отключён)
    logger.warn('Redis: Приложение продолжит работу без Redis (degraded mode)');
  }
}

/**
 * Отключение от Redis (graceful shutdown).
 */
async function disconnectRedis() {
  try {
    await redisClient.quit();
    await redisPubClient.quit();
    await redisSubClient.quit();
    logger.info('Redis: Все клиенты отключены');
  } catch (error) {
    logger.error('Redis: Ошибка при отключении', { error: error.message });
  }
}

/**
 * Проверка здоровья Redis (для readiness probe).
 */
async function isRedisHealthy() {
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

// ============================================================
// Утилиты для работы с кэшем
// ============================================================

/**
 * Получить значение из кэша с автоматическим JSON-парсингом.
 */
async function cacheGet(key) {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

/**
 * Установить значение в кэш с TTL (в секундах).
 */
async function cacheSet(key, value, ttlSeconds = 300) {
  try {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    logger.warn('Redis: Не удалось записать в кэш', { key, error: error.message });
  }
}

/**
 * Удалить ключ из кэша.
 */
async function cacheDel(key) {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.warn('Redis: Не удалось удалить ключ', { key, error: error.message });
  }
}

/**
 * Инкремент счётчика (для rate limiting).
 * Возвращает новое значение счётчика.
 */
async function incrementCounter(key, ttlSeconds = 86400) {
  try {
    const multi = redisClient.multi();
    multi.incr(key);
    multi.expire(key, ttlSeconds);
    const results = await multi.exec();
    return results[0]; // Новое значение счётчика
  } catch {
    return null;
  }
}

export {
  redisClient,
  redisPubClient,
  redisSubClient,
  connectRedis,
  disconnectRedis,
  isRedisHealthy,
  cacheGet,
  cacheSet,
  cacheDel,
  incrementCounter,
};
```

### Установка

```bash
npm install redis
```

### Подключение Redis в `src/server.js`

```js
import { connectRedis, disconnectRedis } from './config/redis.js';

async function start() {
  try {
    // 1. Подключиться к БД
    await sequelize.authenticate();
    logger.info('Sequelize: Подключение к БД успешно.');

    // 2. Подключиться к Redis
    await connectRedis();

    // 3. Синхронизировать модели / миграции
    // ...

    // 4. Запустить HTTP-сервер
    // ...
  } catch (error) { /* ... */ }
}

// В graceful shutdown добавить:
// await disconnectRedis();
```

---

## 14. Performance optimization

### Database connection pooling

Sequelize по умолчанию создаёт пул соединений. Настроим его оптимально.

#### Обновление `src/models/index.js`

```js
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,

  // Пул соединений
  pool: {
    min: 2,             // Минимум соединений (всегда готовы)
    max: 20,            // Максимум соединений (при нагрузке)
    acquire: 30_000,    // Таймаут получения соединения (30 сек)
    idle: 10_000,       // Время простоя до закрытия (10 сек)
    evict: 1_000,       // Интервал проверки idle-соединений (1 сек)
  },

  // Настройки для production
  dialectOptions: {
    // SSL для production (если БД за пределами Docker-сети)
    ...(process.env.NODE_ENV === 'production' && process.env.DB_SSL === 'true' && {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    }),

    // Таймаут запроса
    statement_timeout: 30_000,    // 30 секунд на запрос
    idle_in_transaction_session_timeout: 60_000, // 60 секунд idle в транзакции
  },

  // Таймзона
  timezone: '+00:00', // Хранить в UTC, конвертировать на уровне приложения

  // Retry для нестабильных соединений
  retry: {
    max: 3,
    match: [
      /SequelizeConnectionError/,
      /SequelizeConnectionRefusedError/,
      /SequelizeHostNotFoundError/,
      /SequelizeHostNotReachableError/,
      /SequelizeInvalidConnectionError/,
      /SequelizeConnectionTimedOutError/,
    ],
  },
});
```

### Response compression

#### Установка

```bash
npm install compression
```

#### Подключение в `src/app.js`

```js
import compression from 'compression';

const app = express();

// Compression -- перед роутами
app.use(compression({
  level: 6,                    // Уровень сжатия (1-9, 6 -- баланс скорости и размера)
  threshold: 1024,             // Сжимать ответы > 1KB
  filter: (req, res) => {
    // Не сжимать SSE и WebSocket
    if (req.headers['accept'] === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));
```

### Query optimization (Sequelize)

#### Eager loading -- загрузка связанных данных в одном запросе

```js
// ПЛОХО: N+1 проблема
const events = await Event.findAll({ where: { user_id: userId } });
for (const event of events) {
  const user = await event.getUser(); // Отдельный запрос на КАЖДОЕ событие
}

// ХОРОШО: Один запрос с JOIN
const events = await Event.findAll({
  where: { user_id: userId },
  include: [{
    model: User,
    attributes: ['id', 'username', 'timezone'], // Только нужные поля
  }],
});
```

#### Выборка только нужных полей

```js
// ПЛОХО: SELECT * FROM events
const events = await Event.findAll();

// ХОРОШО: SELECT id, title, event_date FROM events
const events = await Event.findAll({
  attributes: ['id', 'title', 'event_date', 'end_date'],
  where: { user_id: userId },
  order: [['event_date', 'ASC']],
  limit: 50,
});
```

#### Индексы для частых запросов

Индексы уже описаны в [target-architecture.md](target-architecture.md) для каждой модели.
Ключевые:

```js
// В миграции
await queryInterface.addIndex('events', ['user_id', 'event_date'], {
  name: 'idx_events_user_date',
});

await queryInterface.addIndex('messages', ['session_id', 'created_at'], {
  name: 'idx_messages_session_time',
});

await queryInterface.addIndex('credit_transactions', ['user_id', 'created_at'], {
  name: 'idx_credits_user_time',
});

// GIN-индекс для поиска по тегам (ARRAY)
await queryInterface.sequelize.query(
  'CREATE INDEX idx_tasks_tags ON tasks USING GIN (tags);'
);
```

---

## 15. Security audit checklist

Финальный аудит безопасности перед выходом в production.

### Аутентификация и авторизация

- [ ] Пароли хешируются bcrypt с cost factor >= 10
- [ ] JWT access token: срок жизни <= 15 минут
- [ ] JWT refresh token: срок жизни <= 7 дней, хранится в БД, отзывается при логауте
- [ ] Rate limiting на `/auth/login` -- максимум 5 попыток / 15 минут (защита от brute force)
- [ ] Все API endpoints (кроме /auth, /health, /webhook) требуют JWT
- [ ] RBAC: админ-функции доступны только роли `admin`
- [ ] Telegram Login Widget: верификация hash через HMAC-SHA-256

### HTTP безопасность

- [ ] `helmet` middleware включён (Security headers: X-Content-Type-Options, X-Frame-Options, CSP, HSTS)
- [ ] CORS ограничен разрешёнными доменами (не `*` в production)
- [ ] `express.json({ limit: '10mb' })` -- ограничение размера тела запроса
- [ ] Нет `X-Powered-By: Express` header (`helmet` убирает)
- [ ] HTTPS обязателен в production (через reverse proxy: nginx/Caddy)

### Данные

- [ ] OAuth-токены зашифрованы AES-256-GCM в БД (OAuthToken модель)
- [ ] `TOKEN_ENCRYPTION_KEY` минимум 32 байта, не в репозитории
- [ ] SQL injection: используем Sequelize параметризованные запросы (никаких raw SQL с конкатенацией)
- [ ] XSS: все входные данные валидируются через zod-схемы
- [ ] Sensitive data (`password_hash`, `access_token`, `refresh_token`) не возвращается в API ответах
- [ ] `sanitizeBody()` убирает чувствительные поля из логов

### Инфраструктура

- [ ] `.env` не в репозитории, `.gitignore` содержит `.env` и `.env.*`
- [ ] Docker: приложение работает от non-root пользователя (`USER secretary`)
- [ ] Docker: Multi-stage build (нет devDependencies в production-образе)
- [ ] PostgreSQL: пароль не `mypassword` в production
- [ ] Redis: `maxmemory` установлен (256MB production, 128MB dev)
- [ ] Нет debug-информации в production ответах (stack trace, SQL queries)

### Зависимости

- [ ] `npm audit` не показывает критических уязвимостей
- [ ] Зависимости зафиксированы через `package-lock.json`
- [ ] `npm ci` (а не `npm install`) используется в CI/CD и Docker

### Мониторинг

- [ ] Все ошибки 500 логируются с контекстом (requestId, userId, path)
- [ ] Критические ошибки отправляют уведомление админу
- [ ] `unhandledRejection` и `uncaughtException` перехватываются
- [ ] Health check endpoints работают (`/api/v1/health`, `/api/v1/health/ready`)
- [ ] Логи не содержат секретов (пароли, токены, API ключи)

### Stripe/Биллинг

- [ ] Webhook endpoint верифицирует Stripe signature
- [ ] Webhook endpoint не требует JWT (но проверяет `stripe-signature` header)
- [ ] Цены и тарифы управляются через Stripe Dashboard, а не хардкодятся

---

## 16. Чеклист готовности к production

Перед деплоем в production убедиться, что **каждый** пункт выполнен:

### Тестирование

- [ ] `npm test` -- все тесты проходят (0 failed)
- [ ] `npm run test:coverage` -- покрытие >= 60% statements, branches, functions, lines
- [ ] Unit тесты: modelRouter, intentParser, creditService, tierLimits, auth middleware, rateLimiter, crypto, validators
- [ ] Integration тесты: auth flow, CRUD events/tasks/notes, chat flow, billing flow
- [ ] `tests/setup.js` корректно создаёт/очищает тестовую БД
- [ ] Тесты используют отдельную тестовую БД (не dev!)

### Docker

- [ ] `docker/Dockerfile` -- multi-stage build, non-root user, healthcheck
- [ ] `docker/docker-compose.yml` -- app + postgres + redis, health checks для всех сервисов
- [ ] `docker/docker-compose.dev.yml` -- hot reload, pgAdmin, тестовая БД
- [ ] `.dockerignore` исключает: node_modules, .env, tests, docs, ffmpeg, .git
- [ ] `docker compose up -d --build` -- приложение запускается без ошибок
- [ ] `docker compose ps` -- все сервисы в состоянии `healthy`

### CI/CD

- [ ] `.github/workflows/ci.yml` -- lint + unit tests + integration tests + build Docker
- [ ] `.github/workflows/deploy.yml` -- build, push, deploy, notify
- [ ] CI использует service containers для PostgreSQL и Redis
- [ ] Cache `node_modules` через `actions/setup-node` с `cache: 'npm'`
- [ ] GitHub Secrets настроены: DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY и др.

### Мониторинг

- [ ] Health check: `GET /api/v1/health` -- liveness probe
- [ ] Readiness: `GET /api/v1/health/ready` -- проверяет PostgreSQL и Redis
- [ ] `/metrics` endpoint (если Prometheus включён)
- [ ] Winston JSON-логирование в production
- [ ] Ротация логов: 10MB файлы, 14 дней хранение
- [ ] Error tracking: structured logging с requestId, userId, path
- [ ] Admin notifications: Telegram-уведомления при критических ошибках

### Безопасность

- [ ] Security audit checklist (раздел 15) полностью пройден
- [ ] `npm audit` -- 0 critical, 0 high vulnerabilities
- [ ] Все секреты в переменных окружения (не в коде)
- [ ] HTTPS настроен (через reverse proxy)

### Бэкапы

- [ ] `scripts/backup-db.sh` -- работает, создаёт gzip-бэкапы
- [ ] `scripts/restore-db.sh` -- протестирован на тестовой БД
- [ ] Cron-задача настроена (ежедневно в 03:00)
- [ ] Ротация бэкапов: хранение 30 дней

### Redis

- [ ] `src/config/redis.js` -- подключение с reconnect strategy
- [ ] Redis используется для: session cache, rate limiting, prompt cache
- [ ] Graceful degradation: приложение работает без Redis (degraded mode)
- [ ] `isRedisHealthy()` -- используется в readiness probe

### Performance

- [ ] Sequelize connection pool: min=2, max=20
- [ ] Response compression: `compression` middleware
- [ ] Eager loading: нет N+1 проблем в основных запросах
- [ ] Индексы: все описанные в target-architecture.md индексы созданы
- [ ] `express.json({ limit: '10mb' })` -- защита от oversized payloads

### Environment

- [ ] `.env.example` содержит ВСЕ переменные с описанием
- [ ] `.env.test` настроен для локального запуска тестов
- [ ] Production: секреты через Docker secrets или переменные окружения сервера
- [ ] Все переменные окружения валидируются при старте (zod-схема в `src/config/index.js`)

### npm-скрипты

- [ ] `npm run dev` -- development с hot reload
- [ ] `npm start` -- production запуск
- [ ] `npm test` -- все тесты
- [ ] `npm run test:watch` -- watch-режим
- [ ] `npm run test:coverage` -- покрытие
- [ ] `npm run test:unit` -- только unit
- [ ] `npm run test:integration` -- только integration
- [ ] `npm run lint` -- ESLint
- [ ] `npm run lint:fix` -- авто-исправление
- [ ] `npm run format` -- Prettier

### Документация

- [ ] `.env.example` -- полная документация переменных
- [ ] `scripts/backup-db.sh` -- инструкции в комментариях
- [ ] `docker/` -- все Docker-файлы с комментариями
- [ ] `.github/workflows/` -- CI/CD с описанием каждого шага

---

## Итоговый package.json после Stage 9

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
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:unit": "vitest run tests/unit/",
    "test:integration": "vitest run tests/integration/"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "module",
  "description": "Secretary Bot -- AI-секретарь в Telegram",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@anthropic-ai/mcp-client": "^0.1.0",
    "axios": "^1.7.9",
    "bcrypt": "^5.1.1",
    "compression": "^1.7.5",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "fluent-ffmpeg": "^2.1.3",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "moment-timezone": "^0.5.47",
    "node-schedule": "^2.1.1",
    "node-telegram-bot-api": "^0.66.0",
    "pg": "^8.13.2",
    "pg-hstore": "^2.3.4",
    "prom-client": "^15.1.0",
    "redis": "^4.7.0",
    "sequelize": "^6.37.5",
    "sequelize-cli": "^6.6.2",
    "socket.io": "^4.8.0",
    "stripe": "^17.0.0",
    "swagger-jsdoc": "^6.2.8",
    "swagger-ui-express": "^5.0.1",
    "winston": "^3.17.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.2.0",
    "nodemon": "^3.1.9",
    "prettier": "^3.4.0",
    "supertest": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

---

## Порядок реализации (4-5 дней)

| День | Задачи |
|---|---|
| **День 1** | Vitest setup + unit тесты (modelRouter, intentParser, creditService, tierLimits, crypto, validators) |
| **День 2** | Integration тесты (auth, events, chat) + fixtures + setup.js |
| **День 3** | Docker (production + development) + .dockerignore + проверка сборки |
| **День 4** | GitHub Actions CI/CD + Redis setup + мониторинг (metrics, error tracking) |
| **День 5** | Database backups + performance optimization + security audit + финальный чеклист |

---

> **Предыдущий этап:** [Stage 8: Монетизация](stage-8-monetization.md)
> **Следующий этап:** [Stage 10: Мобильное приложение](stage-10-mobile.md)
