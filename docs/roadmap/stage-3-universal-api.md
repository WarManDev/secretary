# Этап 3: Универсальный REST API

> **Срок:** 3-4 дня
> **Зависит от:** Этап 2 (Безопасность и аутентификация)
> **Результат:** Полноценный REST API v1 с CRUD для всех сущностей, чат-endpoint для кроссплатформенного общения с ботом, Swagger-документация, пагинация, health-проверки
>
> **Последнее обновление:** 2026-02-12

---

## Оглавление

1. [Архитектура API](#1-архитектура-api)
2. [UnifiedMessage формат](#2-unifiedmessage-формат)
3. [Chat endpoint](#3-chat-endpoint)
4. [Events CRUD](#4-events-crud)
5. [Tasks CRUD](#5-tasks-crud)
6. [Notes CRUD](#6-notes-crud)
7. [Users profile](#7-users-profile)
8. [Sessions](#8-sessions)
9. [Пагинация](#9-пагинация)
10. [Swagger документация](#10-swagger-документация)
11. [Health endpoints](#11-health-endpoints)
12. [Чеклист готовности](#12-чеклист-готовности)

---

## Новые npm пакеты

```bash
npm install swagger-jsdoc swagger-ui-express
```

| Пакет | Версия | Назначение |
|-------|--------|------------|
| `swagger-jsdoc` | ^6.x | Генерация OpenAPI спецификации из JSDoc-комментариев |
| `swagger-ui-express` | ^5.x | Визуальная Swagger UI документация на `/api/docs` |

---

## Новые/изменённые файлы

| Файл | Действие | Описание |
|------|----------|----------|
| `src/routes/index.js` | **Создать** | Агрегатор всех маршрутов |
| `src/routes/events.routes.js` | **Создать** | Маршруты событий |
| `src/routes/tasks.routes.js` | **Создать** | Маршруты задач |
| `src/routes/notes.routes.js` | **Создать** | Маршруты заметок |
| `src/routes/users.routes.js` | **Создать** | Маршруты профиля |
| `src/routes/sessions.routes.js` | **Создать** | Маршруты сессий чата |
| `src/routes/health.routes.js` | **Создать** | Health/readiness |
| `src/controllers/events.controller.js` | **Создать** | Контроллер событий |
| `src/controllers/tasks.controller.js` | **Создать** | Контроллер задач |
| `src/controllers/notes.controller.js` | **Создать** | Контроллер заметок |
| `src/controllers/users.controller.js` | **Создать** | Контроллер профиля |
| `src/controllers/sessions.controller.js` | **Создать** | Контроллер сессий |
| `src/controllers/health.controller.js` | **Создать** | Контроллер health |
| `src/services/platforms/api/restAdapter.js` | **Создать** | REST API адаптер (chat) |
| `src/utils/pagination.js` | **Создать** | Хелпер пагинации |
| `src/config/swagger.js` | **Создать** | Swagger конфигурация |
| `src/app.js` | **Изменить** | Подключить Swagger UI |

---

## 1. Архитектура API

### Принципы

1. **Все endpoints под `/api/v1/`** -- версионирование с первого дня
2. **Routes -> Controllers -> Services** -- контроллеры тонкие, бизнес-логика в сервисах
3. **Контроллеры** принимают `req`, вызывают сервис, форматируют ответ -- и больше НИЧЕГО
4. **Сервисы** содержат бизнес-логику, работают с моделями, могут вызывать другие сервисы
5. **Единый формат ответа** -- `{ success, data, meta? }` или `{ success, error }`

### Файл: `src/routes/index.js`

Агрегатор маршрутов. Собирает все роутеры и монтирует под соответствующие пути.

```js
import { Router } from 'express';
import authRoutes from './auth.routes.js';
import usersRoutes from './users.routes.js';
import eventsRoutes from './events.routes.js';
import tasksRoutes from './tasks.routes.js';
import notesRoutes from './notes.routes.js';
import sessionsRoutes from './sessions.routes.js';
import healthRoutes from './health.routes.js';

const router = Router();

// Публичные маршруты (без JWT)
router.use('/auth', authRoutes);       // Этап 2
router.use('/health', healthRoutes);

// Защищённые маршруты (JWT required)
// verifyToken подключён внутри каждого router файла
router.use('/users', usersRoutes);
router.use('/events', eventsRoutes);
router.use('/tasks', tasksRoutes);
router.use('/notes', notesRoutes);
router.use('/chat', sessionsRoutes);   // /chat и /chat/sessions

export default router;
```

### Подключение в `src/app.js`

```js
import routes from './routes/index.js';

// ... middleware chain (helmet, cors, json, requestLogger, rateLimiter) ...

app.use('/api/v1', routes);

// ... error handlers ...
```

### Диаграмма потока запроса

```
Клиент
  │
  ▼
Express middleware chain:
  helmet() → cors() → json() → requestLogger → globalLimiter
  │
  ▼
/api/v1/events/:id  →  routes/events.routes.js
  │
  ▼
Middleware chain маршрута:
  verifyToken → validate(schema)
  │
  ▼
controllers/events.controller.js
  │
  │  // Контроллер -- тонкий слой
  │  const events = await eventService.listByUser(req.user.id, filters);
  │  res.json({ success: true, data: events, meta: pagination });
  │
  ▼
services/  (бизнес-логика)
  │
  ▼
models/  (Sequelize ORM → PostgreSQL)
```

---

## 2. UnifiedMessage формат

Ключевая абстракция кроссплатформенности. **Любое** сообщение -- из Telegram, REST API, WebSocket или будущего мобильного приложения -- преобразуется в этот формат перед обработкой в `messageProcessor.js`.

### Определение

```js
/**
 * @typedef {Object} UnifiedMessage
 *
 * Унифицированный формат сообщения для всех платформ.
 * Каждый платформенный адаптер конвертирует входящее сообщение
 * в этот формат перед передачей в messageProcessor.js.
 *
 * @property {number} userId
 *   ID пользователя в БД (из таблицы users).
 *   НЕ telegram_id, НЕ внешний идентификатор -- только внутренний PK.
 *
 * @property {string} text
 *   Текст сообщения. Для голосовых -- результат STT.
 *   Для фото -- текст подписи (caption) или пустая строка.
 *
 * @property {'text'|'voice'|'photo'|'system'} type
 *   Тип сообщения:
 *   - text: текстовое сообщение
 *   - voice: голосовое (text содержит результат распознавания)
 *   - photo: фотография (для Claude Vision)
 *   - system: системное сообщение (команды, уведомления)
 *
 * @property {'telegram'|'api'|'web'|'mobile'} platform
 *   Платформа-источник сообщения.
 *
 * @property {number|null} sessionId
 *   ID сессии чата (из таблицы sessions).
 *   null = создать новую сессию.
 *   Для Telegram: сессия определяется автоматически по user_id.
 *   Для API: передаётся клиентом (или null для новой).
 *
 * @property {Array<UnifiedAttachment>} attachments
 *   Массив вложений (фото, аудио-файлы и т.д.).
 *   Пустой массив если вложений нет.
 *
 * @property {Object} metadata
 *   Платформо-специфичные данные. Не используются в Core Layer,
 *   но могут потребоваться адаптеру при отправке ответа.
 *   - Для Telegram: { chatId, messageId, replyToMessageId }
 *   - Для API: { requestId, ipAddress }
 *   - Для WebSocket: { socketId, connectionId }
 */

/**
 * @typedef {Object} UnifiedAttachment
 *
 * @property {'image'|'audio'|'document'} type
 * @property {string} url - URL для скачивания файла
 * @property {string} mimeType - MIME тип (image/jpeg, audio/ogg, и т.д.)
 */
```

### Создание UnifiedMessage на каждой платформе

#### Telegram адаптер

```js
// src/services/platforms/telegram/handlers/messageHandler.js

/**
 * Конвертировать Telegram message в UnifiedMessage.
 *
 * @param {Object} msg - Telegram message object (from node-telegram-bot-api)
 * @param {Object} user - User model instance (из authenticateTelegramUser)
 * @returns {UnifiedMessage}
 */
function createUnifiedMessage(msg, user) {
  const message = {
    userId: user.id,
    text: msg.text || '',
    type: 'text',
    platform: 'telegram',
    sessionId: null, // sessionManager найдёт или создаст
    attachments: [],
    metadata: {
      chatId: msg.chat.id,
      messageId: msg.message_id,
      replyToMessageId: msg.reply_to_message?.message_id || null,
      telegramId: String(msg.from.id),
    },
  };

  // Голосовое сообщение (text заполняется после STT)
  if (msg.voice) {
    message.type = 'voice';
    message.attachments.push({
      type: 'audio',
      url: '', // Заполняется после getFileLink()
      mimeType: msg.voice.mime_type || 'audio/ogg',
    });
  }

  // Фотография
  if (msg.photo && msg.photo.length > 0) {
    message.type = 'photo';
    message.text = msg.caption || '';
    // Берём самое большое фото (последний элемент массива)
    const largestPhoto = msg.photo[msg.photo.length - 1];
    message.attachments.push({
      type: 'image',
      url: '', // Заполняется после getFileLink()
      mimeType: 'image/jpeg',
    });
  }

  return message;
}
```

#### REST API адаптер

```js
// src/services/platforms/api/restAdapter.js

/**
 * Конвертировать REST API запрос в UnifiedMessage.
 *
 * @param {Object} req - Express request (body: { message, session_id })
 * @returns {UnifiedMessage}
 */
function createUnifiedMessageFromAPI(req) {
  return {
    userId: req.user.id, // Из JWT (verifyToken middleware)
    text: req.body.message,
    type: 'text',
    platform: 'api',
    sessionId: req.body.session_id || null,
    attachments: [],
    metadata: {
      requestId: req.headers['x-request-id'] || null,
      ipAddress: req.ip,
    },
  };
}
```

### Ключевой принцип

`messageProcessor.js` получает `UnifiedMessage` и возвращает текстовый ответ. Он **никогда** не знает, откуда пришло сообщение. Адаптер платформы отвечает за:

1. **Вход:** конвертация платформенного формата -> `UnifiedMessage`
2. **Выход:** отправка текстового ответа обратно через API платформы

```
Telegram message  ──→  createUnifiedMessage()  ──→ ┐
REST API request  ──→  createUnifiedMessageFromAPI() ──→ ├── messageProcessor.process(message)
WebSocket message ──→  createUnifiedMessageFromWS() ──→ ┘          │
                                                                     ▼
                                                              Текстовый ответ
                                                                     │
Telegram  ←── bot.sendMessage() ────────────────────────────────── ←─┤
REST API  ←── res.json({ data: { reply: "..." }}) ──────────────── ←─┤
WebSocket ←── socket.emit('message', { reply: "..." }) ──────────── ←─┘
```

---

## 3. Chat endpoint

### Самый важный endpoint API

`POST /api/v1/chat` -- это то, как **НЕ-Telegram клиенты** (мобильное приложение, PWA, веб-интерфейс) общаются с ботом. Этот endpoint использует тот же `messageProcessor.js`, что и Telegram-бот, обеспечивая **идентичное поведение** на всех платформах.

### Файл: `src/routes/sessions.routes.js`

```js
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as sessionsController from '../controllers/sessions.controller.js';
import { chatMessageSchema, listSessionsQuerySchema } from '../utils/validators.js';

const router = Router();

// Все маршруты требуют JWT
router.use(verifyToken);

// POST /api/v1/chat
// Отправить сообщение боту (главный endpoint для кроссплатформенного чата)
router.post(
  '/',
  validate(chatMessageSchema),
  asyncHandler(sessionsController.sendMessage)
);

// GET /api/v1/chat/sessions
// Список сессий текущего пользователя
router.get(
  '/sessions',
  validate(listSessionsQuerySchema),
  asyncHandler(sessionsController.listSessions)
);

// GET /api/v1/chat/sessions/:id
// Получить сессию с историей сообщений
router.get(
  '/sessions/:id',
  asyncHandler(sessionsController.getSession)
);

// DELETE /api/v1/chat/sessions/:id
// Архивировать сессию (soft delete -- устанавливает ended_at)
router.delete(
  '/sessions/:id',
  asyncHandler(sessionsController.deleteSession)
);

export default router;
```

### Zod-схема для chat

Добавить в `src/utils/validators.js`:

```js
/**
 * POST /api/v1/chat
 */
export const chatMessageSchema = z.object({
  body: z.object({
    message: z
      .string()
      .min(1, 'Сообщение не может быть пустым')
      .max(4000, 'Сообщение не должно превышать 4000 символов'),
    session_id: z.number().int().positive().optional(),
  }),
});

/**
 * GET /api/v1/chat/sessions
 */
export const listSessionsQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).optional().default('1'),
    limit: z.string().regex(/^\d+$/).optional().default('20'),
  }),
});
```

### Файл: `src/controllers/sessions.controller.js`

```js
import models from '../models/index.js';
import { messageProcessor } from '../services/core/messageProcessor.js';
import { paginate } from '../utils/pagination.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

const { Session, Message } = models;

/**
 * POST /api/v1/chat
 *
 * Отправить сообщение боту через REST API.
 * Создаёт UnifiedMessage, пропускает через messageProcessor,
 * возвращает ответ бота.
 *
 * Request body:
 *   { "message": "Создай встречу с Иваном завтра в 10", "session_id": 42 }
 *
 * Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "reply": "Создал встречу 'Встреча с Иваном' на 13 февраля в 10:00.",
 *       "session_id": 42,
 *       "actions": [
 *         { "type": "event_created", "event_id": 15, "title": "Встреча с Иваном" }
 *       ]
 *     }
 *   }
 */
export async function sendMessage(req, res) {
  const { message, session_id } = req.body;

  // Формируем UnifiedMessage
  const unifiedMessage = {
    userId: req.user.id,
    text: message,
    type: 'text',
    platform: 'api',
    sessionId: session_id || null,
    attachments: [],
    metadata: {
      requestId: req.headers['x-request-id'] || null,
      ipAddress: req.ip,
    },
  };

  // Обработка через общий pipeline (тот же, что и для Telegram)
  const result = await messageProcessor.process(unifiedMessage);

  res.json({
    success: true,
    data: {
      reply: result.reply,
      session_id: result.sessionId,
      actions: result.actions || [], // Выполненные действия (создание события, задачи и т.д.)
    },
  });
}

/**
 * GET /api/v1/chat/sessions
 *
 * Список сессий текущего пользователя.
 * Возвращает сессии с количеством сообщений и датой последнего.
 */
export async function listSessions(req, res) {
  const { page, limit } = req.query;

  const { rows, count } = await Session.findAndCountAll({
    where: {
      user_id: req.user.id,
    },
    attributes: [
      'id',
      'platform',
      'session_type',
      'started_at',
      'ended_at',
      'current_summary',
      [
        models.sequelize.fn('COUNT', models.sequelize.col('Messages.id')),
        'message_count',
      ],
    ],
    include: [
      {
        model: Message,
        attributes: [],
      },
    ],
    group: ['Session.id'],
    order: [['started_at', 'DESC']],
    ...paginate(page, limit),
    subQuery: false,
  });

  res.json({
    success: true,
    data: rows,
    meta: {
      page: Number(page),
      limit: Number(limit),
      total: count.length, // При GROUP BY count -- массив
      total_pages: Math.ceil(count.length / Number(limit)),
    },
  });
}

/**
 * GET /api/v1/chat/sessions/:id
 *
 * Получить сессию с историей сообщений.
 * Проверяет, что сессия принадлежит текущему пользователю.
 */
export async function getSession(req, res) {
  const session = await Session.findByPk(req.params.id, {
    include: [
      {
        model: Message,
        order: [['created_at', 'ASC']],
      },
    ],
  });

  if (!session) {
    throw new NotFoundError(`Сессия с id=${req.params.id} не найдена`);
  }

  // Проверка владельца
  if (session.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой сессии');
  }

  res.json({
    success: true,
    data: session,
  });
}

/**
 * DELETE /api/v1/chat/sessions/:id
 *
 * Архивировать сессию (soft delete).
 * Устанавливает ended_at = NOW(). Сообщения не удаляются.
 */
export async function deleteSession(req, res) {
  const session = await Session.findByPk(req.params.id);

  if (!session) {
    throw new NotFoundError(`Сессия с id=${req.params.id} не найдена`);
  }

  if (session.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой сессии');
  }

  await session.update({ ended_at: new Date() });

  res.json({
    success: true,
    data: { message: 'Сессия архивирована' },
  });
}
```

---

## 4. Events CRUD

### Файл: `src/routes/events.routes.js`

```js
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as eventsController from '../controllers/events.controller.js';
import {
  createEventSchema,
  updateEventSchema,
  listEventsQuerySchema,
} from '../utils/validators.js';

const router = Router();

// Все маршруты требуют JWT
router.use(verifyToken);

// GET /api/v1/events/today
// Быстрый доступ: события на сегодня (ПЕРЕД /:id, иначе "today" матчится как :id)
router.get('/today', asyncHandler(eventsController.getToday));

// GET /api/v1/events/range?start=...&end=...
// События за произвольный период
router.get('/range', asyncHandler(eventsController.getRange));

// GET /api/v1/events
// Список событий с фильтрами и пагинацией
router.get('/', validate(listEventsQuerySchema), asyncHandler(eventsController.list));

// POST /api/v1/events
// Создать событие
router.post('/', validate(createEventSchema), asyncHandler(eventsController.create));

// GET /api/v1/events/:id
// Получить событие по ID
router.get('/:id', asyncHandler(eventsController.getById));

// PUT /api/v1/events/:id
// Обновить событие
router.put('/:id', validate(updateEventSchema), asyncHandler(eventsController.update));

// DELETE /api/v1/events/:id
// Удалить событие
router.delete('/:id', asyncHandler(eventsController.remove));

export default router;
```

### Файл: `src/controllers/events.controller.js`

```js
import { Op } from 'sequelize';
import models from '../models/index.js';
import { paginate, paginationMeta } from '../utils/pagination.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

const { Event } = models;

/**
 * GET /api/v1/events
 *
 * Список событий текущего пользователя.
 * Фильтры: ?from=2026-02-01&to=2026-02-28
 * По умолчанию -- текущий месяц.
 */
export async function list(req, res) {
  const { from, to, page, limit } = req.query;

  // Если фильтры не переданы -- текущий месяц
  const now = new Date();
  const dateFrom = from
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const dateTo = to
    ? new Date(to)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const { rows, count } = await Event.findAndCountAll({
    where: {
      user_id: req.user.id,
      event_date: {
        [Op.between]: [dateFrom, dateTo],
      },
    },
    order: [['event_date', 'ASC']],
    ...paginate(page, limit),
  });

  res.json({
    success: true,
    data: rows,
    meta: paginationMeta(count, page, limit),
  });
}

/**
 * POST /api/v1/events
 *
 * Создать событие.
 * При наличии подключения к Google Calendar -- синхронизация (Этап 6).
 */
export async function create(req, res) {
  const event = await Event.create({
    ...req.body,
    user_id: req.user.id,
  });

  // TODO (Этап 6): Синхронизация с Google Calendar через MCP
  // if (user.hasGoogleCalendar) {
  //   const gcalEventId = await mcpRouter.createCalendarEvent(event);
  //   await event.update({ google_calendar_event_id: gcalEventId });
  // }

  res.status(201).json({
    success: true,
    data: event,
  });
}

/**
 * GET /api/v1/events/:id
 *
 * Получить событие по ID.
 * Проверяет принадлежность текущему пользователю.
 */
export async function getById(req, res) {
  const event = await Event.findByPk(req.params.id);

  if (!event) {
    throw new NotFoundError(`Событие с id=${req.params.id} не найдено`);
  }

  if (event.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этому событию');
  }

  res.json({
    success: true,
    data: event,
  });
}

/**
 * PUT /api/v1/events/:id
 *
 * Обновить событие.
 */
export async function update(req, res) {
  const event = await Event.findByPk(req.params.id);

  if (!event) {
    throw new NotFoundError(`Событие с id=${req.params.id} не найдено`);
  }

  if (event.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этому событию');
  }

  await event.update(req.body);

  // TODO (Этап 6): Синхронизация с Google Calendar через MCP

  res.json({
    success: true,
    data: event,
  });
}

/**
 * DELETE /api/v1/events/:id
 *
 * Удалить событие.
 */
export async function remove(req, res) {
  const event = await Event.findByPk(req.params.id);

  if (!event) {
    throw new NotFoundError(`Событие с id=${req.params.id} не найдено`);
  }

  if (event.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этому событию');
  }

  // TODO (Этап 6): Удалить из Google Calendar через MCP

  await event.destroy();

  res.json({
    success: true,
    data: { message: 'Событие удалено' },
  });
}

/**
 * GET /api/v1/events/today
 *
 * Быстрый доступ: события на сегодня.
 * Учитывает timezone пользователя для определения "сегодня".
 */
export async function getToday(req, res) {
  const timezone = req.user.timezone || 'UTC';

  // Определяем начало и конец "сегодня" в timezone пользователя
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(new Date()); // "2026-02-12"
  const startOfDay = new Date(`${todayStr}T00:00:00`);
  const endOfDay = new Date(`${todayStr}T23:59:59`);

  const events = await Event.findAll({
    where: {
      user_id: req.user.id,
      event_date: {
        [Op.between]: [startOfDay, endOfDay],
      },
    },
    order: [['event_date', 'ASC']],
  });

  res.json({
    success: true,
    data: events,
  });
}

/**
 * GET /api/v1/events/range?start=2026-02-10&end=2026-02-14
 *
 * События за произвольный период.
 */
export async function getRange(req, res) {
  const { start, end } = req.query;

  if (!start || !end) {
    throw new NotFoundError('Параметры start и end обязательны');
  }

  const events = await Event.findAll({
    where: {
      user_id: req.user.id,
      event_date: {
        [Op.between]: [new Date(start), new Date(end)],
      },
    },
    order: [['event_date', 'ASC']],
  });

  res.json({
    success: true,
    data: events,
  });
}
```

### Zod-схемы валидации (из Этапа 2)

Уже определены в `src/utils/validators.js`:
- `createEventSchema` -- title, event_date, end_date обязательны; refine: end_date > event_date
- `updateEventSchema` -- все поля опциональны, params.id -- число
- `listEventsQuerySchema` -- from, to, page, limit

---

## 5. Tasks CRUD

### Файл: `src/routes/tasks.routes.js`

```js
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as tasksController from '../controllers/tasks.controller.js';
import {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  listTasksQuerySchema,
} from '../utils/validators.js';

const router = Router();

router.use(verifyToken);

// GET /api/v1/tasks
// Список задач с фильтрами и сортировкой
router.get('/', validate(listTasksQuerySchema), asyncHandler(tasksController.list));

// POST /api/v1/tasks
// Создать задачу
router.post('/', validate(createTaskSchema), asyncHandler(tasksController.create));

// GET /api/v1/tasks/:id
// Получить задачу по ID
router.get('/:id', asyncHandler(tasksController.getById));

// PUT /api/v1/tasks/:id
// Обновить задачу (любые поля)
router.put('/:id', validate(updateTaskSchema), asyncHandler(tasksController.update));

// PUT /api/v1/tasks/:id/status
// Изменить статус задачи (отдельный endpoint для удобства)
router.put('/:id/status', validate(updateTaskStatusSchema), asyncHandler(tasksController.updateStatus));

// DELETE /api/v1/tasks/:id
// Удалить задачу
router.delete('/:id', asyncHandler(tasksController.remove));

export default router;
```

### Файл: `src/controllers/tasks.controller.js`

```js
import { Op } from 'sequelize';
import models from '../models/index.js';
import { paginate, paginationMeta } from '../utils/pagination.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

const { Task, Employee } = models;

/**
 * GET /api/v1/tasks
 *
 * Список задач текущего пользователя.
 * Фильтры: ?status=pending&priority=high&assigned_to=5
 * Сортировка: ?sort=due_date&order=asc
 */
export async function list(req, res) {
  const { status, priority, assigned_to, sort, order, page, limit } = req.query;

  // Собираем условия фильтрации
  const where = { created_by: req.user.id };

  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (assigned_to) where.assigned_employee_id = Number(assigned_to);

  // Сортировка
  const orderClause = [[sort || 'created_at', order || 'DESC']];

  const { rows, count } = await Task.findAndCountAll({
    where,
    include: [
      {
        model: Employee,
        as: 'assignedEmployee',
        attributes: ['id', 'full_name', 'email'],
        required: false, // LEFT JOIN -- задачи без назначенного тоже показываем
      },
    ],
    order: orderClause,
    ...paginate(page, limit),
  });

  res.json({
    success: true,
    data: rows,
    meta: paginationMeta(count, page, limit),
  });
}

/**
 * POST /api/v1/tasks
 *
 * Создать задачу.
 */
export async function create(req, res) {
  const task = await Task.create({
    ...req.body,
    created_by: req.user.id,
    status: 'pending', // Новая задача всегда pending
  });

  // Подгрузить ассоциации для ответа
  const taskWithAssociations = await Task.findByPk(task.id, {
    include: [
      {
        model: Employee,
        as: 'assignedEmployee',
        attributes: ['id', 'full_name', 'email'],
        required: false,
      },
    ],
  });

  res.status(201).json({
    success: true,
    data: taskWithAssociations,
  });
}

/**
 * GET /api/v1/tasks/:id
 *
 * Получить задачу по ID.
 */
export async function getById(req, res) {
  const task = await Task.findByPk(req.params.id, {
    include: [
      {
        model: Employee,
        as: 'assignedEmployee',
        attributes: ['id', 'full_name', 'email'],
        required: false,
      },
    ],
  });

  if (!task) {
    throw new NotFoundError(`Задача с id=${req.params.id} не найдена`);
  }

  if (task.created_by !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой задаче');
  }

  res.json({
    success: true,
    data: task,
  });
}

/**
 * PUT /api/v1/tasks/:id
 *
 * Обновить задачу (любые поля).
 */
export async function update(req, res) {
  const task = await Task.findByPk(req.params.id);

  if (!task) {
    throw new NotFoundError(`Задача с id=${req.params.id} не найдена`);
  }

  if (task.created_by !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой задаче');
  }

  await task.update(req.body);

  // Подгрузить ассоциации для ответа
  const updated = await Task.findByPk(task.id, {
    include: [
      {
        model: Employee,
        as: 'assignedEmployee',
        attributes: ['id', 'full_name', 'email'],
        required: false,
      },
    ],
  });

  res.json({
    success: true,
    data: updated,
  });
}

/**
 * PUT /api/v1/tasks/:id/status
 *
 * Изменить только статус задачи.
 * Отдельный endpoint для удобства (фронтенд может менять статус одним запросом).
 * Допустимые значения: pending, in_progress, done, cancelled.
 */
export async function updateStatus(req, res) {
  const task = await Task.findByPk(req.params.id);

  if (!task) {
    throw new NotFoundError(`Задача с id=${req.params.id} не найдена`);
  }

  if (task.created_by !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой задаче');
  }

  await task.update({ status: req.body.status });

  res.json({
    success: true,
    data: task,
  });
}

/**
 * DELETE /api/v1/tasks/:id
 *
 * Удалить задачу.
 */
export async function remove(req, res) {
  const task = await Task.findByPk(req.params.id);

  if (!task) {
    throw new NotFoundError(`Задача с id=${req.params.id} не найдена`);
  }

  if (task.created_by !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой задаче');
  }

  await task.destroy();

  res.json({
    success: true,
    data: { message: 'Задача удалена' },
  });
}
```

---

## 6. Notes CRUD

### Файл: `src/routes/notes.routes.js`

```js
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as notesController from '../controllers/notes.controller.js';
import { createNoteSchema, updateNoteSchema } from '../utils/validators.js';

const router = Router();

router.use(verifyToken);

// GET /api/v1/notes
// Список заметок с фильтрами
router.get('/', asyncHandler(notesController.list));

// POST /api/v1/notes
// Создать заметку
router.post('/', validate(createNoteSchema), asyncHandler(notesController.create));

// GET /api/v1/notes/:id
// Получить заметку по ID
router.get('/:id', asyncHandler(notesController.getById));

// PUT /api/v1/notes/:id
// Обновить заметку
router.put('/:id', validate(updateNoteSchema), asyncHandler(notesController.update));

// PUT /api/v1/notes/:id/complete
// Отметить заметку как выполненную (или снять отметку)
router.put('/:id/complete', asyncHandler(notesController.toggleComplete));

// DELETE /api/v1/notes/:id
// Удалить заметку
router.delete('/:id', asyncHandler(notesController.remove));

export default router;
```

### Файл: `src/controllers/notes.controller.js`

```js
import models from '../models/index.js';
import { paginate, paginationMeta } from '../utils/pagination.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';

const { Note } = models;

/**
 * GET /api/v1/notes
 *
 * Список заметок текущего пользователя.
 * Фильтры: ?category=meeting&completed=false
 */
export async function list(req, res) {
  const { category, completed, page = '1', limit = '20' } = req.query;

  const where = { user_id: req.user.id };

  if (category) where.category = category;
  if (completed !== undefined) {
    where.completed = completed === 'true';
  }

  const { rows, count } = await Note.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    ...paginate(page, limit),
  });

  res.json({
    success: true,
    data: rows,
    meta: paginationMeta(count, page, limit),
  });
}

/**
 * POST /api/v1/notes
 *
 * Создать заметку.
 */
export async function create(req, res) {
  const note = await Note.create({
    ...req.body,
    user_id: req.user.id,
  });

  res.status(201).json({
    success: true,
    data: note,
  });
}

/**
 * GET /api/v1/notes/:id
 *
 * Получить заметку по ID.
 */
export async function getById(req, res) {
  const note = await Note.findByPk(req.params.id);

  if (!note) {
    throw new NotFoundError(`Заметка с id=${req.params.id} не найдена`);
  }

  if (note.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой заметке');
  }

  res.json({
    success: true,
    data: note,
  });
}

/**
 * PUT /api/v1/notes/:id
 *
 * Обновить заметку.
 */
export async function update(req, res) {
  const note = await Note.findByPk(req.params.id);

  if (!note) {
    throw new NotFoundError(`Заметка с id=${req.params.id} не найдена`);
  }

  if (note.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой заметке');
  }

  await note.update(req.body);

  res.json({
    success: true,
    data: note,
  });
}

/**
 * PUT /api/v1/notes/:id/complete
 *
 * Отметить заметку как выполненную (toggle).
 *
 * Request body:
 *   { "completed": true }
 *   или
 *   { "completed": false }
 *
 * Если body не передан -- переключает текущее значение.
 */
export async function toggleComplete(req, res) {
  const note = await Note.findByPk(req.params.id);

  if (!note) {
    throw new NotFoundError(`Заметка с id=${req.params.id} не найдена`);
  }

  if (note.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой заметке');
  }

  // Если передан explicit completed -- используем его, иначе toggle
  const newCompleted =
    req.body.completed !== undefined ? req.body.completed : !note.completed;

  await note.update({ completed: newCompleted });

  res.json({
    success: true,
    data: note,
  });
}

/**
 * DELETE /api/v1/notes/:id
 *
 * Удалить заметку.
 */
export async function remove(req, res) {
  const note = await Note.findByPk(req.params.id);

  if (!note) {
    throw new NotFoundError(`Заметка с id=${req.params.id} не найдена`);
  }

  if (note.user_id !== req.user.id) {
    throw new ForbiddenError('Нет доступа к этой заметке');
  }

  await note.destroy();

  res.json({
    success: true,
    data: { message: 'Заметка удалена' },
  });
}
```

---

## 7. Users profile

### Файл: `src/routes/users.routes.js`

```js
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as usersController from '../controllers/users.controller.js';
import { updateProfileSchema, updateSettingsSchema } from '../utils/validators.js';

const router = Router();

router.use(verifyToken);

// GET /api/v1/users/me
// Получить профиль текущего пользователя
router.get('/me', asyncHandler(usersController.getProfile));

// PUT /api/v1/users/me
// Обновить профиль
router.put('/me', validate(updateProfileSchema), asyncHandler(usersController.updateProfile));

// PUT /api/v1/users/me/settings
// Обновить настройки бота
router.put(
  '/me/settings',
  validate(updateSettingsSchema),
  asyncHandler(usersController.updateSettings)
);

export default router;
```

### Zod-схемы

Добавить в `src/utils/validators.js`:

```js
/**
 * PUT /api/v1/users/me
 */
export const updateProfileSchema = z.object({
  body: z.object({
    email: z.string().email('Некорректный формат email').optional(),
    timezone: z
      .string()
      .regex(/^[A-Za-z]+\/[A-Za-z_]+$/, 'Timezone в формате IANA')
      .optional(),
    language: z.enum(['ru', 'en']).optional(),
  }),
});

/**
 * PUT /api/v1/users/me/settings
 */
export const updateSettingsSchema = z.object({
  body: z.object({
    digest_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/, 'Время в формате HH:MM')
      .optional(),
    digest_enabled: z.boolean().optional(),
    voice_enabled: z.boolean().optional(),
    voice_model: z.enum(['filipp', 'alena', 'ermil', 'jane', 'omazh']).optional(),
    notification_enabled: z.boolean().optional(),
  }),
});
```

### Файл: `src/controllers/users.controller.js`

```js
import models from '../models/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';

const { User, Subscription } = models;

/**
 * GET /api/v1/users/me
 *
 * Получить профиль текущего пользователя.
 * Включает информацию о подписке и подключённых интеграциях.
 */
export async function getProfile(req, res) {
  const user = await User.findByPk(req.user.id, {
    attributes: {
      exclude: ['password_hash'], // НИКОГДА не возвращаем хеш пароля
    },
    include: [
      {
        model: Subscription,
        attributes: ['tier', 'status', 'current_period_end', 'cancel_at_period_end'],
        required: false,
      },
    ],
  });

  if (!user) {
    throw new NotFoundError('Пользователь не найден');
  }

  res.json({
    success: true,
    data: user,
  });
}

/**
 * PUT /api/v1/users/me
 *
 * Обновить профиль (email, timezone, language).
 */
export async function updateProfile(req, res) {
  const user = await User.findByPk(req.user.id);

  if (!user) {
    throw new NotFoundError('Пользователь не найден');
  }

  // Проверить уникальность email если меняется
  if (req.body.email && req.body.email !== user.email) {
    const existing = await User.findOne({ where: { email: req.body.email } });
    if (existing) {
      throw new ConflictError(`Email "${req.body.email}" уже используется`);
    }
  }

  await user.update(req.body);

  // Возвращаем обновлённый профиль (без password_hash)
  const updatedUser = await User.findByPk(req.user.id, {
    attributes: { exclude: ['password_hash'] },
  });

  res.json({
    success: true,
    data: updatedUser,
  });
}

/**
 * PUT /api/v1/users/me/settings
 *
 * Обновить настройки бота.
 * Настройки хранятся в JSONB поле (или отдельных полях, в зависимости от модели).
 *
 * Примечание: В MVP настройки хранятся как отдельные поля в модели User.
 * В будущем можно вынести в отдельную модель UserSettings.
 */
export async function updateSettings(req, res) {
  const user = await User.findByPk(req.user.id);

  if (!user) {
    throw new NotFoundError('Пользователь не найден');
  }

  // Обновляем только переданные поля настроек
  // Поля настроек могут храниться в JSONB поле settings
  // или как отдельные колонки -- зависит от финальной модели User
  const settings = { ...user.settings, ...req.body };
  await user.update({ settings });

  res.json({
    success: true,
    data: {
      message: 'Настройки обновлены',
      settings,
    },
  });
}
```

---

## 8. Sessions

API для работы с сессиями чата полностью реализован в разделе [3. Chat endpoint](#3-chat-endpoint) (файл `src/controllers/sessions.controller.js`).

### Сводка endpoints

| Метод | Путь | Описание | Контроллер |
|-------|------|----------|------------|
| `POST` | `/api/v1/chat` | Отправить сообщение боту | `sessionsController.sendMessage` |
| `GET` | `/api/v1/chat/sessions` | Список сессий | `sessionsController.listSessions` |
| `GET` | `/api/v1/chat/sessions/:id` | Сессия с историей сообщений | `sessionsController.getSession` |
| `DELETE` | `/api/v1/chat/sessions/:id` | Архивировать сессию (soft delete) | `sessionsController.deleteSession` |

### Примеры запросов и ответов

#### Отправка сообщения

```http
POST /api/v1/chat
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "message": "Какие у меня встречи сегодня?",
  "session_id": 42
}
```

```json
{
  "success": true,
  "data": {
    "reply": "Сегодня у вас 3 встречи:\n\n1. 10:00 - Звонок с Иваном\n2. 14:00 - Планёрка отдела\n3. 17:30 - Дем с клиентом\n\nХотите добавить что-то ещё?",
    "session_id": 42,
    "actions": []
  }
}
```

#### Список сессий

```http
GET /api/v1/chat/sessions?page=1&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "platform": "api",
      "session_type": "work",
      "started_at": "2026-02-12T08:30:00.000Z",
      "ended_at": null,
      "current_summary": "Обсуждение расписания на неделю",
      "message_count": 15
    },
    {
      "id": 41,
      "platform": "telegram",
      "session_type": "work",
      "started_at": "2026-02-11T10:00:00.000Z",
      "ended_at": "2026-02-11T18:00:00.000Z",
      "current_summary": "Создание задач для команды",
      "message_count": 28
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 23,
    "total_pages": 3
  }
}
```

---

## 9. Пагинация

### Файл: `src/utils/pagination.js`

Переиспользуемый хелпер для всех endpoints со списками.

```js
/**
 * Вычислить offset и limit для Sequelize запроса.
 *
 * Использование:
 *   const { rows, count } = await Model.findAndCountAll({
 *     where: { ... },
 *     ...paginate(page, limit),
 *   });
 *
 * @param {string|number} page - Номер страницы (начиная с 1)
 * @param {string|number} limit - Количество записей на странице
 * @returns {{ offset: number, limit: number }}
 */
export function paginate(page = '1', limit = '20') {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20)); // 1-100

  return {
    offset: (pageNum - 1) * limitNum,
    limit: limitNum,
  };
}

/**
 * Формирование объекта meta для пагинированного ответа.
 *
 * Использование:
 *   res.json({
 *     success: true,
 *     data: rows,
 *     meta: paginationMeta(count, page, limit),
 *   });
 *
 * @param {number} total - Общее количество записей
 * @param {string|number} page - Текущая страница
 * @param {string|number} limit - Записей на странице
 * @returns {{ page: number, limit: number, total: number, total_pages: number }}
 */
export function paginationMeta(total, page = '1', limit = '20') {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const totalPages = Math.ceil(total / limitNum);

  return {
    page: pageNum,
    limit: limitNum,
    total,
    total_pages: totalPages,
  };
}
```

### Формат ответа с пагинацией

Все endpoints-списки возвращают данные в едином формате:

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "total_pages": 8
  }
}
```

### Ограничения

- `page` минимум 1, по умолчанию 1
- `limit` от 1 до 100, по умолчанию 20 (защита от "дай мне 1 000 000 записей")

---

## 10. Swagger документация

### Файл: `src/config/swagger.js`

```js
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Secretary Bot API',
      version: '1.0.0',
      description:
        'REST API для AI-секретаря Secretary Bot. ' +
        'Управление событиями, задачами, заметками, чат с ботом.',
      contact: {
        name: 'Secretary Bot Support',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token. Получить через POST /auth/login',
        },
      },
      schemas: {
        // Переиспользуемые схемы
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Ошибка валидации' },
                details: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 156 },
            total_pages: { type: 'integer', example: 8 },
          },
        },
        Event: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            user_id: { type: 'integer' },
            title: { type: 'string', example: 'Встреча с Иваном' },
            description: { type: 'string', nullable: true },
            event_date: { type: 'string', format: 'date-time' },
            end_date: { type: 'string', format: 'date-time' },
            google_calendar_event_id: { type: 'string', nullable: true },
            recurrence_rule: { type: 'string', nullable: true },
            reminder_minutes: { type: 'integer', example: 15 },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Task: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string', example: 'Подготовить отчёт' },
            description: { type: 'string', nullable: true },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'done', 'cancelled'],
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
            },
            due_date: { type: 'string', format: 'date-time', nullable: true },
            tags: { type: 'array', items: { type: 'string' } },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Note: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            user_id: { type: 'integer' },
            content: { type: 'string', example: 'Позвонить клиенту по проекту X' },
            category: { type: 'string', nullable: true },
            completed: { type: 'boolean', example: false },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'], // Сканировать JSDoc-аннотации в route-файлах
};

export const swaggerSpec = swaggerJsdoc(options);
```

### Подключение Swagger UI в `src/app.js`

```js
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';

// ... после middleware chain, перед routes ...

// Swagger UI доступен на /api/docs
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Secretary Bot API Docs',
  customCss: '.swagger-ui .topbar { display: none }', // Скрыть topbar
}));

// JSON-спецификация (для Postman, клиент-генераторов)
app.get('/api/docs.json', (req, res) => {
  res.json(swaggerSpec);
});
```

### Пример JSDoc-аннотации в route-файле

Добавить аннотации в `src/routes/events.routes.js`:

```js
/**
 * @swagger
 * /events:
 *   get:
 *     summary: Список событий
 *     description: Получить список событий текущего пользователя с фильтрами и пагинацией
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Начало периода (ISO 8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Конец периода (ISO 8601)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Список событий
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Event'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       401:
 *         description: Не авторизован
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', validate(listEventsQuerySchema), asyncHandler(eventsController.list));

/**
 * @swagger
 * /events:
 *   post:
 *     summary: Создать событие
 *     description: Создать новое событие календаря
 *     tags: [Events]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, event_date, end_date]
 *             properties:
 *               title:
 *                 type: string
 *                 example: Встреча с Иваном
 *               description:
 *                 type: string
 *               event_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-02-13T10:00:00.000Z"
 *               end_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-02-13T11:00:00.000Z"
 *               recurrence_rule:
 *                 type: string
 *                 example: "FREQ=WEEKLY;BYDAY=MO,WE,FR"
 *               reminder_minutes:
 *                 type: integer
 *                 default: 15
 *     responses:
 *       201:
 *         description: Событие создано
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Event'
 *       400:
 *         description: Ошибка валидации
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', validate(createEventSchema), asyncHandler(eventsController.create));
```

---

## 11. Health endpoints

### Файл: `src/routes/health.routes.js`

```js
import { Router } from 'express';
import * as healthController from '../controllers/health.controller.js';

const router = Router();

// НЕ требуют JWT -- используются для мониторинга (Kubernetes, Docker, Uptime Robot)

// GET /api/v1/health
// Liveness probe -- "приложение живо?"
router.get('/', healthController.liveness);

// GET /api/v1/health/ready
// Readiness probe -- "приложение готово обрабатывать запросы?"
router.get('/ready', healthController.readiness);

export default router;
```

### Файл: `src/controllers/health.controller.js`

```js
import models from '../models/index.js';
import logger from '../config/logger.js';

/**
 * GET /api/v1/health
 *
 * Liveness probe.
 * Отвечает "ok" если приложение запущено.
 * Не проверяет зависимости (БД, Redis) -- это делает readiness.
 *
 * Kubernetes/Docker используют этот endpoint для определения,
 * нужно ли перезапустить контейнер.
 */
export function liveness(req, res) {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    },
  });
}

