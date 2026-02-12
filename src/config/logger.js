import winston from 'winston';

const { combine, timestamp, printf, colorize, simple } = winston.format;

// Кастомный формат для логов
const customFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

// Определяем транспорты в зависимости от окружения
const transports = [];

if (process.env.NODE_ENV === 'production') {
  // Production: JSON формат, файловые логи с ротацией
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), winston.format.json()),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(timestamp(), winston.format.json()),
    })
  );
} else {
  // Development: colorized console
  transports.push(
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), customFormat),
    })
  );
}

// Создаём singleton logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports,
});

export default logger;
