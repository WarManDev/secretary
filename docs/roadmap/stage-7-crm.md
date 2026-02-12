# Этап 7: CRM — управление контактами и взаимодействиями

> **Срок:** 3-4 дня
> **Зависит от:** Этап 6 (Интеграции — MCP, Google Calendar, Gmail)
> **Новые модели:** Contact, Interaction
> **Новые npm пакеты:** нет (используются существующие)
> **Статус:** [ ] Не начат

---

## Оглавление

1. [Обзор и цели](#1-обзор-и-цели)
2. [Модели и миграции](#2-модели-и-миграции)
3. [Contact Service](#3-contact-service)
4. [Interaction Service](#4-interaction-service)
5. [REST API endpoints](#5-rest-api-endpoints)
6. [Claude tool definitions для CRM](#6-claude-tool-definitions-для-crm)
7. [Интеграция с дайджестом](#7-интеграция-с-дайджестом)
8. [Интеграция с Gmail через MCP](#8-интеграция-с-gmail-через-mcp)
9. [Telegram UX для CRM](#9-telegram-ux-для-crm)
10. [Импорт контактов](#10-импорт-контактов)
11. [Чеклист готовности](#11-чеклист-готовности)

---

## 1. Обзор и цели

### Зачем CRM в Secretary Bot?

Целевая аудитория бота -- предприниматели с 1-10 сотрудниками. Для них управление
контактами и отслеживание взаимодействий -- ежедневная задача, которая обычно
решается блокнотом, Excel-таблицей или дорогой CRM-системой.

Secretary Bot предлагает **легковесную CRM** прямо в Telegram:
- Запоминание контактов через естественный язык
- Автоматическое отслеживание взаимодействий
- Напоминания о follow-up
- Связь с календарём и почтой

### Примеры использования

```
Пользователь: "Запомни, что Иван Петров из компании Acme, телефон +7-999-123-45-67, VIP клиент"
Бот: "Контакт создан: Иван Петров (Acme). Телефон: +7-999-123-45-67. Теги: vip"

Пользователь: "Когда я последний раз общался с Петровым?"
Бот: "Последнее взаимодействие с Иваном Петровым (Acme): 5 февраля — звонок.
      Резюме: Обсудили условия поставки. Follow-up запланирован на 12 февраля."

Пользователь: "Напомни позвонить Петрову в пятницу"
Бот: "Добавил follow-up: позвонить Ивану Петрову (Acme) — пятница, 14 февраля."

Пользователь: "Покажи всех клиентов с тегом vip"
Бот: "VIP-клиенты (3):
      1. Иван Петров — Acme — последний контакт: 5 фев
      2. Мария Сидорова — TechCorp — последний контакт: 3 фев
      3. Алексей Козлов — StartupX — последний контакт: 28 янв"
```

### Что реализуем на этом этапе

| Компонент | Описание |
|-----------|----------|
| Модели Contact, Interaction | Таблицы БД с миграциями и индексами |
| contactService.js | CRUD контактов, поиск, теги |
| interactionService.js | Запись взаимодействий, follow-up |
| REST API (7 endpoints) | Полный CRUD + follow-ups |
| Claude tools (5 штук) | Естественно-языковое управление CRM |
| Интеграция с дайджестом | Follow-up в утренней сводке |
| Интеграция с Gmail | Автоматические interaction из писем |
| Telegram UX | Команды, inline-поиск, keyboard |
| Импорт контактов | Google Contacts, CSV |

### Доступность по тарифам

| Функция | Free | Professional | Business | Enterprise |
|---------|------|-------------|----------|------------|
| CRM контакты | -- | -- | + | + |
| Follow-up напоминания | -- | -- | + | + |
| Gmail-интеграция CRM | -- | -- | + | + |
| Импорт контактов | -- | -- | + | + |
| API доступ к CRM | -- | -- | + | + |

CRM доступна начиная с тарифа **Business** ($49/мес).

---

## 2. Модели и миграции

### 2.1. Модель Contact

Файл: `src/models/Contact.js`

```javascript
// src/models/Contact.js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Contact = sequelize.define('Contact', {
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
      comment: 'Владелец контакта',
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      validate: {
        notEmpty: { msg: 'Имя контакта не может быть пустым' },
        len: {
          args: [1, 200],
          msg: 'Имя должно быть от 1 до 200 символов',
        },
      },
      comment: 'Полное имя контакта',
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
      validate: {
        isEmail: { msg: 'Некорректный формат email' },
      },
      comment: 'Email контакта',
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Телефон контакта',
    },
    company: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Компания',
    },
    position: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Должность',
    },
    telegram_handle: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Telegram username (без @)',
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Заметки о контакте',
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
      defaultValue: [],
      comment: 'Теги для фильтрации (vip, client, partner...)',
    },
    last_interaction_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Дата последнего взаимодействия',
    },
  }, {
    tableName: 'contacts',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        name: 'idx_contacts_user_name',
        fields: ['user_id', 'name'],
      },
      {
        name: 'idx_contacts_tags',
        fields: ['tags'],
        using: 'GIN',
      },
      {
        name: 'idx_contacts_last_interaction',
        fields: ['last_interaction_at'],
      },
    ],
  });

  Contact.associate = (models) => {
    Contact.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'owner',
    });
    Contact.hasMany(models.Interaction, {
      foreignKey: 'contact_id',
      as: 'interactions',
    });
  };

  return Contact;
};
```

### 2.2. Модель Interaction

Файл: `src/models/Interaction.js`

```javascript
// src/models/Interaction.js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Interaction = sequelize.define('Interaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    contact_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'contacts',
        key: 'id',
      },
      comment: 'Контакт, с которым было взаимодействие',
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      comment: 'Пользователь (владелец)',
    },
    type: {
      type: DataTypes.ENUM('meeting', 'call', 'email', 'message', 'note'),
      allowNull: false,
      comment: 'Тип взаимодействия',
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Краткое описание взаимодействия',
    },
    scheduled_follow_up: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Запланированная дата follow-up',
    },
  }, {
    tableName: 'interactions',
    timestamps: true,
    updatedAt: false, // Interactions неизменяемы — только created_at
    underscored: true,
    indexes: [
      {
        name: 'idx_interactions_contact_created',
        fields: ['contact_id', 'created_at'],
      },
      {
        name: 'idx_interactions_user_follow_up',
        fields: ['user_id', 'scheduled_follow_up'],
      },
    ],
  });

  Interaction.associate = (models) => {
    Interaction.belongsTo(models.Contact, {
      foreignKey: 'contact_id',
      as: 'contact',
    });
    Interaction.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
    });
  };

  return Interaction;
};
```

### 2.3. Миграция: создание таблицы contacts

Файл: `src/migrations/YYYYMMDDHHMMSS-create-contacts.js`

Имя файла формируется с timestamp при запуске `npx sequelize-cli migration:generate`.
Ниже приведён полный код миграции.

```javascript
// src/migrations/YYYYMMDDHHMMSS-create-contacts.js
'use strict';

/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('contacts', {
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
      name: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      email: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      phone: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      company: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      position: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      telegram_handle: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      tags: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
        defaultValue: [],
      },
      last_interaction_at: {
        type: Sequelize.DATE,
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

    // Индекс: поиск контактов пользователя по имени
    await queryInterface.addIndex('contacts', ['user_id', 'name'], {
      name: 'idx_contacts_user_name',
    });

    // GIN-индекс: поиск по тегам (ARRAY)
    await queryInterface.addIndex('contacts', ['tags'], {
      name: 'idx_contacts_tags',
      using: 'GIN',
    });

    // Индекс: сортировка по дате последнего взаимодействия
    await queryInterface.addIndex('contacts', ['last_interaction_at'], {
      name: 'idx_contacts_last_interaction',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('contacts', 'idx_contacts_last_interaction');
    await queryInterface.removeIndex('contacts', 'idx_contacts_tags');
    await queryInterface.removeIndex('contacts', 'idx_contacts_user_name');
    await queryInterface.dropTable('contacts');
  },
};
```

### 2.4. Миграция: создание таблицы interactions

Файл: `src/migrations/YYYYMMDDHHMMSS-create-interactions.js`

```javascript
// src/migrations/YYYYMMDDHHMMSS-create-interactions.js
'use strict';

/** @type {import('sequelize-cli').Migration} */
export default {
  async up(queryInterface, Sequelize) {
    // Создаём ENUM тип для interactions.type
    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_interactions_type"
      AS ENUM ('meeting', 'call', 'email', 'message', 'note');
    `);

    await queryInterface.createTable('interactions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      contact_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'contacts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      type: {
        type: '"enum_interactions_type"',
        allowNull: false,
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      scheduled_follow_up: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    // Индекс: история взаимодействий с контактом
    await queryInterface.addIndex('interactions', ['contact_id', 'created_at'], {
      name: 'idx_interactions_contact_created',
    });

    // Индекс: follow-up пользователя
    await queryInterface.addIndex('interactions', ['user_id', 'scheduled_follow_up'], {
      name: 'idx_interactions_user_follow_up',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('interactions', 'idx_interactions_user_follow_up');
    await queryInterface.removeIndex('interactions', 'idx_interactions_contact_created');
    await queryInterface.dropTable('interactions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_interactions_type";');
  },
};
```

### 2.5. Регистрация ассоциаций

В файле `src/models/index.js` (при динамической загрузке моделей) ассоциации
вызываются автоматически. Если используется ручная регистрация, добавить:

```javascript
// src/models/index.js — фрагмент ассоциаций для CRM
Contact.associate(models);
Interaction.associate(models);
```

### Сводка индексов

| Таблица | Индекс | Тип | Назначение |
|---------|--------|-----|------------|
| contacts | `idx_contacts_user_name` | B-tree | Поиск контактов пользователя по имени |
| contacts | `idx_contacts_tags` | GIN | Поиск по массиву тегов |
| contacts | `idx_contacts_last_interaction` | B-tree | Сортировка по активности |
| interactions | `idx_interactions_contact_created` | B-tree | Хронология взаимодействий |
| interactions | `idx_interactions_user_follow_up` | B-tree | Выборка follow-up |

---

## 3. Contact Service

Файл: `src/services/crm/contactService.js`

```javascript
// src/services/crm/contactService.js
import { Op } from 'sequelize';
import { Contact, Interaction, sequelize } from '../../models/index.js';
import logger from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

class ContactService {
  /**
   * Создать новый контакт
   * @param {number} userId - ID пользователя-владельца
   * @param {object} data - Данные контакта
   * @returns {Promise<Contact>}
   */
  async create(userId, data) {
    const { name, email, phone, company, position, telegram_handle, notes, tags } = data;

    // Нормализация тегов: приводим к нижнему регистру, убираем дубли
    const normalizedTags = tags
      ? [...new Set(tags.map((t) => t.toLowerCase().trim()).filter(Boolean))]
      : [];

    const contact = await Contact.create({
      user_id: userId,
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      company: company?.trim() || null,
      position: position?.trim() || null,
      telegram_handle: telegram_handle?.replace(/^@/, '').trim() || null,
      notes: notes?.trim() || null,
      tags: normalizedTags,
    });

    logger.info('Contact created', {
      contactId: contact.id,
      userId,
      name: contact.name,
    });

    return contact;
  }

  /**
   * Получить контакт по ID (с проверкой владельца)
   * @param {number} userId - ID пользователя
   * @param {number} contactId - ID контакта
   * @param {object} options - Опции (includeInteractions, interactionLimit)
   * @returns {Promise<Contact>}
   */
  async getById(userId, contactId, options = {}) {
    const { includeInteractions = false, interactionLimit = 10 } = options;

    const include = [];
    if (includeInteractions) {
      include.push({
        model: Interaction,
        as: 'interactions',
        limit: interactionLimit,
        order: [['created_at', 'DESC']],
      });
    }

    const contact = await Contact.findOne({
      where: { id: contactId, user_id: userId },
      include,
    });

    if (!contact) {
      throw new NotFoundError(`Контакт с id=${contactId} не найден`);
    }

    return contact;
  }

  /**
   * Список контактов пользователя с фильтрами и пагинацией
   * @param {number} userId - ID пользователя
   * @param {object} filters - Фильтры (search, company, tags, page, limit)
   * @returns {Promise<{contacts: Contact[], total: number, page: number, totalPages: number}>}
   */
  async list(userId, filters = {}) {
    const {
      search = null,
      company = null,
      tags = null,
      page = 1,
      limit = 20,
      sortBy = 'last_interaction_at',
      sortOrder = 'DESC',
    } = filters;

    const where = { user_id: userId };

    // Поиск по имени, email, компании, телефону
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { telegram_handle: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Фильтр по компании
    if (company) {
      where.company = { [Op.iLike]: `%${company}%` };
    }

    // Фильтр по тегам (PostgreSQL: ARRAY содержит все указанные теги)
    if (tags && tags.length > 0) {
      where.tags = { [Op.contains]: tags.map((t) => t.toLowerCase()) };
    }

    // Допустимые поля сортировки
    const allowedSortFields = ['name', 'company', 'last_interaction_at', 'created_at'];
    const actualSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'last_interaction_at';
    const actualSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // NULL-значения last_interaction_at — в конец при DESC
    const order = actualSortBy === 'last_interaction_at'
      ? [[sequelize.literal(`${actualSortBy} IS NULL`), 'ASC'], [actualSortBy, actualSortOrder]]
      : [[actualSortBy, actualSortOrder]];

    const offset = (page - 1) * limit;

    const { count: total, rows: contacts } = await Contact.findAndCountAll({
      where,
      order,
      limit,
      offset,
    });

    return {
      contacts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Обновить контакт
   * @param {number} userId - ID пользователя
   * @param {number} contactId - ID контакта
   * @param {object} data - Обновляемые поля
   * @returns {Promise<Contact>}
   */
  async update(userId, contactId, data) {
    const contact = await this.getById(userId, contactId);

    const updateData = {};

    // Обновляем только переданные поля
    const allowedFields = [
      'name', 'email', 'phone', 'company', 'position',
      'telegram_handle', 'notes', 'tags',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        if (field === 'tags') {
          updateData.tags = data.tags
            ? [...new Set(data.tags.map((t) => t.toLowerCase().trim()).filter(Boolean))]
            : [];
        } else if (field === 'telegram_handle') {
          updateData.telegram_handle = data.telegram_handle?.replace(/^@/, '').trim() || null;
        } else if (typeof data[field] === 'string') {
          updateData[field] = data[field].trim() || null;
        } else {
          updateData[field] = data[field];
        }
      }
    }

    await contact.update(updateData);

    logger.info('Contact updated', {
      contactId,
      userId,
      updatedFields: Object.keys(updateData),
    });

    return contact;
  }

  /**
   * Удалить контакт (каскадное удаление interactions)
   * @param {number} userId - ID пользователя
   * @param {number} contactId - ID контакта
   */
  async delete(userId, contactId) {
    const contact = await this.getById(userId, contactId);

    // Каскадное удаление настроено в миграции (onDelete: 'CASCADE'),
    // но для надёжности удаляем interactions явно
    await Interaction.destroy({ where: { contact_id: contactId } });
    await contact.destroy();

    logger.info('Contact deleted', { contactId, userId, name: contact.name });
  }

  /**
   * Поиск контактов по имени (для Claude tool — быстрый поиск)
   * Возвращает краткий список совпадений
   * @param {number} userId - ID пользователя
   * @param {string} query - Поисковый запрос
   * @param {number} maxResults - Максимум результатов
   * @returns {Promise<Contact[]>}
   */
  async search(userId, query, maxResults = 5) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const contacts = await Contact.findAll({
      where: {
        user_id: userId,
        [Op.or]: [
          { name: { [Op.iLike]: `%${query}%` } },
          { company: { [Op.iLike]: `%${query}%` } },
          { email: { [Op.iLike]: `%${query}%` } },
          { phone: { [Op.iLike]: `%${query}%` } },
        ],
      },
      order: [
        [sequelize.literal('last_interaction_at IS NULL'), 'ASC'],
        ['last_interaction_at', 'DESC'],
      ],
      limit: maxResults,
    });

    return contacts;
  }

  /**
   * Получить контакт с последними N взаимодействиями
   * (алиас для getById с includeInteractions: true)
   * @param {number} userId
   * @param {number} contactId
   * @param {number} interactionCount
   * @returns {Promise<Contact>}
   */
  async getWithInteractions(userId, contactId, interactionCount = 10) {
    return this.getById(userId, contactId, {
      includeInteractions: true,
      interactionLimit: interactionCount,
    });
  }

  /**
   * Найти контакт по email (для автоматической привязки Gmail-писем)
   * @param {number} userId
   * @param {string} email
   * @returns {Promise<Contact|null>}
   */
  async findByEmail(userId, email) {
    return Contact.findOne({
      where: {
        user_id: userId,
        email: { [Op.iLike]: email.trim() },
      },
    });
  }

  /**
   * Найти контакт по Telegram handle
   * @param {number} userId
   * @param {string} handle
   * @returns {Promise<Contact|null>}
   */
  async findByTelegram(userId, handle) {
    const cleanHandle = handle.replace(/^@/, '').trim();
    return Contact.findOne({
      where: {
        user_id: userId,
        telegram_handle: { [Op.iLike]: cleanHandle },
      },
    });
  }
}

export default new ContactService();
```

---

## 4. Interaction Service

Файл: `src/services/crm/interactionService.js`

```javascript
// src/services/crm/interactionService.js
import { Op } from 'sequelize';
import { Interaction, Contact, sequelize } from '../../models/index.js';
import contactService from './contactService.js';
import logger from '../../config/logger.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

class InteractionService {
  /**
   * Создать взаимодействие с контактом.
   * Автоматически обновляет contact.last_interaction_at
   *
   * @param {number} userId - ID пользователя
   * @param {number} contactId - ID контакта
   * @param {object} data - Данные взаимодействия
   * @param {string} data.type - Тип: meeting/call/email/message/note
   * @param {string} [data.summary] - Краткое описание
   * @param {string|Date} [data.scheduled_follow_up] - Дата follow-up
   * @returns {Promise<Interaction>}
   */
  async create(userId, contactId, data) {
    const { type, summary, scheduled_follow_up } = data;

    // Валидация допустимых типов
    const validTypes = ['meeting', 'call', 'email', 'message', 'note'];
    if (!validTypes.includes(type)) {
      throw new ValidationError(
        `Недопустимый тип взаимодействия: "${type}". Допустимые: ${validTypes.join(', ')}`
      );
    }

    // Проверяем, что контакт принадлежит пользователю
    const contact = await contactService.getById(userId, contactId);

    // Создаём в транзакции: interaction + обновление last_interaction_at
    const interaction = await sequelize.transaction(async (t) => {
      const newInteraction = await Interaction.create({
        contact_id: contactId,
        user_id: userId,
        type,
        summary: summary?.trim() || null,
        scheduled_follow_up: scheduled_follow_up || null,
      }, { transaction: t });

      // Обновляем дату последнего взаимодействия
      await contact.update({
        last_interaction_at: new Date(),
      }, { transaction: t });

      return newInteraction;
    });

    logger.info('Interaction created', {
      interactionId: interaction.id,
      contactId,
      userId,
      type,
      hasFollowUp: !!scheduled_follow_up,
    });

    return interaction;
  }

  /**
   * Получить историю взаимодействий с контактом
   * @param {number} userId
   * @param {number} contactId
   * @param {object} options - Пагинация
   * @returns {Promise<{interactions: Interaction[], total: number}>}
   */
  async listByContact(userId, contactId, options = {}) {
    const { page = 1, limit = 20 } = options;

    // Проверяем доступ к контакту
    await contactService.getById(userId, contactId);

    const offset = (page - 1) * limit;

    const { count: total, rows: interactions } = await Interaction.findAndCountAll({
      where: { contact_id: contactId, user_id: userId },
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return { interactions, total };
  }

  /**
   * Получить follow-up'ы за указанный период
   * @param {number} userId
   * @param {Date|string} from - Начало периода
   * @param {Date|string} to - Конец периода
   * @returns {Promise<Interaction[]>}
   */
  async getFollowUps(userId, from, to) {
    const interactions = await Interaction.findAll({
      where: {
        user_id: userId,
        scheduled_follow_up: {
          [Op.between]: [new Date(from), new Date(to)],
        },
      },
      include: [
        {
          model: Contact,
          as: 'contact',
          attributes: ['id', 'name', 'company', 'phone', 'email'],
        },
      ],
      order: [['scheduled_follow_up', 'ASC']],
    });

    return interactions;
  }

  /**
   * Получить просроченные follow-up'ы (дата в прошлом)
   * @param {number} userId
   * @returns {Promise<Interaction[]>}
   */
  async getOverdueFollowUps(userId) {
    const now = new Date();

    const interactions = await Interaction.findAll({
      where: {
        user_id: userId,
        scheduled_follow_up: {
          [Op.lt]: now,
          [Op.ne]: null,
        },
      },
      include: [
        {
          model: Contact,
          as: 'contact',
          attributes: ['id', 'name', 'company', 'phone', 'email'],
        },
      ],
      order: [['scheduled_follow_up', 'ASC']],
    });

    return interactions;
  }

  /**
   * Получить follow-up'ы на сегодня (для дайджеста)
   * @param {number} userId
   * @param {string} timezone - IANA timezone пользователя
   * @returns {Promise<Interaction[]>}
   */
  async getTodayFollowUps(userId, timezone = 'UTC') {
    // Вычисляем начало и конец дня в timezone пользователя
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = formatter.format(now); // "2026-02-12"

    const dayStart = new Date(`${todayStr}T00:00:00`);
    const dayEnd = new Date(`${todayStr}T23:59:59.999`);

    return this.getFollowUps(userId, dayStart, dayEnd);
  }

  /**
   * Получить последнее взаимодействие с контактом
   * @param {number} userId
   * @param {number} contactId
   * @returns {Promise<Interaction|null>}
   */
  async getLastInteraction(userId, contactId) {
    return Interaction.findOne({
      where: { contact_id: contactId, user_id: userId },
      order: [['created_at', 'DESC']],
    });
  }
}

export default new InteractionService();
```

---

## 5. REST API endpoints

### 5.1. Zod-схемы валидации

Файл: `src/utils/validators/contactValidators.js`

```javascript
// src/utils/validators/contactValidators.js
import { z } from 'zod';

// --- Contact schemas ---

export const createContactSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Имя обязательно').max(200),
    email: z.string().email('Некорректный email').max(100).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    company: z.string().max(200).optional().nullable(),
    position: z.string().max(200).optional().nullable(),
    telegram_handle: z.string().max(100).optional().nullable(),
    notes: z.string().optional().nullable(),
    tags: z.array(z.string().max(50)).max(20).optional().default([]),
  }),
});

export const updateContactSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(100).optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    company: z.string().max(200).optional().nullable(),
    position: z.string().max(200).optional().nullable(),
    telegram_handle: z.string().max(100).optional().nullable(),
    notes: z.string().optional().nullable(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID должен быть числом').transform(Number),
  }),
});

export const listContactsSchema = z.object({
  query: z.object({
    search: z.string().max(200).optional(),
    company: z.string().max(200).optional(),
    tags: z.union([
      z.string().transform((s) => s.split(',')),
      z.array(z.string()),
    ]).optional(),
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('20')
      .refine((v) => v <= 100, 'Максимум 100'),
    sort_by: z.enum(['name', 'company', 'last_interaction_at', 'created_at']).default('last_interaction_at'),
    sort_order: z.enum(['asc', 'desc', 'ASC', 'DESC']).default('DESC'),
  }),
});

export const contactIdSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'ID должен быть числом').transform(Number),
  }),
});

// --- Interaction schemas ---

export const createInteractionSchema = z.object({
  body: z.object({
    type: z.enum(['meeting', 'call', 'email', 'message', 'note'], {
      errorMap: () => ({
        message: 'Допустимые типы: meeting, call, email, message, note',
      }),
    }),
    summary: z.string().max(5000).optional().nullable(),
    scheduled_follow_up: z.string().datetime().optional().nullable(),
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
  }),
});

// --- Follow-up schemas ---

export const followUpsSchema = z.object({
  query: z.object({
    from: z.string().datetime({ message: 'Формат ISO 8601: 2026-02-12T00:00:00Z' }),
    to: z.string().datetime({ message: 'Формат ISO 8601: 2026-02-19T23:59:59Z' }),
  }),
});
```

### 5.2. Контроллер

Файл: `src/controllers/contacts.controller.js`

```javascript
// src/controllers/contacts.controller.js
import contactService from '../services/crm/contactService.js';
import interactionService from '../services/crm/interactionService.js';

/**
 * GET /api/v1/contacts
 * Список контактов с фильтрами и пагинацией
 */
export const listContacts = async (req, res) => {
  const { search, company, tags, page, limit, sort_by, sort_order } = req.query;

  const result = await contactService.list(req.user.id, {
    search,
    company,
    tags,
    page,
    limit,
    sortBy: sort_by,
    sortOrder: sort_order,
  });

  res.json({
    success: true,
    data: result.contacts,
    meta: {
      page: result.page,
      limit,
      total: result.total,
      total_pages: result.totalPages,
    },
  });
};

/**
 * POST /api/v1/contacts
 * Создать контакт
 */
export const createContact = async (req, res) => {
  const contact = await contactService.create(req.user.id, req.body);

  res.status(201).json({
    success: true,
    data: contact,
  });
};

/**
 * GET /api/v1/contacts/:id
 * Получить контакт с последними 10 взаимодействиями
 */
export const getContact = async (req, res) => {
  const contact = await contactService.getWithInteractions(
    req.user.id,
    req.params.id,
    10
  );

  res.json({
    success: true,
    data: contact,
  });
};

/**
 * PUT /api/v1/contacts/:id
 * Обновить контакт
 */
export const updateContact = async (req, res) => {
  const contact = await contactService.update(
    req.user.id,
    req.params.id,
    req.body
  );

  res.json({
    success: true,
    data: contact,
  });
};

/**
 * DELETE /api/v1/contacts/:id
 * Удалить контакт (каскадное удаление взаимодействий)
 */
export const deleteContact = async (req, res) => {
  await contactService.delete(req.user.id, req.params.id);

  res.json({
    success: true,
    data: { message: 'Контакт удалён' },
  });
};

/**
 * POST /api/v1/contacts/:id/interactions
 * Добавить взаимодействие с контактом
 */
export const createInteraction = async (req, res) => {
  const interaction = await interactionService.create(
    req.user.id,
    req.params.id,
    req.body
  );

  res.status(201).json({
    success: true,
    data: interaction,
  });
};

/**
 * GET /api/v1/follow-ups?from=...&to=...
 * Все follow-up'ы за период
 */
export const listFollowUps = async (req, res) => {
  const { from, to } = req.query;
  const followUps = await interactionService.getFollowUps(req.user.id, from, to);

  res.json({
    success: true,
    data: followUps,
  });
};
```

### 5.3. Маршруты

Файл: `src/routes/contacts.routes.js`

```javascript
// src/routes/contacts.routes.js
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { requireTier } from '../middleware/auth.js';
import {
  createContactSchema,
  updateContactSchema,
  listContactsSchema,
  contactIdSchema,
  createInteractionSchema,
  followUpsSchema,
} from '../utils/validators/contactValidators.js';
import {
  listContacts,
  createContact,
  getContact,
  updateContact,
  deleteContact,
  createInteraction,
  listFollowUps,
} from '../controllers/contacts.controller.js';

const router = Router();

// Все CRM-эндпоинты требуют аутентификации и тариф Business+
router.use(authenticate);
router.use(requireTier('business'));

// --- Contacts CRUD ---

// GET /api/v1/contacts — список контактов
router.get(
  '/',
  validate(listContactsSchema),
  listContacts
);

// POST /api/v1/contacts — создать контакт
router.post(
  '/',
  validate(createContactSchema),
  createContact
);

// GET /api/v1/contacts/:id — получить контакт (с interactions)
router.get(
  '/:id',
  validate(contactIdSchema),
  getContact
);

// PUT /api/v1/contacts/:id — обновить контакт
router.put(
  '/:id',
  validate(updateContactSchema),
  updateContact
);

// DELETE /api/v1/contacts/:id — удалить контакт
router.delete(
  '/:id',
  validate(contactIdSchema),
  deleteContact
);

// --- Interactions ---

// POST /api/v1/contacts/:id/interactions — добавить взаимодействие
router.post(
  '/:id/interactions',
  validate(createInteractionSchema),
  createInteraction
);

export default router;
```

Файл: `src/routes/followups.routes.js` (отдельный роутер для follow-ups)

```javascript
// src/routes/followups.routes.js
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTier } from '../middleware/auth.js';
import { validate } from '../middleware/validator.js';
import { followUpsSchema } from '../utils/validators/contactValidators.js';
import { listFollowUps } from '../controllers/contacts.controller.js';

const router = Router();

router.use(authenticate);
router.use(requireTier('business'));

// GET /api/v1/follow-ups?from=...&to=...
router.get('/', validate(followUpsSchema), listFollowUps);

export default router;
```

### 5.4. Подключение маршрутов

В файле `src/routes/index.js` добавить:

```javascript
// src/routes/index.js — фрагмент
import contactsRouter from './contacts.routes.js';
import followUpsRouter from './followups.routes.js';

// ... внутри функции подключения маршрутов
router.use('/contacts', contactsRouter);
router.use('/follow-ups', followUpsRouter);
```

### Сводка endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/v1/contacts` | Список контактов (search, tags, company) |
| `POST` | `/api/v1/contacts` | Создать контакт |
| `GET` | `/api/v1/contacts/:id` | Контакт + последние 10 взаимодействий |
| `PUT` | `/api/v1/contacts/:id` | Обновить контакт |
| `DELETE` | `/api/v1/contacts/:id` | Удалить контакт + все взаимодействия |
| `POST` | `/api/v1/contacts/:id/interactions` | Добавить взаимодействие |
| `GET` | `/api/v1/follow-ups?from=&to=` | Follow-up'ы за период |

---

## 6. Claude tool definitions для CRM

Файл: `src/services/ai/tools/crmTools.js`

Claude управляет CRM через 5 инструментов (tools). Пользователь общается
естественным языком, Claude вызывает нужный tool через `tool_use`.

```javascript
// src/services/ai/tools/crmTools.js

/**
 * Определения CRM-инструментов для Claude API (tool_use)
 *
 * Эти tools добавляются в массив tools при вызове Claude API.
 * Claude решает, какой tool вызвать, на основании сообщения пользователя.
 */

export const crmToolDefinitions = [
  // ═══════════════════════════════════════════════════════════
  // 1. create_contact — создание нового контакта
  // ═══════════════════════════════════════════════════════════
  {
    name: 'create_contact',
    description: `Создать новый контакт в CRM. Используй, когда пользователь просит запомнить
информацию о человеке: имя, телефон, email, компанию, должность, теги.
Примеры:
- "Запомни, что Иван Петров из Acme, телефон +7-999-123-45-67"
- "Добавь контакт: Мария Сидорова, email maria@techcorp.ru, VIP клиент"
- "Сохрани данные Козлова: компания StartupX, должность CTO, тег partner"`,
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Полное имя контакта (обязательно)',
        },
        email: {
          type: 'string',
          description: 'Email адрес',
        },
        phone: {
          type: 'string',
          description: 'Номер телефона',
        },
        company: {
          type: 'string',
          description: 'Название компании',
        },
        position: {
          type: 'string',
          description: 'Должность',
        },
        telegram_handle: {
          type: 'string',
          description: 'Telegram username (без @)',
        },
        notes: {
          type: 'string',
          description: 'Заметки о контакте',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Теги: vip, client, partner, lead, friend и т.д.',
        },
      },
      required: ['name'],
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 2. search_contacts — поиск контактов
  // ═══════════════════════════════════════════════════════════
  {
    name: 'search_contacts',
    description: `Найти контакты по имени, компании, тегам или email. Используй, когда пользователь
спрашивает о контакте или просит показать список контактов.
Примеры:
- "Найди контакт Иванов"
- "Покажи всех VIP клиентов"
- "Кто у меня из компании Acme?"
- "Покажи все контакты с тегом partner"`,
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Текстовый поиск по имени, email, компании, телефону',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Фильтр по тегам (контакт должен содержать ВСЕ указанные теги)',
        },
        company: {
          type: 'string',
          description: 'Фильтр по компании',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 3. get_contact_info — подробная информация о контакте
  // ═══════════════════════════════════════════════════════════
  {
    name: 'get_contact_info',
    description: `Получить подробную информацию о контакте, включая историю взаимодействий.
Используй, когда пользователь спрашивает о конкретном контакте или хочет узнать историю общения.
Примеры:
- "Что у меня по Петрову?"
- "Когда я последний раз общался с Ивановым?"
- "Расскажи про контакт Мария Сидорова"
- "Покажи историю общения с Козловым"`,
    input_schema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'number',
          description: 'ID контакта (если известен)',
        },
        name: {
          type: 'string',
          description: 'Имя контакта для поиска (если ID неизвестен)',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 4. add_interaction — запись взаимодействия
  // ═══════════════════════════════════════════════════════════
  {
    name: 'add_interaction',
    description: `Записать взаимодействие с контактом: встреча, звонок, письмо, сообщение, заметка.
Опционально можно указать дату follow-up.
Примеры:
- "Я позвонил Петрову, обсудили поставку на март"
- "Встретился с Сидоровой, договорились о партнёрстве. Перезвонить в пятницу"
- "Написал Козлову письмо с коммерческим предложением"
- "Напомни связаться с Ивановым 20 февраля"`,
    input_schema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'number',
          description: 'ID контакта (если известен)',
        },
        contact_name: {
          type: 'string',
          description: 'Имя контакта для поиска (если ID неизвестен)',
        },
        type: {
          type: 'string',
          enum: ['meeting', 'call', 'email', 'message', 'note'],
          description: 'Тип взаимодействия',
        },
        summary: {
          type: 'string',
          description: 'Краткое описание взаимодействия',
        },
        scheduled_follow_up: {
          type: 'string',
          description: 'Дата follow-up в формате ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)',
        },
      },
      required: ['type'],
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 5. list_follow_ups — список предстоящих follow-up
  // ═══════════════════════════════════════════════════════════
  {
    name: 'list_follow_ups',
    description: `Показать предстоящие и просроченные follow-up. Используй, когда пользователь
спрашивает о запланированных контактах, напоминаниях, кому нужно позвонить/написать.
Примеры:
- "Какие у меня follow-up на эту неделю?"
- "Кому я должен позвонить?"
- "Покажи просроченные напоминания"
- "Что запланировано на сегодня по контактам?"`,
    input_schema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Начало периода ISO 8601 (по умолчанию — сегодня)',
        },
        to: {
          type: 'string',
          description: 'Конец периода ISO 8601 (по умолчанию — через 7 дней)',
        },
        include_overdue: {
          type: 'boolean',
          description: 'Включить просроченные follow-up (по умолчанию true)',
        },
      },
    },
  },
];
```

### Обработчик tool_use для CRM

Файл: `src/services/ai/toolHandlers/crmToolHandler.js`

```javascript
// src/services/ai/toolHandlers/crmToolHandler.js
import contactService from '../../crm/contactService.js';
import interactionService from '../../crm/interactionService.js';
import logger from '../../../config/logger.js';

/**
 * Обработчик CRM tool_use вызовов от Claude.
 * Вызывается из actionExecutor.js при получении tool_use с CRM-инструментом.
 *
 * @param {string} toolName - Имя инструмента
 * @param {object} toolInput - Входные параметры от Claude
 * @param {number} userId - ID текущего пользователя
 * @returns {Promise<object>} - Результат для отправки в tool_result
 */
export async function handleCrmTool(toolName, toolInput, userId) {
  switch (toolName) {
    case 'create_contact':
      return handleCreateContact(userId, toolInput);

    case 'search_contacts':
      return handleSearchContacts(userId, toolInput);

    case 'get_contact_info':
      return handleGetContactInfo(userId, toolInput);

    case 'add_interaction':
      return handleAddInteraction(userId, toolInput);

    case 'list_follow_ups':
      return handleListFollowUps(userId, toolInput);

    default:
      return { error: `Неизвестный CRM-инструмент: ${toolName}` };
  }
}

// ────────────────────────────────────────────
// create_contact
// ────────────────────────────────────────────
async function handleCreateContact(userId, input) {
  try {
    const contact = await contactService.create(userId, {
      name: input.name,
      email: input.email,
      phone: input.phone,
      company: input.company,
      position: input.position,
      telegram_handle: input.telegram_handle,
      notes: input.notes,
      tags: input.tags,
    });

    return {
      success: true,
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        position: contact.position,
        telegram_handle: contact.telegram_handle,
        tags: contact.tags,
      },
    };
  } catch (error) {
    logger.error('CRM create_contact error', { error: error.message, userId });
    return { error: error.message };
  }
}

// ────────────────────────────────────────────
// search_contacts
// ────────────────────────────────────────────
async function handleSearchContacts(userId, input) {
  try {
    const result = await contactService.list(userId, {
      search: input.query,
      tags: input.tags,
      company: input.company,
      limit: 10,
    });

    return {
      success: true,
      total: result.total,
      contacts: result.contacts.map((c) => ({
        id: c.id,
        name: c.name,
        company: c.company,
        phone: c.phone,
        email: c.email,
        tags: c.tags,
        last_interaction_at: c.last_interaction_at,
      })),
    };
  } catch (error) {
    logger.error('CRM search_contacts error', { error: error.message, userId });
    return { error: error.message };
  }
}

// ────────────────────────────────────────────
// get_contact_info
// ────────────────────────────────────────────
async function handleGetContactInfo(userId, input) {
  try {
    let contact;

    if (input.contact_id) {
      contact = await contactService.getWithInteractions(userId, input.contact_id, 10);
    } else if (input.name) {
      // Поиск по имени, берём первый результат
      const results = await contactService.search(userId, input.name, 1);
      if (results.length === 0) {
        return { error: `Контакт "${input.name}" не найден` };
      }
      contact = await contactService.getWithInteractions(userId, results[0].id, 10);
    } else {
      return { error: 'Укажите contact_id или name' };
    }

    return {
      success: true,
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        position: contact.position,
        telegram_handle: contact.telegram_handle,
        notes: contact.notes,
        tags: contact.tags,
        last_interaction_at: contact.last_interaction_at,
        created_at: contact.created_at,
        interactions: contact.interactions?.map((i) => ({
          id: i.id,
          type: i.type,
          summary: i.summary,
          scheduled_follow_up: i.scheduled_follow_up,
          created_at: i.created_at,
        })) || [],
      },
    };
  } catch (error) {
    logger.error('CRM get_contact_info error', { error: error.message, userId });
    return { error: error.message };
  }
}

// ────────────────────────────────────────────
// add_interaction
// ────────────────────────────────────────────
async function handleAddInteraction(userId, input) {
  try {
    let contactId = input.contact_id;

    // Если ID не указан — ищем по имени
    if (!contactId && input.contact_name) {
      const results = await contactService.search(userId, input.contact_name, 1);
      if (results.length === 0) {
        return { error: `Контакт "${input.contact_name}" не найден` };
      }
      contactId = results[0].id;
    }

    if (!contactId) {
      return { error: 'Укажите contact_id или contact_name' };
    }

    const interaction = await interactionService.create(userId, contactId, {
      type: input.type,
      summary: input.summary,
      scheduled_follow_up: input.scheduled_follow_up,
    });

    // Получаем имя контакта для подтверждения
    const contact = await contactService.getById(userId, contactId);

    return {
      success: true,
      interaction: {
        id: interaction.id,
        contact_name: contact.name,
        contact_company: contact.company,
        type: interaction.type,
        summary: interaction.summary,
        scheduled_follow_up: interaction.scheduled_follow_up,
      },
    };
  } catch (error) {
    logger.error('CRM add_interaction error', { error: error.message, userId });
    return { error: error.message };
  }
}

// ────────────────────────────────────────────
// list_follow_ups
// ────────────────────────────────────────────
async function handleListFollowUps(userId, input) {
  try {
    const now = new Date();
    const from = input.from ? new Date(input.from) : now;
    const to = input.to
      ? new Date(input.to)
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 дней

    const includeOverdue = input.include_overdue !== false;

    const followUps = await interactionService.getFollowUps(userId, from, to);

    let overdue = [];
    if (includeOverdue) {
      overdue = await interactionService.getOverdueFollowUps(userId);
    }

    return {
      success: true,
      overdue: overdue.map((i) => ({
        id: i.id,
        contact_name: i.contact?.name,
        contact_company: i.contact?.company,
        type: i.type,
        summary: i.summary,
        scheduled_follow_up: i.scheduled_follow_up,
      })),
      upcoming: followUps.map((i) => ({
        id: i.id,
        contact_name: i.contact?.name,
        contact_company: i.contact?.company,
        type: i.type,
        summary: i.summary,
        scheduled_follow_up: i.scheduled_follow_up,
      })),
    };
  } catch (error) {
    logger.error('CRM list_follow_ups error', { error: error.message, userId });
    return { error: error.message };
  }
}
```

### Регистрация CRM-tools в toolDefinitions.js

```javascript
// src/services/ai/toolDefinitions.js — добавить CRM-инструменты
import { crmToolDefinitions } from './tools/crmTools.js';

// Полный список tool definitions для Claude API
export const allToolDefinitions = [
  // ... существующие tools (calendar, notes, tasks и т.д.)

  // CRM tools — включаются только для тарифов business и enterprise
  ...crmToolDefinitions,
];

/**
 * Получить tools для конкретного пользователя (с учётом тарифа)
 * @param {string} tier - Тарифный план пользователя
 * @returns {object[]} - Массив tool definitions
 */
export function getToolsForTier(tier) {
  const crmTiers = ['business', 'enterprise'];

  if (crmTiers.includes(tier)) {
    return allToolDefinitions;
  }

  // Для free и professional — без CRM-инструментов
  return allToolDefinitions.filter(
    (tool) => !crmToolDefinitions.some((ct) => ct.name === tool.name)
  );
}
```

---

## 7. Интеграция с дайджестом

Утренний дайджест дополняется секцией CRM: follow-up'ы на сегодня и просроченные.

### Обновление digestService.js

```javascript
// src/services/core/digestService.js — добавить CRM-секцию

import interactionService from '../crm/interactionService.js';

/**
 * Сформировать CRM-секцию дайджеста для пользователя
 * @param {number} userId
 * @param {string} timezone
 * @returns {Promise<string>} - Текст секции (Markdown)
 */
export async function buildCrmDigestSection(userId, timezone) {
  const sections = [];

  // 1. Просроченные follow-up (выделяем как срочные)
  const overdue = await interactionService.getOverdueFollowUps(userId);

  if (overdue.length > 0) {
    sections.push('⚠️ *Просроченные follow-up:*');
    for (const item of overdue) {
      const date = new Date(item.scheduled_follow_up).toLocaleDateString('ru-RU', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
      });
      const contactInfo = item.contact?.company
        ? `${item.contact.name} (${item.contact.company})`
        : item.contact?.name || 'Неизвестный';
      const typeLabel = interactionTypeLabel(item.type);
      sections.push(`  ❗ ${contactInfo} — ${typeLabel} — был запланирован на ${date}`);
      if (item.summary) {
        sections.push(`     _${item.summary}_`);
      }
    }
    sections.push('');
  }

  // 2. Follow-up на сегодня
  const todayFollowUps = await interactionService.getTodayFollowUps(userId, timezone);

  if (todayFollowUps.length > 0) {
    sections.push('📋 *Follow-up на сегодня:*');
    for (const item of todayFollowUps) {
      const contactInfo = item.contact?.company
        ? `${item.contact.name} (${item.contact.company})`
        : item.contact?.name || 'Неизвестный';
      const typeLabel = interactionTypeLabel(item.type);
      sections.push(`  • ${contactInfo} — ${typeLabel}`);
      if (item.summary) {
        sections.push(`    _${item.summary}_`);
      }
    }
    sections.push('');
  }

  if (sections.length === 0) {
    return ''; // Нет CRM-данных для дайджеста
  }

  return '\n🤝 *CRM:*\n' + sections.join('\n');
}

/**
 * Перевод типа взаимодействия
 */
function interactionTypeLabel(type) {
  const labels = {
    meeting: 'встреча',
    call: 'звонок',
    email: 'письмо',
    message: 'сообщение',
    note: 'заметка',
  };
  return labels[type] || type;
}
```

### Подключение в основном дайджесте

```javascript
// src/services/core/digestService.js — основная функция buildDigest

import { buildCrmDigestSection } from './digestService.js'; // или из отдельного файла

export async function buildDigest(userId, timezone) {
  const parts = [];

  parts.push('🌅 *Доброе утро! Ваш дайджест:*\n');

  // 1. События на сегодня (из Google Calendar через MCP)
  const eventsSection = await buildEventsSection(userId, timezone);
  if (eventsSection) parts.push(eventsSection);

  // 2. Задачи
  const tasksSection = await buildTasksSection(userId);
  if (tasksSection) parts.push(tasksSection);

  // 3. Невыполненные заметки
  const notesSection = await buildNotesSection(userId);
  if (notesSection) parts.push(notesSection);

  // 4. CRM: follow-up на сегодня + просроченные
  const crmSection = await buildCrmDigestSection(userId, timezone);
  if (crmSection) parts.push(crmSection);

  // Итоговое сообщение
  if (parts.length === 1) {
    parts.push('_На сегодня ничего не запланировано. Хорошего дня!_');
  }

  return parts.join('\n');
}
```

### Пример дайджеста с CRM-секцией

```
🌅 Доброе утро! Ваш дайджест:

📅 События на сегодня:
  • 10:00-11:00 — Созвон с командой
  • 14:00-15:00 — Встреча с инвестором

📝 Задачи:
  • [!] Подготовить презентацию (дедлайн: сегодня)
  • Проверить отчёт за январь

🤝 CRM:
⚠️ Просроченные follow-up:
  ❗ Козлов Алексей (StartupX) — звонок — был запланирован на 10 фев
     Обсудить условия партнёрства

📋 Follow-up на сегодня:
  • Иван Петров (Acme) — звонок
    Подтвердить объём поставки на март
  • Мария Сидорова (TechCorp) — письмо
    Отправить обновлённое КП
```

---

## 8. Интеграция с Gmail через MCP

При получении/отправке email через Gmail MCP-сервер бот может автоматически
создавать interaction с подходящим контактом.

### Архитектура

```
Gmail MCP Server                     Secretary Bot
      │                                    │
      │  tool_result: email received       │
      │  { from: "ivan@acme.com",          │
      │    subject: "RE: Поставка",        │
      │    snippet: "..." }                │
      │                                    │
      └───────────────────────────────────►│
                                           │
                                    contactService
                                    .findByEmail(
                                      userId,
                                      "ivan@acme.com"
                                    )
                                           │
                                    ┌──────┴──────┐
                                    │  Контакт    │
                                    │  найден?    │
                                    └──────┬──────┘
                                     Да    │   Нет
                                    ┌──────┘   └──── (пропускаем)
                                    │
                              interactionService
                              .create(userId, contactId, {
                                type: 'email',
                                summary: subject + snippet
                              })
```

### Реализация

Файл: `src/services/crm/gmailCrmBridge.js`

```javascript
// src/services/crm/gmailCrmBridge.js
import contactService from './contactService.js';
import interactionService from './interactionService.js';
import logger from '../../config/logger.js';

/**
 * Мост между Gmail и CRM.
 * Вызывается из mcpRouter.js после обработки Gmail tool_use,
 * когда Claude читает или отправляет email.
 */
class GmailCrmBridge {
  /**
   * Обработать входящий/исходящий email и создать interaction
   * если отправитель/получатель является контактом в CRM.
   *
   * @param {number} userId - ID пользователя
   * @param {object} emailData - Данные письма
   * @param {string} emailData.email - Email отправителя/получателя
   * @param {string} emailData.subject - Тема письма
   * @param {string} [emailData.snippet] - Превью текста
   * @param {string} [emailData.direction] - 'inbound' или 'outbound'
   * @returns {Promise<{linked: boolean, contact?: object, interaction?: object}>}
   */
  async processEmail(userId, emailData) {
    const { email, subject, snippet, direction = 'inbound' } = emailData;

    if (!email) {
      return { linked: false };
    }

    try {
      // Ищем контакт по email
      const contact = await contactService.findByEmail(userId, email);

      if (!contact) {
        logger.debug('Gmail CRM bridge: no matching contact', {
          userId,
          email,
        });
        return { linked: false };
      }

      // Формируем summary
      const dirLabel = direction === 'outbound' ? 'Исходящее' : 'Входящее';
      const summary = [
        `${dirLabel} письмо: "${subject}"`,
        snippet ? `Превью: ${snippet.substring(0, 200)}` : null,
      ].filter(Boolean).join('\n');

      // Создаём interaction
      const interaction = await interactionService.create(userId, contact.id, {
        type: 'email',
        summary,
      });

      logger.info('Gmail CRM bridge: interaction created', {
        userId,
        contactId: contact.id,
        contactName: contact.name,
        direction,
        subject,
      });

      return {
        linked: true,
        contact: {
          id: contact.id,
          name: contact.name,
          company: contact.company,
        },
        interaction: {
          id: interaction.id,
          type: 'email',
        },
      };
    } catch (error) {
      logger.error('Gmail CRM bridge error', {
        error: error.message,
        userId,
        email,
      });
      return { linked: false, error: error.message };
    }
  }
}

export default new GmailCrmBridge();
```

### Вызов из MCP Router

```javascript
// src/services/mcp/mcpRouter.js — фрагмент обработки Gmail tool_result

import gmailCrmBridge from '../crm/gmailCrmBridge.js';

// После получения результата от Gmail MCP-сервера
async function handleGmailToolResult(userId, toolName, result) {
  // ... основная обработка ...

  // Автоматическая привязка к CRM
  if (toolName === 'gmail_read_email' || toolName === 'gmail_send_email') {
    const emailAddress = toolName === 'gmail_send_email'
      ? result.to
      : result.from;

    await gmailCrmBridge.processEmail(userId, {
      email: emailAddress,
      subject: result.subject,
      snippet: result.snippet || result.body?.substring(0, 200),
      direction: toolName === 'gmail_send_email' ? 'outbound' : 'inbound',
    });
  }
}
```

---

## 9. Telegram UX для CRM

### 9.1. Команда /contacts

```javascript
// src/services/platforms/telegram/handlers/commandHandler.js — фрагмент

import contactService from '../../../crm/contactService.js';
import interactionService from '../../../crm/interactionService.js';

/**
 * /contacts — показать последние контакты с inline-кнопками
 */
async function handleContactsCommand(bot, msg, user) {
  const chatId = msg.chat.id;

  // Проверка тарифа
  if (!['business', 'enterprise'].includes(user.subscription_tier)) {
    await bot.sendMessage(chatId,
      '🔒 CRM доступна на тарифе Business ($49/мес) и выше.\n' +
      'Используйте /upgrade для смены тарифа.'
    );
    return;
  }

  const result = await contactService.list(user.id, {
    limit: 10,
    sortBy: 'last_interaction_at',
    sortOrder: 'DESC',
  });

  if (result.total === 0) {
    await bot.sendMessage(chatId,
      '📇 У вас пока нет контактов.\n\n' +
      'Добавьте контакт прямо в чате:\n' +
      '_"Запомни, что Иван Петров из компании Acme, телефон +7-999-123-45-67"_',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Формируем текст
  let text = `📇 *Контакты* (${result.total} всего):\n\n`;

  for (const contact of result.contacts) {
    const lastDate = contact.last_interaction_at
      ? new Date(contact.last_interaction_at).toLocaleDateString('ru-RU', {
          day: 'numeric', month: 'short',
        })
      : 'нет';
    const tags = contact.tags?.length ? ` [${contact.tags.join(', ')}]` : '';
    const company = contact.company ? ` — ${contact.company}` : '';

    text += `• *${contact.name}*${company}${tags}\n`;
    text += `  Последний контакт: ${lastDate}\n`;
  }

  // Inline-кнопки
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔍 Поиск', callback_data: 'crm:search' },
        { text: '➕ Добавить', callback_data: 'crm:add' },
      ],
      ...(result.totalPages > 1
        ? [[{ text: `Стр. 1/${result.totalPages} ▶`, callback_data: 'crm:page:2' }]]
        : []),
    ],
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
```

### 9.2. Inline-поиск контактов

```javascript
// src/services/platforms/telegram/handlers/inlineQueryHandler.js

import contactService from '../../../crm/contactService.js';

/**
 * Обработка inline-запросов: @botname Иван → показать контакты
 *
 * Пользователь в любом чате набирает: @secretary_bot Иван
 * Бот показывает выпадающий список найденных контактов.
 */
export async function handleInlineQuery(bot, query, user) {
  // query.query содержит текст после @botname
  const searchText = query.query.trim();

  if (searchText.length < 2) {
    return bot.answerInlineQuery(query.id, [], {
      switch_pm_text: 'Введите имя контакта для поиска',
      switch_pm_parameter: 'search',
      cache_time: 0,
    });
  }

  // Проверка тарифа
  if (!['business', 'enterprise'].includes(user.subscription_tier)) {
    return bot.answerInlineQuery(query.id, [], {
      switch_pm_text: 'CRM доступна на тарифе Business',
      switch_pm_parameter: 'upgrade',
      cache_time: 60,
    });
  }

  try {
    const contacts = await contactService.search(user.id, searchText, 10);

    const results = contacts.map((contact) => ({
      type: 'article',
      id: `contact_${contact.id}`,
      title: contact.name,
      description: [
        contact.company,
        contact.phone,
        contact.email,
      ].filter(Boolean).join(' | ') || 'Нет дополнительной информации',
      input_message_content: {
        message_text: formatContactCard(contact),
        parse_mode: 'Markdown',
      },
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📞 Позвонил', callback_data: `crm:interaction:${contact.id}:call` },
            { text: '📧 Написал', callback_data: `crm:interaction:${contact.id}:email` },
          ],
          [
            { text: '🤝 Встретился', callback_data: `crm:interaction:${contact.id}:meeting` },
            { text: '📋 Подробнее', callback_data: `crm:detail:${contact.id}` },
          ],
        ],
      },
    }));

    await bot.answerInlineQuery(query.id, results, {
      cache_time: 0, // Не кэшируем — данные CRM могут меняться
      is_personal: true,
    });
  } catch (error) {
    await bot.answerInlineQuery(query.id, [], {
      cache_time: 5,
    });
  }
}

/**
 * Форматирование карточки контакта (Markdown)
 */
function formatContactCard(contact) {
  const lines = [`*${contact.name}*`];

  if (contact.company) lines.push(`🏢 ${contact.company}`);
  if (contact.position) lines.push(`💼 ${contact.position}`);
  if (contact.phone) lines.push(`📞 ${contact.phone}`);
  if (contact.email) lines.push(`📧 ${contact.email}`);
  if (contact.telegram_handle) lines.push(`✈ @${contact.telegram_handle}`);
  if (contact.tags?.length) lines.push(`🏷 ${contact.tags.join(', ')}`);
  if (contact.last_interaction_at) {
    const date = new Date(contact.last_interaction_at).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    lines.push(`📅 Последний контакт: ${date}`);
  }

  return lines.join('\n');
}
```

### 9.3. Callback-обработка кнопок CRM

```javascript
// src/services/platforms/telegram/handlers/callbackHandler.js — фрагмент CRM

import contactService from '../../../crm/contactService.js';
import interactionService from '../../../crm/interactionService.js';

/**
 * Обработка callback_query для CRM inline-кнопок
 */
export async function handleCrmCallback(bot, callbackQuery, user) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data; // формат: "crm:action:param1:param2"
  const parts = data.split(':');
  const action = parts[1];

  switch (action) {
    // Быстрое добавление взаимодействия
    case 'interaction': {
      const contactId = parseInt(parts[2], 10);
      const type = parts[3]; // call, email, meeting

      // Создаём interaction
      const interaction = await interactionService.create(user.id, contactId, {
        type,
        summary: null, // Пользователь может дополнить позже
      });

      const contact = await contactService.getById(user.id, contactId);
      const typeLabels = {
        call: 'звонок', email: 'письмо', meeting: 'встречу', message: 'сообщение',
      };

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Записал ${typeLabels[type]} с ${contact.name}`,
        show_alert: false,
      });

      // Предлагаем добавить follow-up
      await bot.sendMessage(chatId,
        `✅ Записал ${typeLabels[type]} с *${contact.name}*.\n\n` +
        'Хотите запланировать follow-up? Напишите:\n' +
        `_"Напомни связаться с ${contact.name} через 3 дня"_`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    // Подробная карточка контакта
    case 'detail': {
      const contactId = parseInt(parts[2], 10);
      const contact = await contactService.getWithInteractions(user.id, contactId, 5);

      let text = formatContactCard(contact);
      text += '\n\n*Последние взаимодействия:*\n';

      if (contact.interactions?.length) {
        for (const i of contact.interactions) {
          const date = new Date(i.created_at).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'short',
          });
          const typeLabels = {
            meeting: '🤝', call: '📞', email: '📧', message: '💬', note: '📝',
          };
          text += `${typeLabels[i.type] || '•'} ${date} — ${i.summary || 'без описания'}\n`;
        }
      } else {
        text += '_Нет записей_\n';
      }

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📞 Позвонил', callback_data: `crm:interaction:${contactId}:call` },
              { text: '📧 Написал', callback_data: `crm:interaction:${contactId}:email` },
            ],
            [
              { text: '◀ Назад к списку', callback_data: 'crm:page:1' },
            ],
          ],
        },
      });
      break;
    }

    // Пагинация списка контактов
    case 'page': {
      const page = parseInt(parts[2], 10);
      const result = await contactService.list(user.id, {
        limit: 10,
        page,
        sortBy: 'last_interaction_at',
        sortOrder: 'DESC',
      });

      let text = `📇 *Контакты* (стр. ${page}/${result.totalPages}):\n\n`;
      for (const contact of result.contacts) {
        const company = contact.company ? ` — ${contact.company}` : '';
        text += `• *${contact.name}*${company}\n`;
      }

      const buttons = [];
      if (page > 1) {
        buttons.push({ text: '◀', callback_data: `crm:page:${page - 1}` });
      }
      buttons.push({ text: `${page}/${result.totalPages}`, callback_data: 'crm:noop' });
      if (page < result.totalPages) {
        buttons.push({ text: '▶', callback_data: `crm:page:${page + 1}` });
      }

      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [buttons],
        },
      });
      break;
    }

    // Начать поиск
    case 'search': {
      await bot.answerCallbackQuery(callbackQuery.id);
      await bot.sendMessage(chatId,
        '🔍 Введите имя, компанию или email для поиска контакта:',
        { reply_markup: { force_reply: true } }
      );
      break;
    }

    // Добавить контакт
    case 'add': {
      await bot.answerCallbackQuery(callbackQuery.id);
      await bot.sendMessage(chatId,
        '➕ Чтобы добавить контакт, напишите:\n\n' +
        '_"Запомни: Имя Фамилия, компания, телефон, email, тег"_\n\n' +
        'Пример:\n' +
        '_"Запомни контакт Иван Петров, Acme, +7-999-123-45-67, ivan@acme.com, клиент"_',
        { parse_mode: 'Markdown' }
      );
      break;
    }
  }
}
```

---

## 10. Импорт контактов

### 10.1. CSV-импорт через REST API

Файл: `src/services/crm/importService.js`

```javascript
// src/services/crm/importService.js
import contactService from './contactService.js';
import logger from '../../config/logger.js';

