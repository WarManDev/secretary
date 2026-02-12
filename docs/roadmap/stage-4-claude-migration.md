# Stage 4: Миграция на Claude API + MCP интеграции

> **Длительность:** 3-4 дня
> **Зависимости:** Stage 3 (Universal API) должен быть завершён
> **Цель:** Заменить OpenAI GPT-4 на Claude API. Внедрить MCP-слой для Google-сервисов. Это КЛЮЧЕВОЕ обновление интеллекта бота.
> **Последнее обновление:** 2026-02-12

---

## Ключевой архитектурный принцип

```
ВАЖНО: Google Calendar, Gmail и Google Docs работают ИСКЛЮЧИТЕЛЬНО через MCP-серверы.

Бэкенд НЕ вызывает Google API напрямую. Вместо этого:

1. Claude получает сообщение пользователя
2. Claude решает, какой tool вызвать (например, create_calendar_event)
3. Claude возвращает tool_use блок
4. Бэкенд маршрутизирует tool_use к соответствующему MCP-серверу
5. MCP-сервер выполняет реальный вызов Google API
6. Результат возвращается Claude как tool_result
7. Claude формирует финальный текстовый ответ пользователю

Текущий googleCalendarService.js (прямые вызовы googleapis) -- УДАЛЯЕТСЯ.
Текущий chatgptHandler.js (OpenAI GPT-4-0613) -- УДАЛЯЕТСЯ.
```

---

## Оглавление

1. [Установка зависимостей](#1-установка-зависимостей)
2. [Claude API Handler](#2-claude-api-handler)
3. [Tool Definitions](#3-tool-definitions)
4. [System Prompt](#4-system-prompt--prompt-caching)
5. [Model Router](#5-model-router)
6. [Intent Parser](#6-intent-parser)
7. [MCP Manager](#7-mcp-manager)
8. [MCP Router](#8-mcp-router)
9. [MCP Config](#9-mcp-config)
10. [Message Processor обновление](#10-message-processor-обновление)
11. [Удаление legacy кода](#11-удаление-legacy-кода)
12. [Тестирование миграции](#12-тестирование-миграции)
13. [Мониторинг AI расходов](#13-мониторинг-ai-расходов)
14. [Чеклист готовности](#14-чеклист-готовности)

---

## 1. Установка зависимостей

### Новые пакеты

```bash
# Claude API SDK -- официальная библиотека Anthropic
npm install @anthropic-ai/sdk

# MCP клиент -- для взаимодействия с MCP-серверами
npm install @anthropic-ai/mcp-client

# MCP-серверы для Google-сервисов
npm install @anthropic-ai/mcp-server-google-calendar
npm install @anthropic-ai/mcp-server-gmail
npm install @anthropic-ai/mcp-server-google-drive
```

### Удаление старых пакетов

```bash
# Удаляем прямую зависимость от Google API SDK
# (MCP-серверы имеют свои собственные зависимости)
npm uninstall googleapis

# НЕ удаляем openai -- его нет в package.json (использовался raw fetch)
# Но chatgptHandler.js будет удалён
```

### Переменные окружения (.env)

Добавить в `.env`:

```env
# Claude API
ANTHROPIC_API_KEY=sk-ant-api03-...

# MCP серверы (Google OAuth credentials -- используются MCP-серверами)
# Эти значения берутся из OAuthToken модели для каждого пользователя.
# Ниже -- fallback для single-user режима (текущий BOSS_CHAT_ID):
GOOGLE_CLIENT_ID=...          # переименовано из GCAL_CLIENT_ID
GOOGLE_CLIENT_SECRET=...      # переименовано из GCAL_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN=...      # переименовано из GCAL_REFRESH_TOKEN
```

Удалить из `.env`:

```env
# Больше не нужны:
# OPENAI_API_KEY        -- заменён на ANTHROPIC_API_KEY
# GOOGLE_ACCESS_TOKEN   -- MCP-серверы управляют токенами сами
```

### Итоговая секция dependencies в package.json

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@anthropic-ai/mcp-client": "^0.1.0",
    "@anthropic-ai/mcp-server-google-calendar": "^0.1.0",
    "@anthropic-ai/mcp-server-gmail": "^0.1.0",
    "@anthropic-ai/mcp-server-google-drive": "^0.1.0",
    "axios": "^1.7.9",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "fluent-ffmpeg": "^2.1.3",
    "moment-timezone": "^0.5.47",
    "node-schedule": "^2.1.1",
    "node-telegram-bot-api": "^0.66.0",
    "pg": "^8.13.2",
    "pg-hstore": "^2.3.4",
    "sequelize": "^6.37.5",
    "winston": "^3.17.0"
  }
}
```

> **Примечание:** `googleapis` удалён -- Google API вызовы теперь идут через MCP-серверы.
> `body-parser` удалён -- используется встроенный `express.json()` (Stage 3).
> `nodemon` перенесён в `devDependencies` (Stage 1).

---

## 2. Claude API Handler

**Файл:** `src/services/ai/claudeHandler.js`

Полная замена текущего `services/chatgptHandler.js`. Вместо raw fetch к OpenAI
используется официальный `@anthropic-ai/sdk`.

```javascript
// src/services/ai/claudeHandler.js

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from './promptBuilder.js';
import { getToolDefinitions } from './toolDefinitions.js';
import { selectModel } from './modelRouter.js';
import { parseResponse } from './intentParser.js';
import { config } from '../../config/index.js';
import { logger } from '../../config/logger.js';

// Singleton -- один экземпляр клиента на всё приложение
const client = new Anthropic({
  apiKey: config.anthropicApiKey,
});

/**
 * Отправляет сообщение пользователя в Claude API и возвращает структурированный ответ.
 *
 * @param {Object} params
 * @param {Array}  params.messages      - История сообщений [{ role: 'user'|'assistant', content: '...' }]
 * @param {Object} params.user          - Объект пользователя из БД (id, timezone, subscription_tier, ...)
 * @param {Array}  params.connectedIntegrations - Список подключённых интеграций ['google_calendar', 'gmail', ...]
 * @returns {Object} { text, toolCalls, usage, model }
 */
export async function sendMessage({ messages, user, connectedIntegrations = [] }) {
  // 1. Определяем модель (Haiku или Sonnet) на основе контекста
  const model = selectModel({
    lastMessage: messages[messages.length - 1]?.content || '',
    messageCount: messages.length,
    connectedIntegrations,
  });

  // 2. Собираем системный промпт (с кэшированием)
  const systemPrompt = buildSystemPrompt({
    user,
    connectedIntegrations,
    currentDateTime: new Date().toISOString(),
  });

  // 3. Получаем определения инструментов (только для подключённых интеграций)
  const tools = getToolDefinitions(connectedIntegrations);

  // 4. Конвертируем историю в формат Claude API
  const claudeMessages = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  try {
    logger.info('[Claude] Отправка запроса', {
      model,
      messageCount: claudeMessages.length,
      toolCount: tools.length,
      userId: user.id,
    });

    // 5. Вызов Claude API
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,  // system prompt с cache_control
      messages: claudeMessages,
      tools: tools.length > 0 ? tools : undefined,
    });

    // 6. Логируем использование токенов
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens || 0,
    };

    logger.info('[Claude] Ответ получен', {
      model,
      stopReason: response.stop_reason,
      usage,
      userId: user.id,
    });

    // 7. Парсим ответ (текст + tool_use блоки)
    const parsed = parseResponse(response);

    return {
      text: parsed.text,
      toolCalls: parsed.toolCalls,
      usage,
      model,
      stopReason: response.stop_reason,
      rawContent: response.content,  // сохраняем для tool_result loop
    };
  } catch (error) {
    // Обработка специфичных ошибок Claude API
    if (error instanceof Anthropic.APIError) {
      logger.error('[Claude] API ошибка', {
        status: error.status,
        message: error.message,
        type: error.error?.type,
        userId: user.id,
      });

      if (error.status === 429) {
        throw new Error('Claude API: превышен лимит запросов. Попробуйте через минуту.');
      }
      if (error.status === 529) {
        throw new Error('Claude API: сервис временно перегружен. Попробуйте через минуту.');
      }
    }

    logger.error('[Claude] Неожиданная ошибка', {
      error: error.message,
      stack: error.stack,
      userId: user.id,
    });

    throw new Error(`Ошибка Claude API: ${error.message}`);
  }
}

/**
 * Отправляет результат выполнения инструмента обратно в Claude для получения
 * финального текстового ответа.
 *
 * @param {Object} params
 * @param {Array}  params.messages       - Вся история включая предыдущий ответ Claude
 * @param {Array}  params.toolResults    - Массив результатов [{ tool_use_id, content }]
 * @param {Object} params.user           - Объект пользователя
 * @param {string} params.model          - Та же модель, что использовалась для tool_use
 * @param {Array}  params.connectedIntegrations - Подключённые интеграции
 * @returns {Object} { text, toolCalls, usage, model }
 */
export async function sendToolResults({ messages, toolResults, user, model, connectedIntegrations = [] }) {
  const systemPrompt = buildSystemPrompt({
    user,
    connectedIntegrations,
    currentDateTime: new Date().toISOString(),
  });

  const tools = getToolDefinitions(connectedIntegrations);

  // Формируем сообщение с tool_result
  const toolResultMessage = {
    role: 'user',
    content: toolResults.map(result => ({
      type: 'tool_result',
      tool_use_id: result.tool_use_id,
      content: typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content),
      is_error: result.is_error || false,
    })),
  };

  const allMessages = [...messages, toolResultMessage];

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: allMessages,
      tools: tools.length > 0 ? tools : undefined,
    });

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens || 0,
    };

    logger.info('[Claude] Tool result ответ', {
      model,
      stopReason: response.stop_reason,
      usage,
      userId: user.id,
    });

    const parsed = parseResponse(response);

    return {
      text: parsed.text,
      toolCalls: parsed.toolCalls,
      usage,
      model,
      stopReason: response.stop_reason,
      rawContent: response.content,
    };
  } catch (error) {
    logger.error('[Claude] Ошибка при отправке tool_result', {
      error: error.message,
      userId: user.id,
    });
    throw new Error(`Ошибка Claude API (tool_result): ${error.message}`);
  }
}
```

### Сравнение со старым chatgptHandler.js

| Аспект | chatgptHandler.js (старый) | claudeHandler.js (новый) |
|---|---|---|
| API | OpenAI `gpt-4-0613` через raw fetch | Claude через `@anthropic-ai/sdk` |
| System prompt | Инлайн строка с JSON-инструкциями | `promptBuilder.js` с кэшированием |
| Function calling | OpenAI `functions` + `function_call: "auto"` | Claude native `tool_use` |
| Модели | Одна модель (gpt-4-0613) | Haiku (70%) / Sonnet (30%) через `modelRouter.js` |
| Обработка ответа | Ручной JSON.parse | `intentParser.js` с поддержкой multi-tool |
| Ошибки | Простой throw | Детальная обработка по статус-кодам |
| Логирование | console.log | Winston logger с usage-метриками |
| Кэширование промпта | Нет | `cache_control: { type: "ephemeral" }` |

---

## 3. Tool Definitions

**Файл:** `src/services/ai/toolDefinitions.js`

Определения инструментов для Claude API. Claude использует эти определения для
понимания, какие действия доступны. Каждый инструмент маппится на операцию
MCP-сервера или внутреннего сервиса.

```javascript
// src/services/ai/toolDefinitions.js

/**
 * Полный набор инструментов, доступных Claude.
 * Каждый инструмент -- это объект с name, description, input_schema (JSON Schema).
 *
 * Инструменты разделены на группы:
 * - Google Calendar (MCP) -- create, update, delete, list
 * - Gmail (MCP) -- send, search
 * - Google Docs (MCP) -- create document
 * - Notes (внутренний сервис) -- create, list, complete
 * - Tasks (внутренний сервис) -- create, update status
 */

// =============================================
//  GOOGLE CALENDAR (через MCP-сервер)
// =============================================

const calendarTools = [
  {
    name: 'create_calendar_event',
    description:
      'Создаёт новое событие в Google Calendar пользователя. ' +
      'Используй этот инструмент, когда пользователь просит создать встречу, мероприятие, напоминание с датой/временем. ' +
      'Всегда указывай title. Если пользователь не указал время, спроси у него.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Название события. Начинай с заглавной буквы.',
        },
        start_date: {
          type: 'string',
          description: 'Дата начала в формате YYYY-MM-DD.',
        },
        start_time: {
          type: 'string',
          description: 'Время начала в формате HH:MM (24-часовой). Если событие на весь день -- не указывай.',
        },
        end_date: {
          type: 'string',
          description: 'Дата окончания в формате YYYY-MM-DD. По умолчанию = start_date.',
        },
        end_time: {
          type: 'string',
          description: 'Время окончания в формате HH:MM. По умолчанию = start_time + 1 час.',
        },
        location: {
          type: 'string',
          description: 'Место проведения (адрес, офис, ссылка на Zoom и т.д.).',
        },
        description: {
          type: 'string',
          description: 'Описание события.',
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Список email-адресов участников.',
        },
        all_day: {
          type: 'boolean',
          description: 'Событие на весь день (true) или с конкретным временем (false). По умолчанию false.',
        },
        timezone: {
          type: 'string',
          description: 'Часовой пояс (IANA, например "Asia/Dubai"). Используй часовой пояс пользователя.',
        },
      },
      required: ['title', 'start_date'],
    },
  },

  {
    name: 'update_calendar_event',
    description:
      'Обновляет существующее событие в Google Calendar. ' +
      'Используй, когда пользователь хочет изменить время, название, место или другие детали существующего события. ' +
      'Нужен event_id -- получи его из list_calendar_events.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: {
          type: 'string',
          description: 'ID события в Google Calendar.',
        },
        title: { type: 'string', description: 'Новое название.' },
        start_date: { type: 'string', description: 'Новая дата начала (YYYY-MM-DD).' },
        start_time: { type: 'string', description: 'Новое время начала (HH:MM).' },
        end_date: { type: 'string', description: 'Новая дата окончания (YYYY-MM-DD).' },
        end_time: { type: 'string', description: 'Новое время окончания (HH:MM).' },
        location: { type: 'string', description: 'Новое место.' },
        description: { type: 'string', description: 'Новое описание.' },
      },
      required: ['event_id'],
    },
  },

  {
    name: 'delete_calendar_event',
    description:
      'Удаляет событие из Google Calendar. ' +
      'Используй, когда пользователь явно просит удалить/отменить конкретное событие.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: {
          type: 'string',
          description: 'ID события в Google Calendar.',
        },
      },
      required: ['event_id'],
    },
  },

  {
    name: 'list_calendar_events',
    description:
      'Получает список событий из Google Calendar за указанный период. ' +
      'Используй, когда пользователь спрашивает "что у меня сегодня?", "покажи мероприятия на завтра", ' +
      '"какие встречи на этой неделе?" и т.п.',
    input_schema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'Начало периода (YYYY-MM-DD). По умолчанию -- сегодня.',
        },
        end_date: {
          type: 'string',
          description: 'Конец периода (YYYY-MM-DD). По умолчанию -- тот же день, что start_date.',
        },
        timezone: {
          type: 'string',
          description: 'Часовой пояс (IANA). Используй часовой пояс пользователя.',
        },
      },
      required: ['start_date'],
    },
  },
];

