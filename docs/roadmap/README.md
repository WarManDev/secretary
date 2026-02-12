# Secretary Bot - Дорожная карта модернизации

## О проекте

**Secretary Bot** - AI-секретарь в Telegram для предпринимателей и руководителей малого бизнеса. Управляет календарём, задачами, заметками через естественный язык (текст и голос).

**Цель модернизации**: Превратить рабочий прототип в коммерческий production-grade продукт с монетизацией, мульти-платформенностью и расширенным функционалом.

---

## Ключевые архитектурные принципы

### 1. Google сервисы через MCP (Model Context Protocol)
Вместо прямых вызовов Google API из бэкенда, используем **MCP-серверы Claude** для работы с Google сервисами:
- **Google Calendar** — через MCP-сервер `@anthropic/mcp-server-google-calendar`
- **Gmail** — через MCP-сервер `@anthropic/mcp-server-gmail`
- **Google Drive/Docs** — через MCP-сервер `@anthropic/mcp-server-google-drive`

**Преимущества MCP-подхода:**
- Claude сам вызывает нужные инструменты (tool_use) для работы с Google
- Бэкенд выступает MCP-клиентом, маршрутизирует tool_use от Claude к MCP-серверам
- Не нужно писать и поддерживать обёртки над Google API
- Автоматическое управление OAuth-токенами на стороне MCP-серверов
- Единообразная архитектура для всех интеграций

### 2. Кроссплатформенная архитектура с первого дня
Архитектура **Platform → Core → Services** позволяет подключать любые платформы без изменения бизнес-логики:

| Платформа | Адаптер | Статус |
|-----------|---------|--------|
| **Telegram Bot** | `platforms/telegram/` | Текущий (модернизация) |
| **REST API** | `platforms/api/rest.js` | Для веб-приложения и PWA |
| **WebSocket** | `platforms/api/websocket.js` | Real-time для мобильного/веб |
| **Web App (PWA)** | Отдельный фронтенд | Этап 10+ |
| **Mobile App** | React Native + Expo | Этап 10 |

Любое сообщение — из Telegram, REST API или WebSocket — проходит через единый `messageProcessor.js`.

---

## Текущее состояние

| Параметр | Оценка |
|----------|--------|
| **Production-readiness** | 2/10 |
| **Безопасность** | 1/10 (критично) |
| **Тесты** | 0/10 (отсутствуют) |
| **Инфраструктура** | 2/10 |
| **Функционал** | 5/10 (базовый работает) |

Подробный аудит: **[current-state.md](current-state.md)**

Целевая архитектура: **[target-architecture.md](target-architecture.md)**

---

## Этапы модернизации

| # | Этап | Срок | Зависит от | Статус |
|---|------|------|------------|--------|
| 0 | [Фундамент](stage-0-foundation.md) | 1-2 дня | - | [ ] |
| 1 | [Рефакторинг БД](stage-1-database-refactor.md) | 2-3 дня | 0 | [ ] |
| 2 | [Безопасность](stage-2-security.md) | 2-3 дня | 1 | [ ] |
| 3 | [Универсальный API](stage-3-universal-api.md) | 3-4 дня | 2 | [ ] |
| 4 | [Миграция на Claude](stage-4-claude-migration.md) | 3-4 дня | 3 | [ ] |
| 5 | [Telegram Pro](stage-5-telegram-pro.md) | 3-4 дня | 3, 4 | [ ] |
| 6 | [Интеграции](stage-6-integrations.md) | 5-7 дней | 4, 5 | [ ] |
| 7 | [CRM](stage-7-crm.md) | 3-4 дня | 6 | [ ] |
| 8 | [Монетизация](stage-8-monetization.md) | 5-7 дней | 5 | [ ] |
| 9 | [DevOps и тесты](stage-9-devops.md) | 4-5 дней | все | [ ] |
| 10 | [Мобильное приложение](stage-10-mobile.md) | 2-4 нед. | 3, 2 | [ ] |

**Общий timeline**: 30-45 рабочих дней (этапы 0-9), + 2-4 недели на мобильное приложение.

---

## Параллелизация

```
Неделя 1-2:  [Этап 0] → [Этап 1] → [Этап 2]
Неделя 3-4:  [Этап 3] → [Этап 4]
Неделя 5-6:  [Этап 5] ──────────────────────┐
             [Этап 6] (параллельно с 5)      │
             [Этап 8] (параллельно с 5,6)    │
Неделя 7-8:  [Этап 7] ──────────────────────┤
             [Этап 9] (начать тесты рано)    │
Неделя 9-13: [Этап 10] (мобильное) ─────────┘
```

---

## Новые npm пакеты по этапам

| Этап | Пакеты (dependencies) | Пакеты (devDependencies) |
|------|----------------------|--------------------------|
| 0 | - | eslint, prettier, eslint-config-prettier |
| 1 | sequelize-cli | - |
| 2 | bcrypt, jsonwebtoken, helmet, cors, express-rate-limit, zod | - |
| 3 | socket.io, swagger-jsdoc, swagger-ui-express | - |
| 4 | @anthropic-ai/sdk, @anthropic-ai/mcp-client | - |
| 5 | - | - |
| 6 | @anthropic/mcp-server-google-calendar, @anthropic/mcp-server-gmail, @anthropic/mcp-server-google-drive | - |
| 7 | - | - |
| 8 | stripe | - |
| 9 | - | vitest, @vitest/coverage-v8, supertest |
| 10 | (отдельный проект) | - |

**Удалить из dependencies**: `body-parser` (встроен в Express), `nodemon` (перенести в devDependencies)

---

## Новые модели БД по этапам

| Этап | Модель | Описание |
|------|--------|----------|
| 1 | (рефакторинг 8 существующих) | User +password_hash +telegram_id +timezone +subscription_tier; Note +user_id; Event +user_id; Task +priority +tags; Session +platform; Message +tool_calls +token_count +model_used |
| 6 | OAuthToken | Per-user токены для Google, Gmail, и др. |
| 7 | Contact | CRM: контакты с тегами |
| 7 | Interaction | CRM: история взаимодействий |
| 8 | Subscription | Подписки пользователей |
| 8 | Payment | Платежные транзакции |
| 8 | CreditTransaction | Учет расхода кредитов |

**Итого**: 8 существующих (рефакторинг) + 6 новых = 14 моделей

---

## Тарифные планы (Этап 8)

| | Free | Professional | Business | Enterprise |
|--|------|-------------|----------|------------|
| **Цена** | $0 | $19/мес | $49/мес | договорная |
| **Сообщений/день** | 50 | 500 | безлимит | безлимит |
| **AI модели** | Haiku | Haiku + Sonnet | Haiku + Sonnet | + Opus |
| **Календарь** | + | + | + | + |
| **Заметки/Задачи** | + (лимит) | + | + | + |
| **Gmail** | - | + | + | + |
| **Google Docs** | - | - | + | + |
| **TTS (голос)** | - | + | + | + |
| **Vision (фото)** | - | + | + | + |
| **CRM** | - | - | + | + |
| **API доступ** | - | - | + | + |

---

## Финансовые цели

| Метрика | 3 мес. | 6 мес. | 12 мес. |
|---------|--------|--------|---------|
| Платящих клиентов | 10 | 50 | 200-500 |
| MRR | $200 | $1,500 | $4,000-10,000 |
| AI расходы | $50 | $300 | $1,500-3,000 |
| Маржа | 75% | 80% | 70-80% |

---

## Быстрый старт

Начинаем с [Этапа 0: Фундамент](stage-0-foundation.md) - подготовка проекта к профессиональной разработке.
