# Этап 2: Безопасность и аутентификация

> **Срок:** 2-3 дня
> **Зависит от:** Этап 1 (Рефакторинг БД)
> **Результат:** Полноценная аутентификация (JWT), авторизация по ролям, валидация входных данных, rate limiting, security headers, глобальная обработка ошибок
>
> **Последнее обновление:** 2026-02-12

---

## Оглавление

1. [Хеширование паролей (bcrypt)](#1-хеширование-паролей-bcrypt)
2. [JWT аутентификация](#2-jwt-аутентификация)
3. [Auth routes](#3-auth-routes)
4. [Telegram auth](#4-telegram-auth)
5. [Валидация входных данных (zod)](#5-валидация-входных-данных-zod)
6. [Security headers (helmet)](#6-security-headers-helmet)
7. [Rate limiting](#7-rate-limiting)
8. [Глобальный обработчик ошибок](#8-глобальный-обработчик-ошибок)
9. [Request logging middleware](#9-request-logging-middleware)
10. [Ограничение доступа к Telegram боту](#10-ограничение-доступа-к-telegram-боту)
11. [Чеклист безопасности](#11-чеклист-безопасности)

---

## Новые npm пакеты

```bash
npm install bcrypt jsonwebtoken helmet cors express-rate-limit zod
```

| Пакет | Версия | Назначение |
|-------|--------|------------|
| `bcrypt` | ^5.x | Хеширование паролей (saltRounds=12) |
| `jsonwebtoken` | ^9.x | JWT генерация и верификация |
| `helmet` | ^8.x | Security HTTP headers |
| `cors` | ^2.x | Cross-Origin Resource Sharing |
| `express-rate-limit` | ^7.x | Rate limiting middleware |
| `zod` | ^3.x | Валидация входных данных (runtime type checking) |

---

## Новые переменные окружения

Добавить в `.env` и `.env.example`:

```env
# JWT
JWT_ACCESS_SECRET=your-super-secret-access-key-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

Добавить в `src/config/index.js` (zod-валидация конфигурации):

```js
// Добавить в существующую zod-схему конфигурации:
jwt: {
  accessSecret: z.string().min(32).parse(process.env.JWT_ACCESS_SECRET),
  refreshSecret: z.string().min(32).parse(process.env.JWT_REFRESH_SECRET),
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
},
cors: {
  origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
},
```

---

## Новые/изменённые файлы

| Файл | Действие | Описание |
|------|----------|----------|
| `src/utils/crypto.js` | **Создать** | bcrypt хелперы |
| `src/utils/errors.js` | **Создать** | Кастомные классы ошибок |
| `src/utils/validators.js` | **Создать** | Zod-схемы валидации |
| `src/middleware/auth.js` | **Создать** | JWT верификация + requireRole |
| `src/middleware/validator.js` | **Создать** | Zod validation middleware |
| `src/middleware/rateLimiter.js` | **Создать** | Rate limiting |
| `src/middleware/errorHandler.js` | **Создать** | Глобальный обработчик ошибок |
| `src/middleware/requestLogger.js` | **Создать** | HTTP request logging |
| `src/routes/auth.routes.js` | **Создать** | Маршруты аутентификации |
| `src/controllers/auth.controller.js` | **Создать** | Контроллер аутентификации |
| `src/migrations/XXXXXX-hash-existing-passwords.js` | **Создать** | Миграция паролей |
| `src/app.js` | **Изменить** | Подключить middleware chain |

---

## 1. Хеширование паролей (bcrypt)

### Файл: `src/utils/crypto.js`

```js
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Хешировать пароль с использованием bcrypt.
 * saltRounds=12 обеспечивает баланс безопасности и скорости:
 * - 10 = ~10 хешей/сек (минимально приемлемо)
 * - 12 = ~2-3 хеша/сек (рекомендация OWASP)
 * - 14 = ~0.5 хеша/сек (избыточно для большинства случаев)
 *
 * @param {string} password - Пароль в открытом виде
 * @returns {Promise<string>} Хеш пароля
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Сравнить пароль с хешем.
 *
 * @param {string} password - Пароль в открытом виде
 * @param {string} hash - Хеш из базы данных
 * @returns {Promise<boolean>} Совпадает ли пароль
 */
export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
```

### Миграция существующих паролей

Файл: `src/migrations/XXXXXX-hash-existing-passwords.js`

> **ВАЖНО:** Эту миграцию нужно запустить ОДИН РАЗ. Она конвертирует все plain text пароли в bcrypt-хеши. После миграции откат невозможен (хеш -> пароль нельзя восстановить), поэтому `down()` выбросит ошибку.

```js
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export default {
  async up(queryInterface) {
    // Получить всех пользователей с plain text паролями
    const [users] = await queryInterface.sequelize.query(
      'SELECT id, password_hash FROM users WHERE password_hash IS NOT NULL'
    );

    // Хешировать каждый пароль, если он ещё не хеширован
    // bcrypt-хеш всегда начинается с "$2b$" или "$2a$"
    for (const user of users) {
      if (!user.password_hash.startsWith('$2b$') && !user.password_hash.startsWith('$2a$')) {
        const hash = await bcrypt.hash(user.password_hash, SALT_ROUNDS);
        await queryInterface.sequelize.query(
          'UPDATE users SET password_hash = ? WHERE id = ?',
          { replacements: [hash, user.id] }
        );
      }
    }

    console.log(`Migrated ${users.length} user passwords to bcrypt hashes`);
  },

  async down() {
    // Невозможно восстановить plain text пароли из хешей
    throw new Error(
      'Невозможно откатить миграцию хеширования паролей. ' +
      'Bcrypt -- односторонняя функция. Если нужно откатить, ' +
      'восстановите базу из бэкапа.'
    );
  },
};
```

### Хук в модели User

В модели `src/models/User.js` добавить хук `beforeCreate` / `beforeUpdate`:

```js
import { hashPassword } from '../utils/crypto.js';

// ... определение модели ...

// Хуки (внутри init или после определения модели)
User.beforeCreate(async (user) => {
  if (user.password_hash && !user.password_hash.startsWith('$2b$')) {
    user.password_hash = await hashPassword(user.password_hash);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('password_hash') && !user.password_hash.startsWith('$2b$')) {
    user.password_hash = await hashPassword(user.password_hash);
  }
});
```

**Примечание:** Поле в модели называется `password_hash` (не `password`). При создании пользователя через `User.create({ ..., password_hash: 'plaintext' })` хук автоматически хеширует значение перед записью в БД. Это решено на Этапе 1 (рефакторинг модели User: переименование `password` -> `password_hash`).

---

## 2. JWT аутентификация

### Файл: `src/middleware/auth.js`

Стратегия токенов:
- **Access token** -- короткоживущий (15 минут), передаётся в заголовке `Authorization: Bearer <token>`
- **Refresh token** -- долгоживущий (7 дней), используется для обновления access token
- Оба токена подписаны РАЗНЫМИ секретами (compromiss одного не компрометирует другой)

```js
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { AuthenticationError, ForbiddenError } from '../utils/errors.js';

/**
 * Генерация пары токенов (access + refresh).
 *
 * @param {Object} user - Объект пользователя из БД
 * @returns {{ accessToken: string, refreshToken: string }}
 */
export function generateTokenPair(user) {
  const payload = {
    userId: user.id,
    role: user.role,
    tier: user.subscription_tier,
  };

  const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn, // 15m
    subject: String(user.id),
    issuer: 'secretary-bot',
  });

  const refreshToken = jwt.sign(
    { userId: user.id },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn, // 7d
      subject: String(user.id),
      issuer: 'secretary-bot',
    }
  );

  return { accessToken, refreshToken };
}

/**
 * Middleware: верификация access token из заголовка Authorization.
 * При успешной верификации добавляет req.user с данными из payload.
 *
 * Использование:
 *   router.get('/events', verifyToken, eventsController.list);
 */
export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Отсутствует или невалидный заголовок Authorization');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.accessSecret, {
      issuer: 'secretary-bot',
    });

    // Добавляем данные пользователя в запрос
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      tier: decoded.tier,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthenticationError('Access token истёк. Используйте /auth/refresh для обновления.');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AuthenticationError('Невалидный access token');
    }
    throw new AuthenticationError('Ошибка верификации токена');
  }
}

/**
 * Верификация refresh token (не middleware, используется в контроллере).
 *
 * @param {string} token - Refresh token
 * @returns {Object} Decoded payload
 * @throws {AuthenticationError}
 */
export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, config.jwt.refreshSecret, {
      issuer: 'secretary-bot',
    });
  } catch (err) {
    throw new AuthenticationError('Невалидный или истёкший refresh token');
  }
}