// =============================================
//  GMAIL (через MCP-сервер)
// =============================================

const gmailTools = [
  {
    name: 'send_email',
    description:
      'Отправляет email через Gmail пользователя. ' +
      'Используй, когда пользователь просит отправить письмо, написать email, ' +
      'ответить на письмо. Всегда подтверждай содержание перед отправкой.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Email-адрес получателя.',
        },
        subject: {
          type: 'string',
          description: 'Тема письма.',
        },
        body: {
          type: 'string',
          description: 'Текст письма (plain text или HTML).',
        },
        cc: {
          type: 'array',
          items: { type: 'string' },
          description: 'Список email в копии.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },

  {
    name: 'search_email',
    description:
      'Ищет письма в Gmail пользователя. ' +
      'Используй, когда пользователь спрашивает "есть ли письмо от ...", ' +
      '"найди email про ...", "покажи непрочитанные письма".',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Поисковый запрос в формате Gmail (например "from:ivan@example.com subject:отчёт is:unread").',
        },
        max_results: {
          type: 'integer',
          description: 'Максимум результатов. По умолчанию 10.',
        },
      },
      required: ['query'],
    },
  },
];

// =============================================
//  GOOGLE DOCS (через MCP-сервер Google Drive)
// =============================================

const googleDocsTools = [
  {
    name: 'create_document',
    description:
      'Создаёт новый документ в Google Docs. ' +
      'Используй, когда пользователь просит "создай документ", "напиши отчёт", ' +
      '"подготовь протокол встречи".',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Название документа.',
        },
        content: {
          type: 'string',
          description: 'Содержимое документа (текст, можно с Markdown-форматированием).',
        },
        folder_id: {
          type: 'string',
          description: 'ID папки на Google Drive. По умолчанию -- корневая папка.',
        },
      },
      required: ['title', 'content'],
    },
  },
];

// =============================================
//  ЗАМЕТКИ (внутренний сервис, не MCP)
// =============================================

const noteTools = [
  {
    name: 'create_note',
    description:
      'Создаёт заметку для пользователя. ' +
      'Используй, когда пользователь говорит "запомни", "заметка", "запиши", "не забыть".',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Текст заметки.',
        },
        category: {
          type: 'string',
          enum: ['general', 'meeting', 'idea', 'personal', 'work'],
          description: 'Категория заметки. По умолчанию "general".',
        },
      },
      required: ['content'],
    },
  },

  {
    name: 'list_notes',
    description:
      'Показывает заметки пользователя. ' +
      'Используй, когда пользователь спрашивает "покажи заметки", "что я записывал", "мои заметки".',
    input_schema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          enum: ['pending', 'completed', 'all'],
          description: 'Фильтр: "pending" (невыполненные, по умолчанию), "completed", "all".',
        },
        category: {
          type: 'string',
          description: 'Фильтр по категории.',
        },
      },
      required: [],
    },
  },

  {
    name: 'complete_note',
    description:
      'Отмечает заметку как выполненную. ' +
      'Используй, когда пользователь говорит "выполнено", "готово", "отметь заметку".',
    input_schema: {
      type: 'object',
      properties: {
        note_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Массив ID заметок для отметки.',
        },
        content_search: {
          type: 'string',
          description: 'Поиск заметки по содержимому (если ID не известен).',
        },
      },
      required: [],
    },
  },
];

// =============================================
//  ЗАДАЧИ (внутренний сервис, не MCP)
// =============================================

const taskTools = [
  {
    name: 'create_task',
    description:
      'Создаёт задачу для пользователя. ' +
      'Используй, когда пользователь говорит "задача", "нужно сделать", "добавь в задачи", "поручи".',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Название задачи.',
        },
        description: {
          type: 'string',
          description: 'Описание задачи.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Приоритет. По умолчанию "medium".',
        },
        due_date: {
          type: 'string',
          description: 'Дедлайн в формате YYYY-MM-DD.',
        },
        assigned_to: {
          type: 'string',
          description: 'Имя сотрудника, на которого назначена задача.',
        },
      },
      required: ['title'],
    },
  },

  {
    name: 'update_task_status',
    description:
      'Обновляет статус задачи. ' +
      'Используй, когда пользователь говорит "задача выполнена", "отмени задачу", "начал работу над задачей".',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'integer',
          description: 'ID задачи.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'cancelled'],
          description: 'Новый статус задачи.',
        },
      },
      required: ['task_id', 'status'],
    },
  },
];

// =============================================
//  МАППИНГ И ЭКСПОРТ
// =============================================

/**
 * Маппинг инструментов по группам интеграций.
 * Ключ -- название интеграции (из OAuthToken.provider или внутреннее).
 * Значение -- массив tool definitions.
 */
const TOOL_GROUPS = {
  google_calendar: calendarTools,
  gmail: gmailTools,
  google_drive: googleDocsTools,
  notes: noteTools,      // всегда доступны
  tasks: taskTools,      // всегда доступны
};

/**
 * Возвращает массив tool definitions для Claude API.
 * Фильтрует по подключённым интеграциям пользователя.
 *
 * @param {Array<string>} connectedIntegrations - ['google_calendar', 'gmail', ...]
 * @returns {Array<Object>} - Массив tool definitions для Claude API
 */
export function getToolDefinitions(connectedIntegrations = []) {
  const tools = [];

  // Внутренние инструменты (заметки, задачи) -- доступны всегда
  tools.push(...noteTools);
  tools.push(...taskTools);

  // Внешние интеграции -- только если подключены
  for (const integration of connectedIntegrations) {
    if (TOOL_GROUPS[integration]) {
      tools.push(...TOOL_GROUPS[integration]);
    }
  }

  return tools;
}

/**
 * Маппинг tool name -> тип маршрутизации (MCP-сервер или внутренний сервис).
 * Используется в mcpRouter.js для определения, куда отправить tool_use.
 */
