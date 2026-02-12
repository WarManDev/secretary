/**
 * Базовый класс для всех кастомных ошибок приложения
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Ошибка валидации данных (400)
 */
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400);
    this.details = details; // zod error details
  }
}

/**
 * Ошибка аутентификации (401)
 */
class AuthenticationError extends AppError {
  constructor(message = 'Требуется аутентификация') {
    super(message, 401);
  }
}

/**
 * Ошибка авторизации/доступа (403)
 */
class AuthorizationError extends AppError {
  constructor(message = 'Недостаточно прав доступа') {
    super(message, 403);
  }
}

/**
 * Ресурс не найден (404)
 */
class NotFoundError extends AppError {
  constructor(resource = 'Ресурс') {
    super(`${resource} не найден`, 404);
  }
}

/**
 * Конфликт данных (409)
 * Например: username уже существует
 */
class ConflictError extends AppError {
  constructor(message) {
    super(message, 409);
  }
}

/**
 * Превышен лимит запросов (429)
 */
class RateLimitError extends AppError {
  constructor(message = 'Слишком много запросов. Попробуйте позже.') {
    super(message, 429);
  }
}

export {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
};