/**
 * Middleware factory: проверка роли пользователя.
 * Должен идти ПОСЛЕ verifyToken.
 *
 * Использование:
 *   router.delete('/users/:id', verifyToken, requireRole(['admin']), usersController.delete);
 *   router.get('/events', verifyToken, requireRole(['admin', 'boss']), eventsController.list);
 *
 * @param {string[]} allowedRoles - Массив допустимых ролей
 * @returns {Function} Express middleware
 */
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      throw new AuthenticationError('Требуется аутентификация');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(
        `Доступ запрещён. Требуется одна из ролей: ${allowedRoles.join(', ')}`
      );
    }

    next();
  };
}
```

### Диаграмма потока аутентификации

```
┌─────────────┐     POST /auth/login        ┌──────────────┐
│   Клиент    │ ──── username + password ───→│  Auth        │
│ (Telegram/  │                              │  Controller  │
│  Web/Mobile)│ ←── accessToken (15m)  ────  │              │
│             │     refreshToken (7d)        └──────────────┘
│             │
│             │     GET /api/v1/events
│             │ ──── Authorization: Bearer <accessToken> ───→ verifyToken()
│             │                                                    │
│             │     ← 200 OK + данные ──────────────────────────── ✓
│             │
│             │     GET /api/v1/events (после истечения access token)
│             │ ──── Authorization: Bearer <expired> ───→ verifyToken()
│             │     ← 401 "Access token истёк"  ←──────────────── ✗
│             │
│             │     POST /auth/refresh
│             │ ──── refreshToken ───→ verifyRefreshToken()
│             │     ← новый accessToken + refreshToken  ←── ✓
└─────────────┘
```

---

## 3. Auth routes

### Файл: `src/routes/auth.routes.js`

```js
import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validator.js';
import { registerSchema, loginSchema, refreshSchema, telegramAuthSchema } from '../utils/validators.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limiter на все auth endpoints (защита от brute force)
router.use(authLimiter);

// POST /api/v1/auth/register
// Регистрация нового пользователя
router.post('/register', validate(registerSchema), authController.register);

// POST /api/v1/auth/login
// Вход по username + password
router.post('/login', validate(loginSchema), authController.login);

// POST /api/v1/auth/refresh
// Обновление access token по refresh token
router.post('/refresh', validate(refreshSchema), authController.refresh);

// POST /api/v1/auth/telegram
// Аутентификация через Telegram Login Widget
router.post('/telegram', validate(telegramAuthSchema), authController.telegramAuth);

export default router;
```

### Файл: `src/controllers/auth.controller.js`

```js
import models from '../models/index.js';
import { comparePassword } from '../utils/crypto.js';
import { generateTokenPair, verifyRefreshToken } from '../middleware/auth.js';
import { verifyTelegramAuth } from '../utils/telegramAuth.js';
import {
  AuthenticationError,
  ConflictError,
  ValidationError,
} from '../utils/errors.js';

const { User } = models;

/**
 * POST /api/v1/auth/register
 *
 * Регистрация нового пользователя.
 * Пароль хешируется автоматически через beforeCreate хук модели User.
 */
export async function register(req, res) {
  const { username, password, email, timezone } = req.body;

  // Проверить уникальность username
  const existingUser = await User.findOne({ where: { username } });
  if (existingUser) {
    throw new ConflictError(`Пользователь с username "${username}" уже существует`);
  }

  // Проверить уникальность email (если передан)
  if (email) {
    const existingEmail = await User.findOne({ where: { email } });
    if (existingEmail) {
      throw new ConflictError(`Пользователь с email "${email}" уже существует`);
    }
  }

  // Создать пользователя (пароль хешируется автоматически в beforeCreate)
  const user = await User.create({
    username,
    password_hash: password, // beforeCreate хук хеширует это значение
    email: email || null,
    timezone: timezone || 'Asia/Dubai',
    role: 'boss', // По умолчанию новый пользователь -- "boss" (владелец аккаунта)
    subscription_tier: 'free',
  });

  // Генерируем токены
  const tokens = generateTokenPair(user);

  res.status(201).json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        timezone: user.timezone,
        subscription_tier: user.subscription_tier,
      },
      ...tokens,
    },
  });
}