/**
 * GET /api/v1/health/ready
 *
 * Readiness probe.
 * Проверяет соединение с PostgreSQL (и Redis, когда подключим).
 * Если БД недоступна -- возвращает 503 (Service Unavailable).
 *
 * Kubernetes использует этот endpoint для определения,
 * можно ли направлять трафик на этот pod.
 */
export async function readiness(req, res) {
  const checks = {
    postgres: 'unknown',
    // redis: 'unknown', // TODO: добавить после подключения Redis
  };

  let allReady = true;

  // Проверяем PostgreSQL
  try {
    await models.sequelize.authenticate();
    checks.postgres = 'ok';
  } catch (err) {
    checks.postgres = 'error';
    allReady = false;
    logger.error('Health check: PostgreSQL unavailable', {
      error: err.message,
    });
  }

  // TODO (Этап 9): Проверять Redis
  // try {
  //   await redis.ping();
  //   checks.redis = 'ok';
  // } catch (err) {
  //   checks.redis = 'error';
  //   allReady = false;
  // }

  const statusCode = allReady ? 200 : 503;

  res.status(statusCode).json({
    success: allReady,
    data: {
      status: allReady ? 'ready' : 'not_ready',
      checks,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
}
```

### Примеры ответов

#### Liveness (всё хорошо)

```http
GET /api/v1/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 12345,
    "timestamp": "2026-02-12T10:30:00.000Z",
    "version": "1.0.0"
  }
}
```

#### Readiness (всё хорошо)

```http
GET /api/v1/health/ready
```

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "checks": {
      "postgres": "ok"
    },
    "uptime": 12345,
    "timestamp": "2026-02-12T10:30:00.000Z"
  }
}
```

#### Readiness (БД недоступна)

```http
GET /api/v1/health/ready
```

HTTP 503:

```json
{
  "success": false,
  "data": {
    "status": "not_ready",
    "checks": {
      "postgres": "error"
    },
    "uptime": 12345,
    "timestamp": "2026-02-12T10:30:00.000Z"
  }
}
```

---

## 12. Чеклист готовности

### Перед завершением Этапа 3: полная проверка

#### Архитектура

- [ ] Все endpoints под `/api/v1/`
- [ ] Route -> Controller -> Service паттерн соблюдается
- [ ] Контроллеры тонкие: нет бизнес-логики, только оркестрация
- [ ] `src/routes/index.js` агрегирует все маршруты
- [ ] Каждый route-файл подключает `verifyToken` (кроме auth и health)

#### UnifiedMessage

- [ ] Формат `UnifiedMessage` определён и задокументирован (JSDoc)
- [ ] Telegram адаптер конвертирует сообщения в `UnifiedMessage`
- [ ] REST API адаптер конвертирует запросы в `UnifiedMessage`
- [ ] `messageProcessor.js` принимает `UnifiedMessage` и не знает о платформе

#### Chat

- [ ] `POST /api/v1/chat` отправляет сообщение через `messageProcessor`
- [ ] Тот же `messageProcessor` используется для Telegram и REST API
- [ ] `session_id` опционален (null = создать новую)
- [ ] Ответ содержит `reply`, `session_id`, `actions`

#### CRUD -- Events

- [ ] `GET /api/v1/events` -- список с фильтрами (from, to) и пагинацией
- [ ] `POST /api/v1/events` -- создание с валидацией (title, event_date, end_date)
- [ ] `GET /api/v1/events/:id` -- получение с проверкой владельца
- [ ] `PUT /api/v1/events/:id` -- обновление с проверкой владельца
- [ ] `DELETE /api/v1/events/:id` -- удаление с проверкой владельца
- [ ] `GET /api/v1/events/today` -- события на сегодня (timezone-aware)
- [ ] `GET /api/v1/events/range` -- события за период

#### CRUD -- Tasks

- [ ] `GET /api/v1/tasks` -- список с фильтрами (status, priority, assigned_to) и сортировкой
- [ ] `POST /api/v1/tasks` -- создание (title обязателен, status=pending по умолчанию)
- [ ] `GET /api/v1/tasks/:id` -- с проверкой владельца
- [ ] `PUT /api/v1/tasks/:id` -- обновление любых полей
- [ ] `PUT /api/v1/tasks/:id/status` -- изменение только статуса
- [ ] `DELETE /api/v1/tasks/:id` -- удаление

#### CRUD -- Notes

- [ ] `GET /api/v1/notes` -- список с фильтрами (category, completed)
- [ ] `POST /api/v1/notes` -- создание (content обязателен)
- [ ] `GET /api/v1/notes/:id` -- с проверкой владельца
- [ ] `PUT /api/v1/notes/:id` -- обновление
- [ ] `PUT /api/v1/notes/:id/complete` -- toggle completed
- [ ] `DELETE /api/v1/notes/:id` -- удаление

#### Users

- [ ] `GET /api/v1/users/me` -- профиль без password_hash
- [ ] `PUT /api/v1/users/me` -- обновление с проверкой уникальности email
- [ ] `PUT /api/v1/users/me/settings` -- обновление настроек бота

#### Sessions

- [ ] `GET /api/v1/chat/sessions` -- список с пагинацией
- [ ] `GET /api/v1/chat/sessions/:id` -- с историей сообщений
- [ ] `DELETE /api/v1/chat/sessions/:id` -- soft delete (ended_at)

#### Пагинация

- [ ] `paginate()` хелпер используется во всех списковых endpoints
- [ ] `paginationMeta()` формирует единообразный `meta` объект
- [ ] Лимит `limit` ограничен 1-100 (защита от abuse)
- [ ] Ответ: `{ success, data: [...], meta: { page, limit, total, total_pages } }`

#### Swagger

- [ ] `swagger-jsdoc` + `swagger-ui-express` подключены
- [ ] Swagger UI доступен на `/api/docs`
- [ ] JSON-спецификация доступна на `/api/docs.json`
- [ ] Все endpoints задокументированы (хотя бы основные: events, tasks, notes, chat)
- [ ] Security scheme `bearerAuth` определён в components

#### Health

- [ ] `GET /api/v1/health` -- liveness (status, uptime, timestamp)
- [ ] `GET /api/v1/health/ready` -- readiness (проверка PostgreSQL)
- [ ] Readiness возвращает 503 если БД недоступна
- [ ] Health endpoints НЕ требуют JWT
- [ ] Health endpoints исключены из rate limiting

#### Безопасность (наследование от Этапа 2)

- [ ] Все CRUD-endpoints проверяют `user_id` / `created_by` (нельзя видеть чужие данные)
- [ ] Все мутирующие endpoints используют zod-валидацию
- [ ] `password_hash` никогда не возвращается в ответах API
- [ ] Все async-контроллеры обёрнуты в `asyncHandler`

#### Единообразие ответов

- [ ] Успешный ответ: `{ success: true, data: {...} }`
- [ ] Список с пагинацией: `{ success: true, data: [...], meta: {...} }`
- [ ] Ошибка: `{ success: false, error: { code, message, details? } }`
- [ ] HTTP-коды: 200 (OK), 201 (Created), 400, 401, 403, 404, 429, 500

---

## Порядок реализации (рекомендуемый)

```
День 1:
  1. src/utils/pagination.js (хелпер пагинации)
  2. src/routes/index.js (агрегатор маршрутов)
  3. src/routes/health.routes.js + src/controllers/health.controller.js
  4. src/routes/events.routes.js + src/controllers/events.controller.js
  5. Дополнительные zod-схемы в src/utils/validators.js
  6. Проверить: GET/POST/PUT/DELETE events работают через Postman/curl

День 2:
  7. src/routes/tasks.routes.js + src/controllers/tasks.controller.js
  8. src/routes/notes.routes.js + src/controllers/notes.controller.js
  9. src/routes/users.routes.js + src/controllers/users.controller.js
  10. Проверить: все CRUD endpoints работают

День 3:
  11. src/services/platforms/api/restAdapter.js (UnifiedMessage из REST)
  12. src/routes/sessions.routes.js + src/controllers/sessions.controller.js
  13. POST /api/v1/chat -- интеграция с messageProcessor
  14. Проверить: отправка сообщения через API даёт тот же результат, что Telegram

День 4:
  15. src/config/swagger.js + подключение в src/app.js
  16. JSDoc-аннотации во все route-файлы
  17. Проверить: Swagger UI на /api/docs показывает все endpoints
  18. Финальный прогон по чеклисту готовности
```

---

## Сводка всех endpoints этого этапа

| # | Метод | Путь | Описание |
|---|-------|------|----------|
| 1 | `POST` | `/api/v1/chat` | Отправить сообщение боту |
| 2 | `GET` | `/api/v1/chat/sessions` | Список сессий |
| 3 | `GET` | `/api/v1/chat/sessions/:id` | Сессия с сообщениями |
| 4 | `DELETE` | `/api/v1/chat/sessions/:id` | Архивировать сессию |
| 5 | `GET` | `/api/v1/events` | Список событий |
| 6 | `POST` | `/api/v1/events` | Создать событие |
| 7 | `GET` | `/api/v1/events/:id` | Получить событие |
| 8 | `PUT` | `/api/v1/events/:id` | Обновить событие |
| 9 | `DELETE` | `/api/v1/events/:id` | Удалить событие |
| 10 | `GET` | `/api/v1/events/today` | События на сегодня |
| 11 | `GET` | `/api/v1/events/range` | События за период |
| 12 | `GET` | `/api/v1/tasks` | Список задач |
| 13 | `POST` | `/api/v1/tasks` | Создать задачу |
| 14 | `GET` | `/api/v1/tasks/:id` | Получить задачу |
| 15 | `PUT` | `/api/v1/tasks/:id` | Обновить задачу |
| 16 | `PUT` | `/api/v1/tasks/:id/status` | Изменить статус задачи |
| 17 | `DELETE` | `/api/v1/tasks/:id` | Удалить задачу |
| 18 | `GET` | `/api/v1/notes` | Список заметок |
| 19 | `POST` | `/api/v1/notes` | Создать заметку |
| 20 | `GET` | `/api/v1/notes/:id` | Получить заметку |
| 21 | `PUT` | `/api/v1/notes/:id` | Обновить заметку |
| 22 | `PUT` | `/api/v1/notes/:id/complete` | Toggle completed |
| 23 | `DELETE` | `/api/v1/notes/:id` | Удалить заметку |
| 24 | `GET` | `/api/v1/users/me` | Профиль |
| 25 | `PUT` | `/api/v1/users/me` | Обновить профиль |
| 26 | `PUT` | `/api/v1/users/me/settings` | Обновить настройки |
| 27 | `GET` | `/api/v1/health` | Liveness probe |
| 28 | `GET` | `/api/v1/health/ready` | Readiness probe |

**Итого: 28 endpoints** (из 48 целевых). Остальные 20 добавятся на этапах 6 (Интеграции), 7 (CRM), 8 (Биллинг).

---

## Зависимости от предыдущих этапов

| Требование | Откуда | Этап |
|------------|--------|------|
| JWT `verifyToken` middleware | `src/middleware/auth.js` | Этап 2 |
| Zod-валидация `validate()` middleware | `src/middleware/validator.js` | Этап 2 |
| `asyncHandler()` wrapper | `src/middleware/errorHandler.js` | Этап 2 |
| Классы ошибок (NotFoundError, ForbiddenError) | `src/utils/errors.js` | Этап 2 |
| Zod-схемы для Events, Tasks, Notes | `src/utils/validators.js` | Этап 2 |
| Модели с `user_id`, `created_by` FK | Рефакторинг моделей | Этап 1 |
| `messageProcessor.js` | Core Layer | Этап 4+ |

### Примечание по messageProcessor

На Этапе 3 `messageProcessor.js` может быть заглушкой, которая просто возвращает echo-ответ. Полная реализация с Claude API будет на Этапе 4 (Миграция на Claude). Это позволяет полностью завершить API-слой и протестировать все endpoints без зависимости от AI-сервиса.

```js
// Временная заглушка src/services/core/messageProcessor.js (до Этапа 4)
export const messageProcessor = {
  async process(unifiedMessage) {
    return {
      reply: `Echo: ${unifiedMessage.text}`,
      sessionId: unifiedMessage.sessionId || 1,
      actions: [],
    };
  },
};
```

---

## Что НЕ входит в этот этап

- Contacts CRM endpoints (Этап 7)
- Billing endpoints (Этап 8)
- Integrations OAuth endpoints (Этап 6)
- Digest endpoint (Этап 5)
- WebSocket real-time (после Этапа 3, можно параллельно)
- Полноценный `messageProcessor` с Claude API (Этап 4)
