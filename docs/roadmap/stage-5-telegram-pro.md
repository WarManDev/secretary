# Этап 5: Telegram Pro -- модернизация Telegram-клиента

> **Срок:** 3-4 дня
> **Зависимости:** Этап 3 (Универсальный API) + Этап 4 (Миграция на Claude)
> **Статус:** [ ] Не начат
>
> **Цель:** Разбить монолитный `telegramBot.js` (442 строки) на модульные обработчики,
> добавить inline-клавиатуры, команды бота, голосовые ответы (TTS), обработку фотографий
> (Claude Vision) и режим компаньона.
>
> **Ключевой принцип:** Telegram-слой знает ТОЛЬКО о Telegram API. Вся бизнес-логика
> находится в `messageProcessor.js`. Каждый обработчик конвертирует Telegram-данные
> в `UnifiedMessage` и передает в ядро, затем отправляет ответ обратно в Telegram.

---

## Оглавление

1. [Разделение монолита](#1-разделение-монолита)
2. [Инициализация бота](#2-инициализация-бота)
3. [Команды бота](#3-команды-бота)
4. [Inline-клавиатуры](#4-inline-клавиатуры)
5. [Голосовые ответы (TTS)](#5-голосовые-ответы-tts)
6. [Обработка фото (Claude Vision)](#6-обработка-фото-claude-vision)
7. [Режим компаньона](#7-режим-компаньона)
8. [Рефакторинг morningDigest](#8-рефакторинг-morningdigest)
9. [Рефакторинг STT](#9-рефакторинг-stt)
10. [Регистрация через Telegram](#10-регистрация-через-telegram)
11. [Сервис уведомлений](#11-сервис-уведомлений)
12. [Чеклист готовности](#12-чеклист-готовности)

---

## 1. Разделение монолита

### Проблемы текущего telegramBot.js (442 строки)

Весь код находится в одном файле `services/telegramBot.js`:

```
services/telegramBot.js (442 строки) -- ТЕКУЩЕЕ СОСТОЯНИЕ:
├── chatHistories = {} (строка 29)         -- memory leak
├── handleGPTResponse() (строки 32-370)    -- 340 строк бизнес-логики
│   ├── case "event" (строки 48-252)       -- создание/обновление/удаление событий
│   ├── case "note" (строки 253-319)       -- CRUD заметок
│   ├── case "show_events" (строки 321-357)-- показ событий
│   ├── case "task" (строки 359-361)       -- заглушка
│   └── case "chat" (строки 363-366)       -- текстовый ответ
├── bot.on('message') (строки 373-438)     -- единый обработчик
│   ├── msg.voice (строки 382-418)         -- голосовые
│   └── msg.text (строки 421-435)          -- текстовые
└── hardcoded "Asia/Dubai" в 4+ местах     -- строки 102, 103, 208, 209
```

### Целевая структура

```
src/services/platforms/telegram/
├── bot.js                          -- Инициализация бота (единственный экземпляр)
├── handlers/
│   ├── messageHandler.js           -- Текстовые сообщения -> UnifiedMessage
│   ├── voiceHandler.js             -- Голосовые сообщения (STT + опциональный TTS)
│   ├── photoHandler.js             -- Фото (Claude Vision)
│   ├── commandHandler.js           -- /start, /help, /settings, /mode, /stats...
│   └── callbackHandler.js          -- Обработка inline keyboard callbacks
├── keyboards.js                    -- Построители inline-клавиатур
└── formatters.js                   -- Форматирование сообщений (Markdown, emoji)
```

### Принцип работы каждого обработчика

Каждый обработчик выполняет три действия:

1. **Принять** -- получить данные из Telegram (msg, callback_query)
2. **Конвертировать** -- создать `UnifiedMessage` из Telegram-данных
3. **Передать** -- отправить в `messageProcessor.js` и вернуть ответ в Telegram

Обработчик НЕ содержит бизнес-логики. Он не знает что такое "событие", "заметка" или "задача".

### Формат UnifiedMessage

`UnifiedMessage` определен на Этапе 3. Telegram-обработчики создают его так:

```js
// src/services/platforms/telegram/handlers/messageHandler.js

import { processMessage } from '../../../core/messageProcessor.js';
import { formatResponse } from '../formatters.js';

/**
 * Обрабатывает текстовые сообщения из Telegram.
 * Конвертирует в UnifiedMessage и передает в messageProcessor.
 *
 * @param {TelegramBot} bot - экземпляр бота
 * @param {Object} msg - объект сообщения от Telegram
 */
export async function handleTextMessage(bot, msg) {
  const chatId = msg.chat.id;

  // 1. Конвертируем Telegram-сообщение в UnifiedMessage
  const unifiedMessage = {
    userId: null,                    // будет определен по telegram_id
    telegramId: String(msg.from.id),
    text: msg.text,
    type: 'text',
    platform: 'telegram',
    attachments: [],
    metadata: {
      chatId: chatId,
      messageId: msg.message_id,
      firstName: msg.from.first_name,
      lastName: msg.from.last_name,
      username: msg.from.username,
      languageCode: msg.from.language_code,
    },
  };

  try {
    // 2. Отправляем "typing" индикатор
    await bot.sendChatAction(chatId, 'typing');

    // 3. Передаем в ядро обработки
    const result = await processMessage(unifiedMessage);

    // 4. Форматируем и отправляем ответ
    const formattedText = formatResponse(result.text);

    // 5. Если есть inline-клавиатура -- прикрепляем
    const options = { parse_mode: 'Markdown' };
    if (result.keyboard) {
      options.reply_markup = {
        inline_keyboard: result.keyboard,
      };
    }

    await bot.sendMessage(chatId, formattedText, options);

    // 6. Если пользователь выбрал голосовой режим -- дополнительно отправляем голос
    if (result.sendVoice && result.voiceBuffer) {
      await bot.sendVoice(chatId, result.voiceBuffer, {
        caption: 'Голосовой ответ',
      });
    }
  } catch (error) {
    console.error('[Telegram] Ошибка обработки текстового сообщения:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при обработке сообщения. Попробуйте позже.');
  }
}
```

### Обработчик голосовых сообщений

```js
// src/services/platforms/telegram/handlers/voiceHandler.js

import { processMessage } from '../../../core/messageProcessor.js';
import { speechToText } from '../../../integrations/yandexSpeech.js';
import { textToSpeech } from '../../../integrations/yandexTTS.js';
import { formatResponse } from '../formatters.js';

/**
 * Обрабатывает голосовые сообщения из Telegram.
 *
 * Текущие проблемы, которые исправлены:
 * - Двойное сообщение (распознанный текст + ответ GPT) -- теперь одно
 * - chatHistories в памяти -- теперь через messageProcessor -> sessionManager (БД)
 *
 * @param {TelegramBot} bot - экземпляр бота
 * @param {Object} msg - объект сообщения от Telegram
 */
export async function handleVoiceMessage(bot, msg) {
  const chatId = msg.chat.id;

  try {
    // 1. Скачиваем голосовой файл из Telegram
    const fileId = msg.voice.file_id;
    const fileUrl = await bot.getFileLink(fileId);

    const response = await fetch(fileUrl);
    const oggBuffer = Buffer.from(await response.arrayBuffer());

    // 2. STT: конвертируем голос в текст
    await bot.sendChatAction(chatId, 'typing');
    const transcription = await speechToText(oggBuffer);

    if (!transcription || transcription.trim() === '') {
      await bot.sendMessage(chatId, 'Не удалось распознать речь. Попробуйте ещё раз.');
      return;
    }

    // 3. Конвертируем в UnifiedMessage
    const unifiedMessage = {
      userId: null,
      telegramId: String(msg.from.id),
      text: transcription,
      type: 'voice',
      platform: 'telegram',
      attachments: [],
      metadata: {
        chatId: chatId,
        messageId: msg.message_id,
        originalFileId: fileId,
        duration: msg.voice.duration,
        firstName: msg.from.first_name,
        username: msg.from.username,
        languageCode: msg.from.language_code,
      },
    };

    // 4. Передаем в ядро
    const result = await processMessage(unifiedMessage);

    // 5. Отправляем текстовый ответ (НЕ отправляем "Распознанный текст: ..." отдельно!)
    // Вместо двух сообщений -- одно, с указанием что было распознано
    const replyText = `_Распознано:_ ${transcription}\n\n${formatResponse(result.text)}`;

    const options = { parse_mode: 'Markdown' };
    if (result.keyboard) {
      options.reply_markup = { inline_keyboard: result.keyboard };
    }
    await bot.sendMessage(chatId, replyText, options);

    // 6. Опционально: TTS -- отправляем голосовой ответ
    // Зависит от настройки пользователя (voice_mode)
    if (result.userSettings?.voice_mode === 'voice' || result.userSettings?.voice_mode === 'auto') {
      await bot.sendChatAction(chatId, 'upload_voice');
      const voiceBuffer = await textToSpeech(result.text);
      if (voiceBuffer) {
        await bot.sendVoice(chatId, voiceBuffer);
      }
    }
  } catch (error) {
    console.error('[Telegram] Ошибка обработки голосового сообщения:', error);
    await bot.sendMessage(chatId, 'Ошибка при обработке голосового сообщения. Попробуйте позже.');
  }
}
```

### Обработчик фотографий

```js
// src/services/platforms/telegram/handlers/photoHandler.js

import { processMessage } from '../../../core/messageProcessor.js';
import { formatResponse } from '../formatters.js';

/**
 * Обрабатывает фото-сообщения из Telegram.
 * Фото отправляется в Claude Vision для анализа.
 *
 * @param {TelegramBot} bot - экземпляр бота
 * @param {Object} msg - объект сообщения от Telegram
 */
export async function handlePhotoMessage(bot, msg) {
  const chatId = msg.chat.id;

  try {
    // 1. Telegram отправляет фото в нескольких размерах -- берем самый большой
    const photos = msg.photo;
    const largestPhoto = photos[photos.length - 1];
    const fileId = largestPhoto.file_id;

    // 2. Скачиваем файл
    const fileUrl = await bot.getFileLink(fileId);
    const response = await fetch(fileUrl);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const base64Image = imageBuffer.toString('base64');

    // 3. Определяем MIME-тип (Telegram фото обычно JPEG)
    const mimeType = 'image/jpeg';

    // 4. Текст подписи к фото (если есть)
    const caption = msg.caption || 'Что на этом изображении?';

    // 5. Конвертируем в UnifiedMessage
    const unifiedMessage = {
      userId: null,
      telegramId: String(msg.from.id),
      text: caption,
      type: 'photo',
      platform: 'telegram',
      attachments: [
        {
          type: 'image',
          mimeType: mimeType,
          base64: base64Image,
          fileId: fileId,
        },
      ],
      metadata: {
        chatId: chatId,
        messageId: msg.message_id,
        firstName: msg.from.first_name,
        username: msg.from.username,
        languageCode: msg.from.language_code,
      },
    };

    // 6. Передаем в ядро (messageProcessor передаст в Claude с изображением)
    await bot.sendChatAction(chatId, 'typing');
    const result = await processMessage(unifiedMessage);

    // 7. Отправляем ответ
    const formattedText = formatResponse(result.text);
    await bot.sendMessage(chatId, formattedText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('[Telegram] Ошибка обработки фото:', error);
    await bot.sendMessage(chatId, 'Ошибка при обработке изображения. Попробуйте позже.');
  }
}
```

---

## 2. Инициализация бота

### Файл: `src/services/platforms/telegram/bot.js`

Текущие проблемы:
- **telegramBot.js** создает экземпляр бота (строка 19: `new TelegramBot(token, { polling: true })`)
- **morningDigest.js** создает ВТОРОЙ экземпляр (строка 11: `new TelegramBot(token, { polling: false })`)
- Нет обработки `polling_error`
- Нет поддержки webhook для production

Решение -- единый модуль инициализации:

```js
// src/services/platforms/telegram/bot.js

import TelegramBot from 'node-telegram-bot-api';
import config from '../../../config/index.js';
import logger from '../../../config/logger.js';

// Handlers
import { handleTextMessage } from './handlers/messageHandler.js';
import { handleVoiceMessage } from './handlers/voiceHandler.js';
import { handlePhotoMessage } from './handlers/photoHandler.js';
import { registerCommands } from './handlers/commandHandler.js';
import { handleCallbackQuery } from './handlers/callbackHandler.js';

let bot = null;

/**
 * Инициализирует единственный экземпляр Telegram-бота.
 * Поддерживает два режима: polling (dev) и webhook (production).
 *
 * ВАЖНО: Этот модуль ЭКСПОРТИРУЕТ bot для использования в других сервисах
 * (digestService, notificationService). Никто не должен создавать второй экземпляр.
 *
 * @returns {TelegramBot} - экземпляр бота
 */
export function initTelegramBot() {
  if (bot) {
    logger.warn('[Telegram] Бот уже инициализирован. Возвращаем существующий экземпляр.');
    return bot;
  }

  const token = config.telegram.botToken;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан в переменных окружения.');
  }

  // --- Режим работы: polling (dev) или webhook (production) ---
  const isProduction = config.env === 'production';

  if (isProduction) {
    // WEBHOOK режим для production
    bot = new TelegramBot(token, { webHook: true });

    const webhookUrl = `${config.server.baseUrl}/api/v1/telegram/webhook`;
    bot.setWebHook(webhookUrl)
      .then(() => logger.info(`[Telegram] Webhook установлен: ${webhookUrl}`))
      .catch((err) => logger.error('[Telegram] Ошибка установки webhook:', err));
  } else {
    // POLLING режим для разработки
    bot = new TelegramBot(token, { polling: true });
    logger.info('[Telegram] Бот запущен в режиме polling.');
  }

  // --- Обработка ошибок polling ---
  // ИСПРАВЛЕНИЕ: В текущем коде нет bot.on('polling_error')
  bot.on('polling_error', (error) => {
    logger.error('[Telegram] Polling error:', {
      code: error.code,
      message: error.message,
      // ETELEGRAM: ошибка от Telegram API
      // EFATAL: фатальная ошибка (невалидный токен)
      // EPARSE: ошибка парсинга ответа
    });

    // При невалидном токене -- не пытаемся переподключиться
    if (error.code === 'EFATAL') {
      logger.error('[Telegram] Фатальная ошибка. Проверьте TELEGRAM_BOT_TOKEN.');
      process.exit(1);
    }
  });

  bot.on('webhook_error', (error) => {
    logger.error('[Telegram] Webhook error:', error);
  });

  // --- Регистрация обработчиков ---
  registerHandlers(bot);

  return bot;
}

/**
 * Регистрирует все обработчики сообщений.
 */
function registerHandlers(bot) {
  // 1. Регистрация команд (/start, /help, /settings и т.д.)
  registerCommands(bot);

  // 2. Обработка callback_query (inline-клавиатуры)
  bot.on('callback_query', (query) => handleCallbackQuery(bot, query));

  // 3. Обработка сообщений (текст, голос, фото)
  bot.on('message', async (msg) => {
    // Пропускаем команды -- они обрабатываются в commandHandler
    if (msg.text && msg.text.startsWith('/')) {
      return;
    }

    // Голосовое сообщение
    if (msg.voice) {
      return handleVoiceMessage(bot, msg);
    }

    // Фото
    if (msg.photo) {
      return handlePhotoMessage(bot, msg);
    }

    // Текстовое сообщение
    if (msg.text) {
      return handleTextMessage(bot, msg);
    }

    // Документы, стикеры и прочее -- пока не поддерживаем
    await bot.sendMessage(
      msg.chat.id,
      'Этот тип сообщений пока не поддерживается. Отправьте текст, голосовое или фото.'
    );
  });

  logger.info('[Telegram] Обработчики зарегистрированы.');
}

/**
 * Возвращает текущий экземпляр бота.
 * Используется в digestService, notificationService и других модулях
 * для отправки сообщений без создания нового экземпляра.
 *
 * @returns {TelegramBot|null}
 */
export function getBotInstance() {
  return bot;
}

/**
 * Останавливает бота (для graceful shutdown).
 */
export async function stopTelegramBot() {
  if (bot) {
    if (bot.isPolling()) {
      await bot.stopPolling();
      logger.info('[Telegram] Polling остановлен.');
    }
    bot = null;
  }
}

export default { initTelegramBot, getBotInstance, stopTelegramBot };
```

### Подключение webhook в Express (production)

В production режиме нужен endpoint для приема webhook от Telegram:

```js
// Фрагмент для src/routes/index.js (или отдельный routes/telegram.routes.js)

import { getBotInstance } from '../services/platforms/telegram/bot.js';

// Endpoint для Telegram webhook
router.post('/api/v1/telegram/webhook', (req, res) => {
  const bot = getBotInstance();
  if (bot) {
    bot.processUpdate(req.body);
  }
  res.sendStatus(200);
});
```

---

## 3. Команды бота

### Файл: `src/services/platforms/telegram/handlers/commandHandler.js`

Текущее состояние: команды отсутствуют. Бот не реагирует на `/start`, `/help` и т.д.

```js
// src/services/platforms/telegram/handlers/commandHandler.js

import logger from '../../../../config/logger.js';
import { findOrCreateUserByTelegramId } from '../../../core/userService.js';
import {
  mainMenuKeyboard,
  settingsKeyboard,
  modeKeyboard,
} from '../keyboards.js';

/**
 * Регистрирует все команды бота.
 *
 * Список команд:
 * /start    -- Регистрация или приветствие + главное меню
 * /help     -- Справка по возможностям
 * /settings -- Настройки (часовой пояс, язык, голос)
 * /mode     -- Переключение режима (работа / компаньон)
 * /stats    -- Статистика использования
 * /calendar -- Быстрый просмотр событий на сегодня
 * /tasks    -- Быстрый просмотр задач
 *
 * @param {TelegramBot} bot
 */
export function registerCommands(bot) {
  // Регистрируем команды в меню Telegram (кнопка "/" у поля ввода)
  bot.setMyCommands([
    { command: 'start', description: 'Начать работу / Главное меню' },
    { command: 'help', description: 'Справка по возможностям' },
    { command: 'settings', description: 'Настройки бота' },
    { command: 'mode', description: 'Режим: работа / компаньон' },
    { command: 'stats', description: 'Статистика использования' },
    { command: 'calendar', description: 'События на сегодня' },
    { command: 'tasks', description: 'Текущие задачи' },
  ]).catch((err) => logger.error('[Telegram] Ошибка setMyCommands:', err));

  // --- /start ---
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
      // Находим или создаем пользователя
      const { user, isNew } = await findOrCreateUserByTelegramId({
        telegramId,
        firstName: msg.from.first_name,
        lastName: msg.from.last_name,
        username: msg.from.username,
        languageCode: msg.from.language_code,
      });

      if (isNew) {
        // Новый пользователь -- приветствие с онбордингом
        const welcome =
          `Привет, ${msg.from.first_name}! Я -- Secretary Bot, твой AI-секретарь.\n\n` +
          `Я умею:\n` +
          `-- Управлять календарем (создавать, изменять, удалять события)\n` +
          `-- Вести заметки и задачи\n` +
          `-- Распознавать голосовые сообщения\n` +
          `-- Анализировать фотографии\n` +
          `-- Отправлять утренний дайджест\n\n` +
          `Просто напиши мне, что нужно сделать, в свободной форме!\n\n` +
          `Настрой часовой пояс в /settings, чтобы события были в правильном времени.`;

        await bot.sendMessage(chatId, welcome, {
          reply_markup: { inline_keyboard: mainMenuKeyboard() },
        });
      } else {
        // Существующий пользователь -- приветствие + меню
        const welcomeBack =
          `С возвращением, ${msg.from.first_name}!\n` +
          `Чем могу помочь?`;

        await bot.sendMessage(chatId, welcomeBack, {
          reply_markup: { inline_keyboard: mainMenuKeyboard() },
        });
      }
    } catch (error) {
      logger.error('[Telegram] Ошибка /start:', error);
      await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
  });

  // --- /help ---
  bot.onText(/\/help/, async (msg) => {
    const helpText =
      `*Secretary Bot -- Справка*\n\n` +
      `*Текстовые команды (свободная форма):*\n` +
      `-- "Создай встречу с Иваном завтра в 15:00"\n` +
      `-- "Покажи мероприятия на сегодня"\n` +
      `-- "Запиши заметку: купить подарок"\n` +
      `-- "Покажи мои заметки"\n` +
      `-- "Создай задачу: подготовить отчёт до пятницы"\n\n` +
      `*Голосовые сообщения:*\n` +
      `Просто отправьте голосовое -- бот распознает речь и выполнит команду.\n\n` +
      `*Фотографии:*\n` +
      `Отправьте фото -- бот проанализирует изображение (документы, чеки, визитки).\n\n` +
      `*Команды:*\n` +
      `/start -- Главное меню\n` +
      `/settings -- Настройки (часовой пояс, язык, голос)\n` +
      `/mode -- Переключить режим (работа / компаньон)\n` +
      `/stats -- Статистика использования\n` +
      `/calendar -- События на сегодня\n` +
      `/tasks -- Текущие задачи\n` +
      `/help -- Эта справка`;

    await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  // --- /settings ---
  bot.onText(/\/settings/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
      const { user } = await findOrCreateUserByTelegramId({ telegramId });

      const settingsText =
        `*Настройки*\n\n` +
        `Часовой пояс: \`${user.timezone}\`\n` +
        `Язык: \`${user.language}\`\n` +
        `Голосовой режим: \`${user.voice_mode || 'text'}\`\n` +
        `Время дайджеста: \`${user.digest_time || '08:00'}\`\n\n` +
        `Выберите, что хотите изменить:`;

      await bot.sendMessage(chatId, settingsText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: settingsKeyboard() },
      });
    } catch (error) {
      logger.error('[Telegram] Ошибка /settings:', error);
      await bot.sendMessage(chatId, 'Ошибка загрузки настроек.');
    }
  });

  // --- /mode ---
  bot.onText(/\/mode/, async (msg) => {
    const chatId = msg.chat.id;

    const modeText =
      `*Выберите режим работы:*\n\n` +
      `*Рабочий режим* -- строгий секретарь. Фокус на задачах, событиях, заметках.\n` +
      `*Компаньон* -- дружелюбный AI-помощник. Обсуждение любых тем в свободной форме.`;

    await bot.sendMessage(chatId, modeText, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: modeKeyboard() },
    });
  });

  // --- /stats ---
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
      const { user } = await findOrCreateUserByTelegramId({ telegramId });

      // Получаем статистику из messageProcessor или отдельного сервиса
      // Пока -- заглушка с базовыми данными из User
      const statsText =
        `*Статистика*\n\n` +
        `Тариф: \`${user.subscription_tier}\`\n` +
        `Сообщений сегодня: \`${user.messages_today || 0}\`\n` +
        `Лимит: \`${getLimitForTier(user.subscription_tier)}\`\n` +
        `Аккаунт создан: \`${formatDate(user.created_at)}\``;

      await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('[Telegram] Ошибка /stats:', error);
      await bot.sendMessage(chatId, 'Ошибка загрузки статистики.');
    }
  });

  // --- /calendar ---
  bot.onText(/\/calendar/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
      // Передаем как обычное текстовое сообщение с определенным текстом
      const unifiedMessage = {
        userId: null,
        telegramId,
        text: 'Покажи мои события на сегодня',
        type: 'command',
        platform: 'telegram',
        attachments: [],
        metadata: { chatId, isCommand: true },
      };

      const { processMessage } = await import('../../../core/messageProcessor.js');
      await bot.sendChatAction(chatId, 'typing');
      const result = await processMessage(unifiedMessage);

      const { formatResponse } = await import('../formatters.js');
      await bot.sendMessage(chatId, formatResponse(result.text), {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.error('[Telegram] Ошибка /calendar:', error);
      await bot.sendMessage(chatId, 'Ошибка загрузки событий.');
    }
  });

  // --- /tasks ---
  bot.onText(/\/tasks/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);

    try {
      const unifiedMessage = {
        userId: null,
        telegramId,
        text: 'Покажи мои текущие задачи',
        type: 'command',
        platform: 'telegram',
        attachments: [],
        metadata: { chatId, isCommand: true },
      };

      const { processMessage } = await import('../../../core/messageProcessor.js');
      await bot.sendChatAction(chatId, 'typing');
      const result = await processMessage(unifiedMessage);

      const { formatResponse } = await import('../formatters.js');
      await bot.sendMessage(chatId, formatResponse(result.text), {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      logger.error('[Telegram] Ошибка /tasks:', error);
      await bot.sendMessage(chatId, 'Ошибка загрузки задач.');
    }
  });

  logger.info('[Telegram] Команды зарегистрированы.');
}

// --- Вспомогательные функции ---

function getLimitForTier(tier) {
  const limits = {
    free: '50/день',
    professional: '500/день',
    business: 'безлимит',
    enterprise: 'безлимит',
  };
  return limits[tier] || '50/день';
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
```

---

## 4. Inline-клавиатуры

### Файл: `src/services/platforms/telegram/keyboards.js`

```js
// src/services/platforms/telegram/keyboards.js

/**
 * Построители inline-клавиатур для Telegram.
 *
 * Каждая функция возвращает массив массивов (строки кнопок),
 * где каждая кнопка -- объект { text, callback_data }.
 *
 * Формат callback_data: "action:параметр"
 * Примеры: "menu:calendar", "settings:timezone", "confirm:delete_event:42"
 */

// --- Главное меню (после /start) ---
export function mainMenuKeyboard() {
  return [
    [
      { text: 'События на сегодня', callback_data: 'menu:calendar_today' },
      { text: 'Мои задачи', callback_data: 'menu:tasks' },
    ],
    [
      { text: 'Мои заметки', callback_data: 'menu:notes' },
      { text: 'Статистика', callback_data: 'menu:stats' },
    ],
    [
      { text: 'Настройки', callback_data: 'menu:settings' },
      { text: 'Справка', callback_data: 'menu:help' },
    ],
  ];
}

// --- Настройки ---
export function settingsKeyboard() {
  return [
    [
      { text: 'Часовой пояс', callback_data: 'settings:timezone' },
      { text: 'Язык', callback_data: 'settings:language' },
    ],
    [
      { text: 'Голосовой режим', callback_data: 'settings:voice' },
      { text: 'Время дайджеста', callback_data: 'settings:digest_time' },
    ],
    [
      { text: 'Назад', callback_data: 'menu:main' },
    ],
  ];
}

// --- Выбор часового пояса ---
export function timezoneKeyboard() {
  return [
    [
      { text: 'Москва (UTC+3)', callback_data: 'tz:Europe/Moscow' },
      { text: 'Дубай (UTC+4)', callback_data: 'tz:Asia/Dubai' },
    ],
    [
      { text: 'Ташкент (UTC+5)', callback_data: 'tz:Asia/Tashkent' },
      { text: 'Алматы (UTC+6)', callback_data: 'tz:Asia/Almaty' },
    ],
    [
      { text: 'Киев (UTC+2)', callback_data: 'tz:Europe/Kyiv' },
      { text: 'Лондон (UTC+0)', callback_data: 'tz:Europe/London' },
    ],
    [
      { text: 'Назад', callback_data: 'settings:back' },
    ],
  ];
}

// --- Выбор языка ---
export function languageKeyboard() {
  return [
    [
      { text: 'Русский', callback_data: 'lang:ru' },
      { text: 'English', callback_data: 'lang:en' },
    ],
    [
      { text: 'Назад', callback_data: 'settings:back' },
    ],
  ];
}

// --- Голосовой режим ---
export function voiceModeKeyboard() {
  return [
    [
      { text: 'Только текст', callback_data: 'voice:text' },
    ],
    [
      { text: 'Только голос', callback_data: 'voice:voice' },
    ],
    [
      { text: 'Авто (голос на голос)', callback_data: 'voice:auto' },
    ],
    [
      { text: 'Назад', callback_data: 'settings:back' },
    ],
  ];
}

// --- Выбор режима работы ---
export function modeKeyboard() {
  return [
    [
      { text: 'Рабочий режим', callback_data: 'mode:work' },
    ],
    [
      { text: 'Компаньон', callback_data: 'mode:companion' },
    ],
  ];
}

// --- Подтверждение действия (удаление события, завершение задачи) ---
export function confirmKeyboard(action, entityId) {
  return [
    [
      { text: 'Да', callback_data: `confirm:${action}:${entityId}` },
      { text: 'Нет', callback_data: 'confirm:cancel' },
    ],
  ];
}

// --- Статус задачи ---
export function taskStatusKeyboard(taskId) {
  return [
    [
      { text: 'Ожидает', callback_data: `task_status:${taskId}:pending` },
      { text: 'В работе', callback_data: `task_status:${taskId}:in_progress` },
    ],
    [
      { text: 'Выполнена', callback_data: `task_status:${taskId}:done` },
      { text: 'Отменена', callback_data: `task_status:${taskId}:cancelled` },
    ],
  ];
}

// --- Пагинация (для списков событий, задач, заметок) ---
export function paginationKeyboard(currentPage, totalPages, prefix) {
  const buttons = [];

  if (currentPage > 1) {
    buttons.push({
      text: 'Назад',
      callback_data: `${prefix}:page:${currentPage - 1}`,
    });
  }

  buttons.push({
    text: `${currentPage}/${totalPages}`,
    callback_data: 'noop', // пустое действие
  });

  if (currentPage < totalPages) {
    buttons.push({
      text: 'Вперёд',
      callback_data: `${prefix}:page:${currentPage + 1}`,
    });
  }

  return [buttons];
}
```

### Обработчик callback_query

```js
// src/services/platforms/telegram/handlers/callbackHandler.js

import logger from '../../../../config/logger.js';
import { findOrCreateUserByTelegramId } from '../../../core/userService.js';
import {
  mainMenuKeyboard,
  settingsKeyboard,
  timezoneKeyboard,
  languageKeyboard,
  voiceModeKeyboard,
} from '../keyboards.js';

/**
 * Обрабатывает нажатия на inline-кнопки.
 *
 * Формат callback_data: "action:param1:param2"
 * Разбиваем по ":" и маршрутизируем по первому сегменту.
 *
 * @param {TelegramBot} bot
 * @param {Object} query - callback_query от Telegram
 */
export async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const telegramId = String(query.from.id);
  const data = query.data;

  // Подтверждаем получение callback (убирает "часики" на кнопке)
  await bot.answerCallbackQuery(query.id);

  const [action, ...params] = data.split(':');

  try {
    switch (action) {
      // --- Навигация по меню ---
      case 'menu':
        await handleMenuAction(bot, chatId, messageId, params[0]);
        break;

      // --- Настройки ---
      case 'settings':
        await handleSettingsAction(bot, chatId, messageId, params[0], telegramId);
        break;

      // --- Часовой пояс ---
      case 'tz':
        await handleTimezoneChange(bot, chatId, messageId, params[0], telegramId);
        break;

      // --- Язык ---
      case 'lang':
        await handleLanguageChange(bot, chatId, messageId, params[0], telegramId);
        break;

      // --- Голосовой режим ---
      case 'voice':
        await handleVoiceModeChange(bot, chatId, messageId, params[0], telegramId);
        break;

      // --- Режим работы ---
      case 'mode':
        await handleModeChange(bot, chatId, messageId, params[0], telegramId);
        break;

      // --- Подтверждение действий ---
      case 'confirm':
        await handleConfirmation(bot, chatId, messageId, params, telegramId);
        break;

      // --- Статус задачи ---
      case 'task_status':
        await handleTaskStatusChange(bot, chatId, messageId, params, telegramId);
        break;

      // --- Пустое действие (для пагинации: номер страницы) ---
      case 'noop':
        break;

      default:
        logger.warn(`[Telegram] Неизвестный callback action: ${action}`);
    }
  } catch (error) {
    logger.error('[Telegram] Ошибка обработки callback:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте ещё раз.');
  }
}

// --- Обработчики действий ---

async function handleMenuAction(bot, chatId, messageId, menuItem) {
  switch (menuItem) {
    case 'main':
      await bot.editMessageText('Главное меню:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: mainMenuKeyboard() },
      });
      break;

    case 'calendar_today':
      // Делегируем в messageProcessor как текстовую команду
      await bot.editMessageText('Загружаю события на сегодня...', {
        chat_id: chatId,
        message_id: messageId,
      });
      // Здесь вызываем processMessage с текстом "Покажи события на сегодня"
      // (аналогично /calendar)
      break;

    case 'tasks':
      await bot.editMessageText('Загружаю задачи...', {
        chat_id: chatId,
        message_id: messageId,
      });
      break;

    case 'notes':
      await bot.editMessageText('Загружаю заметки...', {
        chat_id: chatId,
        message_id: messageId,
      });
      break;

    case 'settings':
      await bot.editMessageText('Настройки:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: settingsKeyboard() },
      });
      break;

    case 'help':
      await bot.editMessageText(
        '*Справка*\nНапишите /help для полного списка возможностей.',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
        }
      );
      break;

    case 'stats':
      // Аналогично /stats
      break;
  }
}