/**
 * POST /api/v1/auth/login
 *
 * Вход по username + password.
 * Возвращает пару токенов (access + refresh).
 */
export async function login(req, res) {
  const { username, password } = req.body;

  // Найти пользователя по username
  const user = await User.findOne({ where: { username } });
  if (!user) {
    // Намеренно не сообщаем, что именно неверно (username или password)
    // чтобы не давать информацию для перебора
    throw new AuthenticationError('Неверный username или пароль');
  }

  // Проверить, активен ли аккаунт
  if (!user.is_active) {
    throw new AuthenticationError('Аккаунт деактивирован. Обратитесь в поддержку.');
  }

  // Сравнить пароль с хешем
  const isPasswordValid = await comparePassword(password, user.password_hash);
  if (!isPasswordValid) {
    throw new AuthenticationError('Неверный username или пароль');
  }

  // Генерируем токены
  const tokens = generateTokenPair(user);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        timezone: user.timezone,
        subscription_tier: user.subscription_tier,
      },
      ...tokens,
    },
  });
}

/**
 * POST /api/v1/auth/refresh
 *
 * Обновление access token по refresh token.
 * Возвращает новую пару токенов (token rotation).
 *
 * Token rotation: при каждом refresh старый refresh token инвалидируется
 * и выдается новый. Это снижает риск при компрометации refresh token.
 */
export async function refresh(req, res) {
  const { refreshToken } = req.body;

  // Верифицируем refresh token
  const decoded = verifyRefreshToken(refreshToken);

  // Находим пользователя
  const user = await User.findByPk(decoded.userId);
  if (!user) {
    throw new AuthenticationError('Пользователь не найден');
  }

  if (!user.is_active) {
    throw new AuthenticationError('Аккаунт деактивирован');
  }

  // Генерируем новую пару токенов (token rotation)
  const tokens = generateTokenPair(user);

  res.json({
    success: true,
    data: tokens,
  });
}

/**
 * POST /api/v1/auth/telegram
 *
 * Аутентификация через Telegram Login Widget.
 * Принимает данные от виджета, верифицирует подпись,
 * создаёт пользователя если не существует, возвращает токены.
 */
export async function telegramAuth(req, res) {
  const telegramData = req.body;

  // Верифицируем подпись от Telegram (подробности -- см. раздел 4)
  const isValid = verifyTelegramAuth(telegramData);
  if (!isValid) {
    throw new AuthenticationError('Невалидные данные Telegram авторизации');
  }

  // Ищем пользователя по telegram_id
  let user = await User.findOne({
    where: { telegram_id: String(telegramData.id) },
  });

  if (!user) {
    // Автоматическая регистрация нового пользователя
    // Telegram Login Widget не предоставляет пароль,
    // поэтому генерируем случайный (пользователь может сменить позже)
    const crypto = await import('node:crypto');
    const randomPassword = crypto.randomBytes(32).toString('hex');

    user = await User.create({
      username: telegramData.username || `tg_${telegramData.id}`,
      password_hash: randomPassword,
      telegram_id: String(telegramData.id),
      role: 'boss',
      subscription_tier: 'free',
      timezone: 'Asia/Dubai', // Значение по умолчанию, пользователь сменит в настройках
    });
  }

  if (!user.is_active) {
    throw new AuthenticationError('Аккаунт деактивирован');
  }

  const tokens = generateTokenPair(user);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        telegram_id: user.telegram_id,
        role: user.role,
        timezone: user.timezone,
        subscription_tier: user.subscription_tier,
      },
      ...tokens,
    },
  });
}
```

---

## 4. Telegram auth

### Как работает Telegram Login Widget

Telegram Login Widget (`<script src="https://telegram.org/js/telegram-widget.js">`) позволяет пользователям авторизоваться на сайте через свой Telegram аккаунт. После авторизации Telegram отправляет на callback URL следующие данные:

```js
{
  id: 123456789,          // Telegram user ID
  first_name: "Иван",     // Имя
  last_name: "Петров",    // Фамилия (опционально)
  username: "ivanpetrov", // Username (опционально)
  photo_url: "https://t.me/i/userpic/...", // Аватар (опционально)
  auth_date: 1739350000,  // Unix timestamp авторизации
  hash: "abc123..."       // HMAC-SHA-256 подпись
}
```

### Верификация подписи

Telegram подписывает данные с помощью SHA-256 хеша от токена бота. Алгоритм:

1. Создать строку `data_check_string` из всех полей (кроме `hash`), отсортированных по алфавиту, в формате `key=value\n`
2. Вычислить `secret_key = SHA256(bot_token)`
3. Вычислить `hash = HMAC-SHA-256(data_check_string, secret_key)`
4. Сравнить вычисленный hash с полученным
5. Проверить, что `auth_date` не старше 1 дня (защита от replay attack)

### Файл: `src/utils/telegramAuth.js`

```js
import crypto from 'node:crypto';
import config from '../config/index.js';

