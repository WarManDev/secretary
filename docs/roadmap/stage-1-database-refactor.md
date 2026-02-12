# Stage 1: Рефакторинг базы данных

> **Срок:** 2-3 дня
> **Зависимости:** Stage 0 (Фундамент проекта) -- должен быть полностью завершен
> **Цель:** Исправить все проблемы БД, перейти на миграции, подготовить схему
> для многопользовательского режима.
>
> После этого этапа: `sequelize.sync()` удален навсегда, все изменения схемы
> идут через миграции, модели готовы к коммерческому использованию.

---

## Оглавление

1. [Установка Sequelize CLI](#1-установка-sequelize-cli)
2. [Отказ от sequelize.sync()](#2-отказ-от-sequelizesync)
3. [Миграции для существующих таблиц](#3-миграции-для-существующих-таблиц)
4. [Рефакторинг модели User](#4-рефакторинг-модели-user)
5. [Рефакторинг модели Note](#5-рефакторинг-модели-note)
6. [Рефакторинг модели Event](#6-рефакторинг-модели-event)
7. [Рефакторинг модели Task](#7-рефакторинг-модели-task)
8. [Рефакторинг модели Session](#8-рефакторинг-модели-session)
9. [Рефакторинг модели Message](#9-рефакторинг-модели-message)
10. [Индексы](#10-индексы)
11. [Seeders](#11-seeders)
12. [Чеклист готовности](#12-чеклист-готовности)

---

## 1. Установка Sequelize CLI

### Зачем

Sequelize CLI (`sequelize-cli`) -- инструмент командной строки для управления
миграциями, seeders и моделями. Без него изменения схемы БД делаются вручную
через `sequelize.sync({ alter: true })` или `sync({ force: true })`, что опасно
в production (потеря данных, непредсказуемое поведение).

### Установка

```bash
npm install --save-dev sequelize-cli
```

### Файл: `.sequelizerc` (корень проекта)

`.sequelizerc` -- конфигурационный файл, указывающий Sequelize CLI, где искать
миграции, модели, seeders и конфигурацию. Поскольку проект использует ES Modules
(`"type": "module"` в `package.json`), а `sequelize-cli` по умолчанию ожидает
CommonJS, нужно использовать `.cjs` расширение для конфигурации.

```js
// .sequelizerc (корень проекта)
const path = require('path');

module.exports = {
  'config': path.resolve('src', 'config', 'database.cjs'),
  'models-path': path.resolve('src', 'models'),
  'seeders-path': path.resolve('src', 'seeders'),
  'migrations-path': path.resolve('src', 'migrations'),
};
```

### Файл: `src/config/database.cjs`

Sequelize CLI требует конфигурационный файл для подключения к БД. Поскольку CLI
не поддерживает ES Modules, используем `.cjs`:

```js
// src/config/database.cjs
require('dotenv').config();

module.exports = {
  development: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    timezone: '+04:00',
    dialectOptions: {
      useUTC: false,
    },
    logging: false,
  },
  test: {
    url: process.env.DATABASE_URL_TEST || process.env.DATABASE_URL,
    dialect: 'postgres',
    timezone: '+04:00',
    dialectOptions: {
      useUTC: false,
    },
    logging: false,
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    timezone: '+04:00',
    dialectOptions: {
      useUTC: false,
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
    logging: false,
  },
};
```

### Создать директории

```bash
mkdir -p src/migrations src/seeders
```

### npm-скрипты для миграций

Добавить в `package.json` -> `scripts`:

```json
{
  "scripts": {
    "db:migrate": "npx sequelize-cli db:migrate",
    "db:migrate:undo": "npx sequelize-cli db:migrate:undo",
    "db:migrate:undo:all": "npx sequelize-cli db:migrate:undo:all",
    "db:seed": "npx sequelize-cli db:seed:all",
    "db:seed:undo": "npx sequelize-cli db:seed:undo:all",
    "db:reset": "npx sequelize-cli db:migrate:undo:all && npx sequelize-cli db:migrate && npx sequelize-cli db:seed:all"
  }
}
```

### Проверка

```bash
npx sequelize-cli db:migrate:status
```

Должно вывести пустой список миграций (пока не создали ни одной).

---

## 2. Отказ от sequelize.sync()

### Зачем

`sequelize.sync()` автоматически создает/изменяет таблицы на основе моделей.
Проблемы:

1. **Непредсказуемость** -- `sync()` может удалить столбцы, если модель изменилась.
2. **Нет отката** -- невозможно откатить изменения.
3. **Нет истории** -- неясно, когда и какие изменения были внесены.
4. **Опасность в production** -- `sync({ force: true })` удаляет все данные.

### Действия

#### 2.1. Удалить `sequelize.sync()` из `src/server.js`

```js
// БЫЛО (в src/server.js):
await sequelize.authenticate();
logger.info('Sequelize: Подключение к БД успешно.');
await sequelize.sync();  // <-- УДАЛИТЬ ЭТУ СТРОКУ
logger.info('Sequelize: Модели синхронизированы.');

// СТАЛО:
await sequelize.authenticate();
logger.info('Sequelize: Подключение к БД успешно.');
// Миграции запускаются через CLI: npm run db:migrate
```

#### 2.2. Убедиться, что `sequelize.sync()` нигде не вызывается

Поиск по проекту:

```bash
grep -rn "sequelize.sync" src/
```

Результат должен быть пустым. Если Stage 0 выполнен корректно, `sync()` уже
удалён из `src/models/index.js`.

#### 2.3. Порядок запуска после перехода на миграции

```bash
# 1. Создать/обновить БД (первый раз или после изменений)
npm run db:migrate

# 2. (Опционально) Заполнить тестовыми данными
npm run db:seed

# 3. Запустить приложение
npm run dev
```

### Стратегия миграции существующей БД

Если БД уже содержит таблицы (созданные через `sync()`), есть два пути:

**Путь A: Чистая БД (рекомендуется для development)**
```bash
# Пересоздать БД
docker-compose -f docker-compose-local.yml down -v
docker-compose -f docker-compose-local.yml up -d
# Подождать 5 секунд, пока PostgreSQL запустится
npm run db:migrate
npm run db:seed
```

**Путь B: Существующая БД с данными (для production)**
Первую миграцию сделать как "baseline" -- она проверяет существование таблицы
перед созданием (`CREATE TABLE IF NOT EXISTS`). Все последующие миграции --
обычные ALTER TABLE.

---

## 3. Миграции для существующих таблиц

### Именование

Каждый файл миграции именуется по конвенции:

```
YYYYMMDDHHMMSS-описание.cjs
```

Используем `.cjs` расширение, потому что Sequelize CLI не поддерживает ES Modules.

Пример: `20260212100000-create-users.cjs`

### Порядок создания миграций

Миграции создаются в порядке зависимостей (FK):

1. `users` -- базовая таблица (нет FK)
2. `employees` -- FK → users
3. `events` -- FK → users
4. `tasks` -- FK → employees, users
5. `notes` -- FK → users
6. `sessions` -- FK → users
7. `messages` -- FK → sessions
8. `summaries` -- FK → sessions

### Миграция 1: `src/migrations/20260212100000-create-users.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      username: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      email: {
        type: Sequelize.STRING(100),
        allowNull: true,
        unique: true,
      },
      telegram_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
        unique: true,
      },
      role: {
        type: Sequelize.ENUM('admin', 'boss', 'employee'),
        allowNull: false,
        defaultValue: 'boss',
      },
      timezone: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'Asia/Dubai',
      },
      language: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'ru',
      },
      subscription_tier: {
        type: Sequelize.ENUM('free', 'professional', 'business', 'enterprise'),
        allowNull: false,
        defaultValue: 'free',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('users');
    // Удаляем ENUM-типы, созданные PostgreSQL
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_role";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_subscription_tier";');
  },
};
```

### Миграция 2: `src/migrations/20260212100100-create-employees.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('employees', {
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
      full_name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      telegram_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('employees');
  },
};
```

### Миграция 3: `src/migrations/20260212100200-create-events.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('events', {
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
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      event_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      google_calendar_event_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      recurrence_rule: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      reminder_minutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 15,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('events');
  },
};
```

### Миграция 4: `src/migrations/20260212100300-create-tasks.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tasks', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'in_progress', 'done', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      priority: {
        type: Sequelize.ENUM('low', 'medium', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'medium',
      },
      due_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      tags: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
        defaultValue: [],
      },
      reminder_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      assigned_employee_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'employees',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('tasks');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tasks_priority";');
  },
};
```

### Миграция 5: `src/migrations/20260212100400-create-notes.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notes', {
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
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      category: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      completed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('notes');
  },
};
```

### Миграция 6: `src/migrations/20260212100500-create-sessions.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sessions', {
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
      platform: {
        type: Sequelize.ENUM('telegram', 'web', 'mobile', 'api'),
        allowNull: false,
        defaultValue: 'telegram',
      },
      session_type: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'work',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      current_summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('sessions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_sessions_platform";');
  },
};
```

### Миграция 7: `src/migrations/20260212100600-create-messages.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sender: {
        type: Sequelize.ENUM('user', 'bot', 'system'),
        allowNull: false,
      },
      message_text: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      message_type: {
        type: Sequelize.ENUM('text', 'voice', 'photo', 'system'),
        allowNull: false,
        defaultValue: 'text',
      },
      tool_calls: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      token_count: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      model_used: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('messages');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_messages_sender";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_messages_message_type";');
  },
};
```

### Миграция 8: `src/migrations/20260212100700-create-summaries.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('summaries', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      summary_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.dropTable('summaries');
  },
};
```

### Запуск миграций

```bash
npm run db:migrate
```

Ожидаемый вывод:

```
== 20260212100000-create-users: migrating =======
== 20260212100000-create-users: migrated (0.045s)