async function handleSettingsAction(bot, chatId, messageId, setting, telegramId) {
  switch (setting) {
    case 'timezone':
      await bot.editMessageText('Выберите часовой пояс:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: timezoneKeyboard() },
      });
      break;

    case 'language':
      await bot.editMessageText('Выберите язык:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: languageKeyboard() },
      });
      break;

    case 'voice':
      await bot.editMessageText('Выберите голосовой режим:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: voiceModeKeyboard() },
      });
      break;

    case 'digest_time':
      await bot.editMessageText(
        'Введите время дайджеста в формате ЧЧ:ММ (например, 08:00):',
        { chat_id: chatId, message_id: messageId }
      );
      // Устанавливаем состояние ожидания ввода (через Session metadata)
      break;

    case 'back':
      await bot.editMessageText('Настройки:', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: settingsKeyboard() },
      });
      break;
  }
}

async function handleTimezoneChange(bot, chatId, messageId, timezone, telegramId) {
  const { user } = await findOrCreateUserByTelegramId({ telegramId });

  // Обновляем часовой пояс пользователя
  await user.update({ timezone });

  await bot.editMessageText(`Часовой пояс обновлён: \`${timezone}\``, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: settingsKeyboard() },
  });
}

async function handleLanguageChange(bot, chatId, messageId, language, telegramId) {
  const { user } = await findOrCreateUserByTelegramId({ telegramId });
  await user.update({ language });

  const langNames = { ru: 'Русский', en: 'English' };
  await bot.editMessageText(`Язык обновлён: ${langNames[language] || language}`, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: settingsKeyboard() },
  });
}

