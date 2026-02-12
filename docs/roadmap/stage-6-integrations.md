# Этап 6: Интеграции — Google сервисы через MCP

> **Срок:** 5-7 дней
> **Зависимости:** Этап 4 (Claude + MCP), Этап 5 (Telegram Pro)
> **Результат:** Полноценные интеграции Google Calendar, Gmail, Google Drive/Docs через MCP-серверы. Per-user OAuth. Голосовые ответы (TTS).
> **Принцип:** Бэкенд НИКОГДА не вызывает Google API напрямую. Все Google-сервисы работают исключительно через MCP-серверы.

---

## Оглавление

1. [Обзор этапа](#1-обзор-этапа)
2. [Per-user OAuth flow](#2-per-user-oauth-flow)
3. [Модель OAuthToken и миграция](#3-модель-oauthtoken-и-миграция)
4. [Google Calendar через MCP](#4-google-calendar-через-mcp)
5. [Gmail через MCP](#5-gmail-через-mcp)
6. [Google Drive/Docs через MCP](#6-google-drivedocs-через-mcp)
7. [MCP Manager обновление](#7-mcp-manager-обновление)
8. [Telegram команда /connect](#8-telegram-команда-connect)
9. [Telegram команда /integrations](#9-telegram-команда-integrations)
10. [Tool definitions обновление](#10-tool-definitions-обновление)
11. [Обработка ошибок интеграций](#11-обработка-ошибок-интеграций)
12. [Yandex SpeechKit TTS](#12-yandex-speechkit-tts)
13. [Чеклист готовности](#13-чеклист-готовности)

---

## 1. Обзор этапа

### Что было ДО этого этапа (Stage 4-5)

После этапов 4 и 5 у нас есть:
- Claude API с tool_use (claudeHandler.js, intentParser.js, promptBuilder.js, modelRouter.js)
- MCP-инфраструктура (mcpManager.js, mcpRouter.js, mcpConfig.js) — каркас без реальных интеграций
- Модернизированный Telegram-бот с командами, inline keyboards, обработчиками
- toolDefinitions.js с базовыми инструментами (заметки, задачи, события из локальной БД)
- messageProcessor.js — единый pipeline обработки сообщений

### Что добавляет этот этап

```
БЫЛО (Stage 5):                         СТАЛО (Stage 6):

Claude → tool_use → локальная БД        Claude → tool_use → MCP → Google Calendar
                                        Claude → tool_use → MCP → Gmail
                                        Claude → tool_use → MCP → Google Drive

OAuth: один пользователь (env)          OAuth: per-user, шифрование токенов

Нет голосовых ответов                   Yandex TTS: бот отвечает голосом
```

### Архитектура интеграций

```
┌─────────────────────────────────────────────────────────────┐
│                    Telegram / REST API                       │
│                         (User)                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    messageProcessor.js                       │
│  1. Загрузить connected services пользователя               │
│  2. Отправить в Claude с актуальными tools                  │
│  3. Получить tool_use → маршрутизировать через MCP          │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
┌──────────────────┐ ┌────────────┐ ┌──────────────┐
│ Google Calendar  │ │   Gmail    │ │ Google Drive  │
│   MCP Server     │ │ MCP Server │ │  MCP Server   │
│                  │ │            │ │               │
│ Per-user OAuth   │ │ Per-user   │ │ Per-user      │
│ credentials      │ │ OAuth creds│ │ OAuth creds   │
└──────────────────┘ └────────────┘ └──────────────┘
         │                  │              │
         ▼                  ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Google Cloud APIs                         │
│           (Calendar API, Gmail API, Drive API)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Per-user OAuth flow

### Текущая проблема

Сейчас Google OAuth работает на одного пользователя: токены хранятся в `.env` (`GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`, `GCAL_REFRESH_TOKEN`, `GOOGLE_ACCESS_TOKEN`). Для коммерческого продукта нужен per-user OAuth — каждый пользователь подключает свой Google-аккаунт.

### Принцип работы

```
1. Пользователь → /connect в Telegram (или кнопка в веб-UI)
2. Бот → генерирует уникальную OAuth URL с state=JWT(user_id)
3. Пользователь → переходит по ссылке → Google consent screen
4. Google → callback на наш сервер с authorization code
5. Сервер → обменивает code на access_token + refresh_token
6. Сервер → шифрует токены AES-256-GCM → сохраняет в OAuthToken
7. Бот → уведомляет пользователя: "Google Calendar подключён ✓"
```

### Файл: `src/routes/integrations.routes.js`

```javascript
// src/routes/integrations.routes.js
import { Router } from 'express';
import { integrationsController } from '../controllers/integrations.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Начать OAuth flow — требует JWT (знаем user_id)
// GET /api/v1/integrations/google/auth?service=calendar
router.get('/google/auth', authenticate, integrationsController.initiateGoogleOAuth);

// OAuth callback от Google — JWT не нужен, user_id в state параметре
// GET /api/v1/integrations/google/callback?code=...&state=...
router.get('/google/callback', integrationsController.handleGoogleCallback);

// Статус подключённых интеграций
// GET /api/v1/integrations/status
router.get('/status', authenticate, integrationsController.getStatus);

// Отключить интеграцию
// DELETE /api/v1/integrations/google?service=calendar
router.delete('/google', authenticate, integrationsController.disconnectGoogle);

export default router;
```

### Файл: `src/controllers/integrations.controller.js`

```javascript
// src/controllers/integrations.controller.js
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { OAuthToken } from '../models/index.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';
import config from '../config/index.js';
import logger from '../config/logger.js';

// Scopes по сервисам
const SERVICE_SCOPES = {
  calendar: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  drive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
  ],
};

// Все scopes при полном подключении Google
const ALL_GOOGLE_SCOPES = [
  ...SERVICE_SCOPES.calendar,
  ...SERVICE_SCOPES.gmail,
  ...SERVICE_SCOPES.drive,
];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.callbackUrl // например: https://yourdomain.com/api/v1/integrations/google/callback
  );
}

export const integrationsController = {
  /**
   * Начать OAuth flow.
   * Генерирует URL для Google consent screen.
   * state содержит JWT с user_id — чтобы при callback знать, чей это токен.
   */
  async initiateGoogleOAuth(req, res, next) {
    try {
      const userId = req.user.id;
      const service = req.query.service || 'all'; // calendar | gmail | drive | all

      const scopes = service === 'all'
        ? ALL_GOOGLE_SCOPES
        : SERVICE_SCOPES[service];

      if (!scopes) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Неизвестный сервис: ${service}` },
        });
      }

      // state = подписанный JWT с user_id и запрошенным сервисом
      // Срок жизни 10 минут — пользователь должен завершить OAuth за это время
      const state = jwt.sign(
        { userId, service },
        config.jwt.secret,
        { expiresIn: '10m' }
      );

      const oauth2Client = createOAuth2Client();

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',     // получить refresh_token
        prompt: 'consent',          // всегда показывать consent screen (для refresh_token)
        scope: scopes,
        state,
      });

      res.json({
        success: true,
        data: { authUrl },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * OAuth callback от Google.
   * Обменивает authorization code на токены, шифрует и сохраняет.
   */
  async handleGoogleCallback(req, res, next) {
    try {
      const { code, state } = req.query;

      if (!code || !state) {
        return res.status(400).send('Отсутствуют обязательные параметры (code, state).');
      }

      // Верифицируем state — извлекаем user_id
      let payload;
      try {
        payload = jwt.verify(state, config.jwt.secret);
      } catch {
        return res.status(400).send('Недействительный или истёкший state параметр. Попробуйте /connect заново.');
      }

      const { userId, service } = payload;

      // Обменять code на токены
      const oauth2Client = createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      // tokens содержит: access_token, refresh_token, expiry_date, scope, token_type

      if (!tokens.refresh_token) {
        logger.warn(`OAuth callback для user ${userId}: refresh_token отсутствует. Пользователь возможно уже давал consent ранее.`);
      }

      // Шифруем токены перед сохранением
      const encryptedAccess = encryptToken(tokens.access_token);
      const encryptedRefresh = tokens.refresh_token
        ? encryptToken(tokens.refresh_token)
        : null;

      // Определяем scopes из ответа Google
      const grantedScopes = tokens.scope ? tokens.scope.split(' ') : [];

      // Upsert — обновляем если уже есть, создаём если нет
      await OAuthToken.upsert({
        user_id: userId,
        provider: 'google',
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        expires_at: new Date(tokens.expiry_date),
        scopes: grantedScopes,
      });

      logger.info(`Google OAuth завершён для user ${userId}. Scopes: ${grantedScopes.join(', ')}`);

      // Перенаправляем на страницу успеха
      // В Telegram-сценарии — закрываем вкладку браузера, бот уведомит в чате
      res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2>Google подключён успешно!</h2>
            <p>Можете закрыть эту вкладку и вернуться в Telegram.</p>
          </body>
        </html>
      `);

      // Уведомить пользователя через Telegram (если есть telegram_id)
      // Это делается через event emitter или напрямую через bot instance
      // Реализация в разделе "Telegram команда /connect"

    } catch (error) {
      logger.error('Google OAuth callback error:', error);
      res.status(500).send('Ошибка при подключении Google. Попробуйте позже.');
    }
  },

  /**
   * Статус подключённых интеграций.
   */
  async getStatus(req, res, next) {
    try {
      const userId = req.user.id;

      const tokens = await OAuthToken.findAll({
        where: { user_id: userId },
        attributes: ['provider', 'scopes', 'expires_at', 'updated_at'],
      });

      const integrations = {};

      for (const token of tokens) {
        const isExpired = new Date(token.expires_at) < new Date();
        // Access token может быть expired, но refresh_token позволит обновить
        // Статус "connected" если есть запись, "expired" если нет refresh
        integrations[token.provider] = {
          status: 'connected',
          scopes: token.scopes,
          access_token_expired: isExpired,
          connected_at: token.updated_at,
        };
      }

      // Добавляем все возможные провайдеры со статусом disconnected
      for (const provider of ['google', 'yandex', 'notion', 'slack']) {
        if (!integrations[provider]) {
          integrations[provider] = { status: 'disconnected' };
        }
      }

      res.json({ success: true, data: integrations });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Отключить интеграцию — удалить OAuth-токены.
   */
  async disconnectGoogle(req, res, next) {
    try {
      const userId = req.user.id;

      const deleted = await OAuthToken.destroy({
        where: { user_id: userId, provider: 'google' },
      });

      if (deleted === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Google интеграция не найдена' },
        });
      }

      logger.info(`Google отключён для user ${userId}`);

      res.json({
        success: true,
        data: { message: 'Google интеграция отключена' },
      });
    } catch (error) {
      next(error);
    }
  },
};
```

### Автоматическое обновление токенов

```javascript
// src/services/integrations/oauthRefresher.js
import { google } from 'googleapis';
import { OAuthToken } from '../../models/index.js';
import { encryptToken, decryptToken } from '../../utils/crypto.js';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

/**
 * Получить расшифрованные токены пользователя для Google.
 * Если access_token истёк — автоматически обновить через refresh_token.
 *
 * @param {number} userId
 * @returns {{ accessToken: string, refreshToken: string } | null}
 */
export async function getGoogleTokens(userId) {
  const oauthRecord = await OAuthToken.findOne({
    where: { user_id: userId, provider: 'google' },
  });

  if (!oauthRecord) {
    return null; // Google не подключён
  }

  const now = new Date();
  const expiresAt = new Date(oauthRecord.expires_at);
  const bufferMs = 5 * 60 * 1000; // обновляем за 5 минут до истечения

  // Если access_token ещё валиден — возвращаем как есть
  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    return {
      accessToken: decryptToken(oauthRecord.access_token),
      refreshToken: oauthRecord.refresh_token
        ? decryptToken(oauthRecord.refresh_token)
        : null,
    };
  }

  // Access token истёк или скоро истечёт — обновляем
  if (!oauthRecord.refresh_token) {
    logger.warn(`User ${userId}: access_token истёк, refresh_token отсутствует. Требуется повторная авторизация.`);
    return null;
  }

  try {
    const refreshToken = decryptToken(oauthRecord.refresh_token);

    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.callbackUrl
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    // Сохраняем обновлённый access_token
    const encryptedAccess = encryptToken(credentials.access_token);

    await oauthRecord.update({
      access_token: encryptedAccess,
      expires_at: new Date(credentials.expiry_date),
    });

    logger.info(`Access token обновлён для user ${userId}`);

    return {
      accessToken: credentials.access_token,
      refreshToken,
    };
  } catch (error) {
    logger.error(`Ошибка обновления токена для user ${userId}:`, error);

    // Если refresh_token отозван — помечаем
    if (error.response?.data?.error === 'invalid_grant') {
      logger.warn(`Refresh token отозван для user ${userId}. Удаляем запись.`);
      await oauthRecord.destroy();
    }

    return null;
  }
}

/**
 * Проверить, подключён ли конкретный Google-сервис у пользователя.
 *
 * @param {number} userId
 * @param {string} service - 'calendar' | 'gmail' | 'drive'
 * @returns {boolean}
 */
export async function isServiceConnected(userId, service) {
  const oauthRecord = await OAuthToken.findOne({
    where: { user_id: userId, provider: 'google' },
    attributes: ['scopes'],
  });

  if (!oauthRecord || !oauthRecord.scopes) return false;

  const requiredScopes = {
    calendar: 'https://www.googleapis.com/auth/calendar',
    gmail: 'https://www.googleapis.com/auth/gmail.readonly',
    drive: 'https://www.googleapis.com/auth/drive',
  };

  return oauthRecord.scopes.includes(requiredScopes[service]);
}
```

---

## 3. Модель OAuthToken и миграция

### Файл миграции: `src/migrations/XXXXXXX-create-oauth-tokens.js`

```javascript
// src/migrations/20260215000001-create-oauth-tokens.js
'use strict';

export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('oauth_tokens', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      provider: {
        type: Sequelize.ENUM('google', 'yandex', 'notion', 'slack'),
        allowNull: false,
      },
      access_token: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Зашифрован AES-256-GCM',
      },
      refresh_token: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Зашифрован AES-256-GCM',
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      scopes: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    // UNIQUE constraint: один провайдер на пользователя
    await queryInterface.addIndex('oauth_tokens', ['user_id', 'provider'], {
      unique: true,
      name: 'oauth_tokens_user_provider_unique',
    });

    // Индекс для cron-задачи обновления истекающих токенов
    await queryInterface.addIndex('oauth_tokens', ['expires_at'], {
      name: 'oauth_tokens_expires_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('oauth_tokens');
  },
};
```

### Модель: `src/models/OAuthToken.js`

```javascript
// src/models/OAuthToken.js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const OAuthToken = sequelize.define('OAuthToken', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
    },
    provider: {
      type: DataTypes.ENUM('google', 'yandex', 'notion', 'slack'),
      allowNull: false,
    },
    access_token: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Зашифрован AES-256-GCM',
    },
    refresh_token: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Зашифрован AES-256-GCM',
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    scopes: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
    },
  }, {
    tableName: 'oauth_tokens',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'provider'],
        name: 'oauth_tokens_user_provider_unique',
      },
    ],
  });

  OAuthToken.associate = (models) => {
    OAuthToken.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
    });
  };

  return OAuthToken;
};
```

### Утилита шифрования: `src/utils/crypto.js`

```javascript
// src/utils/crypto.js
import crypto from 'node:crypto';
import config from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;      // 128 бит
const AUTH_TAG_LENGTH = 16; // 128 бит
const KEY_LENGTH = 32;      // 256 бит

