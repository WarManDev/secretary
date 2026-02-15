import TelegramBot from 'node-telegram-bot-api';
import config from '../config/index.js';
import logger from '../config/logger.js';
import models from '../models/index.js';
import messageProcessor from './messageProcessor.js';
import { speechToTextYandex, textToSpeechYandex } from './yandexSpeechService.js';

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
      role: 'employee', // Допустимые значения: 'admin', 'boss', 'employee'
      subscription_tier: 'free',
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
 * Обработчик команды /calendar — подключение Google Calendar
 */
async function handleCalendarCommand(msg) {
  const chatId = msg.chat.id;

  try {
    const user = await getOrCreateUser(msg.from);
    const authUrl = `${config.appUrl}/api/gcal/auth?userId=${user.id}`;

    if (user.google_refresh_token) {
      // Уже подключён
      await bot.sendMessage(
        chatId,
        `✅ Google Calendar подключён!\n\nЯ создаю события в твоём календаре автоматически.\n\n🔄 Переподключить: ${authUrl}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отключить календарь', callback_data: 'gcal_disconnect' }],
            ],
          },
        }
      );
    } else {
      // Не подключён
      const isLocalhost = authUrl.includes('localhost');
      const text = isLocalhost
        ? `📅 Google Calendar не подключён.\n\nОткрой эту ссылку в браузере:\n\n${authUrl}`
        : `📅 Google Calendar не подключён.\n\nНажми чтобы авторизовать доступ:`;

      const options = isLocalhost
        ? {}
        : { reply_markup: { inline_keyboard: [[{ text: '🔗 Подключить Google Calendar', url: authUrl }]] } };

      await bot.sendMessage(chatId, text, options);
    }
  } catch (error) {
    logger.error('Ошибка handleCalendarCommand:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте ещё раз.');
  }
}

/**
 * Обработчик текстовых сообщений
 */
async function handleTextMessage(msg) {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  try {
    // Перехватываем команду /calendar
    if (messageText === '/calendar') {
      return handleCalendarCommand(msg);
    }

    // Получаем или создаём пользователя
    const user = await getOrCreateUser(msg.from);

    // TODO: Проверка кредитов будет добавлена в Stage 8 (Monetization)
    // Сейчас credits_used_today и credits_balance отсутствуют в модели User

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

    // TODO: Проверка кредитов будет добавлена в Stage 8 (Monetization)

    await bot.sendMessage(chatId, '🎤 Распознаю голос...');

    // Скачиваем голосовое сообщение (Telegram отправляет в OGG/Opus)
    const fileId = msg.voice.file_id;
    const fileUrl = await bot.getFileLink(fileId);

    const response = await fetch(fileUrl);
    const oggArrayBuffer = await response.arrayBuffer();
    const oggBuffer = Buffer.from(oggArrayBuffer);

    // Отправляем OGG напрямую в Yandex (без конвертации — сохраняем качество)
    const transcription = await speechToTextYandex(oggBuffer, 'oggopus');

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

    // Отправляем текстовый ответ
    await bot.sendMessage(chatId, result.response);

    // Отправляем голосовой ответ (TTS) — секретарь отвечает голосом на голос
    try {
      const voiceBuffer = await textToSpeechYandex(result.response);
      if (voiceBuffer) {
        await bot.sendVoice(chatId, voiceBuffer, {}, { filename: 'response.ogg', contentType: 'audio/ogg' });
      }
    } catch (ttsError) {
      logger.warn('TTS ответ не удался:', ttsError.message);
    }

    logger.info(`Telegram: голосовое сообщение обработано для user=${user.id}, chat=${chatId}`);
  } catch (error) {
    logger.error('Ошибка handleVoiceMessage:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при обработке голоса.');
  }
}

/**
 * Обработчик фото (Stage 6: Vision)
 */
async function handlePhotoMessage(msg) {
  const chatId = msg.chat.id;

  try {
    const user = await getOrCreateUser(msg.from);

    await bot.sendMessage(chatId, '📷 Анализирую фото...');

    // Telegram отдаёт массив размеров — берём максимальный (последний)
    const photo = msg.photo[msg.photo.length - 1];
    const fileUrl = await bot.getFileLink(photo.file_id);

    // Скачиваем изображение
    const response = await fetch(fileUrl);
    const imageArrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);

    // Обрабатываем через MessageProcessor (caption как текст, фото как imageBuffer)
    const result = await messageProcessor.processMessage({
      userId: user.id,
      messageText: msg.caption || '',
      platform: 'telegram',
      messageType: 'photo',
      imageBuffer,
      metadata: {
        chat_id: chatId,
        telegram_user_id: msg.from.id,
        username: msg.from.username,
        photo_file_id: photo.file_id,
      },
    });

    await bot.sendMessage(chatId, result.response);

    logger.info(`Telegram: фото обработано для user=${user.id}, chat=${chatId}`);
  } catch (error) {
    logger.error('Ошибка handlePhotoMessage:', error);
    await bot.sendMessage(chatId, '❌ Произошла ошибка при обработке фото.');
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

  // Фото (Stage 6: Vision)
  if (msg.photo) {
    await handlePhotoMessage(msg);
    return;
  }

  // Неподдерживаемый тип
  await bot.sendMessage(chatId, '❓ Тип сообщения не поддерживается. Отправьте текст или голос.');
});

/**
 * Обработчик inline-кнопок (callback_query)
 */
bot.on('callback_query', async (query) => {
  try {
    if (query.data === 'gcal_disconnect') {
      const user = await getOrCreateUser(query.from);

      await user.update({
        google_refresh_token: null,
        google_access_token: null,
        google_token_expiry: null,
      });

      await bot.answerCallbackQuery(query.id, { text: 'Google Calendar отключён' });
      await bot.sendMessage(query.message.chat.id, '📅 Google Calendar отключён. Используй /calendar чтобы подключить снова.');

      logger.info(`Google Calendar отключён для user=${user.id}`);
    }
  } catch (error) {
    logger.error('Ошибка callback_query:', error);
    await bot.answerCallbackQuery(query.id, { text: 'Ошибка' });
  }
});

/**
 * Обработчик ошибок Telegram Bot
 */
bot.on('polling_error', (error) => {
  logger.error('Telegram polling error:', error);
});

export default bot;