class ImportService {
  /**
   * Импорт контактов из CSV-строки
   *
   * Ожидаемый формат CSV (первая строка — заголовки):
   * name,email,phone,company,position,tags
   * "Иван Петров",ivan@acme.com,+7-999-123-45-67,Acme,CEO,"vip,client"
   *
   * @param {number} userId
   * @param {string} csvContent - Содержимое CSV-файла
   * @returns {Promise<{imported: number, skipped: number, errors: string[]}>}
   */
  async importFromCsv(userId, csvContent) {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      return { imported: 0, skipped: 0, errors: ['CSV файл пуст или содержит только заголовки'] };
    }

    // Парсим заголовки
    const headers = this._parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const nameIdx = headers.indexOf('name');

    if (nameIdx === -1) {
      return { imported: 0, skipped: 0, errors: ['Столбец "name" обязателен'] };
    }

    const results = { imported: 0, skipped: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      const values = this._parseCsvLine(lines[i]);
      if (values.length === 0) continue;

      try {
        const data = {};
        for (let j = 0; j < headers.length; j++) {
          const header = headers[j];
          const value = values[j]?.trim();

          if (!value) continue;

          switch (header) {
            case 'name':
              data.name = value;
              break;
            case 'email':
              data.email = value;
              break;
            case 'phone':
              data.phone = value;
              break;
            case 'company':
              data.company = value;
              break;
            case 'position':
              data.position = value;
              break;
            case 'telegram':
            case 'telegram_handle':
              data.telegram_handle = value;
              break;
            case 'notes':
              data.notes = value;
              break;
            case 'tags':
              data.tags = value.split(',').map((t) => t.trim()).filter(Boolean);
              break;
          }
        }

        if (!data.name) {
          results.skipped++;
          results.errors.push(`Строка ${i + 1}: пустое имя — пропущена`);
          continue;
        }

        await contactService.create(userId, data);
        results.imported++;
      } catch (error) {
        results.skipped++;
        results.errors.push(`Строка ${i + 1}: ${error.message}`);
      }
    }

