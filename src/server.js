import app from './app.js';
import config from './config/index.js';
import logger from './config/logger.js';
import { sequelize } from './models/index.js';

// Импортируем Telegram бот (side effect — запускает polling)
import './services/telegramBot.js';
import { startReminderScheduler, stopReminderScheduler } from './services/reminderScheduler.js';
import { startDigestScheduler, stopDigestScheduler } from './services/digestScheduler.js';

// Проверяем подключение к базе данных
async function connectDatabase() {
  try {
    await sequelize.authenticate();
    logger.info('✓ База данных: подключение успешно установлено');

    // ВРЕМЕННО: Sync для development чтобы применить изменения модели Event (end_date allowNull)
    // TODO: В Stage 1 перейти полностью на миграции
    if (config.isDevelopment) {
      await sequelize.sync({ alter: true });
      logger.info('✓ База данных: схема синхронизирована (alter mode)');
    }

    logger.info('✓ База данных: готова к работе (используйте миграции для изменения схемы)');
  } catch (error) {
    logger.error('✗ База данных: ошибка подключения:', error);
    process.exit(1);
  }
}

// Запускаем сервер
const server = app.listen(config.port, async () => {
  await connectDatabase();
  startReminderScheduler();
  startDigestScheduler();
  logger.info(`✓ Сервер запущен на порту ${config.port}`);
  logger.info(`✓ Окружение: ${config.env}`);
});

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown уже в процессе, ожидайте...');
    return;
  }

  isShuttingDown = true;
  logger.info(`Получен сигнал ${signal}. Начинаю graceful shutdown...`);

  // 1. Прекращаем принимать новые подключения
  server.close(() => {
    logger.info('✓ HTTP сервер закрыт');
  });

  // 2. Ждём завершения активных запросов (таймаут 30 секунд)
  setTimeout(() => {
    logger.warn('⚠ Принудительное завершение по таймауту (30 сек)');
    process.exit(1);
  }, 30000);

  try {
    // 3. Останавливаем планировщики
    stopReminderScheduler();
    stopDigestScheduler();

    // 4. Закрываем соединение с БД
    await sequelize.close();
    logger.info('✓ Соединение с БД закрыто');

    // 4. Telegram bot polling будет остановлен автоматически при завершении процесса
    // (в будущем добавим явный bot.stopPolling() в Этапе 5)

    logger.info('✓ Graceful shutdown завершён');
    process.exit(0);
  } catch (error) {
    logger.error('✗ Ошибка при shutdown:', error);
    process.exit(1);
  }
}

// Обрабатываем сигналы остановки
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Обрабатываем необработанные ошибки
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});