async function handleVoiceModeChange(bot, chatId, messageId, mode, telegramId) {
  const { user } = await findOrCreateUserByTelegramId({ telegramId });
  await user.update({ voice_mode: mode });

  const modeNames = { text: 'Только текст', voice: 'Только голос', auto: 'Авто' };
  await bot.editMessageText(`Голосовой режим: ${modeNames[mode] || mode}`, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: settingsKeyboard() },
  });
}

async function handleModeChange(bot, chatId, messageId, mode, telegramId) {
  const { user } = await findOrCreateUserByTelegramId({ telegramId });

  // Сохраняем режим в Session или User settings
  // mode: 'work' | 'companion'
  await user.update({ current_mode: mode });

  const modeNames = { work: 'Рабочий режим', companion: 'Компаньон' };
  await bot.editMessageText(
    `Режим переключён: *${modeNames[mode]}*`,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
    }
  );
}

async function handleConfirmation(bot, chatId, messageId, params, telegramId) {
  const [action, entityId] = params;

  if (action === 'cancel') {
    await bot.editMessageText('Действие отменено.', {
      chat_id: chatId,
      message_id: messageId,
    });
    return;
  }

  // Делегируем подтверждённое действие в messageProcessor
  // Пример: confirm:delete_event:42 -> удалить событие 42
  const unifiedMessage = {
    userId: null,
    telegramId,
    text: `Подтвердить ${action} ${entityId}`,
    type: 'callback',
    platform: 'telegram',
    attachments: [],
    metadata: {
      chatId,
      confirmedAction: action,
      entityId,
    },
  };

  const { processMessage } = await import('../../../core/messageProcessor.js');
  const result = await processMessage(unifiedMessage);

  await bot.editMessageText(result.text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
  });
}

