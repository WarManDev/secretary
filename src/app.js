import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config/index.js';
import logger from './config/logger.js';
import models from './models/index.js';

// Routers
import gcalAuthRouter from './routes/gcalAuthRouter.js';
import authRouter from './routes/authRouter.js';
import userRouter from './routes/userRouter.js';
import noteRouter from './routes/noteRouter.js';
import eventRouter from './routes/eventRouter.js';
import taskRouter from './routes/taskRouter.js';

// Middleware
import { authenticate } from './middleware/auth.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

// -------------------------
// Security Middleware
// -------------------------

// Helmet - устанавливает security headers
app.use(
  helmet({
    contentSecurityPolicy: config.isProduction ? undefined : false, // Отключаем в dev для удобства
  })
);

// CORS - разрешаем cross-origin запросы
app.use(
  cors({
    origin: config.isProduction
      ? [
          'https://your-production-domain.com',
          // Добавьте ваши production домены
        ]
      : '*', // В dev разрешаем всё
    credentials: true,
  })
);

// General rate limiting
app.use(generalLimiter);

// -------------------------
// Body Parsing Middleware
// -------------------------

app.use(express.json({ limit: '10mb' })); // JSON с лимитом размера
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -------------------------
// Request Logging (development)
// -------------------------

if (config.isDevelopment) {
  app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`, {
      query: req.query,
      ip: req.ip,
    });
    next();
  });
}

// -------------------------
// Health Check (без аутентификации)
// -------------------------

app.get('/api/health', async (req, res) => {
  try {
    // Проверяем подключение к БД
    await models.sequelize.authenticate();

    res.json({
      status: 'OK',
      timestamp: new Date(),
      environment: config.env,
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date(),
      database: 'disconnected',
      error: error.message,
    });
  }
});

// -------------------------
// API Routes
// -------------------------

app.use('/api/auth', authRouter);
app.use('/api/gcal', gcalAuthRouter);

// Protected API routes - требуют JWT аутентификации
app.use('/api/users', authenticate, userRouter);
app.use('/api/notes', authenticate, noteRouter);
app.use('/api/events', authenticate, eventRouter);
app.use('/api/tasks', authenticate, taskRouter);

// -------------------------
// Error Handling
// -------------------------

// 404 handler - должен быть после всех роутов
app.use(notFoundHandler);

// Глобальный error handler - должен быть последним
app.use(errorHandler);

export default app;
