import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';

/**
 * Middleware фабрика для валидации запросов через Zod схемы
 * @param {Object} schemas - объект с zod схемами для body, query, params
 */
export const validate = (schemas) => {
  return (req, res, next) => {
    try {
      // Валидация body
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      // Валидация query параметров
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }

      // Валидация URL параметров
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        throw new ValidationError('Ошибка валидации данных', errors);
      }
      throw error;
    }
  };
};

/**
 * Общие Zod схемы для переиспользования
 */

// ID параметр в URL
export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID должен быть числом').transform(Number),
});

// Пагинация
export const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .default('1')
    .transform(Number)
    .refine((val) => val > 0, 'page должен быть больше 0'),
  limit: z
    .string()
    .optional()
    .default('20')
    .transform(Number)
    .refine((val) => val > 0 && val <= 100, 'limit должен быть от 1 до 100'),
});

// Сортировка
export const sortSchema = z.object({
  sortBy: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

/**
 * Схемы для аутентификации
 */
export const authSchemas = {
  // POST /api/auth/register
  register: {
    body: z.object({
      username: z
        .string()
        .min(3, 'Username минимум 3 символа')
        .max(50, 'Username максимум 50 символов')
        .regex(/^[a-zA-Z0-9_-]+$/, 'Username может содержать только буквы, цифры, _ и -'),
      password: z
        .string()
        .min(6, 'Пароль минимум 6 символов')
        .max(100, 'Пароль максимум 100 символов'),
      email: z.string().email('Неверный формат email').optional(),
      telegram_id: z.string().optional(),
    }),
  },

  // POST /api/auth/login
  login: {
    body: z.object({
      username: z.string().min(1, 'Username обязателен'),
      password: z.string().min(1, 'Пароль обязателен'),
    }),
  },

  // POST /api/auth/refresh
  refresh: {
    body: z.object({
      refreshToken: z.string().min(1, 'Refresh token обязателен'),
    }),
  },
};

/**
 * Схемы для пользователей
 */
export const userSchemas = {
  // PATCH /api/users/:id
  update: {
    params: idParamSchema,
    body: z.object({
      email: z.string().email('Неверный формат email').optional(),
      timezone: z.string().optional(),
      language: z.enum(['ru', 'en']).optional(),
      telegram_id: z.string().optional(),
    }),
  },

  // GET /api/users (admin only)
  list: {
    query: paginationSchema.merge(sortSchema).extend({
      role: z.enum(['admin', 'boss', 'employee']).optional(),
      subscription_tier: z.enum(['free', 'professional', 'business', 'enterprise']).optional(),
      is_active: z
        .string()
        .optional()
        .transform((val) => val === 'true'),
    }),
  },
};

/**
 * Схемы для заметок
 */
export const noteSchemas = {
  // POST /api/notes
  create: {
    body: z.object({
      content: z.string().min(1, 'Содержимое заметки обязательно'),
      category: z.string().max(100).optional(),
    }),
  },

  // PATCH /api/notes/:id
  update: {
    params: idParamSchema,
    body: z.object({
      content: z.string().min(1).optional(),
      category: z.string().max(100).optional(),
      completed: z.boolean().optional(),
    }),
  },

  // GET /api/notes
  list: {
    query: paginationSchema.merge(sortSchema).extend({
      category: z.string().optional(),
      completed: z
        .string()
        .optional()
        .transform((val) => val === 'true'),
    }),
  },
};

/**
 * Схемы для событий
 */
export const eventSchemas = {
  // POST /api/events
  create: {
    body: z.object({
      title: z.string().min(1, 'Название события обязательно').max(200),
      description: z.string().optional(),
      event_date: z.string().datetime('Неверный формат даты'),
      end_date: z.string().datetime('Неверный формат даты').optional(), // Опциональная дата окончания
      recurrence_rule: z.string().optional(),
      reminder_minutes: z.number().int().min(0).optional().default(15),
      // location будет добавлен в Stage 6 (миграция БД)
    }),
  },

  // PATCH /api/events/:id
  update: {
    params: idParamSchema,
    body: z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().optional(),
      event_date: z.string().datetime().optional(),
      end_date: z.string().datetime().optional(),
      recurrence_rule: z.string().optional(),
      reminder_minutes: z.number().int().min(0).optional(),
    }),
  },

  // GET /api/events
  list: {
    query: paginationSchema.merge(sortSchema).extend({
      start_date: z.string().optional(), // Принимаем любой формат даты
      end_date: z.string().optional(), // Принимаем любой формат даты
    }),
  },
};

/**
 * Схемы для задач
 */
export const taskSchemas = {
  // POST /api/tasks
  create: {
    body: z.object({
      title: z.string().min(1, 'Название задачи обязательно').max(255),
      description: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      due_date: z.string().datetime().optional(),
      tags: z.array(z.string()).optional(),
      assigned_employee_id: z.number().int().optional(),
    }),
  },

  // PATCH /api/tasks/:id
  update: {
    params: idParamSchema,
    body: z.object({
      title: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      due_date: z.string().datetime().optional(),
      tags: z.array(z.string()).optional(),
      assigned_employee_id: z.number().int().optional(),
    }),
  },

  // GET /api/tasks
  list: {
    query: paginationSchema.merge(sortSchema).extend({
      status: z.enum(['pending', 'in_progress', 'done', 'cancelled']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      assigned_employee_id: z.string().transform(Number).optional(),
    }),
  },
};