async function handleTaskStatusChange(bot, chatId, messageId, params, telegramId) {
  const [taskId, newStatus] = params;

  // Делегируем в messageProcessor
  const unifiedMessage = {
    userId: null,
    telegramId,
    text: `Изменить статус задачи ${taskId} на ${newStatus}`,
    type: 'callback',
    platform: 'telegram',
    attachments: [],
    metadata: {
      chatId,
      confirmedAction: 'update_task_status',
      entityId: taskId,
      newStatus,
    },
  };

  const { processMessage } = await import('../../../core/messageProcessor.js');
  const result = await processMessage(unifiedMessage);

  await bot.editMessageText(result.text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
  });
}
```

### Форматирование сообщений

```js
// src/services/platforms/telegram/formatters.js

/**
 * Форматирует ответ для отправки в Telegram.
 * Поддерживает Markdown V1 (MarkdownV2 слишком строгий для динамического контента).
 *
 * @param {string} text - текст для форматирования
 * @returns {string} - отформатированный текст
 */
export function formatResponse(text) {
  if (!text) return 'Нет ответа.';

  // Экранируем символы, которые могут сломать Markdown V1
  // В Markdown V1 проблемные символы: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Но мы ХОТИМ использовать * и _ для форматирования, поэтому экранируем только опасные
  return text;
}

/**
 * Форматирует список событий для Telegram.
 */
export function formatEventsList(events, date) {
  if (!events || events.length === 0) {
    return `На ${date} мероприятий нет.`;
  }

  let text = `*События на ${date}:*\n\n`;
  events.forEach((event, index) => {
    const startTime = formatTime(event.start);
    const endTime = formatTime(event.end);
    text += `${index + 1}. *${event.title}*\n`;
    text += `   ${startTime} -- ${endTime}\n`;
    if (event.location) {
      text += `   Место: ${event.location}\n`;
    }
    text += '\n';
  });

  return text;
}

/**
 * Форматирует список задач для Telegram.
 */