/**
 * Получить ключ шифрования из конфига.
 * TOKEN_ENCRYPTION_KEY должен быть 64-символьной hex-строкой (32 байта).
 * Генерация: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function getEncryptionKey() {
  const keyHex = config.security.tokenEncryptionKey;

  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY должен быть 64-символьной hex-строкой (256 бит). ' +
      'Сгенерируйте: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Зашифровать строку (OAuth-токен) с помощью AES-256-GCM.
 *
 * Формат результата: base64( IV(16 bytes) + ciphertext + authTag(16 bytes) )
 *
 * @param {string} plaintext — токен в открытом виде
 * @returns {string} — зашифрованный токен (base64)
 */
export function encryptToken(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Собираем: IV + ciphertext + authTag
  const combined = Buffer.concat([iv, encrypted, authTag]);

  return combined.toString('base64');
}

/**
 * Расшифровать строку (OAuth-токен) из AES-256-GCM.
 *
 * @param {string} encryptedBase64 — зашифрованный токен (base64)
 * @returns {string} — токен в открытом виде
 * @throws {Error} — если расшифровка не удалась (неверный ключ, повреждённые данные)
 */
export function decryptToken(encryptedBase64) {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, 'base64');

  // Разбираем: IV(16) + ciphertext(N) + authTag(16)
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
```

### Переменная окружения

Добавить в `.env` и `.env.example`:

```env
# Ключ шифрования для OAuth-токенов (64 hex символа = 256 бит)
# Генерация: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=ваш_64_символьный_hex_ключ_здесь
```

Добавить в `src/config/index.js`:

```javascript
// В секцию security:
security: {
  // ... существующие поля ...
  tokenEncryptionKey: z.string().length(64).parse(process.env.TOKEN_ENCRYPTION_KEY),
},
```

---

## 4. Google Calendar через MCP

### Конфигурация MCP-сервера

MCP-сервер Google Calendar запускается как отдельный процесс. Наш бэкенд выступает MCP-клиентом и передаёт запросы от Claude к серверу.

```javascript
// src/services/mcp/mcpConfig.js — обновлённая секция Google Calendar

