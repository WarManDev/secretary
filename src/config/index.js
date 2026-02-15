import { z } from 'zod';
import dotenv from 'dotenv';

// Загружаем .env файл
dotenv.config();

// Zod схема для валидации переменных окружения
const configSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  APP_URL: z.string().optional(), // http://localhost:3000 или https://your-domain.com
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),

  // Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN обязателен'),
  BOSS_CHAT_ID: z.string().optional(),

  // OpenAI (legacy, будет заменён на Claude)
  OPENAI_API_KEY: z.string().optional(),

  // Anthropic Claude API (будущее)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Google Calendar
  GCAL_CLIENT_ID: z.string().optional(),
  GCAL_CLIENT_SECRET: z.string().optional(),
  GCAL_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_ACCESS_TOKEN: z.string().optional(),

  // Yandex SpeechKit
  YANDEX_API_KEY: z.string().min(1, 'YANDEX_API_KEY обязателен'),

  // JWT Authentication (этап 2)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть минимум 32 символа'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET должен быть минимум 32 символа'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Token encryption (будущее - этап 2)
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  // Yandex Weather
  YANDEX_WEATHER_API_KEY: z.string().optional(),

  // Stripe (будущее - этап 8)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

// Валидируем переменные окружения
let config;

try {
  config = configSchema.parse(process.env);
} catch (error) {
  console.error('❌ Ошибка валидации конфигурации:');
  if (error instanceof z.ZodError) {
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  }
  console.error('\n💡 Проверьте файл .env и убедитесь что все обязательные переменные заданы.');
  process.exit(1);
}

// Экспортируем типизированную конфигурацию
export default {
  env: config.NODE_ENV,
  port: config.PORT,
  appUrl: config.APP_URL || `http://localhost:${config.PORT}`,
  logLevel: config.LOG_LEVEL,
  isDevelopment: config.NODE_ENV === 'development',
  isProduction: config.NODE_ENV === 'production',
  isTest: config.NODE_ENV === 'test',

  database: {
    url: config.DATABASE_URL,
  },

  telegram: {
    botToken: config.TELEGRAM_BOT_TOKEN,
    bossChatId: config.BOSS_CHAT_ID,
  },

  openai: {
    apiKey: config.OPENAI_API_KEY,
  },

  anthropic: {
    apiKey: config.ANTHROPIC_API_KEY,
  },

  google: {
    calendar: {
      clientId: config.GCAL_CLIENT_ID,
      clientSecret: config.GCAL_CLIENT_SECRET,
      refreshToken: config.GCAL_REFRESH_TOKEN,
      accessToken: config.GOOGLE_ACCESS_TOKEN,
    },
  },

  yandex: {
    apiKey: config.YANDEX_API_KEY,
    weatherApiKey: config.YANDEX_WEATHER_API_KEY,
  },

  jwt: {
    secret: config.JWT_SECRET,
    refreshSecret: config.JWT_REFRESH_SECRET,
    accessExpiresIn: config.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: config.JWT_REFRESH_EXPIRES_IN,
  },

  encryption: {
    key: config.TOKEN_ENCRYPTION_KEY,
  },

  stripe: {
    secretKey: config.STRIPE_SECRET_KEY,
    webhookSecret: config.STRIPE_WEBHOOK_SECRET,
  },
};
