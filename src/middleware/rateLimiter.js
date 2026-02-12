import rateLimit from 'express-rate-limit';
import config from '../config/index.js';

/**
 * Общий rate limiter для всех запросов
 * 100 запросов в 15 минут с одного IP
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100,
  message: {
    status: 'fail',
    message: 'Слишком много запросов с вашего IP. Попробуйте через 15 минут.',
  },
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,
  skip: () => config.isTest, // Пропускаем в тестах
});

/**
 * Строгий limiter для авторизации
 * 5 попыток входа в 15 минут
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    status: 'fail',
    message: 'Слишком много попыток входа. Попробуйте через 15 минут или восстановите пароль.',
  },
  skipSuccessfulRequests: true, // Не считаем успешные логины
  skip: () => config.isTest,
});

/**
 * Limiter для регистрации
 * 3 регистрации в час с одного IP
 */
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 3,
  message: {
    status: 'fail',
    message: 'Слишком много регистраций с вашего IP. Попробуйте через час.',
  },
  skip: () => config.isTest,
});

/**
 * Limiter для AI запросов (применяется по subscription tier)
 * Вызывается вручную в контроллерах, не как middleware
 */
export const createAILimiter = (maxRequests, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    message: {
      status: 'fail',
      message: `Превышен лимит AI запросов для вашего тарифа. Доступно ${maxRequests} запросов в ${windowMinutes} минут.`,
    },
    keyGenerator: (req) => {
      // ВАЖНО: AI endpoints должны быть за authenticate middleware
      // req.user всегда доступен
      return `user:${req.user.id}`;
    },
    skip: (req) => {
      // Enterprise - безлимит
      return config.isTest || req.user?.subscription_tier === 'enterprise';
    },
  });
};

/**
 * AI limiters по тарифам
 */
export const aiLimiters = {
  // Free: 50 сообщений в день
  free: createAILimiter(50, 24 * 60),

  // Professional: 500 сообщений в день
  professional: createAILimiter(500, 24 * 60),

  // Business: 2000 сообщений в день
  business: createAILimiter(2000, 24 * 60),

  // Enterprise: без лимитов (skip = true)
};

/**
 * Middleware для применения AI rate limit по тарифу пользователя
 */
export const aiRateLimiter = (req, res, next) => {
  const tier = req.user?.subscription_tier || 'free';
  const limiter = aiLimiters[tier] || aiLimiters.free;

  return limiter(req, res, next);
};