export const TOOL_ROUTING = {
  // MCP-серверы
  create_calendar_event: { type: 'mcp', server: 'google-calendar' },
  update_calendar_event: { type: 'mcp', server: 'google-calendar' },
  delete_calendar_event: { type: 'mcp', server: 'google-calendar' },
  list_calendar_events:  { type: 'mcp', server: 'google-calendar' },
  send_email:            { type: 'mcp', server: 'gmail' },
  search_email:          { type: 'mcp', server: 'gmail' },
  create_document:       { type: 'mcp', server: 'google-drive' },

  // Внутренние сервисы
  create_note:           { type: 'internal', service: 'notes' },
  list_notes:            { type: 'internal', service: 'notes' },
  complete_note:         { type: 'internal', service: 'notes' },
  create_task:           { type: 'internal', service: 'tasks' },
  update_task_status:    { type: 'internal', service: 'tasks' },
};
```

### Итого: 12 инструментов

| # | Инструмент | Тип | Маршрут |
|---|---|---|---|
| 1 | `create_calendar_event` | MCP | Google Calendar MCP Server |
| 2 | `update_calendar_event` | MCP | Google Calendar MCP Server |
| 3 | `delete_calendar_event` | MCP | Google Calendar MCP Server |
| 4 | `list_calendar_events` | MCP | Google Calendar MCP Server |
| 5 | `send_email` | MCP | Gmail MCP Server |
| 6 | `search_email` | MCP | Gmail MCP Server |
| 7 | `create_document` | MCP | Google Drive MCP Server |
| 8 | `create_note` | Internal | noteService |
| 9 | `list_notes` | Internal | noteService |
| 10 | `complete_note` | Internal | noteService |
| 11 | `create_task` | Internal | taskService |
| 12 | `update_task_status` | Internal | taskService |

---

## 4. System Prompt + Prompt Caching

**Файл:** `src/services/ai/promptBuilder.js`

Собирает системный промпт для Claude. Использует `cache_control` для кэширования
статической части промпта (экономия до 90% на повторных запросах).

```javascript
// src/services/ai/promptBuilder.js

import { logger } from '../../config/logger.js';

/**
 * Собирает системный промпт для Claude API с поддержкой prompt caching.
 *
 * Промпт разделён на две части:
 * 1. Статическая часть (persona + инструкции) -- кэшируется через cache_control
 * 2. Динамическая часть (текущая дата, контекст пользователя) -- НЕ кэшируется
 *
 * Claude API кэширует блоки с cache_control: { type: "ephemeral" } на 5 минут.
 * При повторных запросах того же пользователя статическая часть читается из кэша,
 * что снижает стоимость input_tokens на ~90%.
 *
 * @param {Object} params
 * @param {Object} params.user - Объект пользователя из БД
 * @param {Array}  params.connectedIntegrations - Подключённые интеграции
 * @param {string} params.currentDateTime - Текущая дата и время (ISO)
 * @returns {Array} - Массив system content blocks для Claude API
 */
export function buildSystemPrompt({ user, connectedIntegrations = [], currentDateTime }) {
  const userName = user.username || 'пользователь';
  const userTimezone = user.timezone || 'Asia/Dubai';
  const userTier = user.subscription_tier || 'free';
  const userLanguage = user.language || 'ru';

  // -----------------------------------------------
  //  СТАТИЧЕСКАЯ ЧАСТЬ (кэшируется)
  // -----------------------------------------------
  const staticPrompt = `Ты -- Secretary Bot, персональный AI-секретарь. Ты помогаешь управлять расписанием, задачами, заметками, почтой и документами.

## Твоя роль и поведение

- Ты профессиональный, но дружелюбный ассистент.
- Говори на русском языке (если пользователь не попросит иначе).
- Будь лаконичным: не растягивай ответы, но давай всю нужную информацию.
- Используй эмодзи умеренно -- только для структурирования информации.
- При создании событий всегда подтверждай детали: название, дату, время, место.
- Если информации недостаточно (например, не указано время встречи) -- уточни у пользователя.
- Названия событий начинай с заглавной буквы.

## Работа с инструментами

- Для работы с Google Calendar, Gmail и Google Docs -- используй соответствующие инструменты.
- Для заметок и задач -- используй внутренние инструменты (create_note, create_task и т.д.).
- Если пользователь просит что-то, что не требует инструментов -- просто ответь текстом.
- Если нужен event_id для обновления/удаления, но он неизвестен -- сначала вызови list_calendar_events.
- При работе с email: ВСЕГДА показывай пользователю текст письма перед отправкой и жди подтверждения.
- При создании документов: спроси, нужен ли определённый формат/шаблон.

## Форматирование ответов

- Для списка событий используй нумерованный список с временем и названием.
- Для дат используй формат "13 февраля 2026, четверг".
- Для времени используй 24-часовой формат: "10:00", "14:30".
- После создания/обновления/удаления -- подтверди действие кратко.

## Обработка ошибок

- Если инструмент вернул ошибку -- объясни пользователю простым языком, что пошло не так.
- Если Google-сервис недоступен -- сообщи: "Сервис Google временно недоступен, попробуйте через пару минут."
- Никогда не показывай технические детали ошибок (ID, stack trace, HTTP-коды).`;

  // -----------------------------------------------
  //  ДИНАМИЧЕСКАЯ ЧАСТЬ (НЕ кэшируется)
  // -----------------------------------------------
  const integrationsList = connectedIntegrations.length > 0
    ? connectedIntegrations.join(', ')
    : 'нет подключённых интеграций';

  const dynamicPrompt = `## Контекст текущего пользователя

- Имя: ${userName}
- Часовой пояс: ${userTimezone}
- Тарифный план: ${userTier}
- Язык: ${userLanguage}
- Подключённые интеграции: ${integrationsList}
- Текущая дата и время: ${formatDateTimeRussian(currentDateTime, userTimezone)}`;

  // -----------------------------------------------
  //  ФОРМАТ ДЛЯ CLAUDE API (с cache_control)
  // -----------------------------------------------
  return [
    {
      type: 'text',
      text: staticPrompt,
      cache_control: { type: 'ephemeral' },  // Кэшируется на 5 минут
    },
    {
      type: 'text',
      text: dynamicPrompt,
      // БЕЗ cache_control -- эта часть меняется каждый запрос
    },
  ];
}

/**
 * Форматирует дату и время на русском языке.
 * Пример: "12 февраля 2026, четверг, 15:30"
 */
function formatDateTimeRussian(isoString, timezone) {
  try {
    const date = new Date(isoString);
    const options = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    };
    return date.toLocaleString('ru-RU', options);
  } catch {
    return isoString;
  }
}
```

### Как работает prompt caching

```
Первый запрос пользователя:
  system: [static (2000 tokens) + dynamic (100 tokens)]
  → Claude кэширует static часть
  → usage.cache_creation_input_tokens = 2000
  → Стоимость: 2000 * $0.00375/1K = $0.0075 (создание кэша: x1.25)

Второй запрос того же пользователя (в течение 5 минут):
  system: [static (из кэша) + dynamic (100 tokens)]
  → Claude читает static из кэша
  → usage.cache_read_input_tokens = 2000
  → Стоимость: 2000 * $0.0003/1K = $0.0006 (чтение кэша: x0.1)

Экономия: 90% на статической части промпта при повторных запросах!
```

---

## 5. Model Router

**Файл:** `src/services/ai/modelRouter.js`

Определяет, какую модель Claude использовать для конкретного запроса.
Стратегия: **Haiku (70%)** для простых операций, **Sonnet (30%)** для сложных.

```javascript
// src/services/ai/modelRouter.js

import { logger } from '../../config/logger.js';

/**
 * ID моделей Claude.
 * Актуальные на февраль 2026 (обновлять при выходе новых версий).
 */
const MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-5-20250929',
};

/**
 * Стоимость моделей ($ за 1M tokens) для расчёта расходов.
 */
export const MODEL_PRICING = {
  [MODELS.HAIKU]: {
    input: 1.00,     // $1.00 / 1M input tokens
    output: 5.00,    // $5.00 / 1M output tokens
    cacheWrite: 1.25,  // $1.25 / 1M tokens (создание кэша)
    cacheRead: 0.10,   // $0.10 / 1M tokens (чтение кэша)
  },
  [MODELS.SONNET]: {
    input: 3.00,     // $3.00 / 1M input tokens
    output: 15.00,   // $15.00 / 1M output tokens
    cacheWrite: 3.75,  // $3.75 / 1M tokens
    cacheRead: 0.30,   // $0.30 / 1M tokens
  },
};

/**
 * Ключевые слова и паттерны, указывающие на необходимость Sonnet.
 * Sonnet используется для задач, требующих глубокого понимания и генерации.
 */
const SONNET_TRIGGERS = {
  // Сложное планирование
  scheduling: [
    'перенеси', 'перепланируй', 'найди свободное время',
    'оптимизируй расписание', 'конфликт', 'пересечение',
  ],
  // Генерация контента
  contentGeneration: [
    'напиши письмо', 'составь', 'подготовь документ',
    'отчёт', 'протокол', 'резюме встречи', 'план проекта',
  ],
  // Аналитика
  analysis: [
    'проанализируй', 'сравни', 'итоги недели',
    'статистика', 'что важного', 'приоритизируй',
  ],
  // Multi-step reasoning
  multiStep: [
    'а потом', 'после этого', 'и ещё', 'несколько задач',
    'комплексный', 'пошагово',
  ],
};

/**
 * Определяет модель для текущего запроса.
 *
 * Логика:
 * 1. Если сообщение длинное (>200 символов) -- Sonnet (сложный запрос)
 * 2. Если содержит триггеры Sonnet -- Sonnet
 * 3. Если история длинная (>15 сообщений) -- Sonnet (сложный контекст)
 * 4. Всё остальное -- Haiku
 *
 * @param {Object} params
 * @param {string} params.lastMessage - Текст последнего сообщения пользователя
 * @param {number} params.messageCount - Количество сообщений в истории
 * @param {Array}  params.connectedIntegrations - Подключённые интеграции
 * @returns {string} ID модели Claude
 */
export function selectModel({ lastMessage, messageCount, connectedIntegrations = [] }) {
  const message = lastMessage.toLowerCase();

  // Правило 1: Длинное сообщение -> Sonnet
  if (lastMessage.length > 200) {
    logger.debug('[ModelRouter] Sonnet: длинное сообщение', { length: lastMessage.length });
    return MODELS.SONNET;
  }

  // Правило 2: Триггерные слова -> Sonnet
  for (const [category, triggers] of Object.entries(SONNET_TRIGGERS)) {
    for (const trigger of triggers) {
      if (message.includes(trigger)) {
        logger.debug('[ModelRouter] Sonnet: триггер', { category, trigger });
        return MODELS.SONNET;
      }
    }
  }

  // Правило 3: Длинная история -> Sonnet (сложный контекст)
  if (messageCount > 15) {
    logger.debug('[ModelRouter] Sonnet: длинная история', { messageCount });
    return MODELS.SONNET;
  }

  // Правило 4: Всё остальное -> Haiku
  logger.debug('[ModelRouter] Haiku: простой запрос');
  return MODELS.HAIKU;
}

