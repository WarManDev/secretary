import express from 'express';
import bcrypt from 'bcrypt';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate, authSchemas } from '../middleware/validator.js';
import { authLimiter, registrationLimiter } from '../middleware/rateLimiter.js';
import { generateTokenPair, verifyRefreshToken } from '../utils/jwt.js';
import { AuthenticationError, ConflictError, ValidationError } from '../utils/errors.js';
import models from '../models/index.js';
import logger from '../config/logger.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Регистрация нового пользователя
 */
router.post(
  '/register',
  registrationLimiter,
  validate(authSchemas.register),
  asyncHandler(async (req, res) => {
    const { username, password, email, telegram_id } = req.body;

    // Проверяем существование username
    const existingUser = await models.User.findOne({ where: { username } });
    if (existingUser) {
      throw new ConflictError('Username уже занят');
    }

    // Проверяем существование email
    if (email) {
      const existingEmail = await models.User.findOne({ where: { email } });
      if (existingEmail) {
        throw new ConflictError('Email уже зарегистрирован');
      }
    }

    // Проверяем существование telegram_id
    if (telegram_id) {
      const existingTelegram = await models.User.findOne({
        where: { telegram_id },
      });
      if (existingTelegram) {
        throw new ConflictError('Telegram аккаунт уже привязан к другому пользователю');
      }
    }

    // Хэшируем пароль
    const password_hash = await bcrypt.hash(password, 10);

    // Создаём пользователя
    const user = await models.User.create({
      username,
      password_hash,
      email: email || null,
      telegram_id: telegram_id || null,
      role: 'employee', // default role
      subscription_tier: 'free', // default tier
      timezone: 'Asia/Dubai',
      language: 'ru',
      is_active: true,
    });

    logger.info(`Новый пользователь зарегистрирован: ${username} (ID: ${user.id})`);

    // Генерируем токены
    const tokens = generateTokenPair(user.id, user.role);

    res.status(201).json({
      status: 'success',
      message: 'Регистрация успешна',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          subscription_tier: user.subscription_tier,
        },
        ...tokens,
      },
    });
  })
);

/**
 * POST /api/auth/login
 * Вход в систему
 */
router.post(
  '/login',
  authLimiter,
  validate(authSchemas.login),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    // Находим пользователя
    const user = await models.User.findOne({
      where: { username },
      attributes: [
        'id',
        'username',
        'password_hash',
        'email',
        'role',
        'subscription_tier',
        'is_active',
      ],
    });

    if (!user) {
      throw new AuthenticationError('Неверный username или пароль');
    }

    if (!user.is_active) {
      throw new AuthenticationError('Аккаунт деактивирован');
    }

    // Проверяем пароль
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      logger.warn(`Неудачная попытка входа: ${username}`);
      throw new AuthenticationError('Неверный username или пароль');
    }

    logger.info(`Пользователь вошёл в систему: ${username} (ID: ${user.id})`);

    // Генерируем токены
    const tokens = generateTokenPair(user.id, user.role);

    res.json({
      status: 'success',
      message: 'Вход выполнен успешно',
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          subscription_tier: user.subscription_tier,
        },
        ...tokens,
      },
    });
  })
);

/**
 * POST /api/auth/refresh
 * Обновление access токена через refresh токен
 */
router.post(
  '/refresh',
  validate(authSchemas.refresh),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    // Проверяем refresh токен
    const decoded = verifyRefreshToken(refreshToken);

    // Загружаем пользователя
    const user = await models.User.findByPk(decoded.userId, {
      attributes: ['id', 'username', 'role', 'is_active'],
    });

    if (!user) {
      throw new AuthenticationError('Пользователь не найден');
    }

    if (!user.is_active) {
      throw new AuthenticationError('Аккаунт деактивирован');
    }

    // Генерируем новую пару токенов
    const tokens = generateTokenPair(user.id, user.role);

    res.json({
      status: 'success',
      message: 'Токены обновлены',
      data: tokens,
    });
  })
);

/**
 * POST /api/auth/logout
 * Выход из системы (client-side - удаление токенов)
 * На backend нет state, так как JWT stateless
 */
router.post('/logout', (req, res) => {
  res.json({
    status: 'success',
    message: 'Выход выполнен. Удалите токены на клиенте.',
  });
});

/**
 * GET /api/auth/me
 * Получить информацию о текущем пользователе
 * Требует аутентификации
 */
import { authenticate } from '../middleware/auth.js';

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    // req.user уже установлен в authenticate middleware
    res.json({
      status: 'success',
      data: {
        user: {
          id: req.user.id,
          username: req.user.username,
          email: req.user.email,
          telegram_id: req.user.telegram_id,
          role: req.user.role,
          subscription_tier: req.user.subscription_tier,
          timezone: req.user.timezone,
          language: req.user.language,
          is_active: req.user.is_active,
        },
      },
    });
  })
);

export default router;