export function formatTasksList(tasks) {
  if (!tasks || tasks.length === 0) {
    return 'Нет активных задач.';
  }

  const statusIcons = {
    pending: '[ ]',
    in_progress: '[~]',
    done: '[x]',
    cancelled: '[-]',
  };

  const priorityIcons = {
    urgent: '!!!',
    high: '!!',
    medium: '!',
    low: '',
  };

  let text = '*Задачи:*\n\n';
  tasks.forEach((task) => {
    const status = statusIcons[task.status] || '[ ]';
    const priority = priorityIcons[task.priority] || '';
    text += `${status} ${priority} *${task.title}*`;
    if (task.due_date) {
      text += ` (до ${formatDate(task.due_date)})`;
    }
    text += '\n';
  });

  return text;
}

/**
 * Форматирует список заметок для Telegram.
 */
export function formatNotesList(notes) {
  if (!notes || notes.length === 0) {
    return 'Заметок нет.';
  }

  let text = '*Заметки:*\n\n';
  notes.forEach((note) => {
    const icon = note.completed ? '[x]' : '[ ]';
    text += `${icon} ${note.id}. ${note.content}\n`;
  });

  return text;
}

// --- Вспомогательные ---

function formatTime(dateStr) {
  if (!dateStr) return '--:--';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  if (!dateStr) return '---';
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
```

---

## 5. Голосовые ответы (TTS)

### Файл: `src/services/integrations/yandexTTS.js`

Бот может не только распознавать голос (STT), но и отвечать голосом (TTS).
Yandex SpeechKit TTS -- дешевый и качественный вариант для русского языка.

**Стоимость:** ~1.50 руб. (~$0.015) за 1000 символов.
При средней длине ответа 200 символов -- ~$0.003 за голосовой ответ.

```js
// src/services/integrations/yandexTTS.js

import config from '../../config/index.js';
import logger from '../../config/logger.js';

/**
 * Синтезирует речь из текста через Yandex SpeechKit TTS API.
 *
 * Возвращает Buffer с аудио в формате OGG/Opus -- нативный формат Telegram voice.
 * Telegram принимает голосовые сообщения ТОЛЬКО в формате OGG с кодеком Opus.
 *
 * @param {string} text - текст для озвучивания (макс. 5000 символов)
 * @param {Object} options - опции
 * @param {string} options.voice - голос: 'filipp' (мужской), 'alena' (женский),
 *                                 'jane' (женский), 'omazh' (женский), 'zahar' (мужской)
 * @param {string} options.emotion - эмоция: 'neutral', 'good', 'evil' (зависит от голоса)
 * @param {string} options.speed - скорость: '0.1' - '3.0', default '1.0'
 * @returns {Promise<Buffer|null>} - буфер OGG/Opus аудио или null при ошибке
 */
export async function textToSpeech(text, options = {}) {
  const apiKey = config.yandex.apiKey;

  if (!apiKey) {
    logger.error('[YandexTTS] YANDEX_API_KEY не задан.');
    return null;
  }

  if (!text || text.trim() === '') {
    return null;
  }

  // Ограничиваем длину текста (Yandex TTS API лимит -- 5000 символов)
  const truncatedText = text.length > 5000 ? text.substring(0, 5000) : text;

  // Параметры голоса
  const voice = options.voice || 'filipp';   // мужской голос по умолчанию
  const emotion = options.emotion || 'neutral';
  const speed = options.speed || '1.0';

  // Формируем тело запроса (application/x-www-form-urlencoded)
  const params = new URLSearchParams({
    text: truncatedText,
    lang: 'ru-RU',
    voice: voice,
    emotion: emotion,
    speed: speed,
    format: 'oggopus',    // OGG с кодеком Opus -- нативный формат Telegram voice
    sampleRateHertz: '48000',
  });

  try {
    const response = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[YandexTTS] Ошибка API: ${response.status} ${errorText}`);
      return null;
    }

    // Ответ -- бинарные аудиоданные
    const audioBuffer = Buffer.from(await response.arrayBuffer());

    logger.info(`[YandexTTS] Синтезировано: ${truncatedText.length} символов, ` +
      `${audioBuffer.length} байт аудио, голос: ${voice}`);

    return audioBuffer;
  } catch (error) {
    logger.error('[YandexTTS] Ошибка синтеза:', error);
    return null;
  }
}

/**
 * Определяет, нужно ли отправлять голосовой ответ.
 *
 * @param {string} voiceMode - настройка пользователя: 'text' | 'voice' | 'auto'
 * @param {string} messageType - тип входящего сообщения: 'text' | 'voice' | 'photo'
 * @returns {boolean}
 */
export function shouldSendVoice(voiceMode, messageType) {
  switch (voiceMode) {
    case 'voice':
      return true;          // всегда голосом
    case 'auto':
      return messageType === 'voice';  // голосом только на голосовое
    case 'text':
    default:
      return false;         // только текстом
  }
}
```

---

## 6. Обработка фото (Claude Vision)

### Как это работает в Claude API

Claude API поддерживает multimodal-сообщения с изображениями. Фотография передается
как `content` блок типа `image` в формате base64.

### Обработка в messageProcessor.js

`photoHandler.js` (раздел 1) создает `UnifiedMessage` с `attachments[].base64`.
`messageProcessor.js` при обнаружении `attachments` с типом `image` формирует
multimodal-запрос к Claude:

```js
// Фрагмент src/services/ai/claudeHandler.js -- обработка изображений

/**
 * Формирует multimodal-сообщение для Claude API с изображением.
 *
 * @param {string} text - текст пользователя (подпись к фото или вопрос)
 * @param {Array} attachments - вложения из UnifiedMessage
 * @returns {Array} - массив content блоков для Claude API
 */
function buildMultimodalContent(text, attachments) {
  const content = [];

  // Добавляем изображения
  for (const attachment of attachments) {
    if (attachment.type === 'image') {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mimeType,  // 'image/jpeg', 'image/png', 'image/webp', 'image/gif'
          data: attachment.base64,
        },
      });
    }
  }

  // Добавляем текст
  content.push({
    type: 'text',
    text: text || 'Опиши, что на этом изображении.',
  });

  return content;
}

// Пример вызова Claude API с изображением:
//
// const response = await anthropic.messages.create({
//   model: 'claude-sonnet-4-20250514',    // Vision требует Sonnet или выше
//   max_tokens: 1024,
//   messages: [
//     {
//       role: 'user',
//       content: buildMultimodalContent(text, attachments),
//     },
//   ],
// });
```

### Сценарии использования Vision

| Сценарий | Текст пользователя | Что делает Claude |
|----------|-------------------|-------------------|
| Скан документа | "Что здесь написано?" | OCR -- извлекает текст из изображения |
| Чек/квитанция | "Сколько я потратил?" | Извлекает сумму, магазин, дату |
| Визитка | "Сохрани контакт" | Извлекает имя, телефон, email -> CRM |
| Скриншот | "Переведи этот текст" | Читает текст с экрана |
| Фото еды | (без подписи) | Описывает что на фото |
| Документ | "Создай заметку из этого" | Извлекает текст -> Note |

### Ограничения

- **Размер изображения:** макс. 20MB (ограничение Telegram), рекомендуется до 5MB
- **Поддерживаемые форматы:** JPEG, PNG, WebP, GIF (только первый кадр)
- **Модель:** Vision требует Claude Sonnet или выше (Haiku не поддерживает изображения -- это увеличивает стоимость)
- **Стоимость:** ~$0.005-0.01 за запрос с изображением (зависит от размера)

---

## 7. Режим компаньона

### Концепция

Два режима работы бота:

| | Рабочий режим | Режим компаньона |
|--|--------------|-----------------|
| **Персона** | Строгий секретарь | Дружелюбный собеседник |
| **Фокус** | Задачи, события, заметки, CRM | Любые темы |
| **Стиль** | Лаконичный, деловой | Развёрнутый, casual |
| **Tool_use** | Все инструменты активны | Только базовые (заметки) |
| **Системный промпт** | Секретарский | Компаньонский |

### Системные промпты

```js
// src/services/ai/promptBuilder.js -- фрагмент

/**
 * Возвращает системный промпт в зависимости от режима.
 *
 * @param {string} mode - 'work' или 'companion'
 * @param {Object} userContext - данные пользователя (имя, timezone, etc.)
 * @returns {string}
 */
export function getSystemPrompt(mode, userContext) {
  const { firstName, timezone, language } = userContext;

  if (mode === 'companion') {
    return getCompanionPrompt(firstName, timezone, language);
  }

  return getWorkPrompt(firstName, timezone, language);
}

function getWorkPrompt(firstName, timezone, language) {
  return `Ты -- Secretary Bot, профессиональный AI-секретарь пользователя ${firstName}.

Твоя роль: эффективный помощник для управления рабочим временем, задачами и коммуникациями.

ПРАВИЛА:
1. Будь лаконичен и конкретен. Не болтай -- действуй.
2. Если пользователь просит создать событие/задачу/заметку -- используй соответствующий tool.
3. При неоднозначности -- уточни (например, время события).
4. Все даты и время -- в часовом поясе пользователя: ${timezone}.
5. Язык ответа: ${language === 'en' ? 'English' : 'русский'}.
6. Текущая дата и время: ${new Date().toISOString()}.

ВОЗМОЖНОСТИ (tools):
- Управление Google Calendar (создание/изменение/удаление/просмотр событий)
- Управление задачами (создание, изменение статуса, просмотр)
- Управление заметками (создание, просмотр, завершение)
- CRM (контакты, взаимодействия, follow-up)
- Чтение почты (Gmail)
- Работа с Google Drive/Docs

Если запрос не связан с работой -- вежливо предложи переключиться в режим компаньона командой /mode.`;
}

function getCompanionPrompt(firstName, timezone, language) {
  return `Ты -- дружелюбный AI-компаньон пользователя ${firstName}.

Твоя роль: собеседник, помощник, друг. Ты можешь обсуждать любые темы: от философии до рецептов.

ПРАВИЛА:
1. Будь дружелюбным, открытым и эмпатичным.
2. Можешь обсуждать любые темы -- не ограничивайся рабочими вопросами.
3. Используй юмор, когда уместно.
4. Если пользователь всё-таки просит что-то рабочее (создать событие, задачу) -- выполни через tools.
5. Язык ответа: ${language === 'en' ? 'English' : 'русский'}.
6. Текущая дата и время: ${new Date().toISOString()}.
7. Часовой пояс пользователя: ${timezone}.

Ты можешь:
- Обсуждать книги, фильмы, новости
- Помогать с идеями и брейнштормом
- Писать тексты, переводить
- Отвечать на вопросы по любым темам
- Давать советы (но не медицинские и не юридические)

Если пользователь хочет вернуться к работе -- предложи переключиться командой /mode.`;
}
```

### Хранение режима

Режим хранится в поле `current_mode` модели User (или в metadata сессии Session).
Переключение происходит через:
- Команду `/mode` (commandHandler.js)
- Inline-клавиатуру (callbackHandler.js)

`messageProcessor.js` при обработке сообщения читает `user.current_mode` и передает
соответствующий системный промпт в `claudeHandler.js`.

---

## 8. Рефакторинг morningDigest

### Файл: `src/services/core/digestService.js`

Текущие проблемы `services/morningDigest.js` (84 строки):

1. **Второй экземпляр бота** (строка 11) -- ИСПРАВЛЕНО: используем `getBotInstance()`
2. **Читает из локальной БД** (строка 32) -- ИСПРАВЛЕНО: получаем из Google Calendar через MCP
3. **Серверный часовой пояс** (строка 28: `new Date()`) -- ИСПРАВЛЕНО: используем timezone пользователя
4. **Только один получатель** (BOSS_CHAT_ID) -- ИСПРАВЛЕНО: отправляем всем пользователям
5. **Только события и заметки** -- РАСШИРЕНО: + задачи, + follow-up (CRM)

```js
// src/services/core/digestService.js

import schedule from 'node-schedule';
import { getBotInstance } from '../platforms/telegram/bot.js';
import { processMessage } from './messageProcessor.js';
import { formatResponse } from '../platforms/telegram/formatters.js';
import models from '../../models/index.js';
import logger from '../../config/logger.js';

/**
 * Сервис утреннего дайджеста.
 *
 * Отправляет каждому активному пользователю персонализированный дайджест
 * в его часовом поясе, в настроенное им время.
 *
 * ОТЛИЧИЯ от текущего morningDigest.js:
 * 1. Использует единственный экземпляр бота (getBotInstance)
 * 2. Работает для всех пользователей, не только BOSS_CHAT_ID
 * 3. Учитывает часовой пояс каждого пользователя
 * 4. Получает события из Google Calendar через MCP (не из локальной БД)
 * 5. Включает задачи и CRM follow-up
 */

// Хранилище запланированных jobs (по user_id -> job)
const scheduledJobs = new Map();

/**
 * Инициализирует дайджест-сервис.
 * Для каждого активного пользователя планирует отправку дайджеста.
 */
export async function initDigestService() {
  try {
    // Получаем всех активных пользователей с telegram_id
    const users = await models.User.findAll({
      where: {
        is_active: true,
        telegram_id: { [models.Sequelize.Op.ne]: null },
      },
    });

    for (const user of users) {
      scheduleDigestForUser(user);
    }

    logger.info(`[Digest] Инициализирован для ${users.length} пользователей.`);
  } catch (error) {
    logger.error('[Digest] Ошибка инициализации:', error);
  }
}

/**
 * Планирует дайджест для конкретного пользователя.
 * Учитывает его часовой пояс и предпочтительное время.
 *
 * @param {Object} user - модель User
 */
export function scheduleDigestForUser(user) {
  // Отменяем предыдущий job если был
  const existingJob = scheduledJobs.get(user.id);
  if (existingJob) {
    existingJob.cancel();
  }

  const digestTime = user.digest_time || '08:00';
  const [hours, minutes] = digestTime.split(':').map(Number);
  const timezone = user.timezone || 'Asia/Dubai';

  // node-schedule поддерживает RecurrenceRule с timezone
  const rule = new schedule.RecurrenceRule();
  rule.hour = hours;
  rule.minute = minutes;
  rule.tz = timezone;

  const job = schedule.scheduleJob(rule, async () => {
    await sendDigestToUser(user);
  });

  scheduledJobs.set(user.id, job);

  logger.info(
    `[Digest] Запланирован для user ${user.id} (${user.username}) ` +
    `в ${digestTime} ${timezone}`
  );
}

/**
 * Собирает и отправляет дайджест конкретному пользователю.
 *
 * @param {Object} user - модель User
 */
async function sendDigestToUser(user) {
  const bot = getBotInstance();
  if (!bot) {
    logger.error('[Digest] Бот не инициализирован.');
    return;
  }

  const chatId = user.telegram_id;
  if (!chatId) return;

  try {
    // Используем messageProcessor для получения дайджеста через Claude + MCP
    // Claude сам запросит нужные данные через tool_use:
    // - Google Calendar: события на сегодня
    // - Локальная БД: задачи, заметки, follow-up
    const unifiedMessage = {
      userId: user.id,
      telegramId: chatId,
      text: 'Составь мой утренний дайджест на сегодня. ' +
            'Включи: события из календаря, активные задачи, невыполненные заметки ' +
            'и предстоящие follow-up по контактам.',
      type: 'system',
      platform: 'telegram',
      attachments: [],
      metadata: {
        chatId,
        isDigest: true,
      },
    };

    const result = await processMessage(unifiedMessage);

    // Формируем и отправляем дайджест
    const digestHeader = `*Доброе утро, ${user.username || 'пользователь'}!*\n\n`;
    const digestText = digestHeader + formatResponse(result.text);

    await bot.sendMessage(chatId, digestText, { parse_mode: 'Markdown' });

    logger.info(`[Digest] Отправлен пользователю ${user.id} (${user.username}).`);
  } catch (error) {
    logger.error(`[Digest] Ошибка отправки пользователю ${user.id}:`, error);
  }
}

/**
 * Останавливает все запланированные дайджесты.
 * Вызывается при graceful shutdown.
 */
export function stopAllDigests() {
  for (const [userId, job] of scheduledJobs) {
    job.cancel();
    logger.info(`[Digest] Отменён для пользователя ${userId}.`);
  }
  scheduledJobs.clear();
}
```

---

## 9. Рефакторинг STT

### Файл: `src/services/integrations/yandexSpeech.js`

Текущие проблемы `services/yandexSpeechService.js` (98 строк):

1. **Путь к ffmpeg жестко закодирован** (строка 15):
   `path.join(__dirname, '..', 'ffmpeg', 'bin', 'ffmpeg.exe')` -- только Windows
2. **Ошибки STT молча проглатываются** (строка 95): `return ""`
3. **Нет кроссплатформенности** -- `.exe` не работает на Linux/Docker

```js
// src/services/integrations/yandexSpeech.js

import ffmpeg from 'fluent-ffmpeg';
import { Readable } from 'stream';
import config from '../../config/index.js';
import logger from '../../config/logger.js';

/**
 * Инициализация FFmpeg.
 *
 * ИСПРАВЛЕНИЕ: Вместо жёстко закодированного пути к ffmpeg.exe используем:
 * 1. Переменную окружения FFMPEG_PATH (если задана)
 * 2. Пакет ffmpeg-static (если установлен) -- содержит бинарник для текущей платформы
 * 3. Системный ffmpeg (должен быть в PATH)
 *
 * Текущая проблема: path.join(__dirname, '..', 'ffmpeg', 'bin', 'ffmpeg.exe')
 * -- работает ТОЛЬКО на Windows, невозможен деплой на Linux/Docker.
 */
function initFfmpeg() {
  // Вариант 1: Явный путь из переменной окружения
  if (config.ffmpegPath) {
    ffmpeg.setFfmpegPath(config.ffmpegPath);
    logger.info(`[FFmpeg] Путь из конфига: ${config.ffmpegPath}`);
    return;
  }

  // Вариант 2: ffmpeg-static пакет (кроссплатформенный)
  try {
    // npm install ffmpeg-static
    // Пакет автоматически предоставляет бинарник для текущей ОС
    const ffmpegStatic = await import('ffmpeg-static');
    if (ffmpegStatic.default) {
      ffmpeg.setFfmpegPath(ffmpegStatic.default);
      logger.info(`[FFmpeg] Путь из ffmpeg-static: ${ffmpegStatic.default}`);
      return;
    }
  } catch {
    // ffmpeg-static не установлен -- продолжаем
  }

  // Вариант 3: Системный ffmpeg (должен быть в PATH)
  // fluent-ffmpeg по умолчанию ищет 'ffmpeg' в PATH
  logger.info('[FFmpeg] Используется системный ffmpeg из PATH.');
}

// Инициализируем при загрузке модуля
// Примечание: в реальном коде initFfmpeg() следует вызвать синхронно
// или обернуть в top-level await (ESM поддерживает это)

/**
 * Конвертирует аудио из OGG в WAV (PCM 16-bit, mono).
 *
 * @param {Buffer} oggBuffer - буфер с OGG-аудио от Telegram
 * @returns {Promise<Buffer>} - буфер с WAV-аудио для Yandex STT
 * @throws {Error} - если конвертация не удалась
 */
export async function convertOggToWav(oggBuffer) {
  return new Promise((resolve, reject) => {
    const inputStream = new Readable({
      read() {},
    });
    inputStream.push(oggBuffer);
    inputStream.push(null);

    const command = ffmpeg(inputStream)
      .inputFormat('ogg')
      .audioChannels(1)
      .audioFrequency(16000)     // 16kHz -- оптимально для STT
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('start', (cmdLine) => {
        logger.debug(`[FFmpeg] Command: ${cmdLine}`);
      })
      .on('error', (err) => {
        logger.error('[FFmpeg] Ошибка конвертации:', err.message);
        reject(new Error(`FFmpeg conversion failed: ${err.message}`));
      });

    const outputStream = command.pipe();
    const chunks = [];

    outputStream.on('data', (chunk) => chunks.push(chunk));

    outputStream.on('end', () => {
      const wavBuffer = Buffer.concat(chunks);
      logger.debug(`[FFmpeg] Конвертация завершена: ${wavBuffer.length} байт.`);
      resolve(wavBuffer);
    });

    outputStream.on('error', (err) => {
      logger.error('[FFmpeg] Ошибка потока:', err.message);
      reject(new Error(`FFmpeg stream error: ${err.message}`));
    });
  });
}

/**
 * Распознает речь через Yandex SpeechKit STT API.
 *
 * ИСПРАВЛЕНИЕ: Вместо молчаливого return "" при ошибке -- бросаем исключение.
 * Вызывающий код (voiceHandler.js) решает, что делать с ошибкой.
 *
 * @param {Buffer} wavBuffer - буфер с WAV-аудио
 * @returns {Promise<string>} - распознанный текст
 * @throws {Error} - если распознавание не удалось
 */
export async function speechToText(wavBuffer) {
  const apiKey = config.yandex.apiKey;

  if (!apiKey) {
    throw new Error('YANDEX_API_KEY не задан в переменных окружения.');
  }

  const url = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?lang=ru-RU&format=lpcm&sampleRateHertz=16000';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${apiKey}`,
        'Content-Type': 'audio/x-pcm;bit=16;rate=16000',
      },
      body: wavBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Yandex STT API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!data.result || data.result.trim() === '') {
      logger.warn('[YandexSTT] Пустой результат распознавания.');
      return '';
    }

    logger.info(`[YandexSTT] Распознано: "${data.result.substring(0, 50)}..."`);
    return data.result;
  } catch (error) {
    logger.error('[YandexSTT] Ошибка:', error.message);
    throw error;  // НЕ молча return "" -- бросаем ошибку!
  }
}
```

### Что добавить в package.json

```json
{
  "dependencies": {
    "ffmpeg-static": "^5.2.0"
  }
}
```

Пакет `ffmpeg-static` содержит предкомпилированные бинарники ffmpeg для:
- Windows (x64)
- Linux (x64, arm64)
- macOS (x64, arm64)

Это полностью решает проблему с `ffmpeg.exe` и делает проект кроссплатформенным.

---

## 10. Регистрация через Telegram

### Логика авто-регистрации

При первом сообщении от нового пользователя бот автоматически создает учетную запись.

```js
// src/services/core/userService.js -- фрагмент

