import { asyncHandler } from './errorHandler.js';
import { verifyAccessToken, extractTokenFromHeader } from '../utils/jwt.js';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import models from '../models/index.js';

/**
 * Middleware для проверки JWT токена
 * Добавляет req.user с данными пользователя
 */
export const authenticate = asyncHandler(async (req, res, next) => {
  // Извлекаем токен из заголовка
  const token = extractTokenFromHeader(req.headers.authorization);

  // Проверяем токен
  const decoded = verifyAccessToken(token);

  // Загружаем пользователя из БД
  const user = await models.User.findByPk(decoded.userId, {
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
    ],
  });

  if (!user) {
    throw new AuthenticationError('Пользователь не найден');
  }

  if (!user.is_active) {
    throw new AuthenticationError('Аккаунт деактивирован');
  }

  // Добавляем данные пользователя в request
  req.user = user;

  next();
});

/**
 * Middleware для проверки роли пользователя
 * @param {string[]} allowedRoles - массив разрешённых ролей ['admin', 'boss']
 */
export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new AuthenticationError('Требуется аутентификация');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError(`Доступ разрешён только для: ${allowedRoles.join(', ')}`);
    }

    next();
  };
};

/**
 * Middleware для проверки subscription tier
 * @param {string[]} allowedTiers - массив разрешённых тарифов
 */
export const requireSubscription = (...allowedTiers) => {
  return (req, res, next) => {
    if (!req.user) {
      throw new AuthenticationError('Требуется аутентификация');
    }

    if (!allowedTiers.includes(req.user.subscription_tier)) {
      throw new AuthorizationError(
        `Функция доступна только для тарифов: ${allowedTiers.join(', ')}`
      );
    }

    next();
  };
};

/**
 * Опциональная аутентификация
 * Если токен предоставлен - проверяет его, иначе продолжает без req.user
 */
export const optionalAuth = asyncHandler(async (req, res, next) => {
  try {
    if (!req.headers.authorization) {
      return next();
    }

    const token = extractTokenFromHeader(req.headers.authorization);
    const decoded = verifyAccessToken(token);

    const user = await models.User.findByPk(decoded.userId, {
      attributes: ['id', 'username', 'email', 'role', 'subscription_tier', 'is_active'],
    });

    if (user && user.is_active) {
      req.user = user;
    }
  } catch (error) {
    // Игнорируем ошибки токена при опциональной аутентификации
  }

  next();
});