export const MCP_SERVERS = {
  'google-calendar': {
    // npm-пакет MCP-сервера
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-google-calendar'],
    // Переменные окружения передаются при запуске сервера
    // Для per-user: подставляются динамически из OAuthToken
    envTemplate: {
      GOOGLE_CLIENT_ID: '${config.google.clientId}',
      GOOGLE_CLIENT_SECRET: '${config.google.clientSecret}',
      GOOGLE_ACCESS_TOKEN: '${userTokens.accessToken}',
      GOOGLE_REFRESH_TOKEN: '${userTokens.refreshToken}',
    },
    // Какие tool_use имена маршрутизировать на этот сервер
    tools: [
      'create_calendar_event',
      'update_calendar_event',
      'delete_calendar_event',
      'list_calendar_events',
      'get_events_for_date_range',
    ],
    // Требуемый scope в OAuthToken
    requiredScope: 'https://www.googleapis.com/auth/calendar',
  },

  'gmail': {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-gmail'],
    envTemplate: {
      GOOGLE_CLIENT_ID: '${config.google.clientId}',
      GOOGLE_CLIENT_SECRET: '${config.google.clientSecret}',
      GOOGLE_ACCESS_TOKEN: '${userTokens.accessToken}',
      GOOGLE_REFRESH_TOKEN: '${userTokens.refreshToken}',
    },
    tools: [
      'search_emails',
      'read_email',
      'send_email',
      'reply_to_email',
      'list_unread_emails',
    ],
    requiredScope: 'https://www.googleapis.com/auth/gmail.readonly',
  },

  'google-drive': {
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-google-drive'],
    envTemplate: {
      GOOGLE_CLIENT_ID: '${config.google.clientId}',
      GOOGLE_CLIENT_SECRET: '${config.google.clientSecret}',
      GOOGLE_ACCESS_TOKEN: '${userTokens.accessToken}',
      GOOGLE_REFRESH_TOKEN: '${userTokens.refreshToken}',
    },
    tools: [
      'create_document',
      'edit_document',
      'list_files',
      'search_files',
      'create_from_template',
    ],
    requiredScope: 'https://www.googleapis.com/auth/drive',
  },
};

/**
 * Получить конфигурацию MCP-сервера с подставленными токенами пользователя.
 */
export function getMcpServerConfig(serverName, userTokens) {
  const template = MCP_SERVERS[serverName];
  if (!template) throw new Error(`Неизвестный MCP-сервер: ${serverName}`);

  const env = {};
  for (const [key, valueTemplate] of Object.entries(template.envTemplate)) {
    env[key] = valueTemplate
      .replace('${config.google.clientId}', config.google.clientId)
      .replace('${config.google.clientSecret}', config.google.clientSecret)
      .replace('${userTokens.accessToken}', userTokens.accessToken || '')
      .replace('${userTokens.refreshToken}', userTokens.refreshToken || '');
  }

  return {
    command: template.command,
    args: template.args,
    env,
  };
}

/**
 * Определить, какой MCP-сервер обслуживает данный tool_use.
 */
export function getServerForTool(toolName) {
  for (const [serverName, serverConfig] of Object.entries(MCP_SERVERS)) {
    if (serverConfig.tools.includes(toolName)) {
      return serverName;
    }
  }
  return null;
}
```

### Маппинг инструментов Google Calendar

Claude использует tool_use для вызова инструментов. Вот как выглядят определения инструментов календаря, которые Claude будет «видеть»:

```javascript
// В toolDefinitions.js — секция Calendar tools

export const calendarTools = [
  {
    name: 'create_calendar_event',
    description: 'Создать новое событие в Google Calendar пользователя. Используй когда пользователь просит создать встречу, напоминание, событие.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Название события (например: "Встреча с Иваном")',
        },
        start_time: {
          type: 'string',
          description: 'Время начала в ISO 8601 (например: "2026-02-13T10:00:00+04:00")',
        },
        end_time: {
          type: 'string',
          description: 'Время окончания в ISO 8601 (например: "2026-02-13T11:00:00+04:00")',
        },
        description: {
          type: 'string',
          description: 'Описание события (опционально)',
        },
        location: {
          type: 'string',
          description: 'Место проведения (опционально)',
        },
      },
      required: ['summary', 'start_time', 'end_time'],
    },
  },

  {
    name: 'update_calendar_event',
    description: 'Обновить существующее событие в Google Calendar. Используй когда пользователь просит перенести, изменить встречу.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: {
          type: 'string',
          description: 'ID события в Google Calendar',
        },
        summary: { type: 'string', description: 'Новое название (опционально)' },
        start_time: { type: 'string', description: 'Новое время начала ISO 8601 (опционально)' },
        end_time: { type: 'string', description: 'Новое время окончания ISO 8601 (опционально)' },
        description: { type: 'string', description: 'Новое описание (опционально)' },
      },
      required: ['event_id'],
    },
  },

  {
    name: 'delete_calendar_event',
    description: 'Удалить событие из Google Calendar. Используй когда пользователь просит удалить/отменить встречу.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: {
          type: 'string',
          description: 'ID события в Google Calendar',
        },
      },
      required: ['event_id'],
    },
  },

  {
    name: 'list_calendar_events',
    description: 'Получить список событий из Google Calendar за указанный период. Используй когда пользователь спрашивает про расписание, план на день/неделю.',
    input_schema: {
      type: 'object',
      properties: {
        time_min: {
          type: 'string',
          description: 'Начало периода ISO 8601 (например: "2026-02-13T00:00:00+04:00")',
        },
        time_max: {
          type: 'string',
          description: 'Конец периода ISO 8601 (например: "2026-02-14T00:00:00+04:00")',
        },
        max_results: {
          type: 'integer',
          description: 'Максимальное количество событий (по умолчанию 20)',
        },
      },
      required: ['time_min', 'time_max'],
    },
  },
];
```

### Тестовые сценарии Google Calendar

| Пользователь говорит | Claude вызывает | Параметры |
|---|---|---|
| "Создай встречу завтра в 10" | `create_calendar_event` | summary: "Встреча", start_time: завтра 10:00, end_time: завтра 11:00 |
| "Покажи расписание на неделю" | `list_calendar_events` | time_min: начало недели, time_max: конец недели |
| "Перенеси встречу с Иваном на 15:00" | `list_calendar_events` затем `update_calendar_event` | Сначала найти событие, потом обновить |
| "Удали встречу с Иваном" | `list_calendar_events` затем `delete_calendar_event` | Сначала найти event_id, потом удалить |
| "Что у меня сегодня?" | `list_calendar_events` | time_min: сегодня 00:00, time_max: сегодня 23:59 |
| "Создай ежедневную планёрку в 9:00 на неделю" | `create_calendar_event` (несколько раз или с recurrence) | С RRULE для повторяющихся событий |

---

## 5. Gmail через MCP

### Конфигурация

Конфигурация Gmail MCP-сервера уже описана в `mcpConfig.js` (раздел 4). Вот определения инструментов:

```javascript
// В toolDefinitions.js — секция Gmail tools

export const gmailTools = [
  {
    name: 'list_unread_emails',
    description: 'Получить список непрочитанных писем из Gmail. Используй когда пользователь спрашивает про новые/непрочитанные письма.',
    input_schema: {
      type: 'object',
      properties: {
        max_results: {
          type: 'integer',
          description: 'Максимальное количество писем (по умолчанию 10)',
        },
      },
    },
  },

  {
    name: 'search_emails',
    description: 'Поиск писем в Gmail по запросу. Используй когда пользователь ищет конкретные письма.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (как в Gmail: from:ivan@mail.ru subject:отчёт)',
        },
        max_results: {
          type: 'integer',
          description: 'Максимальное количество результатов (по умолчанию 10)',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'read_email',
    description: 'Прочитать содержимое конкретного письма по ID. Используй после list/search чтобы показать текст письма.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'ID письма в Gmail',
        },
      },
      required: ['message_id'],
    },
  },

  {
    name: 'send_email',
    description: 'Отправить новое письмо через Gmail. Используй когда пользователь просит написать/отправить письмо.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Email получателя',
        },
        subject: {
          type: 'string',
          description: 'Тема письма',
        },
        body: {
          type: 'string',
          description: 'Текст письма (plain text или HTML)',
        },
        cc: {
          type: 'string',
          description: 'Копия (опционально)',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },

  {
    name: 'reply_to_email',
    description: 'Ответить на существующее письмо. Используй когда пользователь просит ответить на конкретное письмо.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'ID оригинального письма',
        },
        body: {
          type: 'string',
          description: 'Текст ответа',
        },
      },
      required: ['message_id', 'body'],
    },
  },
];
```

### Тестовые сценарии Gmail

| Пользователь говорит | Claude вызывает | Параметры |
|---|---|---|
| "Проверь непрочитанные письма" | `list_unread_emails` | max_results: 10 |
| "Отправь письмо Ивану на ivan@mail.ru" | `send_email` | to: ivan@mail.ru, subject + body — Claude спросит детали |
| "Найди письма от клиента Acme" | `search_emails` | query: "from:*@acme.com" или "Acme" |
| "Покажи последнее письмо от Петрова" | `search_emails` затем `read_email` | Поиск, затем чтение |
| "Ответь на это письмо: Спасибо, принято!" | `reply_to_email` | message_id: из контекста, body: "Спасибо, принято!" |

---

## 6. Google Drive/Docs через MCP

### Определения инструментов

```javascript
// В toolDefinitions.js — секция Drive/Docs tools