== 20260212100100-create-employees: migrating =======
== 20260212100100-create-employees: migrated (0.023s)

== 20260212100200-create-events: migrating =======
== 20260212100200-create-events: migrated (0.021s)

== 20260212100300-create-tasks: migrating =======
== 20260212100300-create-tasks: migrated (0.034s)

== 20260212100400-create-notes: migrating =======
== 20260212100400-create-notes: migrated (0.018s)

== 20260212100500-create-sessions: migrating =======
== 20260212100500-create-sessions: migrated (0.022s)

== 20260212100600-create-messages: migrating =======
== 20260212100600-create-messages: migrated (0.025s)

== 20260212100700-create-summaries: migrating =======
== 20260212100700-create-summaries: migrated (0.015s)
```

### Проверка

```bash
npx sequelize-cli db:migrate:status
```

Все миграции должны показывать статус `up`.

---

## 4. Рефакторинг модели User

### Текущие проблемы

1. **CRITICAL:** поле `password` хранит пароль в plain text (STRING 255).
2. Нет поля `telegram_id` -- невозможно привязать Telegram-пользователя.
3. Нет поля `email` -- невозможно уведомлять и восстанавливать пароль.
4. Нет поля `timezone` -- захардкожен "Asia/Dubai" в 5+ местах.
5. Нет поля `language` -- для будущей локализации.
6. Нет поля `subscription_tier` -- для тарификации.
7. Поле `role` не валидируется (STRING вместо ENUM).

### Установка bcrypt

```bash
npm install bcrypt
```

### Файл: `src/models/user.js` (полная замена)

```js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        validate: {
          len: [3, 50],
          notEmpty: true,
        },
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      telegram_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'boss', 'employee'),
        allowNull: false,
        defaultValue: 'boss',
        validate: {
          isIn: [['admin', 'boss', 'employee']],
        },
      },
      timezone: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'Asia/Dubai',
      },
      language: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'ru',
      },
      subscription_tier: {
        type: DataTypes.ENUM('free', 'professional', 'business', 'enterprise'),
        allowNull: false,
        defaultValue: 'free',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'users',
      timestamps: false, // Управляем created_at/updated_at вручную
    }
  );

  // Instance method: проверка пароля
  User.prototype.validatePassword = async function (plainPassword) {
    const bcrypt = await import('bcrypt');
    return bcrypt.default.compare(plainPassword, this.password_hash);
  };

  // Class method: хеширование пароля
  User.hashPassword = async function (plainPassword) {
    const bcrypt = await import('bcrypt');
    const saltRounds = 12;
    return bcrypt.default.hash(plainPassword, saltRounds);
  };

  // Hook: не возвращать password_hash в JSON
  User.prototype.toJSON = function () {
    const values = { ...this.get() };
    delete values.password_hash;
    return values;
  };

  return User;
};
```

### Ключевые отличия от текущей модели

| Аспект | Было | Стало |
|---|---|---|
| Пароль | `password` (plain text, STRING) | `password_hash` (bcrypt hash, STRING 255) |
| Telegram | Отсутствует | `telegram_id` (UNIQUE) |
| Email | Отсутствует | `email` (UNIQUE, с валидацией) |
| Роль | `role` (STRING 20, без валидации) | `role` (ENUM с validate.isIn) |
| Timezone | Отсутствует | `timezone` (default 'Asia/Dubai') |
| Язык | Отсутствует | `language` (default 'ru') |
| Подписка | Отсутствует | `subscription_tier` (ENUM, default 'free') |
| Активность | Отсутствует | `is_active` (BOOLEAN, default true) |

### Проверка

- Модель загружается без ошибок при старте
- `User.hashPassword('test123')` возвращает bcrypt-хеш
- `user.validatePassword('test123')` корректно сравнивает
- `user.toJSON()` НЕ содержит `password_hash`

---

## 5. Рефакторинг модели Note

### Текущие проблемы

1. **CRITICAL:** нет поля `user_id` -- заметки глобальные, не привязаны к пользователю.
   В многопользовательском режиме все видят все заметки.
2. Нет поля `category` -- нет возможности группировать заметки.

### Файл: `src/models/note.js` (полная замена)

```js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Note = sequelize.define(
    'Note',
    {
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
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      completed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'notes',
      timestamps: false,
    }
  );

  return Note;
};
```

### Обновление ассоциаций в `src/models/index.js`

Добавить ассоциации для Note:

```js
// Заметки
models.Note.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Note, { foreignKey: 'user_id' });
```

### Влияние на сервисы

После добавления `user_id` (NOT NULL) в Note, **все** операции с заметками
должны включать `user_id`. Это затрагивает:

**`src/services/noteService.js`** -- обновить все функции:

```js
import models from '../models/index.js';