    logger.info('CSV import completed', {
      userId,
      imported: results.imported,
      skipped: results.skipped,
    });

    return results;
  }

  /**
   * Импорт из Google Contacts (через Google People API / MCP)
   *
   * Вызывается после получения данных от Google People API MCP-сервера.
   * Формат входных данных: массив объектов от Google People API.
   *
   * @param {number} userId
   * @param {object[]} googleContacts - Массив контактов из Google People API
   * @returns {Promise<{imported: number, skipped: number, errors: string[]}>}
   */
  async importFromGoogle(userId, googleContacts) {
    const results = { imported: 0, skipped: 0, errors: [] };

    for (const gc of googleContacts) {
      try {
        // Извлекаем данные из формата Google People API
        const name = gc.names?.[0]?.displayName;
        if (!name) {
          results.skipped++;
          continue;
        }

        // Проверяем дублирование по email
        const email = gc.emailAddresses?.[0]?.value;
        if (email) {
          const existing = await contactService.findByEmail(userId, email);
          if (existing) {
            results.skipped++;
            results.errors.push(`"${name}": контакт с email ${email} уже существует`);
            continue;
          }
        }

        const data = {
          name,
          email: email || null,
          phone: gc.phoneNumbers?.[0]?.value || null,
          company: gc.organizations?.[0]?.name || null,
          position: gc.organizations?.[0]?.title || null,
          tags: ['google-import'],
        };

        await contactService.create(userId, data);
        results.imported++;
      } catch (error) {
        results.skipped++;
        results.errors.push(`${gc.names?.[0]?.displayName || 'Unknown'}: ${error.message}`);
      }
    }

    logger.info('Google Contacts import completed', {
      userId,
      imported: results.imported,
      skipped: results.skipped,
      total: googleContacts.length,
    });

    return results;
  }

  /**
   * Простой CSV-парсер (поддержка кавычек и запятых внутри значений)
   * @param {string} line
   * @returns {string[]}
   */
  _parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Экранированная кавычка
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);

    return result;
  }
}

