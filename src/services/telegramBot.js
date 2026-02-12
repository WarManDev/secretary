import TelegramBot from 'node-telegram-bot-api';
import config from '../config/index.js';
import logger from '../config/logger.js';
import models from '../models/index.js';
import messageProcessor from './messageProcessor.js';
import { convertOggToWav, speechToTextYandex } from './yandexSpeechService.js';

/**
 * Telegram Bot Integration
 *
 * Подключён к универсальному MessageProcessor
 * - Обработка текстовых сообщений
 * - Обработка голосовых сообщений (транскрипция Yandex SpeechKit)
 * - Автоматическая регистрация пользователей
 * - Сохранение истории в БД через SessionManager
 */

const bot = new TelegramBot(config.telegram.botToken, { polling: true });

logger.info('✓ Telegram Bot инициализирован');

/**
 * Получить или создать пользователя по telegram_id
 */
async function getOrCreateUser(telegramUser) {
  const { id: telegramId, username, first_name, last_name } = telegramUser;

  try {
    // Ищем пользователя по telegram_id
    let user = await models.User.findOne({
      where: { telegram_id: telegramId.toString() },
    });

    if (user) {
      return user;
    }

    // Создаём нового пользователя
    user = await models.User.create({
      telegram_id: telegramId.toString(),
      username: username || `user_${telegramId}`,
      email: null, // Telegram не даёт email
      password_hash: null, // Для Telegram пользователей не нужен
      role: 'user',
      subscription_tier: 'free',
      credits_balance: 50, // Даём 50 бесплатных сообщений
      credits_used_today: 0,
    });

    logger.info(`Новый пользователь зарегистрирован: telegram_id=${telegramId}, user_id=${user.id}`);

    // Отправляем приветствие
    await bot.sendMessage(
      telegramId,
      `👋 Привет${first_name ? `, ${first_name}` : ''}!\n\nЯ твой AI-секретарь. Могу помочь с:\n\n📝 Заметками\n✅ Задачами\n📅 Событиями в календаре\n\nПросто напиши что тебе нужно!`
    );

    return user;
  } catch (error) {
    logger.error('Ошибка getOrCreateUser:', error);
    throw error;
  }
}

/**
 * Обработчик текстовых сообщений
 */
async function handleTextMessage(msg) {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  try {
    // Получаем или создаём пользователя
    const user = await getOrCreateUser(msg.from);

    // Проверяем кредиты (если не admin)
    if (user.role !== 'admin') {
      const dailyLimit = user.subscription_tier === 'free' ? 50 : 500;

      if (user.credits_used_today >= dailyLimit) {
        await bot.sendMessage(
          chatId,
          `⚠️ Вы достигли дневного лимита сообщений (${dailyLimit}).\n\nОбновите подписку для увеличения лимита.`
        );
        return;
      }
    }

    // Обрабатываем через MessageProcessor
    const result = await messageProcessor.processMessage({
      userId: user.id,
      messageText,
      platform: 'telegram',
      messageType: 'text',
      metadata: {
        chat_id: chatId,
        telegram_user_id: msg.from.id,
        username: msg.from.username,
      },
    });

    // Увеличиваем счётчик использованных кредитов
    if (user.role !== 'admin') {
      await user.increment('credits_used_today');
    }

    // Отправляем ответ
    await bot.sendMessage(chatId, result.response);

    logger.info(`Telegram: сообщение обработано для user=${user.id}, chat=${chatId}`);
  } catch (error) {
    logger.error('Ошибка handleTextMessage:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте ещё раз.');
  }
}

/**
 * Обработчик голосовых сообщений
 */
async function handleVoiceMessage(msg) {
  const chatId = msg.chat.id;

  try {
    // Получаем или создаём пользователя
    const user = await getOrCreateUser(msg.from);

    // Проверяем кредиты
    if (user.role !== 'admin') {
      const dailyLimit = user.subscription_tier === 'free' ? 50 : 500;

      if (user.credits_used_today >= dailyLimit) {
        await bot.sendMessage(
          chatId,
          `⚠️ Вы достигли дневного лимита сообщений (${dailyLimit}).\n\nОбновите подписку для увеличения лимита.`
        );
        return;
      }
    }

    await bot.sendMessage(chatId, '🎤 Распознаю голос...');

    // Скачиваем голосовое сообщение
    const fileId = msg.voice.file_id;
    const fileUrl = await bot.getFileLink(fileId);

    const response = await fetch(fileUrl);
    const oggArrayBuffer = await response.arrayBuffer();
    const oggBuffer = Buffer.from(oggArrayBuffer);

    // Конвертируем OGG → WAV
    const wavBuffer = await convertOggToWav(oggBuffer);

    // Транскрибируем через Yandex SpeechKit
    const transcription = await speechToTextYandex(wavBuffer);

    if (!transcription || transcription.trim() === '') {
      await bot.sendMessage(chatId, '❌ Не удалось распознать речь. Попробуйте ещё раз.');
      return;
    }

    await bot.sendMessage(chatId, `📝 Распознано: "${transcription}"\n\n⏳ Обрабатываю...`);

    // Обрабатываем через MessageProcessor
    const result = await messageProcessor.processMessage({
      userId: user.id,
      messageText: transcription,
      platform: 'telegram',
      messageType: 'voice',
      metadata: {
        chat_id: chatId,
        telegram_user_id: msg.from.id,
        username: msg.from.username,
        voice_file_id: fileId,
      },
    });

    // Увеличиваем счётчик использованных кредитов
    if (user.role !== 'admin') {
      await user.increment('credits_used_today');
    }

    // Отправляем ответ
    await bot.sendMessage(chatId, result.response);

    logger.info(`Telegram: голосовое сообщение обработано для user=${user.id}, chat=${chatId}`);
  } catch (error) {
    logger.error('Ошибка handleVoiceMessage:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при обработке голоса.');
  }
}

/**
 * Основной обработчик всех сообщений
 */
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Логируем chat_id (полезно для настройки BOSS_CHAT_ID)
  if (config.isDevelopment) {
    logger.debug(`Telegram message from chat_id: ${chatId}`);
  }

  // Текстовые сообщения
  if (msg.text) {
    await handleTextMessage(msg);
    return;
  }

  // Голосовые сообщения
  if (msg.voice) {
    await handleVoiceMessage(msg);
    return;
  }

  // Фото (пока не поддерживается)
  if (msg.photo) {
    await bot.sendMessage(chatId, '📷 Обработка фото будет добавлена в следующих версиях (Stage 6: Vision).');
    return;
  }

  // Неподдерживаемый тип
  await bot.sendMessage(chatId, '❓ Тип сообщения не поддерживается. Отправьте текст или голос.');
});

/**
 * Обработчик ошибок Telegram Bot
 */
bot.on('polling_error', (error) => {
  logger.error('Telegram polling error:', error);
});

export default bot;