export async function createNote(noteData) {
  // noteData теперь ОБЯЗАН содержать user_id
  return await models.Note.create(noteData);
}

export async function getPendingNotes(userId) {
  return await models.Note.findAll({
    where: { completed: false, user_id: userId },
    order: [['created_at', 'ASC']],
  });
}

export async function markNotesCompleted(noteIds, userId) {
  await models.Note.update(
    { completed: true },
    { where: { id: noteIds, user_id: userId } }  // Проверка владельца!
  );
}
```

**`src/services/telegramBot.js`** -- при создании заметки передавать `user_id`.

> **Примечание:** До реализации полной системы аутентификации (Stage 2+),
> можно использовать `BOSS_CHAT_ID` для определения пользователя или создать
> временный маппинг `telegram_chat_id → user_id`.

### Проверка

- Создание заметки без `user_id` приводит к ошибке валидации
- Заметки фильтруются по `user_id`
- Один пользователь не видит заметки другого

---

## 6. Рефакторинг модели Event

### Текущие проблемы

1. Поле `created_by` используется в ассоциации (`models/index.js:50`), но
   **отсутствует в схеме модели**. Sequelize создает его автоматически через
   ассоциацию, но это неявно.
2. Нет явного `user_id` -- для кроссплатформенности нужен стандартный FK.
3. Нет `recurrence_rule` -- повторяющиеся события.
4. Нет `reminder_minutes` -- напоминания.

### Файл: `src/models/event.js` (полная замена)

```js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Event = sequelize.define(
    'Event',
    {
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
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      event_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      google_calendar_event_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      recurrence_rule: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'RFC 5545 RRULE, например: FREQ=WEEKLY;BYDAY=MO,WE,FR',
      },
      reminder_minutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 15,
        validate: {
          min: 0,
          max: 10080, // 7 дней в минутах
        },
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'events',
      timestamps: false,
    }
  );

  return Event;
};
```

### Обновление ассоциаций в `src/models/index.js`

```js
// БЫЛО:
models.Event.belongsTo(models.User, { foreignKey: 'created_by' });

