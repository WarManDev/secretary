import { Op } from 'sequelize';
import logger from '../config/logger.js';
import models from '../models/index.js';

/**
 * DigestScheduler — каждую минуту проверяет, нужно ли отправить
 * утренний дайджест кому-то из пользователей.
 *
 * Логика: для каждого пользователя с digest_enabled=true
 * проверяем, наступил ли его digest_hour в его таймзоне.
 * Отправляем не чаще одного раза в день (через поле last_digest_sent).
 */

let botInstance = null;
let intervalId = null;

// Трекинг: кому уже отправлено сегодня (в памяти, сбрасывается при перезапуске)
const sentToday = new Map(); // userId -> dateString

async function getBot() {
  if (!botInstance) {
    const module = await import('./telegramBot.js');
    botInstance = module.default;
  }
  return botInstance;
}

/**
 * Проверяет и отправляет дайджесты
 */
async function checkAndSendDigests() {
  try {
    const users = await models.User.findAll({
      where: {
        digest_enabled: true,
        telegram_id: { [Op.ne]: null },
        is_active: true,
      },
    });

    if (users.length === 0) return;

    const bot = await getBot();

    for (const user of users) {
      try {
        // Определяем текущее время в таймзоне пользователя
        const userNow = new Date(new Date().toLocaleString('en-US', { timeZone: user.timezone || 'UTC' }));
        const userHour = userNow.getHours();
        const userMinute = userNow.getMinutes();
        const todayKey = `${user.id}-${userNow.toDateString()}`;

        // Отправляем в нужный час (± 5 минут)
        if (userHour !== user.digest_hour || userMinute > 5) continue;

        // Проверяем, не отправляли ли уже сегодня
        if (sentToday.get(todayKey)) continue;

        // Формируем дайджест
        const digest = await buildDigest(user.id);
        if (!digest) continue;

        await bot.sendMessage(user.telegram_id, digest, { parse_mode: 'Markdown' });
        sentToday.set(todayKey, true);

        logger.info(`Утренний дайджест отправлен: user=${user.id}`);

        // Очищаем старые записи (чтобы Map не рос бесконечно)
        cleanOldEntries();
      } catch (err) {
        logger.error(`Ошибка отправки дайджеста user=${user.id}:`, err.message);
      }
    }
  } catch (error) {
    logger.error('Ошибка проверки дайджестов:', error.message);
  }
}

/**
 * Собирает утренний дайджест для пользователя
 */
async function buildDigest(userId) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // События на сегодня
  const events = await models.Event.findAll({
    where: {
      user_id: userId,
      event_date: { [Op.gte]: todayStart, [Op.lt]: todayEnd },
    },
    order: [['event_date', 'ASC']],
  });

  // Активные задачи
  const tasks = await models.Task.findAll({
    where: {
      created_by: userId,
      status: { [Op.in]: ['pending', 'in_progress'] },
    },
    order: [['priority', 'ASC']],
    limit: 10,
  });

  // Напоминания на сегодня
  const reminders = await models.Reminder.findAll({
    where: {
      user_id: userId,
      is_sent: false,
      remind_at: { [Op.gte]: todayStart, [Op.lt]: todayEnd },
    },
    order: [['remind_at', 'ASC']],
  });

  // Если нет ничего — не отправляем
  if (events.length === 0 && tasks.length === 0 && reminders.length === 0) {
    return null;
  }

  let digest = '☀️ *Доброе утро! Вот твоя сводка на сегодня:*\n\n';

  if (events.length > 0) {
    digest += '📅 *События:*\n';
    for (const e of events) {
      const time = new Date(e.event_date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      digest += `  • ${time} — ${e.title}`;
      if (e.location) digest += ` 📍${e.location}`;
      digest += '\n';
    }
    digest += '\n';
  }

  if (tasks.length > 0) {
    const priorityIcons = { urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    digest += '✅ *Активные задачи:*\n';
    for (const t of tasks) {
      const icon = priorityIcons[t.priority] || '⚪';
      digest += `  ${icon} ${t.title}\n`;
    }
    digest += '\n';
  }

  if (reminders.length > 0) {
    digest += '🔔 *Напоминания:*\n';
    for (const r of reminders) {
      const time = new Date(r.remind_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      digest += `  • ${time} — ${r.text}\n`;
    }
    digest += '\n';
  }

  digest += '_Хорошего дня!_ 🚀';

  return digest;
}

/**
 * Удаляем вчерашние записи из sentToday
 */
function cleanOldEntries() {
  const today = new Date().toDateString();
  for (const [key] of sentToday) {
    if (!key.endsWith(today)) {
      sentToday.delete(key);
    }
  }
}

/**
 * Запускает планировщик дайджестов (каждые 60 секунд)
 */
export function startDigestScheduler() {
  intervalId = setInterval(checkAndSendDigests, 60 * 1000);
  logger.info('✓ Планировщик утренних дайджестов запущен (интервал: 60 сек)');
}

/**
 * Останавливает планировщик
 */
export function stopDigestScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('✓ Планировщик дайджестов остановлен');
  }
}