/**
 * Верифицировать данные авторизации от Telegram Login Widget.
 *
 * Алгоритм:
 * 1. Собрать все поля (кроме hash) в строку "key=value\n", отсортированную по ключам
 * 2. secret = SHA256(bot_token)
 * 3. hmac = HMAC-SHA256(data_check_string, secret)
 * 4. Сравнить hmac с переданным hash
 * 5. Проверить auth_date (не старше 86400 секунд = 24 часа)
 *
 * @param {Object} data - Данные от Telegram Login Widget
 * @returns {boolean} Валидны ли данные
 *
 * @see https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(data) {
  const { hash, ...restData } = data;

  if (!hash) {
    return false;
  }

  // Проверка freshness: auth_date не старше 24 часов
  const authDate = Number(restData.auth_date);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) {
    return false; // Данные устарели (возможная replay-атака)
  }

  // 1. Собрать data_check_string
  const dataCheckString = Object.keys(restData)
    .sort()
    .map((key) => `${key}=${restData[key]}`)
    .join('\n');

  // 2. secret_key = SHA256(bot_token)
  const secretKey = crypto
    .createHash('sha256')
    .update(config.telegram.botToken)
    .digest();

  // 3. hmac = HMAC-SHA256(data_check_string, secret_key)
  const hmac = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // 4. Сравнить (timing-safe comparison для защиты от timing attacks)
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'hex'),
      Buffer.from(hash, 'hex')
    );
  } catch {
    return false; // Разная длина строк = невалидный hash
  }
}
```

### Диаграмма Telegram авторизации

```
┌──────────┐    ┌──────────────────┐    ┌──────────────┐
│ Telegram │    │  Telegram Login  │    │  Secretary   │
│ Servers  │    │  Widget (на сайте│    │  Bot API     │
└────┬─────┘    │  или Mini App)   │    └──────┬───────┘
     │          └────────┬─────────┘           │
     │                   │                      │
     │   1. Пользователь нажимает              │
     │      "Login with Telegram"              │
     │          ←────────┤                      │
     │                   │                      │
     │   2. Telegram отправляет данные         │
     │      (id, name, username, hash)          │
     │          ────────→│                      │
     │                   │                      │
     │                   │  3. POST /api/v1/auth/telegram
     │                   │     { id, first_name, ..., hash }
     │                   │─────────────────────→│
     │                   │                      │
     │                   │  4. verifyTelegramAuth()
     │                   │     secret = SHA256(bot_token)
     │                   │     hmac = HMAC-SHA256(data, secret)
     │                   │     hmac === hash? ✓
     │                   │                      │
     │                   │  5. User.findOrCreate({ telegram_id })
     │                   │                      │
     │                   │  6. 200 OK
     │                   │     { accessToken, refreshToken }
     │                   │←─────────────────────│
     │                   │                      │
```

---

## 5. Валидация входных данных (zod)

### Зачем zod, а не joi / express-validator

- **Type inference**: zod автоматически выводит TypeScript-типы из схем
- **Маленький размер**: ~13KB (joi: ~150KB)
- **Единый формат ошибок**: удобный для фронтенда
- **Composability**: схемы легко комбинируются (`.extend()`, `.merge()`, `.pick()`)

### Файл: `src/utils/validators.js`

```js
import { z } from 'zod';

// ========================
// Auth schemas
// ========================

/**
 * POST /api/v1/auth/register
 */
export const registerSchema = z.object({
  body: z.object({
    username: z
      .string()
      .min(3, 'Username должен содержать минимум 3 символа')
      .max(30, 'Username не должен превышать 30 символов')
      .regex(
        /^[a-zA-Z0-9_]+$/,
        'Username может содержать только латинские буквы, цифры и _'
      ),
    password: z
      .string()
      .min(8, 'Пароль должен содержать минимум 8 символов')
      .max(128, 'Пароль не должен превышать 128 символов')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Пароль должен содержать минимум одну заглавную букву, одну строчную и одну цифру'
      ),
    email: z.string().email('Некорректный формат email').optional(),
    timezone: z
      .string()
      .regex(
        /^[A-Za-z]+\/[A-Za-z_]+$/,
        'Timezone должен быть в формате IANA (например, Asia/Dubai)'
      )
      .optional(),
  }),
});

/**
 * POST /api/v1/auth/login
 */
export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'Username обязателен'),
    password: z.string().min(1, 'Пароль обязателен'),
  }),
});

/**
 * POST /api/v1/auth/refresh
 */
export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token обязателен'),
  }),
});

/**
 * POST /api/v1/auth/telegram
 */
export const telegramAuthSchema = z.object({
  body: z.object({
    id: z.number().int().positive(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().url().optional(),
    auth_date: z.number().int().positive(),
    hash: z.string().length(64, 'Hash должен быть 64 символа (SHA-256 hex)'),
  }),
});

// ========================
// Event schemas
// ========================

/**
 * POST /api/v1/events
 */
export const createEventSchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(1, 'Название события обязательно')
      .max(255, 'Название не должно превышать 255 символов'),
    description: z.string().max(5000).optional(),
    event_date: z
      .string()
      .datetime({ message: 'event_date должен быть в формате ISO 8601' }),
    end_date: z
      .string()
      .datetime({ message: 'end_date должен быть в формате ISO 8601' }),
    recurrence_rule: z
      .string()
      .max(255)
      .optional(),
    reminder_minutes: z
      .number()
      .int()
      .min(0)
      .max(10080) // Максимум 7 дней
      .default(15),
  }).refine(
    (data) => new Date(data.end_date) > new Date(data.event_date),
    { message: 'end_date должен быть позже event_date', path: ['end_date'] }
  ),
});

/**
 * PUT /api/v1/events/:id
 */
export const updateEventSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID должен быть числом'),
  }),
  body: z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).optional(),
    event_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional(),
    recurrence_rule: z.string().max(255).nullable().optional(),
    reminder_minutes: z.number().int().min(0).max(10080).optional(),
  }),
});

// ========================
// Note schemas
// ========================

/**
 * POST /api/v1/notes
 */
export const createNoteSchema = z.object({
  body: z.object({
    content: z
      .string()
      .min(1, 'Текст заметки обязателен')
      .max(10000, 'Текст заметки не должен превышать 10000 символов'),
    category: z
      .string()
      .max(50)
      .optional(),
  }),
});

/**
 * PUT /api/v1/notes/:id
 */
export const updateNoteSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID должен быть числом'),
  }),
  body: z.object({
    content: z.string().min(1).max(10000).optional(),
    category: z.string().max(50).nullable().optional(),
  }),
});

// ========================
// Task schemas
// ========================

/**
 * POST /api/v1/tasks
 */
export const createTaskSchema = z.object({
  body: z.object({
    title: z
      .string()
      .min(1, 'Название задачи обязательно')
      .max(255, 'Название не должно превышать 255 символов'),
    description: z.string().max(5000).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    due_date: z.string().datetime().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    assigned_employee_id: z.number().int().positive().optional(),
    reminder_at: z.string().datetime().optional(),
  }),
});

/**
 * PUT /api/v1/tasks/:id
 */
export const updateTaskSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID должен быть числом'),
  }),
  body: z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
    due_date: z.string().datetime().nullable().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    assigned_employee_id: z.number().int().positive().nullable().optional(),
    reminder_at: z.string().datetime().nullable().optional(),
  }),
});

/**
 * PUT /api/v1/tasks/:id/status
 */
export const updateTaskStatusSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID должен быть числом'),
  }),
  body: z.object({
    status: z.enum(['pending', 'in_progress', 'done', 'cancelled'], {
      errorMap: () => ({
        message: 'Допустимые статусы: pending, in_progress, done, cancelled',
      }),
    }),
  }),
});

// ========================
// Query schemas (для GET с фильтрами)
// ========================

/**
 * GET /api/v1/events?from=...&to=...
 */
export const listEventsQuerySchema = z.object({
  query: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.string().regex(/^\d+$/).optional().default('1'),
    limit: z.string().regex(/^\d+$/).optional().default('20'),
  }),
});

