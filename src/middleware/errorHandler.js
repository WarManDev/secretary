import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

/**
 * Обработчик ошибок Zod валидации
 */
const handleZodError = (error) => {
  const errors = error.issues.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
  }));

  return {
    statusCode: 400,
    status: 'fail',
    message: 'Ошибка валидации данных',
    errors,
  };
};

/**
 * Обработчик ошибок Sequelize
 */
const handleSequelizeError = (error) => {
  // Unique constraint violation
  if (error.name === 'SequelizeUniqueConstraintError') {
    const field = error.errors[0]?.path || 'поле';
    return {
      statusCode: 409,
      status: 'fail',
      message: `Значение ${field} уже существует`,
    };
  }

  // Foreign key constraint
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return {
      statusCode: 400,
      status: 'fail',
      message: 'Недопустимая ссылка на связанные данные',
    };
  }

  // Validation error
  if (error.name === 'SequelizeValidationError') {
    const errors = error.errors.map((err) => ({
      field: err.path,
      message: err.message,
    }));
    return {
      statusCode: 400,
      status: 'fail',
      message: 'Ошибка валидации данных',
      errors,
    };
  }

  return null;
};

/**
 * Обработчик JWT ошибок
 */
const handleJWTError = (error) => {
  if (error.name === 'JsonWebTokenError') {
    return {
      statusCode: 401,
      status: 'fail',
      message: 'Неверный токен аутентификации',
    };
  }

  if (error.name === 'TokenExpiredError') {
    return {
      statusCode: 401,
      status: 'fail',
      message: 'Токен аутентификации истёк',
    };
  }

  return null;
};

/**
 * Глобальный обработчик ошибок
 */
const errorHandler = (err, req, res, next) => {
  // Защита от null/undefined errors
  if (!err) {
    err = new Error('Неизвестная ошибка');
  }

  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  // Логирование ошибки
  if (err.isOperational || config.isDevelopment) {
    logger.error({
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id,
    });
  } else {
    // Критическая неожиданная ошибка
    logger.error('КРИТИЧЕСКАЯ ОШИБКА:', {
      error: err,
      stack: err.stack,
    });
  }

  // Обработка специфичных типов ошибок
  let response;

  if (err instanceof ZodError) {
    response = handleZodError(err);
  } else if (err.name?.startsWith('Sequelize')) {
    response = handleSequelizeError(err);
  } else if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    response = handleJWTError(err);
  } else if (err instanceof AppError) {
    // Наши кастомные ошибки
    response = {
      statusCode: err.statusCode,
      status: err.status,
      message: err.message,
      ...(err.details && { details: err.details }),
    };
  } else {
    // Неизвестная ошибка - не раскрываем детали в production
    response = {
      statusCode: 500,
      status: 'error',
      message: config.isDevelopment ? err.message : 'Внутренняя ошибка сервера',
    };
  }

  // Добавляем stack trace только в development
  if (config.isDevelopment) {
    response.stack = err.stack;
  }

  res.status(response.statusCode).json(response);
};

/**
 * Обработчик несуществующих роутов (404)
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    status: 'fail',
    message: `Роут ${req.originalUrl} не найден`,
  });
};

/**
 * Wrapper для async функций - автоматически передаёт ошибки в errorHandler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export { errorHandler, notFoundHandler, asyncHandler };