export const driveTools = [
  {
    name: 'create_document',
    description: 'Создать новый Google Doc. Используй для создания протоколов, отчётов, писем.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Название документа',
        },
        content: {
          type: 'string',
          description: 'Текстовое содержимое документа (поддерживает Markdown)',
        },
        folder_id: {
          type: 'string',
          description: 'ID папки в Google Drive (опционально)',
        },
      },
      required: ['title', 'content'],
    },
  },

  {
    name: 'edit_document',
    description: 'Редактировать существующий Google Doc. Используй для обновления содержимого документа.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'ID документа в Google Drive',
        },
        content: {
          type: 'string',
          description: 'Новое содержимое (полная замена или дополнение)',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: 'Режим: replace (полная замена) или append (добавить в конец)',
        },
      },
      required: ['document_id', 'content'],
    },
  },

  {
    name: 'list_files',
    description: 'Список файлов в Google Drive. Используй когда пользователь спрашивает про свои файлы/документы.',
    input_schema: {
      type: 'object',
      properties: {
        folder_id: {
          type: 'string',
          description: 'ID папки (по умолчанию — корневая папка)',
        },
        file_type: {
          type: 'string',
          enum: ['document', 'spreadsheet', 'presentation', 'all'],
          description: 'Тип файлов для фильтрации (по умолчанию: all)',
        },
        max_results: {
          type: 'integer',
          description: 'Максимум файлов (по умолчанию 20)',
        },
      },
    },
  },

  {
    name: 'search_files',
    description: 'Поиск файлов в Google Drive по названию или содержимому.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос (по названию файла или содержимому)',
        },
        file_type: {
          type: 'string',
          enum: ['document', 'spreadsheet', 'presentation', 'all'],
          description: 'Тип файлов (опционально)',
        },
      },
      required: ['query'],
    },
  },

  {
    name: 'create_from_template',
    description: 'Создать документ на основе шаблона. Используй для типовых документов: письма на бланке, договоры, коммерческие предложения.',
    input_schema: {
      type: 'object',
      properties: {
        template_id: {
          type: 'string',
          description: 'ID шаблона в Google Drive',
        },
        title: {
          type: 'string',
          description: 'Название нового документа',
        },
        replacements: {
          type: 'object',
          description: 'Замены в шаблоне: { "{{ИМЯ}}": "Иван Петров", "{{ДАТА}}": "12.02.2026" }',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['template_id', 'title'],
    },
  },
];
```

### Тестовые сценарии Google Drive/Docs

| Пользователь говорит | Claude вызывает | Описание |
|---|---|---|
| "Создай протокол встречи" | `create_document` | Claude спросит детали и создаст документ с форматированием |
| "Напиши письмо на бланке компании" | `create_from_template` | Использует шаблон из Drive |
| "Найди документ с бюджетом" | `search_files` | Поиск по ключевому слову |
| "Покажи мои недавние файлы" | `list_files` | Список файлов из корня |
| "Добавь в протокол пункт о дедлайне" | `edit_document` | mode: append, добавить пункт |

---

## 7. MCP Manager обновление

### Задачи обновления

MCP Manager из этапа 4 управлял статическим набором серверов. Теперь нужно:
1. **Per-user серверы** — запускать MCP-серверы с credentials конкретного пользователя
2. **Пул серверов** — не создавать новый сервер на каждый запрос
3. **Конкурентность** — обрабатывать запросы от нескольких пользователей одновременно
4. **Idle cleanup** — останавливать серверы неактивных пользователей
5. **Graceful restart** — перезапускать упавшие серверы

### Файл: `src/services/mcp/mcpManager.js` (обновлённый)

```javascript
// src/services/mcp/mcpManager.js
import { Client } from '@anthropic-ai/mcp-client';
import { getMcpServerConfig, getServerForTool } from './mcpConfig.js';
import { getGoogleTokens } from '../integrations/oauthRefresher.js';
import logger from '../../config/logger.js';

// Ключ пула: `${userId}:${serverName}`
// Значение: { client, process, lastUsed, status }
const serverPool = new Map();

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 минут бездействия → остановить сервер
const MAX_SERVERS_PER_USER = 3;          // calendar + gmail + drive
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // проверка здоровья раз в минуту

/**
 * Получить ключ пула для пользователя и сервера.
 */
function poolKey(userId, serverName) {
  return `${userId}:${serverName}`;
}

/**
 * Запустить MCP-сервер для конкретного пользователя.
 * Если сервер уже запущен — вернуть существующий.
 */
async function getOrCreateServer(userId, serverName) {
  const key = poolKey(userId, serverName);

  // Проверить существующий
  if (serverPool.has(key)) {
    const entry = serverPool.get(key);

    if (entry.status === 'running') {
      entry.lastUsed = Date.now();
      return entry.client;
    }

    // Сервер упал — удаляем и пересоздаём
    logger.warn(`MCP сервер ${key} в статусе ${entry.status}, пересоздаём`);
    await stopServer(key);
  }

  // Получить токены пользователя
  const userTokens = await getGoogleTokens(userId);

  if (!userTokens) {
    throw new Error(`Google не подключён для пользователя ${userId}. Используйте /connect.`);
  }

  // Получить конфигурацию сервера с подставленными токенами
  const serverConfig = getMcpServerConfig(serverName, userTokens);

  logger.info(`Запуск MCP сервера ${serverName} для user ${userId}`);

  try {
    const client = new Client();

    // Подключиться к MCP-серверу (запускается как subprocess)
    const serverProcess = await client.connectToServer({
      command: serverConfig.command,
      args: serverConfig.args,
      env: {
        ...process.env,
        ...serverConfig.env,
      },
    });

    const entry = {
      client,
      process: serverProcess,
      lastUsed: Date.now(),
      status: 'running',
      userId,
      serverName,
    };

    serverPool.set(key, entry);

    logger.info(`MCP сервер ${serverName} запущен для user ${userId}. Пул: ${serverPool.size} серверов`);

    return client;
  } catch (error) {
    logger.error(`Ошибка запуска MCP сервера ${serverName} для user ${userId}:`, error);
    throw new Error(`Не удалось запустить MCP-сервер ${serverName}: ${error.message}`);
  }
}

/**
 * Остановить MCP-сервер.
 */
async function stopServer(key) {
  const entry = serverPool.get(key);
  if (!entry) return;

  try {
    entry.status = 'stopping';
    await entry.client.disconnect();
    logger.info(`MCP сервер ${key} остановлен`);
  } catch (error) {
    logger.warn(`Ошибка при остановке MCP сервера ${key}:`, error.message);
  } finally {
    serverPool.delete(key);
  }
}

/**
 * Выполнить вызов инструмента через MCP.
 *
 * @param {number} userId — ID пользователя
 * @param {string} toolName — имя инструмента (например: create_calendar_event)
 * @param {object} toolInput — параметры инструмента
 * @returns {object} — результат вызова
 */
async function callTool(userId, toolName, toolInput) {
  // Определить, какой MCP-сервер обслуживает этот инструмент
  const serverName = getServerForTool(toolName);

  if (!serverName) {
    throw new Error(`Неизвестный MCP-инструмент: ${toolName}`);
  }

  // Получить или создать сервер
  const client = await getOrCreateServer(userId, serverName);

  try {
    // Вызвать инструмент через MCP-протокол
    const result = await client.callTool(toolName, toolInput);
    return result;
  } catch (error) {
    logger.error(`MCP tool call failed: ${toolName} для user ${userId}:`, error);

    // Если сервер упал — пометить и пробросить ошибку
    const key = poolKey(userId, serverName);
    const entry = serverPool.get(key);
    if (entry) {
      entry.status = 'failed';
    }

    throw error;
  }
}

/**
 * Остановить все серверы конкретного пользователя.
 */
async function stopUserServers(userId) {
  const keysToStop = [];

  for (const [key, entry] of serverPool) {
    if (entry.userId === userId) {
      keysToStop.push(key);
    }
  }

  await Promise.all(keysToStop.map(stopServer));
  logger.info(`Все MCP серверы пользователя ${userId} остановлены (${keysToStop.length} шт.)`);
}

/**
 * Очистить idle-серверы, которые не использовались дольше IDLE_TIMEOUT_MS.
 */
async function cleanupIdleServers() {
  const now = Date.now();
  const keysToStop = [];

  for (const [key, entry] of serverPool) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS && entry.status === 'running') {
      keysToStop.push(key);
    }
  }

  if (keysToStop.length > 0) {
    logger.info(`Cleanup: остановка ${keysToStop.length} idle MCP серверов`);
    await Promise.all(keysToStop.map(stopServer));
  }
}

/**
 * Graceful shutdown: остановить все MCP-серверы.
 */
async function shutdownAll() {
  logger.info(`Shutdown: остановка всех MCP серверов (${serverPool.size} шт.)`);
  const keys = [...serverPool.keys()];
  await Promise.all(keys.map(stopServer));
}

/**
 * Получить статистику пула.
 */
function getPoolStats() {
  const stats = {
    totalServers: serverPool.size,
    byServer: {},
    byUser: {},
  };

  for (const [key, entry] of serverPool) {
    // По серверам
    stats.byServer[entry.serverName] = (stats.byServer[entry.serverName] || 0) + 1;
    // По пользователям
    stats.byUser[entry.userId] = (stats.byUser[entry.userId] || 0) + 1;
  }

  return stats;
}

// Запускаем периодическую очистку idle серверов
const cleanupInterval = setInterval(cleanupIdleServers, HEALTH_CHECK_INTERVAL_MS);

// Для graceful shutdown — очистить interval
function clearCleanupInterval() {
  clearInterval(cleanupInterval);
}

export const mcpManager = {
  callTool,
  getOrCreateServer,
  stopServer,
  stopUserServers,
  shutdownAll,
  cleanupIdleServers,
  getPoolStats,
  clearCleanupInterval,
};
```

### Обновление `src/services/mcp/mcpRouter.js`

```javascript
// src/services/mcp/mcpRouter.js
import { mcpManager } from './mcpManager.js';
import { getServerForTool, MCP_SERVERS } from './mcpConfig.js';
import { isServiceConnected } from '../integrations/oauthRefresher.js';
import logger from '../../config/logger.js';