import models from '../../models/index.js';
import logger from '../../config/logger.js';

/**
 * Находит пользователя по telegram_id или создает нового.
 *
 * Вызывается из:
 * - commandHandler.js (при /start и других командах)
 * - messageProcessor.js (при обработке любого сообщения)
 *
 * @param {Object} params
 * @param {string} params.telegramId - Telegram user ID
 * @param {string} params.firstName - Имя из Telegram
 * @param {string} params.lastName - Фамилия из Telegram
 * @param {string} params.username - Username из Telegram
 * @param {string} params.languageCode - Код языка из Telegram (ru, en)
 * @returns {Promise<{user: User, isNew: boolean}>}
 */
export async function findOrCreateUserByTelegramId({
  telegramId,
  firstName = '',
  lastName = '',
  username = '',
  languageCode = 'ru',
}) {
  if (!telegramId) {
    throw new Error('telegramId обязателен.');
  }

  // Ищем существующего пользователя
  let user = await models.User.findOne({
    where: { telegram_id: String(telegramId) },
  });

  if (user) {
    return { user, isNew: false };
  }

  // Создаем нового пользователя
  const generatedUsername = username || `tg_${telegramId}`;

  user = await models.User.create({
    username: generatedUsername,
    telegram_id: String(telegramId),
    password_hash: '',                // Пароль не нужен для Telegram-пользователей
    role: 'boss',                     // По умолчанию -- руководитель (единоличный пользователь)
    timezone: 'Asia/Dubai',           // Значение по умолчанию; пользователь изменит в /settings
    language: languageCode === 'en' ? 'en' : 'ru',
    subscription_tier: 'free',        // Бесплатный тариф
    is_active: true,
    voice_mode: 'text',               // По умолчанию -- только текст
    current_mode: 'work',             // По умолчанию -- рабочий режим
  });

  logger.info(
    `[UserService] Новый пользователь: id=${user.id}, telegram_id=${telegramId}, ` +
    `username=${generatedUsername}`
  );

  return { user, isNew: true };
}
```

### Поток регистрации

```
1. Пользователь отправляет первое сообщение (или /start)
2. commandHandler / messageHandler вызывает findOrCreateUserByTelegramId()
3. Если isNew = true:
   a. Создается User с telegram_id, free тариф, Asia/Dubai timezone
   b. Отправляется приветственное сообщение с inline-клавиатурой
   c. Предлагается выбрать часовой пояс (через /settings)