/**
 * GET /api/v1/tasks?status=...&priority=...
 */
export const listTasksQuerySchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    assigned_to: z.string().regex(/^\d+$/).optional(),
    sort: z.enum(['due_date', 'priority', 'created_at']).optional().default('created_at'),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
    page: z.string().regex(/^\d+$/).optional().default('1'),
    limit: z.string().regex(/^\d+$/).optional().default('20'),
  }),
});
```

### Файл: `src/middleware/validator.js`

```js
import { ZodError } from 'zod';
import { ValidationError } from '../utils/errors.js';

/**
 * Middleware factory для валидации запроса через zod-схему.
 *
 * Валидирует `req.body`, `req.query` и `req.params` в зависимости
 * от того, какие ключи определены в схеме.
 *
 * Использование:
 *   import { validate } from '../middleware/validator.js';
 *   import { createEventSchema } from '../utils/validators.js';
 *
 *   router.post('/events', validate(createEventSchema), eventsController.create);
 *
 * @param {import('zod').ZodSchema} schema - Zod-схема для валидации
 * @returns {Function} Express middleware
 */
export function validate(schema) {
  return (req, res, next) => {
    try {
      // Валидируем объект с нужными частями запроса
      const result = schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Заменяем исходные данные на провалидированные
      // (zod может трансформировать данные: default values, coercion)
      if (result.body) req.body = result.body;
      if (result.query) req.query = result.query;
      if (result.params) req.params = result.params;

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Трансформируем ошибки zod в наш формат
        const details = err.errors.map((e) => ({
          field: e.path.filter((p) => p !== 'body' && p !== 'query' && p !== 'params').join('.'),
          message: e.message,
        }));

        throw new ValidationError('Ошибка валидации входных данных', details);
      }
      throw err;
    }
  };
}
```

### Пример использования в маршруте

```js
import { Router } from 'express';
import { validate } from '../middleware/validator.js';
import { verifyToken } from '../middleware/auth.js';
import { createEventSchema, updateEventSchema } from '../utils/validators.js';
import * as eventsController from '../controllers/events.controller.js';

const router = Router();

router.post('/', verifyToken, validate(createEventSchema), eventsController.create);
router.put('/:id', verifyToken, validate(updateEventSchema), eventsController.update);
```

Порядок middleware: `verifyToken` → `validate(schema)` → `controller`. Сначала проверяем авторизацию (чтобы не тратить ресурсы на валидацию для неавторизованных), затем валидируем данные.

---

## 6. Security headers (helmet)

### Файл: `src/app.js` (фрагмент настройки middleware)

```js
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

const app = express();

// ========================
// Security middleware
// ========================

// Helmet -- набор security HTTP headers
// https://helmetjs.github.io/
app.use(
  helmet({
    // Content-Security-Policy: default-src 'self'
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Для Swagger UI
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    // X-Content-Type-Options: nosniff
    // Предотвращает MIME-type sniffing
    crossOriginEmbedderPolicy: false, // Отключить для Swagger UI
  })
);

// CORS -- разрешаем запросы с фронтенда
app.use(
  cors({
    origin: config.cors.origin, // ['http://localhost:3000', 'http://localhost:5173']
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    credentials: true,
    maxAge: 86400, // Кэш preflight запросов на 24 часа
  })
);

// ========================
// Body parsing
// ========================

app.use(express.json({ limit: '1mb' })); // Лимит размера JSON body
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ========================
// Request logging
// ========================

app.use(requestLogger);

// ========================
// Rate limiting (глобальный)
// ========================

app.use(globalLimiter);

// ========================
// Routes
// ========================

app.use('/api/v1', routes);

// ========================
// Error handling (ВСЕГДА в конце)
// ========================

app.use(notFoundHandler);  // 404 для несуществующих маршрутов
app.use(errorHandler);     // Глобальный обработчик ошибок

export default app;
```

### Что делает helmet (заголовки)

| Заголовок | Значение | Защита от |
|-----------|----------|-----------|
| `X-Content-Type-Options` | `nosniff` | MIME-type sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking |
| `X-XSS-Protection` | `0` | Legacy XSS filter (отключён, CSP лучше) |
| `Strict-Transport-Security` | `max-age=15552000` | Downgrade-атаки (HTTPS only) |
| `Content-Security-Policy` | `default-src 'self'` | XSS, инъекции скриптов |
| `X-DNS-Prefetch-Control` | `off` | DNS prefetch утечки |
| `Referrer-Policy` | `no-referrer` | Утечка Referrer |
| `X-Permitted-Cross-Domain-Policies` | `none` | Flash/PDF cross-domain |

---

## 7. Rate limiting

### Файл: `src/middleware/rateLimiter.js`

```js
import rateLimit from 'express-rate-limit';
import { RateLimitError } from '../utils/errors.js';
import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Глобальный rate limiter.
 * 100 запросов в минуту с одного IP.
 * Применяется ко ВСЕМ endpoints.
 */
export const globalLimiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 60 * 1000, // 1 минута
  max: config.rateLimit?.maxRequests || 100,
  standardHeaders: true, // X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
  legacyHeaders: false,  // Не отправлять X-RateLimit-* (старый формат)
  handler: (req, res) => {
    logger.warn('Global rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Слишком много запросов. Попробуйте через минуту.',
        details: {
          limit: 100,
          window: '1 минута',
          resets_at: new Date(Date.now() + 60000).toISOString(),
        },
      },
    });
  },
  // Пропускаем health endpoints
  skip: (req) => req.path.startsWith('/api/v1/health'),
});

/**
 * Rate limiter для auth endpoints.
 * 5 запросов в минуту с одного IP.
 * Защита от brute force атак на login/register.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });

    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Слишком много попыток авторизации. Попробуйте через минуту.',
        details: {
          limit: 5,
          window: '1 минута',
          resets_at: new Date(Date.now() + 60000).toISOString(),
        },
      },
    });
  },
});

/**
 * Лимиты сообщений по тарифным планам.
 * Эти значения используются в messageProcessor.js для проверки
 * доступных сообщений пользователя за день.
 */
export const TIER_MESSAGE_LIMITS = {
  free: 50,          // 50 сообщений в день
  professional: 500, // 500 сообщений в день
  business: 2000,    // 2000 сообщений в день (фактически безлимит)
  enterprise: -1,    // Без ограничений (-1 = unlimited)
};

