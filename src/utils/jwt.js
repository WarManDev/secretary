import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { AuthenticationError } from './errors.js';

/**
 * Генерация access токена (короткий срок жизни)
 */
export const generateAccessToken = (userId, role) => {
  return jwt.sign(
    {
      userId,
      role,
      type: 'access',
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.accessExpiresIn, // 15 минут
      issuer: 'secretary-bot',
    }
  );
};

/**
 * Генерация refresh токена (долгий срок жизни)
 */
export const generateRefreshToken = (userId) => {
  return jwt.sign(
    {
      userId,
      type: 'refresh',
    },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn, // 30 дней
      issuer: 'secretary-bot',
    }
  );
};

/**
 * Генерация пары токенов (access + refresh)
 */
export const generateTokenPair = (userId, role) => {
  return {
    accessToken: generateAccessToken(userId, role),
    refreshToken: generateRefreshToken(userId),
  };
};

/**
 * Проверка access токена
 */
export const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    if (decoded.type !== 'access') {
      throw new AuthenticationError('Неверный тип токена');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AuthenticationError('Токен истёк. Обновите токен.');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new AuthenticationError('Неверный токен');
    }
    throw error;
  }
};

/**
 * Проверка refresh токена
 */
export const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret);

    if (decoded.type !== 'refresh') {
      throw new AuthenticationError('Неверный тип токена');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AuthenticationError('Refresh токен истёк. Необходима повторная авторизация.');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new AuthenticationError('Неверный refresh токен');
    }
    throw error;
  }
};

/**
 * Извлечение токена из заголовка Authorization
 */
export const extractTokenFromHeader = (authHeader) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Токен не предоставлен');
  }

  return authHeader.substring(7); // Убираем "Bearer "
};