/**
 * Маршрутизация tool_use от Claude к MCP-серверам.
 *
 * Вызывается из messageProcessor.js когда Claude возвращает tool_use block.
 *
 * @param {number} userId — ID пользователя
 * @param {object} toolUse — tool_use блок из ответа Claude
 *   { id: 'toolu_xxx', name: 'create_calendar_event', input: { ... } }
 * @returns {object} — tool_result для отправки обратно в Claude
 */
export async function routeToolCall(userId, toolUse) {
  const { id: toolUseId, name: toolName, input: toolInput } = toolUse;

  logger.info(`MCP Router: tool_use ${toolName} от user ${userId}`, { toolInput });

  // Определить MCP-сервер
  const serverName = getServerForTool(toolName);

  // Если инструмент не MCP-based — вернуть null (обрабатывается локально)
  if (!serverName) {
    return null;
  }

  // Проверить, подключён ли нужный сервис
  const serverConfig = MCP_SERVERS[serverName];
  const serviceMap = {
    'google-calendar': 'calendar',
    'gmail': 'gmail',
    'google-drive': 'drive',
  };

  const service = serviceMap[serverName];
  const connected = await isServiceConnected(userId, service);

  if (!connected) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Сервис ${serverName} не подключён. Пользователю нужно подключить Google через команду /connect в Telegram.`,
      is_error: true,
    };
  }

  try {
    // Вызвать инструмент через MCP
    const result = await mcpManager.callTool(userId, toolName, toolInput);

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: typeof result === 'string' ? result : JSON.stringify(result),
    };
  } catch (error) {
    logger.error(`MCP Router: ошибка ${toolName} для user ${userId}:`, error);

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Ошибка при вызове ${toolName}: ${error.message}`,
      is_error: true,
    };
  }
}
```

---

## 8. Telegram команда /connect

### Реализация

```javascript
// src/services/platforms/telegram/handlers/commandHandler.js
// Добавить в существующий commandHandler

import { OAuthToken } from '../../../../models/index.js';
import config from '../../../../config/index.js';
import jwt from 'jsonwebtoken';

/**
 * Обработчик команды /connect — подключение внешних сервисов.
 */
export async function handleConnectCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg._user?.id; // user из middleware аутентификации Telegram

  if (!userId) {
    return bot.sendMessage(chatId, 'Сначала зарегистрируйтесь: /start');
  }

  // Проверяем текущий статус подключений
  const existingTokens = await OAuthToken.findAll({
    where: { user_id: userId, provider: 'google' },
    attributes: ['scopes'],
  });

  const connectedScopes = existingTokens.length > 0
    ? (existingTokens[0].scopes || [])
    : [];

  const hasCalendar = connectedScopes.some(s => s.includes('calendar'));
  const hasGmail = connectedScopes.some(s => s.includes('gmail'));
  const hasDrive = connectedScopes.some(s => s.includes('drive'));

  // Формируем inline keyboard
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: `${hasCalendar ? '✅' : '🔗'} Google Calendar`,
          callback_data: hasCalendar ? 'integration_info_calendar' : 'connect_google_calendar',
        },
      ],
      [
        {
          text: `${hasGmail ? '✅' : '🔗'} Gmail`,
          callback_data: hasGmail ? 'integration_info_gmail' : 'connect_google_gmail',
        },
      ],
      [
        {
          text: `${hasDrive ? '✅' : '🔗'} Google Drive`,
          callback_data: hasDrive ? 'integration_info_drive' : 'connect_google_drive',
        },
      ],
      [
        {
          text: '🔗 Подключить все Google сервисы',
          callback_data: 'connect_google_all',
        },
      ],
    ],
  };

  const statusText = [
    '*Подключение сервисов*\n',
    `Google Calendar: ${hasCalendar ? '✅ подключён' : '❌ не подключён'}`,
    `Gmail: ${hasGmail ? '✅ подключён' : '❌ не подключён'}`,
    `Google Drive: ${hasDrive ? '✅ подключён' : '❌ не подключён'}`,
    '\nВыберите сервис для подключения:',
  ].join('\n');

  await bot.sendMessage(chatId, statusText, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Обработчик callback_query для подключения Google.
 */
export async function handleConnectCallback(bot, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery._user?.id;
  const data = callbackQuery.data;

  if (!userId) {
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Ошибка: пользователь не найден',
    });
  }

  // Определить какой сервис подключать
  let service = 'all';
  if (data === 'connect_google_calendar') service = 'calendar';
  else if (data === 'connect_google_gmail') service = 'gmail';
  else if (data === 'connect_google_drive') service = 'drive';
  else if (data === 'connect_google_all') service = 'all';
  else if (data.startsWith('integration_info_')) {
    // Уже подключён — показать инфо
    return bot.answerCallbackQuery(callbackQuery.id, {
      text: 'Этот сервис уже подключён! Используйте /integrations для управления.',
      show_alert: true,
    });
  }

  // Генерируем OAuth URL
  const state = jwt.sign(
    { userId, service, chatId }, // chatId нужен для уведомления после callback
    config.jwt.secret,
    { expiresIn: '10m' }
  );

  const scopes = {
    calendar: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events',
    gmail: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    drive: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents',
    all: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
    ].join(' '),
  };

  const authUrl = [
    'https://accounts.google.com/o/oauth2/v2/auth',
    `?client_id=${config.google.clientId}`,
    `&redirect_uri=${encodeURIComponent(config.google.callbackUrl)}`,
    '&response_type=code',
    '&access_type=offline',
    '&prompt=consent',
    `&scope=${encodeURIComponent(scopes[service])}`,
    `&state=${state}`,
  ].join('');

  await bot.answerCallbackQuery(callbackQuery.id);

  const serviceNames = {
    calendar: 'Google Calendar',
    gmail: 'Gmail',
    drive: 'Google Drive',
    all: 'все Google сервисы',
  };

  await bot.sendMessage(chatId, [
    `Для подключения *${serviceNames[service]}* перейдите по ссылке:\n`,
    `[Подключить ${serviceNames[service]}](${authUrl})\n`,
    '_Ссылка действительна 10 минут._',
  ].join('\n'), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
}
```

### Уведомление после OAuth callback

В `integrations.controller.js` после успешного сохранения токенов нужно уведомить пользователя через Telegram:

```javascript
// В handleGoogleCallback, после upsert:

// Уведомить пользователя через Telegram
try {
  const { chatId } = payload; // из JWT state
  if (chatId) {
    // Импортировать bot singleton
    const { getBotInstance } = await import(
      '../../services/platforms/telegram/bot.js'
    );
    const bot = getBotInstance();

    const connectedServices = [];
    if (grantedScopes.some(s => s.includes('calendar'))) connectedServices.push('Google Calendar');
    if (grantedScopes.some(s => s.includes('gmail'))) connectedServices.push('Gmail');
    if (grantedScopes.some(s => s.includes('drive'))) connectedServices.push('Google Drive');

    await bot.sendMessage(chatId, [
      '✅ *Google подключён успешно!*\n',
      'Подключённые сервисы:',
      ...connectedServices.map(s => `  • ${s}`),
      '\nТеперь можете попросить меня:',
      '  • _"Покажи расписание на неделю"_',
      '  • _"Проверь непрочитанные письма"_',
      '  • _"Создай протокол встречи"_',
    ].join('\n'), { parse_mode: 'Markdown' });
  }
} catch (notifyError) {
  logger.warn('Не удалось уведомить пользователя через Telegram:', notifyError.message);
}
```

---

## 9. Telegram команда /integrations

### Реализация

```javascript
// src/services/platforms/telegram/handlers/commandHandler.js
// Добавить обработчик /integrations

import { OAuthToken } from '../../../../models/index.js';
import { mcpManager } from '../../../mcp/mcpManager.js';

/**
 * Обработчик команды /integrations — просмотр и управление подключёнными сервисами.
 */
export async function handleIntegrationsCommand(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg._user?.id;

  if (!userId) {
    return bot.sendMessage(chatId, 'Сначала зарегистрируйтесь: /start');
  }

  // Получить все OAuth-токены пользователя
  const tokens = await OAuthToken.findAll({
    where: { user_id: userId },
  });

  if (tokens.length === 0) {
    return bot.sendMessage(chatId, [
      '*Интеграции*\n',
      'У вас нет подключённых сервисов.\n',
      'Используйте /connect чтобы подключить Google Calendar, Gmail или Drive.',
    ].join('\n'), { parse_mode: 'Markdown' });
  }

  const lines = ['*Подключённые интеграции*\n'];
  const buttons = [];

  for (const token of tokens) {
    const isExpired = new Date(token.expires_at) < new Date();
    const scopes = token.scopes || [];

    const services = [];
    if (scopes.some(s => s.includes('calendar'))) services.push('Calendar');
    if (scopes.some(s => s.includes('gmail'))) services.push('Gmail');
    if (scopes.some(s => s.includes('drive') || s.includes('documents'))) services.push('Drive');

    const statusEmoji = isExpired ? '🔄' : '✅';
    const statusText = isExpired ? '(токен обновляется автоматически)' : '';

    lines.push(`${statusEmoji} *${token.provider.charAt(0).toUpperCase() + token.provider.slice(1)}*`);
    lines.push(`   Сервисы: ${services.join(', ') || 'неизвестно'}`);
    lines.push(`   Подключён: ${token.updated_at.toLocaleDateString('ru-RU')}`);
    if (statusText) lines.push(`   ${statusText}`);
    lines.push('');

    buttons.push([{
      text: `🗑 Отключить ${token.provider}`,
      callback_data: `disconnect_${token.provider}`,
    }]);
  }

  // Статистика MCP серверов (для информации)
  const poolStats = mcpManager.getPoolStats();
  if (poolStats.totalServers > 0) {
    lines.push(`_Активных MCP серверов: ${poolStats.totalServers}_`);
  }

  buttons.push([{ text: '🔗 Подключить ещё', callback_data: 'show_connect' }]);

  await bot.sendMessage(chatId, lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });
}