/**
 * Проверка лимита сообщений пользователя.
 *
 * Не является Express middleware -- вызывается из messageProcessor.js
 * перед обработкой каждого сообщения (как из Telegram, так и из REST API).
 *
 * @param {Object} user - Объект пользователя из БД
 * @param {number} messagesCountToday - Количество сообщений за сегодня (из БД)
 * @throws {RateLimitError} Если лимит исчерпан
 */
export function checkMessageLimit(user, messagesCountToday) {
  const tier = user.subscription_tier || 'free';
  const limit = TIER_MESSAGE_LIMITS[tier];

  // -1 = unlimited
  if (limit === -1) {
    return;
  }

  if (messagesCountToday >= limit) {
    throw new RateLimitError(
      `Превышен лимит сообщений. Доступно ${limit}/день на тарифе "${tier}".`,
      {
        limit,
        used: messagesCountToday,
        tier,
        resets_at: getEndOfDay(user.timezone),
        upgrade_url: '/api/v1/billing/checkout',
      }
    );
  }
}

/**
 * Получить конец текущего дня в timezone пользователя.
 *
 * @param {string} timezone - IANA timezone (например, 'Asia/Dubai')
 * @returns {string} ISO 8601 datetime
 */
function getEndOfDay(timezone) {
  const now = new Date();
  // Получаем дату в timezone пользователя
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = formatter.format(now); // "2026-02-12"
  // Конец дня = начало следующего дня
  const endOfDay = new Date(`${dateStr}T23:59:59`);
  return endOfDay.toISOString();
}
```

### Таблица лимитов

| Контекст | Лимит | Окно | Ключ | Применение |
|----------|-------|------|------|------------|
| Глобальный | 100 запросов | 1 минута | IP-адрес | Все endpoints (кроме health) |
| Auth endpoints | 5 запросов | 1 минута | IP-адрес | `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/telegram` |
| Chat сообщения (Free) | 50 сообщений | 1 день | user_id | `/chat` + Telegram |
| Chat сообщения (Professional) | 500 сообщений | 1 день | user_id | `/chat` + Telegram |
| Chat сообщения (Business) | 2000 сообщений | 1 день | user_id | `/chat` + Telegram |
| Chat сообщения (Enterprise) | Без ограничений | - | - | `/chat` + Telegram |

---

## 8. Глобальный обработчик ошибок

### Файл: `src/utils/errors.js`

```js
/**
 * Базовый класс ошибки приложения.
 * Все кастомные ошибки наследуют от него.
 *
 * @property {number} statusCode - HTTP status code
 * @property {string} code - Машиночитаемый код ошибки (для фронтенда)
 * @property {boolean} isOperational - true = ожидаемая ошибка (не баг)
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // Отличает ожидаемые ошибки от багов
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request -- невалидные входные данные.
 */
export class ValidationError extends AppError {
  /**
   * @param {string} message
   * @param {Array<{field: string, message: string}>} details - Детали по полям
   */
  constructor(message = 'Ошибка валидации входных данных', details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * 401 Unauthorized -- невалидный/отсутствующий/истёкший токен.
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Требуется аутентификация') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * 403 Forbidden -- недостаточно прав (роль не подходит).
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Недостаточно прав для выполнения операции') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * 404 Not Found -- ресурс не найден.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Ресурс не найден') {
    super(message, 404, 'NOT_FOUND');
  }
}

/**
 * 409 Conflict -- дубликат (username, email и т.д.).
 */
export class ConflictError extends AppError {
  constructor(message = 'Конфликт данных') {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * 429 Too Many Requests -- превышен лимит запросов.
 */
export class RateLimitError extends AppError {
  /**
   * @param {string} message
   * @param {Object} details - Детали лимита (limit, used, resets_at, upgrade_url)
   */
  constructor(message = 'Превышен лимит запросов', details = {}) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.details = details;
  }
}

/**
 * 502 Bad Gateway -- ошибка внешнего сервиса (Google, Yandex, Claude).
 */
export class ExternalServiceError extends AppError {
  constructor(service, originalError) {
    super(
      `Ошибка внешнего сервиса: ${service}`,
      502,
      'EXTERNAL_SERVICE_ERROR'
    );
    this.service = service;
    this.originalError = originalError;
  }
}
```

### Файл: `src/middleware/errorHandler.js`

```js
import logger from '../config/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Глобальный обработчик ошибок Express.
 *
 * ВАЖНО: Должен быть подключён ПОСЛЕДНИМ в цепочке middleware (после всех routes).
 * Express определяет error handler по 4 аргументам: (err, req, res, next).
 *
 * Принцип работы:
 * 1. Ошибки AppError (isOperational=true) -- ожидаемые, отправляем клиенту как есть
 * 2. Неизвестные ошибки (isOperational=false) -- баги, логируем stack trace,
 *    отправляем клиенту generic сообщение
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Определяем, это ожидаемая ошибка или баг
  const isOperational = err instanceof AppError && err.isOperational;

  // Логируем ошибку
  if (isOperational) {
    // Ожидаемые ошибки -- warn level
    logger.warn('Operational error', {
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
    });
  } else {
    // Неожиданные ошибки (баги) -- error level с полным stack trace
    logger.error('Unexpected error', {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
      body: req.body, // Осторожно: не логировать пароли! Фильтрация ниже.
    });
  }