// СТАЛО:
models.Event.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Event, { foreignKey: 'user_id' });
```

### Влияние на сервисы

В `src/services/telegramBot.js` при создании события нужно передавать `user_id`:

```js
// БЫЛО (строка 230):
const localEvent = await models.Event.create({
  title: summary,
  description: msg.text || inputText,
  event_date: startObj,
  end_date: endObj,
  google_calendar_event_id: createdEvent.id,
  created_at: new Date(),
  updated_at: new Date(),
});

// СТАЛО:
const localEvent = await models.Event.create({
  user_id: userId, // TODO: определить userId из telegram chatId
  title: summary,
  description: msg.text || inputText,
  event_date: startObj,
  end_date: endObj,
  google_calendar_event_id: createdEvent.id,
});
```

### Проверка

- Событие создается с `user_id`
- Создание события без `user_id` приводит к ошибке
- `recurrence_rule` и `reminder_minutes` принимают корректные значения

---

## 7. Рефакторинг модели Task

### Текущие проблемы

1. `status` -- STRING(50) без валидации (можно записать любую строку).
2. Нет `priority` -- невозможно приоритизировать задачи.
3. Нет `tags` -- невозможно фильтровать по меткам.
4. Нет `reminder_at` -- нет напоминаний о задачах.

### Файл: `src/models/task.js` (полная замена)

```js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Task = sequelize.define(
    'Task',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'in_progress', 'done', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
        validate: {
          isIn: [['pending', 'in_progress', 'done', 'cancelled']],
        },
      },
      priority: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
        allowNull: false,
        defaultValue: 'medium',
        validate: {
          isIn: [['low', 'medium', 'high', 'urgent']],
        },
      },
      due_date: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      tags: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: true,
        defaultValue: [],
      },
      reminder_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      assigned_employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'employees',
          key: 'id',
        },
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'tasks',
      timestamps: false,
    }
  );

  return Task;
};
```

### Ключевые отличия от текущей модели

| Аспект | Было | Стало |
|---|---|---|
| status | STRING(50), без валидации | ENUM (pending/in_progress/done/cancelled) |
| priority | Отсутствует | ENUM (low/medium/high/urgent), default 'medium' |
| tags | Отсутствует | ARRAY(STRING), default [] |
| reminder_at | Отсутствует | DATE, nullable |

### Проверка

- Создание задачи со статусом "invalid" приводит к ошибке
- `tags` принимает массив строк: `['urgent', 'client']`
- `priority` по умолчанию 'medium'

---

## 8. Рефакторинг модели Session

### Текущие проблемы

1. Нет поля `platform` -- невозможно отличить сессию Telegram от Web/Mobile.
2. Нет поля `metadata` (JSONB) -- негде хранить telegram_chat_id, device info и т.д.

### Файл: `src/models/session.js` (полная замена)

```js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Session = sequelize.define(
    'Session',
    {
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
      platform: {
        type: DataTypes.ENUM('telegram', 'web', 'mobile', 'api'),
        allowNull: false,
        defaultValue: 'telegram',
      },
      session_type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'work',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Дополнительные данные: telegram_chat_id, device_info, ip и т.д.',
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      ended_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      current_summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'sessions',
      timestamps: false,
    }
  );

  return Session;
};
```

### Ключевые отличия от текущей модели

| Аспект | Было | Стало |
|---|---|---|
| platform | Отсутствует | ENUM (telegram/web/mobile/api) |
| metadata | Отсутствует | JSONB (telegram_chat_id, device_info...) |

### Пример metadata

```json
{
  "telegram_chat_id": 123456789,
  "telegram_username": "warman",
  "user_agent": null,
  "ip_address": null
}
```

### Проверка

- Создание сессии с `platform: 'telegram'` и `metadata` работает
- JSONB-поле корректно сериализуется/десериализуется

---

## 9. Рефакторинг модели Message

### Текущие проблемы

1. Поле `function_call` (JSONB) -- устаревшее название из OpenAI API. Claude API
   использует `tool_use` / `tool_calls`.
2. Нет `token_count` -- невозможно отслеживать расход токенов.
3. Нет `model_used` -- невозможно отслеживать, какая модель использована.
4. Поле `sender` (STRING) -- не валидируется. Нет значения 'system' для системных
   сообщений.
5. Поле `message_type` (STRING) -- не валидируется.

### Файл: `src/models/message.js` (полная замена)

```js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Message = sequelize.define(
    'Message',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      session_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
          key: 'id',
        },
      },
      sender: {
        type: DataTypes.ENUM('user', 'bot', 'system'),
        allowNull: false,
        validate: {
          isIn: [['user', 'bot', 'system']],
        },
      },
      message_text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      message_type: {
        type: DataTypes.ENUM('text', 'voice', 'photo', 'system'),
        allowNull: false,
        defaultValue: 'text',
        validate: {
          isIn: [['text', 'voice', 'photo', 'system']],
        },
      },
      tool_calls: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Claude tool_use блоки или результаты tool_result',
      },
      token_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Общее количество токенов (input + output)',
      },
      model_used: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Модель AI: haiku-3.5, sonnet-4, gpt-4-0613',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'messages',
      timestamps: false,
    }
  );

  return Message;
};
```

### Ключевые отличия от текущей модели

| Аспект | Было | Стало |
|---|---|---|
| function_call | JSONB (OpenAI naming) | `tool_calls` JSONB (Claude naming) |
| sender | STRING(20), без валидации | ENUM (user/bot/system) |
| message_type | STRING(20), без валидации | ENUM (text/voice/photo/system) |
| token_count | Отсутствует | INTEGER, nullable |
| model_used | Отсутствует | STRING(50), nullable |

### Пример tool_calls

```json
[
  {
    "id": "toolu_01A...",
    "type": "tool_use",
    "name": "create_calendar_event",
    "input": {
      "title": "Встреча с Иваном",
      "date": "2026-02-13",
      "time": "10:00"
    }
  }
]
```

### Проверка

- Поле `tool_calls` корректно сохраняет и читает JSON-массив
- `sender: 'system'` работает
- `token_count` и `model_used` сохраняются

---

## 10. Индексы

### Зачем

Индексы ускоряют выборку данных. Без них при росте таблиц запросы будут замедляться.
Особенно важны составные индексы для часто используемых WHERE-комбинаций.

### Миграция индексов: `src/migrations/20260212100800-add-indexes.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, _Sequelize) {
    // === users ===
    // username, email, telegram_id уже UNIQUE (создаются при createTable)

    // === events ===
    // Составной: быстрая выборка событий пользователя за период
    await queryInterface.addIndex('events', ['user_id', 'event_date'], {
      name: 'idx_events_user_id_event_date',
    });

    // === tasks ===
    // Составной: задачи пользователя по статусу
    await queryInterface.addIndex('tasks', ['created_by', 'status'], {
      name: 'idx_tasks_created_by_status',
    });
    // FK индекс
    await queryInterface.addIndex('tasks', ['assigned_employee_id'], {
      name: 'idx_tasks_assigned_employee_id',
    });
    // Для напоминаний
    await queryInterface.addIndex('tasks', ['due_date'], {
      name: 'idx_tasks_due_date',
      where: { due_date: { $ne: null } },
    });
    // GIN-индекс для поиска по тегам
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_tags
      ON tasks USING GIN (tags);
    `);

    // === notes ===
    // Составной: невыполненные заметки пользователя
    await queryInterface.addIndex('notes', ['user_id', 'completed'], {
      name: 'idx_notes_user_id_completed',
    });

    // === sessions ===
    // Составной: активные сессии пользователя
    await queryInterface.addIndex('sessions', ['user_id', 'ended_at'], {
      name: 'idx_sessions_user_id_ended_at',
    });
    // По платформе
    await queryInterface.addIndex('sessions', ['platform'], {
      name: 'idx_sessions_platform',
    });

    // === messages ===
    // Составной: история сообщений в хронологическом порядке
    await queryInterface.addIndex('messages', ['session_id', 'created_at'], {
      name: 'idx_messages_session_id_created_at',
    });
    // Аналитика по моделям
    await queryInterface.addIndex('messages', ['model_used'], {
      name: 'idx_messages_model_used',
    });

    // === employees ===
    // FK индекс
    await queryInterface.addIndex('employees', ['user_id'], {
      name: 'idx_employees_user_id',
    });
  },

  async down(queryInterface, _Sequelize) {
    // Удаляем индексы в обратном порядке
    await queryInterface.removeIndex('employees', 'idx_employees_user_id');
    await queryInterface.removeIndex('messages', 'idx_messages_model_used');
    await queryInterface.removeIndex('messages', 'idx_messages_session_id_created_at');
    await queryInterface.removeIndex('sessions', 'idx_sessions_platform');
    await queryInterface.removeIndex('sessions', 'idx_sessions_user_id_ended_at');
    await queryInterface.removeIndex('notes', 'idx_notes_user_id_completed');

    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_tasks_tags;');
    await queryInterface.removeIndex('tasks', 'idx_tasks_due_date');
    await queryInterface.removeIndex('tasks', 'idx_tasks_assigned_employee_id');
    await queryInterface.removeIndex('tasks', 'idx_tasks_created_by_status');

    await queryInterface.removeIndex('events', 'idx_events_user_id_event_date');
  },
};
```

### Полный список индексов

| Таблица | Индекс | Тип | Назначение |
|---|---|---|---|
| `users` | `users_username_key` | UNIQUE | Быстрый поиск по username |
| `users` | `users_email_key` | UNIQUE | Быстрый поиск по email |
| `users` | `users_telegram_id_key` | UNIQUE | Быстрый поиск по Telegram ID |
| `events` | `idx_events_user_id_event_date` | B-tree (составной) | Выборка событий пользователя за период |
| `tasks` | `idx_tasks_created_by_status` | B-tree (составной) | Задачи пользователя по статусу |
| `tasks` | `idx_tasks_assigned_employee_id` | B-tree | FK индекс |
| `tasks` | `idx_tasks_due_date` | B-tree (partial) | Напоминания о задачах |
| `tasks` | `idx_tasks_tags` | GIN | Полнотекстовый поиск по тегам (ARRAY) |
| `notes` | `idx_notes_user_id_completed` | B-tree (составной) | Невыполненные заметки пользователя |
| `sessions` | `idx_sessions_user_id_ended_at` | B-tree (составной) | Активные сессии пользователя |
| `sessions` | `idx_sessions_platform` | B-tree | Аналитика по платформам |
| `messages` | `idx_messages_session_id_created_at` | B-tree (составной) | История сообщений в хронологическом порядке |
| `messages` | `idx_messages_model_used` | B-tree | Аналитика использования моделей |
| `employees` | `idx_employees_user_id` | B-tree | FK индекс |

### Проверка

```bash
npm run db:migrate
```

Проверить наличие индексов в PostgreSQL:

```sql
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

---

## 11. Seeders

### Зачем

Seeders заполняют БД тестовыми данными для разработки. Это позволяет:
- Быстро поднять окружение с готовыми данными
- Тестировать функциональность без ручного ввода
- Воспроизводить сценарии

### Seeder 1: `src/seeders/20260212110000-admin-user.cjs`

```js
'use strict';

const bcrypt = require('bcrypt');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, _Sequelize) {
    const passwordHash = await bcrypt.hash('admin123', 12);

    await queryInterface.bulkInsert('users', [
      {
        username: 'admin',
        password_hash: passwordHash,
        email: 'admin@secretary.bot',
        telegram_id: process.env.BOSS_CHAT_ID || null,
        role: 'admin',
        timezone: 'Asia/Dubai',
        language: 'ru',
        subscription_tier: 'professional',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface, _Sequelize) {
    await queryInterface.bulkDelete('users', { username: 'admin' });
  },
};
```

### Seeder 2: `src/seeders/20260212110100-sample-data.cjs`

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, _Sequelize) {
    // Получаем ID admin-пользователя
    const [users] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE username = 'admin' LIMIT 1;`
    );

    if (users.length === 0) {
      console.warn('Seeder: admin-пользователь не найден. Пропускаем sample-data.');
      return;
    }

    const adminId = users[0].id;
    const now = new Date();

    // --- Тестовые события ---
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);

    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(11, 0, 0, 0);

    const dayAfter = new Date(now);
    dayAfter.setDate(dayAfter.getDate() + 2);
    dayAfter.setHours(14, 0, 0, 0);

    const dayAfterEnd = new Date(dayAfter);
    dayAfterEnd.setHours(15, 30, 0, 0);

    await queryInterface.bulkInsert('events', [
      {
        user_id: adminId,
        title: 'Встреча с инвестором',
        description: 'Обсуждение Series A раунда',
        event_date: tomorrow,
        end_date: tomorrowEnd,
        google_calendar_event_id: null,
        recurrence_rule: null,
        reminder_minutes: 30,
        created_at: now,
        updated_at: now,
      },
      {
        user_id: adminId,
        title: 'Созвон с командой',
        description: 'Еженедельный стендап',
        event_date: dayAfter,
        end_date: dayAfterEnd,
        google_calendar_event_id: null,
        recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE',
        reminder_minutes: 15,
        created_at: now,
        updated_at: now,
      },
    ]);

    // --- Тестовые заметки ---
    await queryInterface.bulkInsert('notes', [
      {
        user_id: adminId,
        content: 'Подготовить презентацию для инвестора',
        category: 'work',
        completed: false,
        created_at: now,
        updated_at: now,
      },
      {
        user_id: adminId,
        content: 'Купить кофе в офис',
        category: 'personal',
        completed: false,
        created_at: now,
        updated_at: now,
      },
      {
        user_id: adminId,
        content: 'Обновить README проекта',
        category: 'work',
        completed: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    // --- Тестовые задачи ---
    await queryInterface.bulkInsert('tasks', [
      {
        title: 'Реализовать систему аутентификации',
        description: 'JWT + bcrypt, /auth/login, /auth/register',
        status: 'pending',
        priority: 'high',
        due_date: dayAfter,
        tags: ['backend', 'security'],
        reminder_at: tomorrow,
        assigned_employee_id: null,
        created_by: adminId,
        created_at: now,
        updated_at: now,
      },
      {
        title: 'Настроить CI/CD',
        description: 'GitHub Actions: lint, test, deploy',
        status: 'pending',
        priority: 'medium',
        due_date: null,
        tags: ['devops'],
        reminder_at: null,
        assigned_employee_id: null,
        created_by: adminId,
        created_at: now,
        updated_at: now,
      },
      {
        title: 'Написать unit-тесты для noteService',
        description: 'Покрыть createNote, getPendingNotes, markNotesCompleted',
        status: 'in_progress',
        priority: 'medium',
        due_date: tomorrow,
        tags: ['testing', 'backend'],
        reminder_at: null,
        assigned_employee_id: null,
        created_by: adminId,
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  async down(queryInterface, _Sequelize) {
    // Удаляем в обратном порядке зависимостей
    await queryInterface.bulkDelete('tasks', null, {});
    await queryInterface.bulkDelete('notes', null, {});
    await queryInterface.bulkDelete('events', null, {});
  },
};
```

### Запуск seeders

```bash
# Заполнить данными
npm run db:seed

# Откатить seeders
npm run db:seed:undo

# Полный сброс (миграции + seeders)
npm run db:reset
```

### Проверка

```bash
npm run db:seed
```

Проверить в PostgreSQL:

```sql
SELECT id, username, role, subscription_tier FROM users;
SELECT id, user_id, title, event_date FROM events;
SELECT id, user_id, content, completed FROM notes;
SELECT id, title, status, priority, tags FROM tasks;
```

---

## 12. Чеклист готовности

Перед переходом к Stage 2 убедиться, что **каждый** пункт выполнен:

### Sequelize CLI

- [ ] `sequelize-cli` установлен в devDependencies
- [ ] `.sequelizerc` создан и указывает на `src/` пути
- [ ] `src/config/database.cjs` создан
- [ ] Директории `src/migrations/` и `src/seeders/` существуют
- [ ] npm-скрипты для миграций добавлены в package.json

### Миграции

- [ ] 8 миграций создано (users, employees, events, tasks, notes, sessions, messages, summaries)
- [ ] 1 миграция для индексов создана
- [ ] `npm run db:migrate` проходит без ошибок
- [ ] `npm run db:migrate:undo:all` откатывает ВСЕ таблицы без ошибок
- [ ] `npm run db:migrate` повторно -- снова создает все таблицы
- [ ] `npx sequelize-cli db:migrate:status` показывает все миграции со статусом `up`

### sequelize.sync() удален

- [ ] `grep -rn "sequelize.sync" src/` -- пустой результат
- [ ] Приложение запускается БЕЗ sync (используя миграции)

### Модели

- [ ] **User**: `password` -> `password_hash`, добавлены `telegram_id`, `email`, `timezone`, `language`, `subscription_tier`, `is_active`, ENUM для `role`
- [ ] **Note**: добавлен `user_id` (FK, NOT NULL), добавлен `category`
- [ ] **Event**: `created_by` -> `user_id` (явный FK, NOT NULL), добавлены `recurrence_rule`, `reminder_minutes`
- [ ] **Task**: `status` STRING -> ENUM, добавлены `priority` ENUM, `tags` ARRAY, `reminder_at`
- [ ] **Session**: добавлены `platform` ENUM, `metadata` JSONB
- [ ] **Message**: `function_call` -> `tool_calls`, добавлены `token_count`, `model_used`, `sender` ENUM с 'system'
- [ ] **Employee**: без изменений (legacy, рефакторинг позже)
- [ ] **Summary**: без изменений

### Ассоциации

- [ ] `Note.belongsTo(User)` + `User.hasMany(Note)` добавлены
- [ ] `Event.belongsTo(User, { foreignKey: 'user_id' })` -- обновлен с `created_by`
- [ ] `User.hasMany(Event)` добавлен
- [ ] Все остальные ассоциации сохранены

### Индексы

- [ ] Составной индекс на `events(user_id, event_date)`
- [ ] Составной индекс на `tasks(created_by, status)`
- [ ] GIN-индекс на `tasks(tags)`
- [ ] Составной индекс на `notes(user_id, completed)`
- [ ] Составной индекс на `sessions(user_id, ended_at)`
- [ ] Составной индекс на `messages(session_id, created_at)`
- [ ] Все индексы проверены через `pg_indexes`

### Seeders

- [ ] Admin-пользователь с bcrypt hash
- [ ] Тестовые события (2 штуки)
- [ ] Тестовые заметки (3 штуки)
- [ ] Тестовые задачи (3 штуки)
- [ ] `npm run db:seed` проходит без ошибок
- [ ] `npm run db:seed:undo` откатывает без ошибок

### Зависимости

- [ ] `bcrypt` добавлен в dependencies
- [ ] `sequelize-cli` добавлен в devDependencies

### Функциональность

- [ ] `npm run db:reset` -- полный цикл: undo all -> migrate -> seed
- [ ] `npm run dev` -- бот запускается без ошибок
- [ ] Telegram бот отвечает на сообщения
- [ ] Заметки создаются с `user_id`
- [ ] События создаются с `user_id`

### Итоговые npm-скрипты

```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "format": "prettier --write src/",
    "db:migrate": "npx sequelize-cli db:migrate",
    "db:migrate:undo": "npx sequelize-cli db:migrate:undo",
    "db:migrate:undo:all": "npx sequelize-cli db:migrate:undo:all",
    "db:seed": "npx sequelize-cli db:seed:all",
    "db:seed:undo": "npx sequelize-cli db:seed:undo:all",
    "db:reset": "npx sequelize-cli db:migrate:undo:all && npx sequelize-cli db:migrate && npx sequelize-cli db:seed:all",
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
```

---

> **Предыдущий этап:** [Stage 0: Фундамент проекта](stage-0-foundation.md)
> **Следующий этап:** Stage 2: Аутентификация и авторизация (планируется)