/**
 * Обработчик callback для отключения интеграции.
 */
export async function handleDisconnectCallback(bot, callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery._user?.id;
  const provider = callbackQuery.data.replace('disconnect_', '');

  // Остановить MCP серверы пользователя
  await mcpManager.stopUserServers(userId);

  // Удалить токены
  const deleted = await OAuthToken.destroy({
    where: { user_id: userId, provider },
  });

  await bot.answerCallbackQuery(callbackQuery.id);

  if (deleted > 0) {
    await bot.sendMessage(chatId, `✅ ${provider.charAt(0).toUpperCase() + provider.slice(1)} отключён.`);
  } else {
    await bot.sendMessage(chatId, `Интеграция ${provider} не найдена.`);
  }
}
```

---

## 10. Tool definitions обновление

### Обновлённый `src/services/ai/toolDefinitions.js`

```javascript
// src/services/ai/toolDefinitions.js

// === Локальные инструменты (работают без внешних интеграций) ===

export const localTools = [
  {
    name: 'create_note',
    description: 'Создать заметку в локальной базе данных.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Текст заметки' },
        category: { type: 'string', description: 'Категория: meeting, idea, personal, work' },
      },
      required: ['content'],
    },
  },
  {
    name: 'list_notes',
    description: 'Показать заметки пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        completed: { type: 'boolean', description: 'Фильтр: true (выполненные), false (невыполненные), не указано (все)' },
        category: { type: 'string', description: 'Фильтр по категории' },
      },
    },
  },
  {
    name: 'complete_note',
    description: 'Отметить заметку как выполненную.',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'integer', description: 'ID заметки' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'create_task',
    description: 'Создать задачу.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Название задачи' },
        description: { type: 'string', description: 'Описание' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_date: { type: 'string', description: 'Дедлайн ISO 8601' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Показать задачи пользователя.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
      },
    },
  },
  {
    name: 'update_task_status',
    description: 'Обновить статус задачи.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'cancelled'] },
      },
      required: ['task_id', 'status'],
    },
  },
];

// === Google Calendar инструменты (MCP) ===
export { calendarTools } from './tools/calendarTools.js';

// === Gmail инструменты (MCP) ===
export { gmailTools } from './tools/gmailTools.js';

// === Google Drive/Docs инструменты (MCP) ===
export { driveTools } from './tools/driveTools.js';

/**
 * Собрать список доступных инструментов для конкретного пользователя.
 *
 * Если Google Calendar не подключён — инструменты Calendar не включаются.
 * Claude НЕ будет пытаться вызвать инструмент, которого нет в tools.
 *
 * @param {object} connectedServices — { calendar: bool, gmail: bool, drive: bool }
 * @returns {Array} — массив tool definitions для Claude API
 */
export function getToolsForUser(connectedServices) {
  const tools = [...localTools];

  if (connectedServices.calendar) {
    tools.push(...calendarTools);
  }

  if (connectedServices.gmail) {
    tools.push(...gmailTools);
  }

  if (connectedServices.drive) {
    tools.push(...driveTools);
  }

  return tools;
}

/**
 * Определить, является ли инструмент MCP-based или локальным.
 */
export function isMcpTool(toolName) {
  const mcpToolNames = [
    ...calendarTools.map(t => t.name),
    ...gmailTools.map(t => t.name),
    ...driveTools.map(t => t.name),
  ];
  return mcpToolNames.includes(toolName);
}
```

### Обновление system prompt в `promptBuilder.js`

```javascript
// src/services/ai/promptBuilder.js
// Функция buildSystemPrompt дополняется информацией о подключённых сервисах

/**
 * Построить системный промпт для Claude с учётом подключённых сервисов пользователя.
 */
export function buildSystemPrompt(user, connectedServices) {
  const parts = [
    'Ты — Secretary Bot, AI-секретарь для предпринимателей и руководителей.',
    `Имя пользователя: ${user.username}.`,
    `Часовой пояс пользователя: ${user.timezone}.`,
    `Текущее время: ${new Date().toISOString()}.`,
    `Язык общения: русский.\n`,
  ];

  // Информация о подключённых сервисах
  parts.push('Подключённые сервисы пользователя:');

  if (connectedServices.calendar) {
    parts.push('- Google Calendar: ПОДКЛЮЧЁН. Можешь создавать, изменять, удалять события и показывать расписание.');
  } else {
    parts.push('- Google Calendar: НЕ подключён. Если пользователь просит про календарь — предложи подключить через /connect.');
  }

  if (connectedServices.gmail) {
    parts.push('- Gmail: ПОДКЛЮЧЁН. Можешь читать, искать и отправлять письма.');
  } else {
    parts.push('- Gmail: НЕ подключён. Если пользователь просит про почту — предложи подключить через /connect.');
  }

  if (connectedServices.drive) {
    parts.push('- Google Drive: ПОДКЛЮЧЁН. Можешь создавать и редактировать документы, искать файлы.');
  } else {
    parts.push('- Google Drive: НЕ подключён. Если пользователь просит про документы — предложи подключить через /connect.');
  }

  parts.push('\nОбщие правила:');
  parts.push('- Всегда используй часовой пояс пользователя при работе с датами.');
  parts.push('- При создании события — подтверди детали перед созданием.');
  parts.push('- При отправке письма — покажи черновик и спроси подтверждение.');
  parts.push('- Отвечай лаконично, по-деловому, но дружелюбно.');

  return parts.join('\n');
}
```

### Обновление `messageProcessor.js` — вызов с per-user tools

```javascript
// В messageProcessor.js — обновить секцию подготовки к Claude API вызову

import { getToolsForUser, isMcpTool } from '../ai/toolDefinitions.js';
import { isServiceConnected } from '../integrations/oauthRefresher.js';
import { routeToolCall } from '../mcp/mcpRouter.js';
import { buildSystemPrompt } from '../ai/promptBuilder.js';

// Внутри processMessage():

// 1. Определить подключённые сервисы пользователя
const connectedServices = {
  calendar: await isServiceConnected(userId, 'calendar'),
  gmail: await isServiceConnected(userId, 'gmail'),
  drive: await isServiceConnected(userId, 'drive'),
};

// 2. Собрать tools для этого пользователя
const tools = getToolsForUser(connectedServices);

// 3. Построить system prompt с учётом подключённых сервисов
const systemPrompt = buildSystemPrompt(user, connectedServices);

// 4. Вызвать Claude API
const response = await claudeHandler.sendMessage({
  systemPrompt,
  messages: conversationHistory,
  tools,
  userId,
});

// 5. Обработать tool_use если есть
if (response.stop_reason === 'tool_use') {
  const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');

  const toolResults = [];

  for (const toolUse of toolUseBlocks) {
    if (isMcpTool(toolUse.name)) {
      // MCP-инструмент → маршрутизировать через MCP
      const result = await routeToolCall(userId, toolUse);
      toolResults.push(result);
    } else {
      // Локальный инструмент → выполнить напрямую
      const result = await executeLocalTool(userId, toolUse);
      toolResults.push(result);
    }
  }

  // 6. Отправить tool_results обратно в Claude для финального ответа
  const finalResponse = await claudeHandler.sendMessage({
    systemPrompt,
    messages: [
      ...conversationHistory,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ],
    tools,
    userId,
  });

  return finalResponse;
}
```

---

## 11. Обработка ошибок интеграций

### Стратегия обработки

```
┌────────────────────────────────────┐
│         Тип ошибки                 │     Действие
├────────────────────────────────────┼─────────────────────────────────
│ Access token expired               │ → Автоматический refresh (oauthRefresher.js)
│ Refresh token revoked/invalid      │ → Удалить OAuthToken, уведомить пользователя
│ MCP server crashed                 │ → Пересоздать, retry 1 раз
│ MCP server timeout                 │ → Graceful message, не блокировать бота
│ Google API quota exceeded (429)    │ → Сообщить пользователю, retry через backoff
│ Google API server error (5xx)      │ → Retry 2 раза с backoff, затем сообщить
│ Network error                      │ → Retry 1 раз, graceful message
│ Service not connected              │ → Предложить /connect
└────────────────────────────────────┘
```

### Паттерн обработки ошибок

```javascript
// src/services/mcp/mcpErrorHandler.js
import logger from '../../config/logger.js';
import { OAuthToken } from '../../models/index.js';

/**
 * Классификатор ошибок MCP / Google API.
 */