/**
 * Возвращает стоимость запроса в долларах.
 *
 * @param {string} model - ID модели
 * @param {Object} usage - { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }
 * @returns {number} Стоимость в USD
 */
export function calculateCost(model, usage) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    logger.warn('[ModelRouter] Неизвестная модель для расчёта стоимости', { model });
    return 0;
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  const cacheWriteCost = (usage.cacheCreationInputTokens / 1_000_000) * pricing.cacheWrite;
  const cacheReadCost = (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheRead;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export { MODELS };
```

### Ожидаемое распределение трафика

```
Тип запроса                     | Модель  | ~% трафика | Пример
---                             | ---     | ---        | ---
Простой чат                     | Haiku   | 25%        | "Привет", "Спасибо"
Создание заметки                | Haiku   | 15%        | "Запомни: купить молоко"
Показать события                | Haiku   | 15%        | "Что у меня сегодня?"
Создание простого события       | Haiku   | 10%        | "Встреча в 15:00"
Изменение статуса задачи        | Haiku   | 5%         | "Задача 5 выполнена"
---                             | ---     | ---        | ---
Итого Haiku                     |         | ~70%       |
---                             | ---     | ---        | ---
Сложное планирование            | Sonnet  | 8%         | "Перенеси встречу и найди свободное время"
Написание писем                 | Sonnet  | 7%         | "Напиши письмо клиенту про..."
Создание документов             | Sonnet  | 5%         | "Подготовь протокол встречи"
Аналитика / итоги               | Sonnet  | 5%         | "Итоги недели: что сделано?"
Multi-step запросы               | Sonnet  | 5%         | "Создай событие, задачу и напомни"
---                             | ---     | ---        | ---
Итого Sonnet                    |         | ~30%       |
```

---

## 6. Intent Parser

**Файл:** `src/services/ai/intentParser.js`

Парсит ответ Claude API. Claude может вернуть текст, tool_use или комбинацию.

```javascript
// src/services/ai/intentParser.js

import { logger } from '../../config/logger.js';

/**
 * Парсит ответ Claude API и извлекает текстовые блоки и вызовы инструментов.
 *
 * Claude API возвращает content как массив блоков:
 * - { type: 'text', text: '...' }           -- текстовый ответ
 * - { type: 'tool_use', id: '...', name: '...', input: {...} }  -- вызов инструмента
 *
 * Claude может вернуть НЕСКОЛЬКО tool_use в одном ответе (multi-tool).
 * Например: "Создай заметку и событие" -> два tool_use блока.
 *
 * @param {Object} response - Ответ от client.messages.create()
 * @returns {Object} { text: string|null, toolCalls: Array }
 */
export function parseResponse(response) {
  const result = {
    text: null,
    toolCalls: [],
  };

  if (!response.content || !Array.isArray(response.content)) {
    logger.warn('[IntentParser] Пустой или невалидный content в ответе Claude');
    return result;
  }

  for (const block of response.content) {
    switch (block.type) {
      case 'text':
        // Может быть несколько текстовых блоков -- склеиваем
        result.text = result.text
          ? `${result.text}\n${block.text}`
          : block.text;
        break;

      case 'tool_use':
        result.toolCalls.push({
          id: block.id,           // Уникальный ID вызова (нужен для tool_result)
          name: block.name,       // Имя инструмента (например, 'create_calendar_event')
          input: block.input,     // Параметры вызова (JSON-объект)
        });
        break;

      default:
        logger.warn('[IntentParser] Неизвестный тип блока', { type: block.type });
    }
  }

  logger.info('[IntentParser] Парсинг завершён', {
    hasText: !!result.text,
    toolCallCount: result.toolCalls.length,
    toolNames: result.toolCalls.map(tc => tc.name),
  });

  return result;
}

/**
 * Определяет, требуется ли продолжение диалога с Claude после получения tool_result.
 *
 * stop_reason === 'tool_use' означает, что Claude ждёт результат выполнения инструмента.
 * stop_reason === 'end_turn' означает, что Claude закончил ответ.
 *
 * @param {string} stopReason - response.stop_reason из Claude API
 * @returns {boolean}
 */
export function requiresToolExecution(stopReason) {
  return stopReason === 'tool_use';
}

/**
 * Формирует массив tool_result для отправки обратно в Claude.
 *
 * @param {Array} executedTools - [{ id, name, result, isError }]
 * @returns {Array} - Массив tool_result блоков
 */
export function buildToolResults(executedTools) {
  return executedTools.map(tool => ({
    tool_use_id: tool.id,
    content: formatToolResult(tool.name, tool.result, tool.isError),
    is_error: tool.isError || false,
  }));
}

/**
 * Форматирует результат выполнения инструмента в строку для Claude.
 * Claude получает этот текст и использует его для формирования ответа пользователю.
 */
function formatToolResult(toolName, result, isError) {
  if (isError) {
    return `Ошибка при выполнении ${toolName}: ${result}`;
  }

  // Для MCP-результатов -- возвращаем JSON как строку
  if (typeof result === 'object') {
    return JSON.stringify(result, null, 2);
  }

  return String(result);
}
```

### Пример потока данных

```
Пользователь: "Создай встречу с Иваном завтра в 10:00 и запиши заметку: обсудить бюджет"

Claude API Response:
{
  "content": [
    {
      "type": "text",
      "text": "Создаю встречу и заметку."
    },
    {
      "type": "tool_use",
      "id": "toolu_01ABC",
      "name": "create_calendar_event",
      "input": {
        "title": "Встреча с Иваном",
        "start_date": "2026-02-13",
        "start_time": "10:00",
        "end_time": "11:00",
        "timezone": "Asia/Dubai"
      }
    },
    {
      "type": "tool_use",
      "id": "toolu_02DEF",
      "name": "create_note",
      "input": {
        "content": "Обсудить бюджет (встреча с Иваном)",
        "category": "meeting"
      }
    }
  ],
  "stop_reason": "tool_use"
}

parseResponse() вернёт:
{
  text: "Создаю встречу и заметку.",
  toolCalls: [
    { id: "toolu_01ABC", name: "create_calendar_event", input: {...} },
    { id: "toolu_02DEF", name: "create_note", input: {...} }
  ]
}
```

---

## 7. MCP Manager

**Файл:** `src/services/mcp/mcpManager.js`

Управляет жизненным циклом MCP-серверов: запуск, подключение, перезапуск при сбое,
корректное завершение.

```javascript
// src/services/mcp/mcpManager.js

import { MCPClient } from '@anthropic-ai/mcp-client';
import { getMCPServerConfigs } from './mcpConfig.js';
import { logger } from '../../config/logger.js';

/**
 * MCPManager -- синглтон, управляющий всеми MCP-серверами.
 *
 * Ответственности:
 * - Запуск MCP-серверов при старте приложения
 * - Поддержание пула подключений
 * - Перезапуск серверов при сбоях
 * - Graceful shutdown при остановке приложения
 */
class MCPManager {
  constructor() {
    /** @type {Map<string, MCPClient>} Пул активных MCP-клиентов */
    this.clients = new Map();

    /** @type {Map<string, Object>} Конфигурации серверов */
    this.configs = new Map();

    /** @type {Map<string, number>} Счётчик перезапусков */
    this.restartCounts = new Map();

    /** @type {number} Максимум перезапусков до отключения сервера */
    this.maxRestarts = 5;

    /** @type {boolean} Флаг инициализации */
    this.initialized = false;
  }

  /**
   * Инициализирует и запускает все MCP-серверы.
   * Вызывается один раз при старте приложения (из server.js).
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('[MCPManager] Уже инициализирован');
      return;
    }

    const serverConfigs = getMCPServerConfigs();

    for (const [serverName, config] of Object.entries(serverConfigs)) {
      this.configs.set(serverName, config);
      this.restartCounts.set(serverName, 0);

      try {
        await this.startServer(serverName, config);
        logger.info(`[MCPManager] Сервер "${serverName}" запущен`);
      } catch (error) {
        logger.error(`[MCPManager] Не удалось запустить сервер "${serverName}"`, {
          error: error.message,
        });
        // Продолжаем запуск остальных серверов -- graceful degradation
      }
    }

    this.initialized = true;
    logger.info('[MCPManager] Инициализация завершена', {
      totalServers: serverConfigs ? Object.keys(serverConfigs).length : 0,
      activeServers: this.clients.size,
    });
  }

  /**
   * Запускает один MCP-сервер и подключается к нему.
   *
   * @param {string} serverName - Имя сервера ('google-calendar', 'gmail', 'google-drive')
   * @param {Object} config - Конфигурация сервера из mcpConfig.js
   */
  async startServer(serverName, config) {
    const client = new MCPClient({
      name: `secretary-${serverName}`,
      version: '1.0.0',
    });

    // Подключаемся к MCP-серверу (stdio transport)
    await client.connect({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    // Обработка отключения сервера
    client.on('disconnect', async () => {
      logger.warn(`[MCPManager] Сервер "${serverName}" отключился`);
      this.clients.delete(serverName);
      await this.handleServerCrash(serverName);
    });

    this.clients.set(serverName, client);
  }

  /**
   * Обработка падения MCP-сервера. Пытается перезапустить.
   */
  async handleServerCrash(serverName) {
    const restartCount = this.restartCounts.get(serverName) || 0;

    if (restartCount >= this.maxRestarts) {
      logger.error(`[MCPManager] Сервер "${serverName}" превысил лимит перезапусков (${this.maxRestarts}). Отключён.`);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, restartCount), 30000); // exponential backoff, max 30s
    logger.info(`[MCPManager] Перезапуск "${serverName}" через ${delay}ms (попытка ${restartCount + 1})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    const config = this.configs.get(serverName);
    if (!config) return;

    try {
      await this.startServer(serverName, config);
      this.restartCounts.set(serverName, restartCount + 1);
      logger.info(`[MCPManager] Сервер "${serverName}" перезапущен (попытка ${restartCount + 1})`);
    } catch (error) {
      this.restartCounts.set(serverName, restartCount + 1);
      logger.error(`[MCPManager] Не удалось перезапустить "${serverName}"`, {
        error: error.message,
        attempt: restartCount + 1,
      });
      await this.handleServerCrash(serverName); // рекурсивный retry
    }
  }

  /**
   * Получает MCP-клиент по имени сервера.
   *
   * @param {string} serverName - 'google-calendar' | 'gmail' | 'google-drive'
   * @returns {MCPClient|null}
   */
  getClient(serverName) {
    return this.clients.get(serverName) || null;
  }

  /**
   * Проверяет, доступен ли MCP-сервер.
   *
   * @param {string} serverName
   * @returns {boolean}
   */
  isServerAvailable(serverName) {
    return this.clients.has(serverName);
  }

  /**
   * Возвращает статус всех MCP-серверов (для health check).
   *
   * @returns {Object}
   */
  getStatus() {
    const status = {};
    for (const [name] of this.configs) {
      status[name] = {
        active: this.clients.has(name),
        restarts: this.restartCounts.get(name) || 0,
      };
    }
    return status;
  }

  /**
   * Корректно останавливает все MCP-серверы.
   * Вызывается при graceful shutdown (SIGTERM/SIGINT).
   */
  async shutdown() {
    logger.info('[MCPManager] Остановка всех MCP-серверов...');

    const shutdownPromises = [];

    for (const [name, client] of this.clients) {
      shutdownPromises.push(
        client.disconnect()
          .then(() => logger.info(`[MCPManager] Сервер "${name}" остановлен`))
          .catch(err => logger.error(`[MCPManager] Ошибка остановки "${name}": ${err.message}`))
      );
    }

    await Promise.allSettled(shutdownPromises);
    this.clients.clear();
    this.initialized = false;

    logger.info('[MCPManager] Все MCP-серверы остановлены');
  }
}

// Экспортируем синглтон
export const mcpManager = new MCPManager();
```

---

## 8. MCP Router

**Файл:** `src/services/mcp/mcpRouter.js`

Маршрутизирует `tool_use` вызовы от Claude к соответствующим MCP-серверам или
внутренним сервисам. Возвращает результат в формате `tool_result`.

```javascript
// src/services/mcp/mcpRouter.js

import { mcpManager } from './mcpManager.js';
import { TOOL_ROUTING } from '../ai/toolDefinitions.js';
import { executeInternalTool } from './internalToolExecutor.js';
import { logger } from '../../config/logger.js';

/**
 * Выполняет один или несколько tool_use вызовов от Claude.
 *
 * Поток:
 * 1. Получает массив toolCalls из intentParser
 * 2. Для каждого tool_use определяет маршрут (MCP или internal)
 * 3. Выполняет вызов
 * 4. Возвращает массив результатов для отправки обратно в Claude
 *
 * @param {Array} toolCalls - [{ id, name, input }] из intentParser
 * @param {Object} user - Объект пользователя (для internal tools)
 * @returns {Array} - [{ id, name, result, isError }]
 */
export async function executeToolCalls(toolCalls, user) {
  const results = [];

  // Выполняем все tool calls параллельно (если их несколько)
  const promises = toolCalls.map(async (toolCall) => {
    const { id, name, input } = toolCall;
    const routing = TOOL_ROUTING[name];

    if (!routing) {
      logger.error(`[MCPRouter] Неизвестный инструмент: "${name}"`);
      return {
        id,
        name,
        result: `Инструмент "${name}" не найден.`,
        isError: true,
      };
    }

    try {
      let result;

      if (routing.type === 'mcp') {
        // ============================================
        //  Маршрутизация к MCP-серверу
        // ============================================
        result = await executeMCPTool(routing.server, name, input, user);
      } else if (routing.type === 'internal') {
        // ============================================
        //  Внутренний сервис (заметки, задачи)
        // ============================================
        result = await executeInternalTool(routing.service, name, input, user);
      }

      logger.info(`[MCPRouter] Инструмент "${name}" выполнен`, {
        toolId: id,
        server: routing.server || routing.service,
        userId: user.id,
      });

      return { id, name, result, isError: false };
    } catch (error) {
      logger.error(`[MCPRouter] Ошибка при выполнении "${name}"`, {
        toolId: id,
        error: error.message,
        userId: user.id,
      });

      return {
        id,
        name,
        result: getUserFriendlyError(name, error),
        isError: true,
      };
    }
  });

  const settled = await Promise.allSettled(promises);

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      // Promise.allSettled никогда не rejected для отдельных промисов,
      // но на всякий случай:
      results.push({
        id: 'unknown',
        name: 'unknown',
        result: 'Внутренняя ошибка при выполнении инструмента.',
        isError: true,
      });
    }
  }

  return results;
}

/**
 * Выполняет вызов к MCP-серверу.
 *
 * @param {string} serverName - 'google-calendar' | 'gmail' | 'google-drive'
 * @param {string} toolName - Имя инструмента
 * @param {Object} input - Параметры вызова
 * @param {Object} user - Объект пользователя
 * @returns {Object} Результат от MCP-сервера
 */
async function executeMCPTool(serverName, toolName, input, user) {
  const client = mcpManager.getClient(serverName);

  if (!client) {
    throw new Error(`MCP-сервер "${serverName}" недоступен.`);
  }

  // Вызываем tool через MCP-клиент
  // MCP-сервер сам обращается к Google API с OAuth credentials пользователя
  const response = await client.callTool({
    name: toolName,
    arguments: input,
  });

  return response;
}

/**
 * Генерирует user-friendly сообщение об ошибке.
 * Claude получит это сообщение и перескажет пользователю понятным языком.
 */
function getUserFriendlyError(toolName, error) {
  const errorMap = {
    'MCP-сервер': 'Сервис Google временно недоступен. Попробуйте через пару минут.',
    'ECONNREFUSED': 'Не удалось подключиться к внешнему сервису.',
    'UNAUTHORIZED': 'Необходимо переподключить Google аккаунт (срок авторизации истёк).',
    'QUOTA_EXCEEDED': 'Превышен лимит запросов к Google API. Попробуйте через минуту.',
    'NOT_FOUND': 'Событие не найдено. Возможно, оно было удалено.',
  };

  for (const [key, message] of Object.entries(errorMap)) {
    if (error.message.includes(key)) {
      return message;
    }
  }

  return `Ошибка при выполнении операции (${toolName}). Попробуйте ещё раз.`;
}
```

### Internal Tool Executor (вспомогательный файл)

**Файл:** `src/services/mcp/internalToolExecutor.js`

```javascript
// src/services/mcp/internalToolExecutor.js

import { createNote, getPendingNotes, markNotesCompleted } from '../core/noteService.js';
import { createTask, updateTaskStatus } from '../core/taskService.js';
import models from '../../models/index.js';
import { Op } from 'sequelize';
import { logger } from '../../config/logger.js';

/**
 * Выполняет вызов внутреннего инструмента (заметки, задачи).
 * Эти инструменты не требуют MCP -- работают напрямую с БД.
 *
 * @param {string} service - 'notes' | 'tasks'
 * @param {string} toolName - Имя инструмента
 * @param {Object} input - Параметры вызова
 * @param {Object} user - Объект пользователя
 * @returns {Object} Результат выполнения
 */
export async function executeInternalTool(service, toolName, input, user) {
  switch (toolName) {
    // ---- ЗАМЕТКИ ----
    case 'create_note': {
      const note = await createNote({
        content: input.content,
        category: input.category || 'general',
        user_id: user.id,
      });
      return {
        success: true,
        note_id: note.id,
        message: `Заметка создана (ID: ${note.id})`,
      };
    }

    case 'list_notes': {
      const filter = input.filter || 'pending';
      const where = { user_id: user.id };

      if (filter === 'pending') where.completed = false;
      else if (filter === 'completed') where.completed = true;
      if (input.category) where.category = input.category;

      const notes = await models.Note.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: 50,
      });

      return {
        success: true,
        count: notes.length,
        notes: notes.map(n => ({
          id: n.id,
          content: n.content,
          category: n.category,
          completed: n.completed,
          created_at: n.created_at,
        })),
      };
    }

    case 'complete_note': {
      let noteIds = input.note_ids || [];

      // Если указан поиск по содержимому
      if (noteIds.length === 0 && input.content_search) {
        const found = await models.Note.findAll({
          where: {
            user_id: user.id,
            content: { [Op.iLike]: `%${input.content_search}%` },
            completed: false,
          },
        });
        noteIds = found.map(n => n.id);
      }

      if (noteIds.length === 0) {
        return { success: false, message: 'Заметки не найдены.' };
      }

      await markNotesCompleted(noteIds);
      return {
        success: true,
        completed_ids: noteIds,
        message: `Отмечено как выполненные: ${noteIds.length} заметок.`,
      };
    }

    // ---- ЗАДАЧИ ----
    case 'create_task': {
      const task = await createTask({
        title: input.title,
        description: input.description,
        priority: input.priority || 'medium',
        due_date: input.due_date,
        created_by: user.id,
      });
      return {
        success: true,
        task_id: task.id,
        message: `Задача создана (ID: ${task.id})`,
      };
    }

    case 'update_task_status': {
      const task = await updateTaskStatus(input.task_id, input.status, user.id);
      return {
        success: true,
        task_id: task.id,
        new_status: task.status,
        message: `Статус задачи обновлён на "${input.status}".`,
      };
    }

    default:
      throw new Error(`Неизвестный внутренний инструмент: ${toolName}`);
  }
}
```

---

## 9. MCP Config

**Файл:** `src/services/mcp/mcpConfig.js`

Конфигурация MCP-серверов. Определяет, как запускать каждый сервер и с какими
учётными данными.

```javascript
// src/services/mcp/mcpConfig.js

import { config } from '../../config/index.js';

/**
 * Конфигурация MCP-серверов для Google-сервисов.
 *
 * Каждый MCP-сервер запускается как дочерний процесс (stdio transport).
 * Он получает OAuth credentials через переменные окружения.
 *
 * В single-user режиме (текущий MVP): credentials берутся из .env
 * В multi-user режиме (будущее): credentials берутся из OAuthToken модели
 * для конкретного пользователя и передаются серверу при подключении.
 *
 * @returns {Object} - { 'server-name': { command, args, env } }
 */
export function getMCPServerConfigs() {
  return {
    // =============================================
    //  Google Calendar MCP Server
    // =============================================
    'google-calendar': {
      command: 'npx',
      args: ['@anthropic-ai/mcp-server-google-calendar'],
      env: {
        ...process.env,
        GOOGLE_CLIENT_ID: config.google.clientId,
        GOOGLE_CLIENT_SECRET: config.google.clientSecret,
        GOOGLE_REFRESH_TOKEN: config.google.refreshToken,
      },
      // Описание для логов
      description: 'Google Calendar: создание, обновление, удаление, просмотр событий',
    },

    // =============================================
    //  Gmail MCP Server
    // =============================================
    'gmail': {
      command: 'npx',
      args: ['@anthropic-ai/mcp-server-gmail'],
      env: {
        ...process.env,
        GOOGLE_CLIENT_ID: config.google.clientId,
        GOOGLE_CLIENT_SECRET: config.google.clientSecret,
        GOOGLE_REFRESH_TOKEN: config.google.refreshToken,
      },
      description: 'Gmail: отправка и поиск писем',
    },

    // =============================================
    //  Google Drive / Docs MCP Server
    // =============================================
    'google-drive': {
      command: 'npx',
      args: ['@anthropic-ai/mcp-server-google-drive'],
      env: {
        ...process.env,
        GOOGLE_CLIENT_ID: config.google.clientId,
        GOOGLE_CLIENT_SECRET: config.google.clientSecret,
        GOOGLE_REFRESH_TOKEN: config.google.refreshToken,
      },
      description: 'Google Drive/Docs: создание и управление документами',
    },
  };
}

/**
 * Получает конфигурацию MCP-сервера для конкретного пользователя.
 * Используется в multi-user режиме, когда у каждого пользователя свои Google-credentials.
 *
 * @param {string} serverName - Имя MCP-сервера
 * @param {Object} oauthToken - Объект OAuthToken из БД (расшифрованный)
 * @returns {Object} - Конфигурация сервера с credentials пользователя
 */
export function getUserMCPConfig(serverName, oauthToken) {
  const baseConfigs = getMCPServerConfigs();
  const baseConfig = baseConfigs[serverName];

  if (!baseConfig) {
    throw new Error(`Неизвестный MCP-сервер: ${serverName}`);
  }

  // Подменяем Google credentials на данные пользователя
  return {
    ...baseConfig,
    env: {
      ...baseConfig.env,
      GOOGLE_CLIENT_ID: config.google.clientId,         // Client ID общий для приложения
      GOOGLE_CLIENT_SECRET: config.google.clientSecret,   // Client Secret общий для приложения
      GOOGLE_REFRESH_TOKEN: oauthToken.refresh_token,     // Refresh Token -- уникальный для пользователя
    },
  };
}
```

### Архитектурная схема MCP

```
┌─────────────────────────────────────────────────────────┐
│                     Бэкенд Secretary Bot                │
│                                                         │
│  ┌──────────────┐     ┌──────────────┐                  │
│  │ Claude API   │────>│ mcpRouter.js │                  │
│  │              │     │              │                  │
│  │ tool_use:    │     │ Маппинг:     │                  │
│  │ create_      │     │ tool_use ->  │                  │
│  │ calendar_    │     │ MCP-сервер   │                  │
│  │ event        │     └──────┬───────┘                  │
│  └──────────────┘            │                          │
│                              │                          │
│  ┌───────────────────────────▼──────────────────────┐   │
│  │                  mcpManager.js                    │   │
│  │                                                   │   │
│  │  ┌──────────────┐ ┌─────────┐ ┌──────────────┐   │   │
│  │  │ MCPClient    │ │MCPClient│ │ MCPClient    │   │   │
│  │  │ (calendar)   │ │(gmail)  │ │ (drive)      │   │   │
│  │  └──────┬───────┘ └────┬────┘ └──────┬───────┘   │   │
│  └─────────┼──────────────┼─────────────┼───────────┘   │
│            │              │             │                │
└────────────┼──────────────┼─────────────┼────────────────┘
             │ stdio        │ stdio       │ stdio
             ▼              ▼             ▼
┌────────────────┐ ┌────────────┐ ┌────────────────┐
│ MCP Server:    │ │ MCP Server:│ │ MCP Server:    │
│ Google Calendar│ │ Gmail      │ │ Google Drive   │
│                │ │            │ │                │
│  Использует    │ │ Использует │ │ Использует     │
│  Google APIs   │ │ Google APIs│ │ Google APIs    │
│  с OAuth       │ │ с OAuth   │ │ с OAuth        │
│  credentials   │ │ credentials│ │ credentials    │
└────────┬───────┘ └─────┬──────┘ └────────┬───────┘
         │               │                 │
         ▼               ▼                 ▼
   ┌──────────────────────────────────────────┐
   │           Google Cloud APIs              │
   │  Calendar API v3 │ Gmail API │ Drive API │
   └──────────────────────────────────────────┘

КЛЮЧЕВОЙ МОМЕНТ: Бэкенд НЕ вызывает Google API напрямую.
Бэкенд только маршрутизирует tool_use к MCP-серверам.
MCP-серверы выполняют фактическое взаимодействие с Google.
```

---

## 10. Message Processor обновление

**Файл:** `src/services/core/messageProcessor.js`

Главный pipeline обработки сообщений. Обновляется для использования Claude API
вместо ChatGPT и MCP вместо прямых Google API вызовов.

```javascript
// src/services/core/messageProcessor.js

import { sendMessage, sendToolResults } from '../ai/claudeHandler.js';
import { requiresToolExecution, buildToolResults } from '../ai/intentParser.js';
import { executeToolCalls } from '../mcp/mcpRouter.js';
import { calculateCost } from '../ai/modelRouter.js';
import { sessionManager } from './sessionManager.js';
import models from '../../models/index.js';
import { logger } from '../../config/logger.js';

/**
 * Максимальное количество циклов tool_use -> tool_result.
 * Защита от бесконечного цикла, если Claude продолжает вызывать инструменты.
 */
const MAX_TOOL_LOOPS = 5;

/**
 * Обрабатывает входящее сообщение от любой платформы.
 *
 * Это ЕДИНАЯ точка входа для всех платформ (Telegram, REST API, WebSocket).
 * Каждая платформа конвертирует своё сообщение в UnifiedMessage и передаёт сюда.
 *
 * @param {Object} unifiedMessage
 * @param {number} unifiedMessage.userId      - ID пользователя в БД
 * @param {string} unifiedMessage.text        - Текст сообщения
 * @param {string} unifiedMessage.type        - 'text' | 'voice' | 'photo'
 * @param {string} unifiedMessage.platform    - 'telegram' | 'api' | 'web'
 * @param {Object} unifiedMessage.metadata    - Доп. данные (chat_id, device info...)
 * @returns {Object} { text, actions, usage }
 */
export async function processMessage(unifiedMessage) {
  const { userId, text, type, platform, metadata } = unifiedMessage;

  // 1. Получить пользователя из БД
  const user = await models.User.findByPk(userId);
  if (!user) {
    throw new Error(`Пользователь ${userId} не найден`);
  }

  // 2. Получить или создать сессию
  const session = await sessionManager.getOrCreateSession(userId, platform, metadata);

  // 3. Проверить лимиты (TODO: интеграция с billingService)
  // await billingService.checkLimits(user);

  // 4. Сохранить входящее сообщение
  await models.Message.create({
    session_id: session.id,
    sender: 'user',
    message_text: text,
    message_type: type,
    created_at: new Date(),
  });

  // 5. Загрузить историю из БД (последние 20 сообщений)
  const history = await sessionManager.getHistory(session.id, 20);

  // 6. Определить подключённые интеграции пользователя
  const connectedIntegrations = await getConnectedIntegrations(userId);

  // 7. Отправить в Claude API
  let response = await sendMessage({
    messages: history,
    user,
    connectedIntegrations,
  });

  // 8. Цикл tool_use -> execute -> tool_result -> Claude
  let totalUsage = { ...response.usage };
  let loopCount = 0;

  // Собираем историю для tool_result (включая ответ Claude с tool_use)
  let conversationMessages = [
    ...history,
    { role: 'assistant', content: response.rawContent },
  ];

  while (requiresToolExecution(response.stopReason) && loopCount < MAX_TOOL_LOOPS) {
    loopCount++;

    logger.info('[MessageProcessor] Выполнение tool_use', {
      loop: loopCount,
      toolCount: response.toolCalls.length,
      tools: response.toolCalls.map(tc => tc.name),
      userId,
    });

    // 8a. Выполнить tool calls (MCP или internal)
    const executedTools = await executeToolCalls(response.toolCalls, user);

    // 8b. Сформировать tool_result для Claude
    const toolResults = buildToolResults(executedTools);

    // 8c. Отправить результаты обратно в Claude
    response = await sendToolResults({
      messages: conversationMessages,
      toolResults,
      user,
      model: response.model,
      connectedIntegrations,
    });

    // Обновляем историю для следующей итерации (если будет)
    // tool_result + новый ответ Claude
    conversationMessages = [
      ...conversationMessages,
      {
        role: 'user',
        content: toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.tool_use_id,
          content: tr.content,
          is_error: tr.is_error,
        })),
      },
      { role: 'assistant', content: response.rawContent },
    ];

    // Суммируем usage
    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;
    totalUsage.cacheCreationInputTokens += response.usage.cacheCreationInputTokens;
    totalUsage.cacheReadInputTokens += response.usage.cacheReadInputTokens;
  }

  if (loopCount >= MAX_TOOL_LOOPS) {
    logger.warn('[MessageProcessor] Достигнут лимит tool loops', { userId, loopCount });
  }

  // 9. Сохранить ответ бота в БД
  await models.Message.create({
    session_id: session.id,
    sender: 'bot',
    message_text: response.text,
    message_type: 'text',
    tool_calls: response.toolCalls.length > 0 ? response.toolCalls : null,
    token_count: totalUsage.inputTokens + totalUsage.outputTokens,
    model_used: response.model,
    created_at: new Date(),
  });

  // 10. Списать кредиты
  const cost = calculateCost(response.model, totalUsage);
  await recordCreditTransaction(user, response.model, totalUsage, cost);

  // 11. Вернуть результат платформе
  return {
    text: response.text || 'Извините, не удалось сформировать ответ.',
    usage: totalUsage,
    model: response.model,
    cost,
  };
}

/**
 * Получает список подключённых интеграций пользователя из OAuthToken.
 */
async function getConnectedIntegrations(userId) {
  const tokens = await models.OAuthToken.findAll({
    where: { user_id: userId },
    attributes: ['provider'],
  });

  const integrations = [];
  for (const token of tokens) {
    if (token.provider === 'google') {
      // Google OAuth даёт доступ к Calendar, Gmail и Drive
      integrations.push('google_calendar', 'gmail', 'google_drive');
    }
  }

  return integrations;
}

/**
 * Записывает транзакцию кредитов в CreditTransaction.
 */
async function recordCreditTransaction(user, model, usage, cost) {
  try {
    // Конвертируем стоимость в кредиты (1 кредит = $0.001)
    const creditsUsed = Math.ceil(cost * 1000);

    await models.CreditTransaction.create({
      user_id: user.id,
      type: 'usage',
      amount: -creditsUsed,
      balance_after: 0, // TODO: рассчитать реальный баланс
      description: `AI запрос (${model})`,
      model_used: model,
      tokens_input: usage.inputTokens,
      tokens_output: usage.outputTokens,
      created_at: new Date(),
    });
  } catch (error) {
    // Не блокируем основной flow из-за ошибки биллинга
    logger.error('[MessageProcessor] Ошибка записи CreditTransaction', {
      error: error.message,
      userId: user.id,
    });
  }
}
```

### Полный цикл обработки (диаграмма)

```
Пользователь: "Создай встречу с Иваном завтра в 10:00"
    │
    ▼
[Platform Layer]  Telegram / REST / WebSocket
    │
    ▼ UnifiedMessage { userId, text, type, platform }
    │
[processMessage()]
    │
    ├── 1. User.findByPk(userId)
    ├── 2. sessionManager.getOrCreateSession()
    ├── 3. checkLimits()
    ├── 4. Message.create({ sender: 'user' })
    ├── 5. sessionManager.getHistory(20)
    ├── 6. getConnectedIntegrations()
    │
    ├── 7. sendMessage() ──────────────> Claude API
    │                                      │
    │      <── response ───────────────────┘
    │      stop_reason: 'tool_use'
    │      toolCalls: [{ name: 'create_calendar_event', input: {...} }]
    │
    ├── 8a. executeToolCalls() ────────> mcpRouter.js
    │                                      │
    │                                      ├── TOOL_ROUTING['create_calendar_event']
    │                                      │   → type: 'mcp', server: 'google-calendar'
    │                                      │
    │                                      ├── mcpManager.getClient('google-calendar')
    │                                      │
    │                                      ├── client.callTool({ name, arguments })
    │                                      │         │
    │                                      │         ▼
    │                                      │   MCP Server: Google Calendar
    │                                      │         │
    │                                      │         ▼
    │                                      │   Google Calendar API v3
    │                                      │   (events.insert)
    │                                      │         │
    │      <── executedTools ──────────────┘         │
    │      [{ id, name, result: { eventId, link } }]│
    │                                                │
    ├── 8b. buildToolResults()
    │
    ├── 8c. sendToolResults() ─────────> Claude API
    │                                      │
    │      <── finalResponse ──────────────┘
    │      text: "Встреча с Иваном создана на 13 февраля в 10:00."
    │      stop_reason: 'end_turn'
    │
    ├── 9.  Message.create({ sender: 'bot' })
    ├── 10. recordCreditTransaction()
    │
    ▼
return { text: "Встреча с Иваном создана на 13 февраля в 10:00." }
    │
    ▼
[Platform Layer]  bot.sendMessage() / res.json() / ws.send()
```

---

## 11. Удаление legacy кода

### Файлы для удаления

| Файл | Причина удаления | Заменён на |
|---|---|---|
| `services/chatgptHandler.js` | OpenAI GPT-4-0613, raw fetch, JSON-based intents | `src/services/ai/claudeHandler.js` |
| `services/googleCalendarService.js` | Прямые вызовы Google Calendar API, БАГ с access_token | MCP-серверы (Google Calendar MCP) |

### Файлы для обновления

| Файл | Изменения |
|---|---|
| `services/telegramBot.js` | Удалить import `chatgptHandler`, `googleCalendarService`. Заменить `handleGPTResponse()` на вызов `processMessage()`. Удалить `chatHistories` (заменён на DB-backed сессии). Удалить switch по `parsed.type` (Claude + MCP делают это автоматически). |
| `services/morningDigest.js` | Использовать `list_calendar_events` через MCP (или напрямую из локальной БД). Импортировать бот из общего модуля (не создавать второй экземпляр). |
| `index.js` | Добавить `mcpManager.initialize()` при старте. Добавить `mcpManager.shutdown()` в graceful shutdown. |
| `models/message.js` | Поле `function_call` (JSONB) переименовать в `tool_calls`. Добавить поля `token_count` (INTEGER) и `model_used` (STRING). |
| `package.json` | Удалить `googleapis` из dependencies. Добавить `@anthropic-ai/sdk`, MCP пакеты. |
| `.env` | Удалить `OPENAI_API_KEY`, `GOOGLE_ACCESS_TOKEN`. Добавить `ANTHROPIC_API_KEY`. Переименовать `GCAL_*` в `GOOGLE_*`. |

### Порядок удаления

```
Шаг 1: Убедиться, что ВСЕ новые файлы созданы и работают
Шаг 2: Обновить telegramBot.js (переключить на processMessage)
Шаг 3: Запустить бот и протестировать базовый flow
Шаг 4: Удалить chatgptHandler.js
Шаг 5: Удалить googleCalendarService.js
Шаг 6: Удалить OPENAI_API_KEY из .env
Шаг 7: npm uninstall googleapis
Шаг 8: Проверить, что нет broken imports (grep -r "chatgptHandler\|googleCalendarService")
```

### Сохраняемые сервисы (БЕЗ изменений)

| Файл | Причина сохранения |
|---|---|
| `services/yandexSpeechService.js` | STT (Speech-to-Text) не имеет MCP-сервера. Yandex SpeechKit вызывается напрямую. |
| `services/noteService.js` | Внутренний сервис для заметок. Используется из `internalToolExecutor.js`. |

---

## 12. Тестирование миграции

### 12.1. Тест Claude API (базовый)

```javascript
// tests/manual/test-claude-basic.js

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function testBasicChat() {
  console.log('=== Тест 1: Базовый чат ===');
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Привет! Как дела?' }],
  });
  console.log('Ответ:', response.content[0].text);
  console.log('Токены:', response.usage);
  console.log('');
}

async function testToolUse() {
  console.log('=== Тест 2: Tool Use ===');
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Создай встречу с Иваном завтра в 10:00' }],
    tools: [{
      name: 'create_calendar_event',
      description: 'Создаёт событие в календаре.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start_date: { type: 'string' },
          start_time: { type: 'string' },
        },
        required: ['title', 'start_date'],
      },
    }],
  });

  console.log('Stop reason:', response.stop_reason);
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      console.log('Tool:', block.name, 'Input:', JSON.stringify(block.input));
    } else if (block.type === 'text') {
      console.log('Text:', block.text);
    }
  }
  console.log('Токены:', response.usage);
  console.log('');
}

async function testPromptCaching() {
  console.log('=== Тест 3: Prompt Caching ===');

  const systemPrompt = [
    {
      type: 'text',
      text: 'Ты -- Secretary Bot, персональный AI-секретарь. '.repeat(100), // длинный промпт
      cache_control: { type: 'ephemeral' },
    },
  ];

  // Первый запрос -- создание кэша
  const r1 = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Тест 1' }],
  });
  console.log('Запрос 1 - cache_creation_input_tokens:', r1.usage.cache_creation_input_tokens || 0);
  console.log('Запрос 1 - cache_read_input_tokens:', r1.usage.cache_read_input_tokens || 0);

  // Второй запрос -- чтение из кэша
  const r2 = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: systemPrompt,
    messages: [{ role: 'user', content: 'Тест 2' }],
  });
  console.log('Запрос 2 - cache_creation_input_tokens:', r2.usage.cache_creation_input_tokens || 0);
  console.log('Запрос 2 - cache_read_input_tokens:', r2.usage.cache_read_input_tokens || 0);

  if ((r2.usage.cache_read_input_tokens || 0) > 0) {
    console.log('Prompt caching РАБОТАЕТ!');
  } else {
    console.log('Prompt caching НЕ сработал (промпт мог быть слишком коротким для кэширования).');
  }
}

(async () => {
  try {
    await testBasicChat();
    await testToolUse();
    await testPromptCaching();
    console.log('Все тесты пройдены.');
  } catch (error) {
    console.error('ОШИБКА:', error.message);
    if (error.status === 401) {
      console.error('Проверьте ANTHROPIC_API_KEY в .env');
    }
  }
})();
```

### 12.2. Тест MCP серверов

```bash
# Проверка, что MCP-сервер Google Calendar запускается
npx @anthropic-ai/mcp-server-google-calendar --help

# Если MCP-сервер требует OAuth -- проверить, что credentials валидны
# (refresh_token должен работать)
```

### 12.3. Тест Model Router

```javascript
// tests/unit/modelRouter.test.js

import { selectModel } from '../../src/services/ai/modelRouter.js';

// Простой чат -> Haiku
console.assert(
  selectModel({ lastMessage: 'Привет', messageCount: 1, connectedIntegrations: [] })
    .includes('haiku'),
  'Простой чат должен использовать Haiku'
);

// Длинное сообщение -> Sonnet
console.assert(
  selectModel({ lastMessage: 'А'.repeat(250), messageCount: 1, connectedIntegrations: [] })
    .includes('sonnet'),
  'Длинное сообщение должно использовать Sonnet'
);

// Триггерное слово -> Sonnet
console.assert(
  selectModel({ lastMessage: 'напиши письмо клиенту', messageCount: 1, connectedIntegrations: [] })
    .includes('sonnet'),
  'Написание писем должно использовать Sonnet'
);

// Длинная история -> Sonnet
console.assert(
  selectModel({ lastMessage: 'ок', messageCount: 20, connectedIntegrations: [] })
    .includes('sonnet'),
  'Длинная история должна использовать Sonnet'
);

console.log('Все тесты modelRouter пройдены.');
```

### 12.4. Чеклист тестирования

```
Базовый flow:
[ ] Claude API отвечает на текстовый запрос (Haiku)
[ ] Claude API отвечает на сложный запрос (Sonnet)
[ ] Claude корректно выбирает tool_use вместо текстового ответа
[ ] Multi-tool: Claude возвращает два tool_use одновременно

Google Calendar через MCP:
[ ] list_calendar_events -- показывает события за день
[ ] create_calendar_event -- создаёт событие
[ ] update_calendar_event -- обновляет событие
[ ] delete_calendar_event -- удаляет событие

Tool result loop:
[ ] tool_use → выполнение → tool_result → Claude → финальный текст
[ ] Ошибка при tool execution → Claude получает is_error → user-friendly ответ
[ ] MAX_TOOL_LOOPS защищает от бесконечного цикла

Model routing:
[ ] "Привет" → Haiku
[ ] "Напиши письмо клиенту про задержку поставки" → Sonnet
[ ] "Покажи события на сегодня" → Haiku
[ ] Длинное сообщение (>200 символов) → Sonnet

Prompt caching:
[ ] Первый запрос: cache_creation_input_tokens > 0
[ ] Второй запрос: cache_read_input_tokens > 0
[ ] Стоимость второго запроса ниже первого

Fallback / graceful degradation:
[ ] MCP-сервер недоступен → Claude получает ошибку → сообщает пользователю
[ ] Claude API 429 (rate limit) → понятное сообщение пользователю
[ ] Claude API 529 (overloaded) → понятное сообщение пользователю
```

---

## 13. Мониторинг AI расходов

Каждый вызов Claude API фиксируется для контроля расходов.

```javascript
// src/services/billing/aiCostTracker.js

import { MODEL_PRICING } from '../ai/modelRouter.js';
import models from '../../models/index.js';
import { logger } from '../../config/logger.js';

/**
 * Трекер AI-расходов. Логирует каждый вызов Claude API с детализацией.
 */
export class AICostTracker {
  /**
   * Записывает одну транзакцию использования AI.
   *
   * @param {Object} params
   * @param {number} params.userId        - ID пользователя
   * @param {string} params.model         - ID модели ('claude-haiku-4-5-20251001' и т.д.)
   * @param {Object} params.usage         - { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }
   * @param {string} params.action        - Описание действия ('Создание события', 'Чат', ...)
   * @param {string} params.toolsUsed     - Список инструментов ('create_calendar_event, create_note')
   */
  static async track({ userId, model, usage, action, toolsUsed = '' }) {
    // Рассчитать стоимость
    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      logger.warn('[AICostTracker] Неизвестная модель', { model });
      return;
    }

    const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
    const cacheWriteCost = ((usage.cacheCreationInputTokens || 0) / 1_000_000) * pricing.cacheWrite;
    const cacheReadCost = ((usage.cacheReadInputTokens || 0) / 1_000_000) * pricing.cacheRead;
    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

    // Конвертируем в кредиты (1 кредит = $0.001)
    const creditsUsed = Math.ceil(totalCost * 1000);

    // Логируем для мониторинга
    logger.info('[AICostTracker] Транзакция', {
      userId,
      model: model.includes('haiku') ? 'Haiku' : 'Sonnet',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheRead: usage.cacheReadInputTokens || 0,
      cacheWrite: usage.cacheCreationInputTokens || 0,
      costUSD: totalCost.toFixed(6),
      credits: creditsUsed,
      action,
      toolsUsed,
    });

    // Сохраняем в БД
    try {
      await models.CreditTransaction.create({
        user_id: userId,
        type: 'usage',
        amount: -creditsUsed,
        balance_after: 0, // TODO: обновлять реальный баланс
        description: `${action}${toolsUsed ? ` (${toolsUsed})` : ''}`,
        model_used: model,
        tokens_input: usage.inputTokens,
        tokens_output: usage.outputTokens,
        created_at: new Date(),
      });
    } catch (error) {
      logger.error('[AICostTracker] Ошибка записи в БД', {
        error: error.message,
        userId,
      });
    }
  }

  /**
   * Получает статистику расходов за период.
   *
   * @param {number} userId
   * @param {Date} startDate
   * @param {Date} endDate
   * @returns {Object}
   */
  static async getUsageStats(userId, startDate, endDate) {
    const { Op, fn, col } = require('sequelize');

    const transactions = await models.CreditTransaction.findAll({
      where: {
        user_id: userId,
        type: 'usage',
        created_at: {
          [Op.between]: [startDate, endDate],
        },
      },
      attributes: [
        'model_used',
        [fn('COUNT', col('id')), 'request_count'],
        [fn('SUM', col('tokens_input')), 'total_input_tokens'],
        [fn('SUM', col('tokens_output')), 'total_output_tokens'],
        [fn('SUM', fn('ABS', col('amount'))), 'total_credits'],
      ],
      group: ['model_used'],
      raw: true,
    });

    return {
      period: { start: startDate, end: endDate },
      byModel: transactions,
      totalCredits: transactions.reduce((sum, t) => sum + parseInt(t.total_credits || 0), 0),
    };
  }
}
```

### Пример лога

```
[2026-02-13 10:15:23] INFO [AICostTracker] Транзакция {
  userId: 1,
  model: "Haiku",
  inputTokens: 1847,
  outputTokens: 234,
  cacheRead: 1200,
  cacheWrite: 0,
  costUSD: "0.001367",
  credits: 2,
  action: "Создание события в календаре",
  toolsUsed: "create_calendar_event"
}
```

### Ожидаемые расходы (на 100 пользователей Professional)

```
Расчёт для 100 пользователей x 500 сообщений/день (не все используют лимит):
Предположим ~200 сообщений/день в среднем = 20,000 сообщений/день

Haiku (70% = 14,000 запросов/день):
  Средний запрос: ~2000 input + 300 output tokens
  С кэшированием: ~800 input (60% из кэша) + 300 output tokens
  Стоимость: 14,000 * ((800/1M)*$1.00 + (300/1M)*$5.00) = 14,000 * $0.00230 = $32.20/день

Sonnet (30% = 6,000 запросов/день):
  Средний запрос: ~3000 input + 500 output tokens
  С кэшированием: ~1200 input (60% из кэша) + 500 output tokens
  Стоимость: 6,000 * ((1200/1M)*$3.00 + (500/1M)*$15.00) = 6,000 * $0.01110 = $66.60/день

Итого: ~$99/день = ~$2,970/месяц
Доход: 100 * $19 = $1,900/месяц

!!! ВНИМАНИЕ: при 200 msg/day/user расходы превышают доход.
Реальное использование ~50-80 msg/day/user:

При 70 msg/day в среднем = 7,000 запросов/день:
Haiku: 4,900 * $0.00230 = $11.27/день
Sonnet: 2,100 * $0.01110 = $23.31/день
Итого: ~$35/день = ~$1,050/месяц

Доход: $1,900/месяц
Маржа: ~45% ($850 прибыль)

С более агрессивным кэшированием и оптимизацией маржа вырастет до ~60-70%.
```

---

## 14. Чеклист готовности

### Перед началом работ

```
[ ] ANTHROPIC_API_KEY получен и работает (тест: node tests/manual/test-claude-basic.js)
[ ] Google OAuth credentials (client_id, client_secret, refresh_token) на месте
[ ] Stage 3 (Universal API) завершён -- структура src/ создана
[ ] Модели OAuthToken, CreditTransaction существуют (миграции применены)
[ ] Модель Message обновлена (tool_calls вместо function_call, token_count, model_used)
```

### День 1: Claude API + базовый handler

```
[ ] npm install @anthropic-ai/sdk
[ ] Создан src/services/ai/claudeHandler.js
[ ] Создан src/services/ai/toolDefinitions.js (все 12 инструментов)
[ ] Создан src/services/ai/promptBuilder.js (с prompt caching)
[ ] Создан src/services/ai/modelRouter.js (Haiku/Sonnet)
[ ] Создан src/services/ai/intentParser.js
[ ] Тест: Claude API отвечает на "Привет"
[ ] Тест: Claude возвращает tool_use на "Создай встречу"
[ ] Тест: prompt caching работает (cache_read_input_tokens > 0)
```

### День 2: MCP-слой

```
[ ] npm install @anthropic-ai/mcp-client и MCP-серверы
[ ] Создан src/services/mcp/mcpConfig.js
[ ] Создан src/services/mcp/mcpManager.js
[ ] Создан src/services/mcp/mcpRouter.js
[ ] Создан src/services/mcp/internalToolExecutor.js
[ ] MCP-сервер Google Calendar запускается
[ ] Тест: list_calendar_events через MCP
[ ] Тест: create_calendar_event через MCP
[ ] Тест: internalToolExecutor работает (create_note, create_task)
```

### День 3: Интеграция + messageProcessor

```
[ ] Обновлён src/services/core/messageProcessor.js
[ ] Полный цикл: user message → Claude → tool_use → MCP → tool_result → Claude → text
[ ] Обновлён telegramBot.js -- использует processMessage()
[ ] Удалён chatHistories (используются DB-backed сессии)
[ ] Тест через Telegram: текстовое сообщение → ответ
[ ] Тест через Telegram: "Что у меня сегодня?" → список событий
[ ] Тест через Telegram: "Создай встречу завтра в 10" → событие в Google Calendar
[ ] Тест через Telegram: "Запомни: купить молоко" → заметка создана
```

### День 4: Cleanup + мониторинг + edge cases

```
[ ] Удалён services/chatgptHandler.js
[ ] Удалён services/googleCalendarService.js
[ ] npm uninstall googleapis
[ ] Удалён OPENAI_API_KEY из .env
[ ] Удалён GOOGLE_ACCESS_TOKEN из .env
[ ] grep -r "chatgptHandler\|googleCalendarService\|openai\|OPENAI" src/ -- нет результатов
[ ] Создан src/services/billing/aiCostTracker.js
[ ] CreditTransaction заполняется при каждом запросе
[ ] Тест: MCP-сервер недоступен → user-friendly ответ
[ ] Тест: MAX_TOOL_LOOPS защита работает
[ ] Тест: голосовое сообщение → STT → Claude → ответ
[ ] morningDigest обновлён
[ ] Graceful shutdown корректно останавливает MCP-серверы
```

### Критерии успеха

```
1. ВСЕ функции, которые работали с GPT-4, работают с Claude:
   - Создание/обновление/удаление событий
   - Просмотр событий за день
   - Создание/просмотр/завершение заметок
   - Общий чат

2. Google Calendar управляется через MCP (НЕ через прямые API вызовы)

3. БАГ с expired access_token -- ИСПРАВЛЕН (MCP использует refresh_token)

4. Prompt caching работает (видно в usage.cache_read_input_tokens)

5. Model routing работает (простые запросы → Haiku, сложные → Sonnet)

6. CreditTransaction заполняется с каждым запросом

7. MCP-серверы перезапускаются при сбоях (MCPManager.handleServerCrash)

8. Нет import'ов chatgptHandler или googleCalendarService нигде в проекте
```

---

## Файлы, создаваемые в этом Stage

| # | Файл | Описание |
|---|---|---|
| 1 | `src/services/ai/claudeHandler.js` | Claude API клиент (замена chatgptHandler) |
| 2 | `src/services/ai/toolDefinitions.js` | 12 определений инструментов для Claude |
| 3 | `src/services/ai/promptBuilder.js` | System prompt + prompt caching |
| 4 | `src/services/ai/modelRouter.js` | Маршрутизация Haiku/Sonnet |
| 5 | `src/services/ai/intentParser.js` | Парсинг tool_use ответов Claude |
| 6 | `src/services/mcp/mcpManager.js` | Lifecycle MCP-серверов |
| 7 | `src/services/mcp/mcpRouter.js` | Маршрутизация tool_use к MCP |
| 8 | `src/services/mcp/mcpConfig.js` | Конфигурация MCP-серверов |
| 9 | `src/services/mcp/internalToolExecutor.js` | Выполнение внутренних tools (заметки, задачи) |
| 10 | `src/services/billing/aiCostTracker.js` | Трекинг расходов на AI |

## Файлы, удаляемые в этом Stage

| # | Файл | Причина |
|---|---|---|
| 1 | `services/chatgptHandler.js` | Заменён на claudeHandler.js |
| 2 | `services/googleCalendarService.js` | Заменён на MCP-серверы |

## Файлы, обновляемые в этом Stage

| # | Файл | Изменения |
|---|---|---|
| 1 | `src/services/core/messageProcessor.js` | Новый flow: Claude → tool_use → MCP → tool_result |
| 2 | `src/services/platforms/telegram/handlers/messageHandler.js` | Использует processMessage() |
| 3 | `src/models/Message.js` | function_call → tool_calls, +token_count, +model_used |
| 4 | `package.json` | +@anthropic-ai/sdk, +MCP пакеты, -googleapis |
| 5 | `.env` | +ANTHROPIC_API_KEY, -OPENAI_API_KEY, -GOOGLE_ACCESS_TOKEN |
| 6 | `src/server.js` | +mcpManager.initialize(), +mcpManager.shutdown() |
