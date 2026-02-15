import { Op } from 'sequelize';
import logger from '../config/logger.js';
import models from '../models/index.js';

/**
 * ReminderScheduler — проверяет БД каждые 30 секунд
 * и отправляет напоминания в Telegram.
 *
 * Используется динамический импорт бота чтобы избежать
 * циклических зависимостей (bot → messageProcessor → models, scheduler → bot).
 */

let botInstance = null;
let intervalId = null;

/**
 * Получаем инстанс Telegram бота (lazy load)
 */
async function getBot() {
  if (!botInstance) {
    const module = await import('./telegramBot.js');
    botInstance = module.default;
  }
  return botInstance;
}

/**
 * Вычисляет следующую дату для recurring напоминания
 */
function getNextOccurrence(currentDate, rule) {
  const next = new Date(currentDate);

  switch (rule) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      return null;
  }

  return next;
}

/**
 * Главная функция — проверяет и отправляет напоминания
 */
async function checkAndSendReminders() {
  try {
    // Находим все неотправленные напоминания, время которых наступило
    const dueReminders = await models.Reminder.findAll({
      where: {
        is_sent: false,
        remind_at: { [Op.lte]: new Date() },
      },
      include: [{ model: models.User, attributes: ['id', 'telegram_id'] }],
    });

    if (dueReminders.length === 0) return;

    const bot = await getBot();

    for (const reminder of dueReminders) {
      try {
        const telegramId = reminder.User?.telegram_id;
        if (!telegramId) {
          logger.warn(`Reminder ${reminder.id}: у пользователя ${reminder.user_id} нет telegram_id`);
          await reminder.update({ is_sent: true });
          continue;
        }

        // Отправляем напоминание в Telegram
        await bot.sendMessage(
          telegramId,
          `🔔 Напоминание:\n\n${reminder.text}`
        );

        logger.info(`Напоминание отправлено: id=${reminder.id}, user=${reminder.user_id}`);

        if (reminder.is_recurring && reminder.recurrence_rule) {
          // Для recurring — вычисляем следующее время и обновляем
          const nextDate = getNextOccurrence(reminder.remind_at, reminder.recurrence_rule);
          if (nextDate) {
            await reminder.update({ remind_at: nextDate });
            logger.info(`Recurring напоминание ${reminder.id} перенесено на ${nextDate.toISOString()}`);
          } else {
            await reminder.update({ is_sent: true });
          }
        } else {
          // Одноразовое — помечаем как отправленное
          await reminder.update({ is_sent: true });
        }
      } catch (sendError) {
        logger.error(`Ошибка отправки напоминания ${reminder.id}:`, sendError.message);
        // Не помечаем как sent — попробуем ещё раз в следующем цикле
      }
    }
  } catch (error) {
    logger.error('Ошибка проверки напоминаний:', error.message);
  }
}

/**
 * Запускает планировщик (вызывается из server.js после подключения к БД)
 */
export function startReminderScheduler() {
  // Проверяем каждые 30 секунд
  intervalId = setInterval(checkAndSendReminders, 30 * 1000);

  // Первая проверка сразу при запуске
  checkAndSendReminders();

  logger.info('✓ Планировщик напоминаний запущен (интервал: 30 сек)');
}

/**
 * Останавливает планировщик (graceful shutdown)
 */
export function stopReminderScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('✓ Планировщик напоминаний остановлен');
  }
}