export default new ImportService();
```

### 10.2. REST API endpoint для CSV-импорта

Добавить в `src/routes/contacts.routes.js`:

```javascript
// Добавить импорт в начало файла
import importService from '../services/crm/importService.js';

// POST /api/v1/contacts/import/csv — импорт из CSV
router.post('/import/csv', async (req, res) => {
  const { csv } = req.body;

  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Тело запроса должно содержать поле "csv" с содержимым CSV-файла',
      },
    });
  }

  const result = await importService.importFromCsv(req.user.id, csv);

  res.json({
    success: true,
    data: {
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors.slice(0, 20), // Ограничиваем вывод ошибок
    },
  });
});
```

### 10.3. Пример CSV для импорта

```csv
name,email,phone,company,position,tags
"Иван Петров",ivan@acme.com,+7-999-123-45-67,Acme,CEO,"vip,client"
"Мария Сидорова",maria@techcorp.ru,+7-999-234-56-78,TechCorp,CTO,"partner"
"Алексей Козлов",alex@startupx.io,,StartupX,Founder,"lead,startup"
"Елена Волкова",elena@design.ru,+7-999-345-67-89,DesignStudio,,"client"
```

### Пример запроса импорта

```bash
curl -X POST http://localhost:3000/api/v1/contacts/import/csv \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "csv": "name,email,phone,company,position,tags\n\"Иван Петров\",ivan@acme.com,+7-999-123-45-67,Acme,CEO,\"vip,client\"\n\"Мария Сидорова\",maria@techcorp.ru,+7-999-234-56-78,TechCorp,CTO,\"partner\""
  }'
