import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError } from '../utils/errors.js';
import models from '../models/index.js';

/**
 * GET /api/users (admin only)
 * Получить список пользователей
 */
export const getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, subscription_tier, is_active } = req.query;
  const offset = (page - 1) * limit;

  const where = {};
  if (role) where.role = role;
  if (subscription_tier) where.subscription_tier = subscription_tier;
  if (is_active !== undefined) where.is_active = is_active;

  const { rows: users, count } = await models.User.findAndCountAll({
    where,
    limit,
    offset,
    attributes: [
      'id',
      'username',
      'email',
      'telegram_id',
      'role',
      'subscription_tier',
      'is_active',
      'created_at',
    ],
    order: [['created_at', 'DESC']],
  });

  res.json({
    status: 'success',
    data: {
      users,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit),
      },
    },
  });
});

/**
 * GET /api/users/:id
 */
export const getUser = asyncHandler(async (req, res) => {
  const user = await models.User.findByPk(req.params.id, {
    attributes: [
      'id',
      'username',
      'email',
      'telegram_id',
      'role',
      'subscription_tier',
      'timezone',
      'language',
      'is_active',
      'created_at',
    ],
  });

  if (!user) {
    throw new NotFoundError('Пользователь');
  }

  res.json({
    status: 'success',
    data: { user },
  });
});

/**
 * PATCH /api/users/:id
 * Обновить профиль (свой или чужой для админа)
 */
export const updateUser = asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);

  // Обычные пользователи могут обновлять только себя
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    throw new NotFoundError('Пользователь');
  }

  const user = await models.User.findByPk(userId);

  if (!user) {
    throw new NotFoundError('Пользователь');
  }

  const { email, timezone, language, telegram_id } = req.body;

  // Обычные пользователи могут менять только эти поля
  const updates = {};
  if (email !== undefined) updates.email = email;
  if (timezone !== undefined) updates.timezone = timezone;
  if (language !== undefined) updates.language = language;
  if (telegram_id !== undefined) updates.telegram_id = telegram_id;

  // Админы могут менять больше (добавится позже если нужно)

  await user.update(updates);

  res.json({
    status: 'success',
    message: 'Профиль обновлён',
    data: { user },
  });
});