export class IntegrationError extends Error {
  constructor(message, code, recoverable = false) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

/**
 * Обработать ошибку MCP и вернуть понятное сообщение для пользователя.
 */
export async function handleMcpError(error, userId, toolName) {
  const errorMessage = error.message || String(error);

  // 1. Token expired / invalid_grant
  if (errorMessage.includes('invalid_grant') || errorMessage.includes('Token has been expired')) {
    logger.warn(`OAuth token проблема для user ${userId}: ${errorMessage}`);

    // Удаляем невалидный токен
    await OAuthToken.destroy({
      where: { user_id: userId, provider: 'google' },
    });

    return {
      userMessage: 'Ваш Google-аккаунт был отключён (токен истёк или отозван). Пожалуйста, подключите заново через /connect.',
      shouldRetry: false,
      severity: 'warn',
    };
  }

  // 2. Google API quota exceeded
  if (errorMessage.includes('rateLimitExceeded') || errorMessage.includes('429')) {
    logger.warn(`Google API rate limit для user ${userId}, tool ${toolName}`);

    return {
      userMessage: 'Google API временно ограничил количество запросов. Попробуйте через минуту.',
      shouldRetry: true,
      retryAfterMs: 60000,
      severity: 'warn',
    };
  }

  // 3. Google API server error
  if (errorMessage.includes('500') || errorMessage.includes('503') || errorMessage.includes('Backend Error')) {
    logger.error(`Google API server error для user ${userId}, tool ${toolName}: ${errorMessage}`);

    return {
      userMessage: 'Google-сервис временно недоступен. Попробуйте через несколько минут.',
      shouldRetry: true,
      retryAfterMs: 30000,
      severity: 'error',
    };
  }

  // 4. MCP server crash
  if (errorMessage.includes('ECONNRESET') || errorMessage.includes('process exited') || errorMessage.includes('connection closed')) {
    logger.error(`MCP сервер упал для user ${userId}, tool ${toolName}: ${errorMessage}`);

    return {
      userMessage: 'Произошла техническая ошибка. Повторная попытка...',
      shouldRetry: true,
      retryAfterMs: 1000,
      severity: 'error',
    };
  }

  // 5. Сервис не подключён
  if (errorMessage.includes('не подключён') || errorMessage.includes('not connected')) {
    return {
      userMessage: 'Для этого действия нужно подключить Google. Используйте /connect.',
      shouldRetry: false,
      severity: 'info',
    };
  }

  // 6. Неизвестная ошибка
  logger.error(`Неизвестная MCP ошибка для user ${userId}, tool ${toolName}:`, error);

  return {
    userMessage: 'Произошла ошибка при работе с внешним сервисом. Попробуйте позже.',
    shouldRetry: false,
    severity: 'error',
  };
}

/**
 * Обёртка для MCP-вызовов с retry-логикой.
 */
export async function withRetry(fn, { maxRetries = 2, baseDelayMs = 1000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(2, attempt); // exponential backoff
        logger.info(`Retry ${attempt + 1}/${maxRetries} через ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
```

### Интеграция обработки ошибок в mcpRouter.js

```javascript
// Обновить routeToolCall в mcpRouter.js:

import { handleMcpError, withRetry } from './mcpErrorHandler.js';

export async function routeToolCall(userId, toolUse) {
  const { id: toolUseId, name: toolName, input: toolInput } = toolUse;

  // ... проверка подключения (как раньше) ...

  try {
    const result = await withRetry(
      () => mcpManager.callTool(userId, toolName, toolInput),
      { maxRetries: 1, baseDelayMs: 2000 }
    );

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: typeof result === 'string' ? result : JSON.stringify(result),
    };
  } catch (error) {
    const errorInfo = await handleMcpError(error, userId, toolName);

    logger[errorInfo.severity](`MCP error handled: ${toolName}, user ${userId}`);

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: errorInfo.userMessage,
      is_error: true,
    };
  }
}
```

---

## 12. Yandex SpeechKit TTS

Голосовые ответы бота — non-MCP интеграция (прямой вызов Yandex API).

### Файл: `src/services/integrations/yandexTTS.js`

```javascript
// src/services/integrations/yandexTTS.js
import axios from 'axios';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

const YANDEX_TTS_URL = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize';

// Доступные голоса
export const VOICES = {
  alena: { name: 'alena', lang: 'ru-RU', description: 'Алёна (женский, нейтральный)' },
  filipp: { name: 'filipp', lang: 'ru-RU', description: 'Филипп (мужской, нейтральный)' },
  ermil: { name: 'ermil', lang: 'ru-RU', description: 'Ермил (мужской, нейтральный)' },
  jane: { name: 'jane', lang: 'ru-RU', description: 'Яна (женский, нейтральный)' },
  madirus: { name: 'madirus', lang: 'ru-RU', description: 'Мадирус (мужской, нейтральный)' },
  omazh: { name: 'omazh', lang: 'ru-RU', description: 'Омаж (женский, нейтральный)' },
  zahar: { name: 'zahar', lang: 'ru-RU', description: 'Захар (мужской, нейтральный)' },
};

// Стоимость: ~1.5 руб за 1 миллион символов (или ~$0.02)
// Бесплатный лимит: 5000 символов в день на SpeechKit
const MAX_TEXT_LENGTH = 5000; // символов за один запрос

/**
 * Синтезировать речь из текста через Yandex SpeechKit TTS.
 *
 * @param {string} text — текст для озвучки (до 5000 символов)
 * @param {object} options — параметры
 * @param {string} options.voice — голос (по умолчанию 'alena')
 * @param {string} options.emotion — эмоция: 'neutral', 'good', 'evil' (по умолчанию 'neutral')
 * @param {string} options.speed — скорость: '0.5' - '3.0' (по умолчанию '1.0')
 * @param {string} options.format — формат: 'oggopus' | 'lpcm' | 'mp3' (по умолчанию 'oggopus')
 * @returns {Buffer} — аудио-данные
 */
export async function synthesizeSpeech(text, options = {}) {
  const {
    voice = 'alena',
    emotion = 'neutral',
    speed = '1.0',
    format = 'oggopus',
  } = options;

  if (!text || text.trim().length === 0) {
    throw new Error('Текст для синтеза не может быть пустым');
  }

  // Обрезаем текст если слишком длинный
  const truncatedText = text.length > MAX_TEXT_LENGTH
    ? text.substring(0, MAX_TEXT_LENGTH) + '...'
    : text;

  const params = new URLSearchParams({
    text: truncatedText,
    lang: 'ru-RU',
    voice,
    emotion,
    speed,
    format,
    folderId: config.yandex.folderId,
  });

  try {
    const response = await axios.post(YANDEX_TTS_URL, params.toString(), {
      headers: {
        'Authorization': `Api-Key ${config.yandex.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      responseType: 'arraybuffer',
      timeout: 10000, // 10 секунд таймаут
    });

    const audioBuffer = Buffer.from(response.data);

    logger.info(`TTS синтезировано: ${truncatedText.length} символов, voice=${voice}, ${audioBuffer.length} bytes`);

    return audioBuffer;
  } catch (error) {
    if (error.response) {
      const errorBody = error.response.data instanceof Buffer
        ? error.response.data.toString('utf-8')
        : error.response.data;

      logger.error(`Yandex TTS ошибка ${error.response.status}:`, errorBody);
      throw new Error(`Yandex TTS: ${error.response.status} — ${errorBody}`);
    }

    logger.error('Yandex TTS network error:', error.message);
    throw new Error(`Yandex TTS недоступен: ${error.message}`);
  }
}

/**
 * Оценить стоимость TTS-запроса в символах.
 * Используется для учёта в CreditTransaction.
 */
export function estimateTTSCost(text) {
  return {
    characters: text.length,
    // Yandex тарификация: за 1 000 000 символов
    // Free tier: 5 000 символов/день
    estimatedCostRub: (text.length / 1_000_000) * 1.5,
  };
}
```

### Использование TTS в обработчике сообщений

```javascript
// src/services/platforms/telegram/handlers/messageHandler.js
// Добавить опцию голосового ответа

import { synthesizeSpeech } from '../../../integrations/yandexTTS.js';

/**
 * Отправить ответ пользователю.
 * Если сообщение было голосовым — отвечаем голосом + текстом.
 */
async function sendResponse(bot, chatId, text, options = {}) {
  const { isVoiceRequest = false, voiceSettings = {} } = options;

  // Всегда отправляем текст
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

  // Если запрос был голосовым — дополнительно отправляем аудио
  if (isVoiceRequest && text.length <= 5000) {
    try {
      const audioBuffer = await synthesizeSpeech(text, {
        voice: voiceSettings.voice || 'alena',
        emotion: voiceSettings.emotion || 'neutral',
        speed: voiceSettings.speed || '1.0',
      });

      await bot.sendVoice(chatId, audioBuffer, {
        caption: '',
      });
    } catch (ttsError) {
      // TTS — некритичная фича. Если не сработала — текстовый ответ уже отправлен.
      logger.warn(`TTS failed для chat ${chatId}:`, ttsError.message);
    }
  }
}
```

### Переменные окружения для TTS

```env
# Yandex Cloud
YANDEX_API_KEY=ваш_api_key
YANDEX_FOLDER_ID=ваш_folder_id
```

---

## 13. Чеклист готовности

### Инфраструктура

- [ ] `TOKEN_ENCRYPTION_KEY` сгенерирован и добавлен в `.env`
- [ ] Google Cloud Console: OAuth consent screen настроен
- [ ] Google Cloud Console: API включены — Calendar API, Gmail API, Google Drive API, Google Docs API
- [ ] Google Cloud Console: OAuth Client ID типа "Web application" создан
- [ ] Redirect URI добавлен: `https://yourdomain.com/api/v1/integrations/google/callback`
- [ ] Yandex Cloud: API-ключ для SpeechKit получен
- [ ] Yandex Cloud: folder_id указан в `.env`

### Миграция БД

- [ ] Миграция `create-oauth-tokens` написана и протестирована
- [ ] `npx sequelize-cli db:migrate` проходит без ошибок
- [ ] `npx sequelize-cli db:migrate:undo` откатывает корректно
- [ ] UNIQUE constraint `(user_id, provider)` проверен

### Модели и утилиты

- [ ] Модель `OAuthToken.js` создана и добавлена в `models/index.js`
- [ ] `src/utils/crypto.js` — `encryptToken()` / `decryptToken()` работают (написать unit-тест)
- [ ] Шифрование/дешифрование round-trip тест пройден
- [ ] `getEncryptionKey()` бросает ошибку при неверном ключе

### OAuth flow

- [ ] `GET /api/v1/integrations/google/auth` генерирует корректный URL
- [ ] State параметр содержит подписанный JWT
- [ ] `GET /api/v1/integrations/google/callback` обменивает code на токены
- [ ] Токены шифруются перед сохранением в БД
- [ ] Refresh token сохраняется (проверить `prompt: consent` в auth URL)
- [ ] Upsert работает: повторная авторизация обновляет, а не дублирует
- [ ] `GET /api/v1/integrations/status` показывает корректный статус
- [ ] `DELETE /api/v1/integrations/google` удаляет токены и останавливает MCP-серверы

### Auto-refresh токенов

- [ ] `oauthRefresher.js` — `getGoogleTokens()` обновляет истёкший access_token
- [ ] Обновлённый access_token сохраняется в БД (зашифрованным)
- [ ] При revoked refresh_token — запись удаляется, пользователь уведомляется
- [ ] Buffer в 5 минут работает (обновление ДО истечения, а не ПОСЛЕ)

### MCP Manager

- [ ] `mcpManager.callTool()` запускает MCP-сервер с per-user credentials
- [ ] Пул серверов работает: повторный вызов не создаёт дублей
- [ ] Idle cleanup: серверы останавливаются через 10 минут бездействия
- [ ] `stopUserServers()` останавливает все серверы пользователя
- [ ] `shutdownAll()` корректно останавливает все серверы при SIGTERM
- [ ] `getPoolStats()` возвращает актуальную статистику

### MCP Router

- [ ] `routeToolCall()` корректно маршрутизирует tool_use к MCP-серверам
- [ ] Проверка `isServiceConnected()` перед вызовом
- [ ] При отсутствии подключения — `is_error: true` с понятным сообщением
- [ ] Retry-логика с exponential backoff работает

### Google Calendar через MCP

- [ ] Tool definitions: `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `list_calendar_events`
- [ ] Тест: "Создай встречу завтра в 10" → событие появляется в Google Calendar
- [ ] Тест: "Покажи расписание на неделю" → список событий из Calendar
- [ ] Тест: "Удали встречу с Иваном" → событие удаляется
- [ ] Тест: "Перенеси встречу на 15:00" → событие обновляется

### Gmail через MCP

- [ ] Tool definitions: `list_unread_emails`, `search_emails`, `read_email`, `send_email`, `reply_to_email`
- [ ] Тест: "Проверь непрочитанные письма" → список писем
- [ ] Тест: "Найди письма от Ивана" → результаты поиска
- [ ] Тест: "Отправь письмо" → Claude спрашивает детали, отправляет

### Google Drive через MCP

- [ ] Tool definitions: `create_document`, `edit_document`, `list_files`, `search_files`, `create_from_template`
- [ ] Тест: "Создай протокол встречи" → документ создаётся в Drive
- [ ] Тест: "Найди документ с бюджетом" → результаты поиска

### Telegram команды

- [ ] `/connect` — показывает inline keyboard с сервисами
- [ ] Callback обработчик генерирует OAuth URL
- [ ] После OAuth — бот уведомляет в чате "Google подключён"
- [ ] `/integrations` — показывает статус подключённых сервисов
- [ ] Кнопка "Отключить" работает

### Tool definitions

- [ ] `getToolsForUser()` возвращает только инструменты подключённых сервисов
- [ ] `isMcpTool()` корректно определяет MCP vs локальные инструменты
- [ ] System prompt включает информацию о подключённых сервисах
- [ ] Claude не пытается использовать инструменты неподключённых сервисов

### Обработка ошибок

- [ ] Expired token → автоматический refresh
- [ ] Revoked token → уведомление + удаление + предложение /connect
- [ ] MCP server crash → пересоздание + retry
- [ ] Google API 429 → сообщение пользователю + backoff
- [ ] Google API 5xx → retry + graceful message
- [ ] Сервис не подключён → предложение /connect

### Yandex TTS

- [ ] `synthesizeSpeech()` возвращает аудио Buffer
- [ ] Формат `oggopus` совместим с Telegram `sendVoice()`
- [ ] Ограничение 5000 символов работает (обрезка)
- [ ] При ошибке TTS — текстовый ответ всё равно доставляется
- [ ] `estimateTTSCost()` корректно считает стоимость

### Безопасность

- [ ] OAuth-токены зашифрованы в БД (AES-256-GCM)
- [ ] `TOKEN_ENCRYPTION_KEY` не в коде, только в `.env`
- [ ] State параметр подписан JWT с ограниченным TTL (10 минут)
- [ ] OAuth callback не принимает запросы с невалидным state
- [ ] API endpoints интеграций защищены JWT middleware
- [ ] Scopes минимальны (только необходимые разрешения)

### Документация

- [ ] `.env.example` обновлён новыми переменными
- [ ] README обновлён информацией о Google-интеграциях
- [ ] Инструкция по настройке Google Cloud Console

---

## Порядок реализации (день за днём)

| День | Задача | Файлы |
|------|--------|-------|
| **1** | Модель OAuthToken + миграция + crypto.js | `models/OAuthToken.js`, `migrations/...`, `utils/crypto.js` |
| **2** | OAuth flow (routes + controller + oauthRefresher) | `routes/integrations.routes.js`, `controllers/integrations.controller.js`, `integrations/oauthRefresher.js` |
| **3** | MCP Manager обновление + mcpConfig + mcpRouter | `mcp/mcpManager.js`, `mcp/mcpConfig.js`, `mcp/mcpRouter.js`, `mcp/mcpErrorHandler.js` |
| **4** | Tool definitions (calendar + gmail + drive) + promptBuilder | `ai/toolDefinitions.js`, `ai/tools/*.js`, `ai/promptBuilder.js` |
| **5** | Telegram /connect + /integrations + callback handlers | `telegram/handlers/commandHandler.js`, `telegram/handlers/callbackHandler.js` |
| **6** | Yandex TTS + messageProcessor обновление | `integrations/yandexTTS.js`, `core/messageProcessor.js` |
| **7** | Тестирование всех сценариев + bugfixes | Все файлы, ручное E2E тестирование |

---

## Новые npm-пакеты

Устанавливаются в этом этапе (если не были установлены ранее):

```bash
# MCP серверы для Google сервисов
npm install @anthropic/mcp-server-google-calendar
npm install @anthropic/mcp-server-gmail
npm install @anthropic/mcp-server-google-drive
```

> **Примечание:** Точные имена пакетов MCP-серверов могут отличаться на момент реализации. Проверить актуальные имена в npm-реестре или документации Anthropic MCP.

---

## Новые переменные окружения

```env
# --- Google OAuth (per-user) ---
GOOGLE_CLIENT_ID=ваш_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=ваш_client_secret
GOOGLE_CALLBACK_URL=https://yourdomain.com/api/v1/integrations/google/callback

# --- Шифрование токенов ---
# Генерация: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY=64_hex_символа

# --- Yandex Cloud (TTS) ---
YANDEX_API_KEY=ваш_api_key
YANDEX_FOLDER_ID=ваш_folder_id
```

---

## Итог этапа

После завершения этапа 6:

1. **Google Calendar** — пользователь управляет календарём через естественный язык ("Создай встречу завтра в 10")
2. **Gmail** — пользователь читает и отправляет почту через бота ("Проверь непрочитанные", "Отправь письмо Ивану")
3. **Google Drive** — пользователь создаёт и ищет документы ("Создай протокол встречи", "Найди файл с бюджетом")
4. **Per-user OAuth** — каждый пользователь подключает свой Google-аккаунт
5. **Голосовые ответы** — бот может отвечать голосом через Yandex TTS
6. **Безопасность** — токены зашифрованы AES-256-GCM, OAuth state подписан JWT
7. **Отказоустойчивость** — auto-refresh токенов, retry при ошибках, graceful degradation

Все Google-сервисы работают **исключительно через MCP**. Бэкенд не содержит ни одного прямого вызова Google API (кроме OAuth token exchange, который необходим для получения токенов).