```

Ответ:

```json
{
  "success": true,
  "data": {
    "imported": 2,
    "skipped": 0,
    "errors": []
  }
}
```

---

## 11. Чеклист готовности

### День 1: Модели и базовые сервисы

- [ ] Создать модель `Contact.js`
- [ ] Создать модель `Interaction.js`
- [ ] Написать миграцию `create-contacts`
- [ ] Написать миграцию `create-interactions`
- [ ] Выполнить миграции: `npx sequelize-cli db:migrate`
- [ ] Проверить создание таблиц и индексов в PostgreSQL
- [ ] Зарегистрировать ассоциации в `models/index.js`
- [ ] Реализовать `contactService.js` — полный CRUD
- [ ] Реализовать `interactionService.js` — создание, follow-ups
- [ ] Ручной тест: создать контакт, добавить interaction, проверить last_interaction_at

### День 2: REST API и валидация

- [ ] Написать zod-схемы валидации (`contactValidators.js`)
- [ ] Реализовать `contacts.controller.js`
- [ ] Реализовать `contacts.routes.js`
- [ ] Реализовать `followups.routes.js`
- [ ] Подключить маршруты в `routes/index.js`
- [ ] Добавить middleware `requireTier('business')` на CRM-роуты
- [ ] Тест через Postman/curl: создать контакт, получить список, добавить interaction
- [ ] Тест: follow-ups?from=...&to=...
- [ ] Тест: пагинация и фильтрация контактов
- [ ] Тест: ошибки валидации (пустое имя, невалидный email)

### День 3: Claude tools и Telegram UX

- [ ] Написать CRM tool definitions (`crmTools.js`)
- [ ] Реализовать `crmToolHandler.js`
- [ ] Зарегистрировать CRM-tools в `toolDefinitions.js`
- [ ] Реализовать `getToolsForTier()` — CRM только для business+
- [ ] Тест через Claude API: "Запомни контакт Иван Петров..."
- [ ] Тест: "Найди контакты с тегом vip"
- [ ] Тест: "Когда я последний раз общался с Петровым?"
- [ ] Тест: "Напомни позвонить Козлову в пятницу"
- [ ] Реализовать команду `/contacts` в Telegram
- [ ] Реализовать callback-обработку кнопок CRM
- [ ] Тест Telegram: `/contacts`, кнопки навигации, быстрый interaction

### День 4: Интеграции и импорт

- [ ] Реализовать `buildCrmDigestSection()` в digestService
- [ ] Интегрировать CRM-секцию в утренний дайджест
- [ ] Тест: дайджест с follow-up на сегодня и просроченными
- [ ] Реализовать `gmailCrmBridge.js`
- [ ] Подключить bridge в `mcpRouter.js`
- [ ] Реализовать `importService.js` (CSV + Google Contacts)
- [ ] Добавить endpoint `POST /api/v1/contacts/import/csv`
- [ ] Тест: CSV-импорт (валидный файл, файл с ошибками, дубликаты)
- [ ] Реализовать inline-поиск контактов в Telegram (опционально)
- [ ] Финальный интеграционный тест: полный flow от создания контакта до дайджеста

### Критерии готовности этапа

| Критерий | Требование |
|----------|------------|
| Модели | Contact и Interaction созданы, миграции прошли успешно |
| CRUD | Все 7 endpoints работают, валидация zod |
| Claude tools | 5 инструментов, Claude создаёт/ищет контакты через естественный язык |
| Тарификация | CRM доступна только на Business и Enterprise |
| Дайджест | Follow-up отображаются в утреннем дайджесте |
| Gmail | Автоматическое создание interaction при email |
| Telegram | `/contacts`, inline-кнопки, быстрое добавление interaction |
| Импорт | CSV-импорт работает через REST API |
| Безопасность | Контакты изолированы по user_id, нет доступа к чужим |

---

## Приложения

### A. Структура файлов этапа 7

```
src/
├── models/
│   ├── Contact.js                      # Модель контакта
│   └── Interaction.js                  # Модель взаимодействия
│
├── migrations/
│   ├── YYYYMMDDHHMMSS-create-contacts.js
│   └── YYYYMMDDHHMMSS-create-interactions.js
│
├── services/
│   └── crm/
│       ├── contactService.js           # CRUD контактов, поиск
│       ├── interactionService.js       # Взаимодействия, follow-ups
│       ├── importService.js            # CSV и Google импорт
│       └── gmailCrmBridge.js           # Мост Gmail → CRM
│
├── controllers/
│   └── contacts.controller.js          # Обработчики HTTP-запросов
│
├── routes/
│   ├── contacts.routes.js              # Маршруты CRM
│   └── followups.routes.js             # Маршруты follow-ups
│
├── utils/
│   └── validators/
│       └── contactValidators.js        # Zod-схемы валидации
│
└── services/
    └── ai/
        ├── tools/
        │   └── crmTools.js             # Tool definitions для Claude
        └── toolHandlers/
            └── crmToolHandler.js       # Обработчик tool_use
```

### B. Примеры API-запросов

**Создание контакта:**
```bash
curl -X POST http://localhost:3000/api/v1/contacts \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Иван Петров",
    "email": "ivan@acme.com",
    "phone": "+7-999-123-45-67",
    "company": "Acme",
    "position": "CEO",
    "tags": ["vip", "client"]
  }'
```

**Поиск контактов по тегу:**
```bash
curl "http://localhost:3000/api/v1/contacts?tags=vip&sort_by=name&sort_order=asc" \
  -H "Authorization: Bearer <token>"
```

**Добавление взаимодействия:**
```bash
curl -X POST http://localhost:3000/api/v1/contacts/1/interactions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "call",
    "summary": "Обсудили условия поставки на март",
    "scheduled_follow_up": "2026-02-14T10:00:00Z"
  }'
```

**Follow-ups за неделю:**
```bash
curl "http://localhost:3000/api/v1/follow-ups?from=2026-02-12T00:00:00Z&to=2026-02-19T23:59:59Z" \
  -H "Authorization: Bearer <token>"
```