  // Формируем ответ
  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: isOperational
        ? err.message
        : 'Внутренняя ошибка сервера. Попробуйте позже.',
    },
  };

  // Добавляем details если есть (для ValidationError, RateLimitError)
  if (err.details) {
    response.error.details = err.details;
  }

  // В development-режиме добавляем stack trace
  if (process.env.NODE_ENV === 'development' && !isOperational) {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * Обработчик 404 для несуществующих маршрутов.
 * Подключается ПЕРЕД errorHandler, ПОСЛЕ всех routes.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Маршрут ${req.method} ${req.path} не найден`,
    },
  });
}
```

### Как ошибки попадают в обработчик

```
Controller/Service бросает ошибку
    │
    ├── throw new ValidationError('Ошибка', details)
    ├── throw new AuthenticationError('Невалидный токен')
    ├── throw new NotFoundError('Событие не найдено')
    ├── throw new RateLimitError('Лимит', details)
    │
    ▼
Express ловит ошибку → errorHandler(err, req, res, next)
    │
    ├── err instanceof AppError? → isOperational = true
    │   → logger.warn()
    │   → res.status(err.statusCode).json({ success: false, error: { ... } })
    │
    └── Неизвестная ошибка? → isOperational = false
        → logger.error() с полным stack trace
        → res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка...' } })
```

**Важный нюанс:** Для асинхронных контроллеров ошибки из `async/await` не попадают в Express error handler автоматически. Нужен wrapper:

```js
/**
 * Обёртка для async контроллеров.
 * Ловит rejected promises и передаёт в Express error handler.
 *
 * Без этого: async ошибка → UnhandledPromiseRejection → крэш процесса
 * С этим: async ошибка → next(err) → errorHandler
 *
 * @param {Function} fn - Async контроллер (req, res, next) => Promise
 * @returns {Function} Express middleware
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

Использование в маршрутах:

```js
import { asyncHandler } from '../middleware/errorHandler.js';

router.post('/register', validate(registerSchema), asyncHandler(authController.register));
router.post('/login', validate(loginSchema), asyncHandler(authController.login));
```

---

## 9. Request logging middleware

### Файл: `src/middleware/requestLogger.js`

```js
import logger from '../config/logger.js';

/**
 * Middleware для логирования HTTP-запросов.
 *
 * Логирует:
 * - HTTP метод и путь
 * - HTTP статус ответа
 * - Время обработки (мс)
 * - IP-адрес клиента
 * - User-Agent
 * - userId из JWT (если авторизован)
 *
 * Пример лог-записи:
 * {
 *   "level": "info",
 *   "message": "HTTP Request",
 *   "method": "GET",
 *   "url": "/api/v1/events?from=2026-02-01",
 *   "status": 200,
 *   "responseTime": 42,
 *   "ip": "127.0.0.1",
 *   "userAgent": "Mozilla/5.0...",
 *   "userId": 7,
 *   "timestamp": "2026-02-12T10:30:00.000Z"
 * }
 */
export function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Перехватываем событие завершения ответа
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      responseTime: `${responseTime}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent') || 'unknown',
      userId: req.user?.id || null,
      contentLength: res.get('Content-Length') || 0,
    };

    // Выбираем уровень логирования в зависимости от статуса
    if (res.statusCode >= 500) {
      logger.error('HTTP Request', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('HTTP Request', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });

  next();
}
```

### Что НЕ логируем (безопасность)

- Тело запроса `req.body` -- может содержать пароли
- Заголовок `Authorization` -- содержит JWT
- Cookies -- могут содержать сессии

Если нужно логировать тело запроса для отладки -- делать это только в development-режиме с маскированием чувствительных полей:

```js
// Только в development, только для отладки
if (process.env.NODE_ENV === 'development') {
  const safebody = { ...req.body };
  if (safebody.password) safebody.password = '***';
  if (safebody.refreshToken) safebody.refreshToken = '***';
  logData.body = safeBody;
}
```

---

## 10. Ограничение доступа к Telegram боту

### Текущая проблема

Сейчас любой пользователь Telegram может отправить сообщение боту и использовать его (включая создание событий в Google Calendar, расходование OpenAI токенов). Нужно:

1. Регистрировать пользователя при первом `/start`
2. Отклонять сообщения от незарегистрированных пользователей
3. Применять rate limiting по `telegram_id`

### Изменения в `src/services/platforms/telegram/handlers/messageHandler.js`

```js
import models from '../../../../models/index.js';
import { checkMessageLimit } from '../../../../middleware/rateLimiter.js';
import logger from '../../../../config/logger.js';

const { User } = models;

/**
 * Найти или создать пользователя по telegram_id.
 * Вызывается ДО обработки каждого сообщения.
 *
 * @param {Object} msg - Telegram message object
 * @returns {Object} User model instance
 */
async function getOrCreateUser(msg) {
  const telegramId = String(msg.from.id);

  let user = await User.findOne({ where: { telegram_id: telegramId } });

  if (!user) {
    // Автоматическая регистрация при первом сообщении
    const crypto = await import('node:crypto');
    const randomPassword = crypto.randomBytes(32).toString('hex');

    user = await User.create({
      username: msg.from.username || `tg_${telegramId}`,
      password_hash: randomPassword,
      telegram_id: telegramId,
      role: 'boss',
      subscription_tier: 'free',
      timezone: 'Asia/Dubai',
    });

    logger.info('New Telegram user registered', {
      userId: user.id,
      telegramId,
      username: msg.from.username,
    });
  }

  return user;
}

/**
 * Middleware-функция для проверки доступа Telegram-пользователя.
 * Вызывается перед обработкой каждого сообщения.
 *
 * @param {Object} bot - TelegramBot instance
 * @param {Object} msg - Telegram message object
 * @returns {Object|null} User instance или null если доступ запрещён
 */
export async function authenticateTelegramUser(bot, msg) {
  try {
    const user = await getOrCreateUser(msg);

    // Проверить, активен ли аккаунт
    if (!user.is_active) {
      await bot.sendMessage(
        msg.chat.id,
        'Ваш аккаунт деактивирован. Обратитесь в поддержку.'
      );
      return null;
    }

    // Проверить лимит сообщений
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const messagesCount = await models.Message.count({
      include: [{
        model: models.Session,
        where: { user_id: user.id },
        attributes: [],
      }],
      where: {
        sender: 'user',
        created_at: { [models.Sequelize.Op.gte]: todayStart },
      },
    });

    try {
      checkMessageLimit(user, messagesCount);
    } catch (rateLimitErr) {
      await bot.sendMessage(
        msg.chat.id,
        `${rateLimitErr.message}\n\nОбновите тарифный план для увеличения лимита.`
      );
      return null;
    }

    return user;
  } catch (err) {
    logger.error('Error authenticating Telegram user', {
      telegramId: msg.from?.id,
      error: err.message,
    });
    await bot.sendMessage(
      msg.chat.id,
      'Произошла ошибка при проверке доступа. Попробуйте позже.'
    );
    return null;
  }
}
```

### Использование в основном обработчике сообщений

```js
// В bot.on('message', ...) или messageHandler
bot.on('message', async (msg) => {
  // 1. Аутентификация и проверка лимитов
  const user = await authenticateTelegramUser(bot, msg);
  if (!user) return; // Доступ запрещён или ошибка

  // 2. Обработка сообщения (user гарантированно существует и активен)
  // ... существующая логика обработки ...
});
```

### Обработка команды /start

```js
bot.onText(/\/start/, async (msg) => {
  const user = await getOrCreateUser(msg);

  const isNewUser = user.created_at.getTime() > Date.now() - 5000; // Создан менее 5 секунд назад

  if (isNewUser) {
    await bot.sendMessage(msg.chat.id,
      'Добро пожаловать! Я -- Secretary Bot, ваш AI-секретарь.\n\n' +
      'Я могу:\n' +
      '- Управлять вашим календарём\n' +
      '- Создавать заметки и задачи\n' +
      '- Отправлять утренний дайджест\n\n' +
      'Просто напишите мне, что вам нужно, текстом или голосовым сообщением.\n\n' +
      `Ваш тариф: ${user.subscription_tier} (${TIER_MESSAGE_LIMITS[user.subscription_tier]} сообщений/день)`
    );
  } else {
    await bot.sendMessage(msg.chat.id,
      `С возвращением! Ваш тариф: ${user.subscription_tier}.\n` +
      'Чем могу помочь?'
    );
  }
});
```

---

## 11. Чеклист безопасности

### Перед завершением Этапа 2: OWASP-style проверка

#### Аутентификация

- [ ] Пароли хешируются bcrypt с saltRounds >= 12
- [ ] Старые plain text пароли мигрированы в bcrypt хеши
- [ ] JWT access token с коротким TTL (15 минут)
- [ ] JWT refresh token с длинным TTL (7 дней)
- [ ] Access и refresh токены подписаны РАЗНЫМИ секретами
- [ ] JWT содержит `issuer` claim для дополнительной валидации
- [ ] Telegram Login Widget данные верифицируются через HMAC-SHA-256
- [ ] `auth_date` от Telegram проверяется на freshness (< 24 часов)
- [ ] Сравнение hash использует `crypto.timingSafeEqual` (защита от timing attacks)
- [ ] Ответ на неверный логин не раскрывает, что именно неверно (username vs password)

#### Авторизация

- [ ] Все API endpoints (кроме auth и health) требуют JWT
- [ ] `requireRole()` middleware проверяет роль пользователя
- [ ] Пользователь может получить/изменить только СВОИ данные (events, notes, tasks)
- [ ] Telegram пользователи проходят аутентификацию через `telegram_id`

#### Валидация

- [ ] Все входные данные валидируются zod-схемами
- [ ] Длина строк ограничена (username: 30, password: 128, content: 10000)
- [ ] Email проверяется на формат
- [ ] ID в URL параметрах проверяются на числовой формат
- [ ] Даты проверяются на ISO 8601 формат
- [ ] ENUM-поля проверяются на допустимые значения

#### HTTP Security

- [ ] `helmet()` подключён (Content-Security-Policy, X-Frame-Options, и др.)
- [ ] CORS настроен с whitelist доменов (не `*`)
- [ ] `express.json({ limit: '1mb' })` -- ограничение размера body
- [ ] Заголовки `X-RateLimit-*` отправляются клиенту

#### Rate Limiting

- [ ] Глобальный rate limit: 100 req/min per IP
- [ ] Auth endpoints: 5 req/min per IP
- [ ] Chat сообщения: лимит по тарифу пользователя per day
- [ ] Health endpoints исключены из rate limiting

#### Обработка ошибок

- [ ] Глобальный error handler ловит ВСЕ ошибки
- [ ] Operational errors (AppError) -- отправляется сообщение клиенту
- [ ] Programming errors (баги) -- generic сообщение клиенту, полный stack в логи
- [ ] В production НЕ отправляется stack trace клиенту
- [ ] Async контроллеры обёрнуты в `asyncHandler()`

#### Логирование

- [ ] Все HTTP-запросы логируются (method, url, status, responseTime, userId)
- [ ] Пароли НЕ попадают в логи
- [ ] JWT токены НЕ попадают в логи
- [ ] Rate limit violations логируются на уровне warn
- [ ] Unexpected errors логируются на уровне error с stack trace

#### Секреты

- [ ] `JWT_ACCESS_SECRET` и `JWT_REFRESH_SECRET` -- разные, минимум 32 символа
- [ ] Все секреты в `.env`, не в коде
- [ ] `.env` в `.gitignore`
- [ ] `.env.example` содержит все нужные переменные (без значений)

---

## Порядок реализации (рекомендуемый)

```
День 1:
  1. src/utils/errors.js (все классы ошибок)
  2. src/utils/crypto.js (bcrypt helpers)
  3. src/middleware/errorHandler.js (глобальный обработчик)
  4. src/middleware/requestLogger.js (логирование запросов)
  5. Миграция паролей (hash existing passwords)
  6. Хуки beforeCreate/beforeUpdate в модели User

День 2:
  7. src/middleware/auth.js (JWT: generateTokenPair, verifyToken, requireRole)
  8. src/utils/validators.js (все zod-схемы)
  9. src/middleware/validator.js (validate middleware)
  10. src/utils/telegramAuth.js (верификация Telegram Login Widget)
  11. src/routes/auth.routes.js + src/controllers/auth.controller.js

День 3:
  12. src/middleware/rateLimiter.js (global + auth + per-user)
  13. helmet + CORS настройка в src/app.js
  14. Ограничение доступа к Telegram боту (authenticateTelegramUser)
  15. Интеграционное тестирование всех auth endpoints
  16. Прогон по чеклисту безопасности
```

---

## Зависимости от предыдущих этапов

| Требование | Откуда | Этап |
|------------|--------|------|
| Модель User с полем `password_hash` | Рефакторинг User модели | Этап 1 |
| Модель User с полем `telegram_id` | Рефакторинг User модели | Этап 1 |
| Модель User с полем `subscription_tier` | Рефакторинг User модели | Этап 1 |
| Модель User с полем `is_active` | Рефакторинг User модели | Этап 1 |
| Модель Message с `created_at` | Рефакторинг Message модели | Этап 1 |
| Модель Session с `user_id` | Рефакторинг Session модели | Этап 1 |
| `src/config/index.js` с zod-валидацией | Централизованная конфигурация | Этап 0 |
| `src/config/logger.js` (Winston singleton) | Централизованное логирование | Этап 0 |
| Sequelize CLI миграции | Переход на миграции | Этап 1 |

---

## Что НЕ входит в этот этап

- OAuth2 для Google сервисов (Этап 6: Интеграции)
- Stripe webhook signature verification (Этап 8: Монетизация)
- Redis-backed rate limiting (Этап 9: DevOps)
- HTTPS/TLS настройка (Этап 9: DevOps)
- Автоматические security тесты (Этап 9: DevOps)
- 2FA / Multi-factor authentication (будущее)