4. Если isNew = false:
   a. Используем существующего User
   b. Продолжаем обработку сообщения
```

### Определение часового пояса

Telegram API не предоставляет часовой пояс пользователя напрямую. Варианты:

1. **Спросить при регистрации** -- inline-клавиатура с популярными поясами (см. `timezoneKeyboard()`)
2. **Попросить отправить геолокацию** -- определить пояс по координатам
3. **Значение по умолчанию** -- `Asia/Dubai` (текущее захардкоженное значение)

Реализуем вариант 1 (inline-клавиатура) как наиболее простой и надежный.

---

## 11. Сервис уведомлений

### Файл: `src/services/core/notificationService.js`

```js
// src/services/core/notificationService.js

import schedule from 'node-schedule';
import { Op } from 'sequelize';
import { getBotInstance } from '../platforms/telegram/bot.js';
import models from '../../models/index.js';
import logger from '../../config/logger.js';

/**
 * Сервис проактивных уведомлений.
 *
 * Типы уведомлений:
 * 1. Напоминания о событиях (за N минут до начала)
 * 2. Напоминания о дедлайнах задач
 * 3. Напоминания о follow-up (CRM)
 *
 * Архитектура:
 * - Каждую минуту проверяем, есть ли уведомления для отправки
 * - Используем единственный экземпляр бота (getBotInstance)
 * - Учитываем часовой пояс каждого пользователя
 */

let checkJob = null;

/**
 * Инициализирует сервис уведомлений.
 * Запускает периодическую проверку каждую минуту.
 */
export function initNotificationService() {
  // Проверяем каждую минуту
  checkJob = schedule.scheduleJob('* * * * *', async () => {
    await checkEventReminders();
    await checkTaskDeadlines();
    await checkFollowUps();
  });

  logger.info('[Notifications] Сервис уведомлений запущен.');
}

/**
 * Проверяет события, для которых пора отправить напоминание.
 *
 * Логика: event_date - reminder_minutes <= NOW < event_date - reminder_minutes + 1 min
 * То есть: за reminder_minutes до начала события, с точностью до 1 минуты.
 */
async function checkEventReminders() {
  try {
    const now = new Date();
    const oneMinuteAhead = new Date(now.getTime() + 60 * 1000);

    // Находим события, для которых (event_date - reminder_minutes) попадает
    // в окно [now, now + 1 минута]
    // SQL: event_date - (reminder_minutes * interval '1 minute') BETWEEN now AND now + 1 min
    const events = await models.Event.findAll({
      where: {
        // event_date в будущем
        event_date: { [Op.gt]: now },
      },
      include: [
        {
          model: models.User,
          where: { is_active: true, telegram_id: { [Op.ne]: null } },
        },
      ],
    });

    for (const event of events) {
      const reminderMinutes = event.reminder_minutes || 15;
      const reminderTime = new Date(
        new Date(event.event_date).getTime() - reminderMinutes * 60 * 1000
      );

      // Проверяем, попадает ли время напоминания в текущую минуту
      if (reminderTime >= now && reminderTime < oneMinuteAhead) {
        await sendEventReminder(event);
      }
    }
  } catch (error) {
    logger.error('[Notifications] Ошибка проверки событий:', error);
  }
}

/**
 * Проверяет задачи с истекающими дедлайнами.
 * Отправляет напоминание за 1 час и за 15 минут до дедлайна.
 */
async function checkTaskDeadlines() {
  try {
    const now = new Date();
    const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);

    const tasks = await models.Task.findAll({
      where: {
        status: { [Op.in]: ['pending', 'in_progress'] },
        due_date: {
          [Op.gt]: now,
          [Op.lte]: oneHourAhead,
        },
      },
      include: [
        {
          model: models.User,
          as: 'creator',
          where: { is_active: true, telegram_id: { [Op.ne]: null } },
        },
      ],
    });

    for (const task of tasks) {
      await sendTaskDeadlineReminder(task);
    }
  } catch (error) {
    logger.error('[Notifications] Ошибка проверки задач:', error);
  }
}

/**
 * Проверяет предстоящие follow-up (CRM).
 * Отправляет напоминание в день follow-up.
 */
async function checkFollowUps() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

    // Находим follow-up, запланированные на сегодня
    // Проверяем только в 09:00 (чтобы не спамить каждую минуту)
    if (now.getHours() !== 9 || now.getMinutes() !== 0) {
      return;
    }

    const interactions = await models.Interaction.findAll({
      where: {
        scheduled_follow_up: {
          [Op.gte]: todayStart,
          [Op.lt]: todayEnd,
        },
      },
      include: [
        {
          model: models.Contact,
          include: [
            {
              model: models.User,
              where: { is_active: true, telegram_id: { [Op.ne]: null } },
            },
          ],
        },
      ],
    });

    for (const interaction of interactions) {
      await sendFollowUpReminder(interaction);
    }
  } catch (error) {
    logger.error('[Notifications] Ошибка проверки follow-up:', error);
  }
}

// --- Отправка уведомлений ---

async function sendEventReminder(event) {
  const bot = getBotInstance();
  if (!bot) return;

  const chatId = event.User.telegram_id;
  const minutes = event.reminder_minutes || 15;

  const startTime = new Date(event.event_date).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const text =
    `*Напоминание*\n\n` +
    `Через ${minutes} мин. начнётся:\n` +
    `*${event.title}*\n` +
    `Время: ${startTime}` +
    (event.description ? `\n${event.description}` : '');

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    logger.info(`[Notifications] Напоминание о событии ${event.id} отправлено user ${event.User.id}.`);
  } catch (error) {
    logger.error(`[Notifications] Ошибка отправки напоминания о событии ${event.id}:`, error);
  }
}

async function sendTaskDeadlineReminder(task) {
  const bot = getBotInstance();
  if (!bot) return;

  const chatId = task.creator.telegram_id;

  const dueTime = new Date(task.due_date).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const text =
    `*Дедлайн приближается*\n\n` +
    `Задача: *${task.title}*\n` +
    `Дедлайн: ${dueTime}\n` +
    `Статус: ${task.status}`;

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    logger.info(`[Notifications] Напоминание о задаче ${task.id} отправлено.`);
  } catch (error) {
    logger.error(`[Notifications] Ошибка отправки напоминания о задаче ${task.id}:`, error);
  }
}

async function sendFollowUpReminder(interaction) {
  const bot = getBotInstance();
  if (!bot) return;

  const contact = interaction.Contact;
  const user = contact.User;
  const chatId = user.telegram_id;

  const text =
    `*Follow-up напоминание*\n\n` +
    `Контакт: *${contact.name}*` +
    (contact.company ? ` (${contact.company})` : '') + `\n` +
    `Последнее взаимодействие: ${interaction.summary || 'не указано'}\n` +
    `Запланировано на сегодня.`;

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    logger.info(`[Notifications] Follow-up напоминание для контакта ${contact.id} отправлено.`);
  } catch (error) {
    logger.error(`[Notifications] Ошибка отправки follow-up напоминания:`, error);
  }
}

/**
 * Останавливает сервис уведомлений (graceful shutdown).
 */
export function stopNotificationService() {
  if (checkJob) {
    checkJob.cancel();
    checkJob = null;
    logger.info('[Notifications] Сервис уведомлений остановлен.');
  }
}
```

---

## 12. Чеклист готовности

### Перед началом

- [ ] Этап 3 (Универсальный API) завершен: `messageProcessor.js`, `UnifiedMessage`, `sessionManager.js` работают
- [ ] Этап 4 (Миграция на Claude) завершен: `claudeHandler.js` с tool_use работает, MCP-серверы подключены
- [ ] Модель User содержит поля: `telegram_id`, `timezone`, `language`, `subscription_tier`, `voice_mode`, `current_mode`, `digest_time`

### День 1: Разделение монолита + инициализация бота

- [ ] Создана директория `src/services/platforms/telegram/`
- [ ] Создан `bot.js` -- единственный экземпляр бота
- [ ] Добавлен `polling_error` обработчик
- [ ] Поддержка polling (dev) и webhook (production)
- [ ] Создан `messageHandler.js` -- текстовые сообщения через UnifiedMessage
- [ ] Создан `voiceHandler.js` -- голосовые сообщения (одно сообщение вместо двух)
- [ ] Удален `chatHistories = {}` -- история через sessionManager (БД)
- [ ] Удален `handleGPTResponse()` -- логика перенесена в messageProcessor + Claude tool_use
- [ ] Удален второй экземпляр бота из morningDigest
- [ ] Бот запускается и отвечает на текстовые и голосовые сообщения

### День 2: Команды + клавиатуры + форматирование

- [ ] Создан `commandHandler.js` -- все 7 команд (/start, /help, /settings, /mode, /stats, /calendar, /tasks)
- [ ] Команды зарегистрированы через `bot.setMyCommands()`
- [ ] Создан `keyboards.js` -- все клавиатуры (mainMenu, settings, timezone, language, voice, mode, confirm, taskStatus, pagination)
- [ ] Создан `callbackHandler.js` -- обработка всех callback_query
- [ ] Создан `formatters.js` -- форматирование событий, задач, заметок для Telegram
- [ ] /start работает (регистрация + приветствие + меню)
- [ ] /settings работает (изменение timezone, language, voice_mode)
- [ ] /mode работает (переключение work/companion)

### День 3: TTS + Vision + Companion + STT рефакторинг

- [ ] Создан `yandexTTS.js` -- синтез речи в OGG/Opus
- [ ] TTS интегрирован в voiceHandler (опциональный голосовой ответ)
- [ ] Настройка voice_mode работает (text / voice / auto)
- [ ] Создан `photoHandler.js` -- обработка фотографий через Claude Vision
- [ ] Фото -> base64 -> Claude API -> текстовый ответ работает
- [ ] Companion mode: отдельный системный промпт, переключение через /mode
- [ ] Рефакторинг STT: кроссплатформенный ffmpeg (ffmpeg-static), proper error handling
- [ ] `npm install ffmpeg-static` добавлен в зависимости

### День 4: Digest + Notifications + финализация

- [ ] Создан `digestService.js` -- утренний дайджест для всех пользователей
- [ ] Дайджест учитывает timezone каждого пользователя
- [ ] Дайджест получает события из Google Calendar через MCP (не из локальной БД)
- [ ] Дайджест включает: события + задачи + заметки + follow-up
- [ ] Создан `notificationService.js` -- проактивные напоминания
- [ ] Напоминания о событиях (за N минут)
- [ ] Напоминания о дедлайнах задач
- [ ] Напоминания о follow-up (CRM)
- [ ] Регистрация через Telegram работает (авто-создание User при первом сообщении)

### Интеграционные проверки

- [ ] Текстовое сообщение -> messageProcessor -> Claude -> tool_use -> ответ в Telegram
- [ ] Голосовое -> STT -> messageProcessor -> ответ текстом (+ опционально голосом)
- [ ] Фото -> base64 -> messageProcessor -> Claude Vision -> ответ в Telegram
- [ ] /start -> регистрация нового пользователя -> приветствие + меню
- [ ] /settings -> изменение timezone -> все даты в новом поясе
- [ ] /mode -> companion -> свободный разговор -> /mode -> work -> строгий секретарь
- [ ] Утренний дайджест приходит в указанное время в правильном часовом поясе
- [ ] Напоминание о событии приходит за N минут до начала
- [ ] Бот работает при перезагрузке (история сохранена в БД, а не в памяти)

### Удаление устаревших файлов

После завершения этапа 5, следующие файлы больше не нужны:

| Удалить | Причина | Замена |
|---------|---------|--------|
| `services/telegramBot.js` | Монолит разбит на модули | `src/services/platforms/telegram/*` |
| `services/morningDigest.js` | Рефакторинг | `src/services/core/digestService.js` |
| `services/yandexSpeechService.js` | Рефакторинг | `src/services/integrations/yandexSpeech.js` |
| `services/chatgptHandler.js` | Заменен на Claude (Этап 4) | `src/services/ai/claudeHandler.js` |
| `ffmpeg/` (директория с бинарниками) | Заменен на ffmpeg-static | `npm install ffmpeg-static` |

### Новые npm-зависимости

| Пакет | Назначение | Тип |
|-------|-----------|-----|
| `ffmpeg-static` | Кроссплатформенный ffmpeg | dependency |

Все остальные зависимости уже установлены (`node-telegram-bot-api`, `node-schedule`, `fluent-ffmpeg`).

---

## Маппинг: текущий код -> новый код

Для удобства навигации при рефакторинге:

| Текущий файл:строки | Что делает | Новый файл |
|---------------------|-----------|------------|
| `telegramBot.js:1-19` | Импорты + создание бота | `telegram/bot.js` |
| `telegramBot.js:29` | `chatHistories = {}` | УДАЛИТЬ (sessionManager в БД) |
| `telegramBot.js:32-370` | `handleGPTResponse()` | УДАЛИТЬ (messageProcessor + Claude tool_use) |
| `telegramBot.js:373-418` | `bot.on('message')` voice | `telegram/handlers/voiceHandler.js` |
| `telegramBot.js:421-435` | `bot.on('message')` text | `telegram/handlers/messageHandler.js` |
| `telegramBot.js:102-103` | `timeZone: "Asia/Dubai"` | User.timezone (из БД) |
| `telegramBot.js:208-209` | `timeZone: "Asia/Dubai"` | User.timezone (из БД) |
| `morningDigest.js:11` | Второй экземпляр бота | `getBotInstance()` из bot.js |
| `morningDigest.js:28-29` | `new Date()` (серверное время) | User.timezone |
| `morningDigest.js:32-40` | `models.Event.findAll` | Claude + MCP Google Calendar |
| `yandexSpeechService.js:15` | `ffmpeg.exe` путь | ffmpeg-static / системный |
| `yandexSpeechService.js:95` | `return ""` при ошибке | `throw error` |
