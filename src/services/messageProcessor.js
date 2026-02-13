import sessionManager from './sessionManager.js';
import claudeService from './claudeService.js';
import { createEvent as createGoogleEvent } from './googleCalendarService.js';
import logger from '../config/logger.js';
import models from '../models/index.js';

/**
 * MessageProcessor - универсальный обработчик сообщений
 * Работает с любой платформой (Telegram, Web, Mobile, API)
 */
class MessageProcessor {
  /**
   * Обработать входящее сообщение
   * @param {Object} params
   * @param {number} params.userId - ID пользователя
   * @param {string} params.messageText - Текст сообщения
   * @param {string} params.platform - 'telegram', 'web', 'mobile', 'api'
   * @param {string} params.messageType - 'text', 'voice', 'photo'
   * @param {Object} params.metadata - Доп. данные (chat_id, file_id и т.д.)
   * @returns {Object} - { response, session, messages }
   */
  async processMessage({
    userId,
    messageText,
    platform = 'api',
    messageType = 'text',
    imageBuffer = null,
    metadata = {},
  }) {
    try {
      // 1. Получаем или создаём сессию
      const session = await sessionManager.getOrCreateSession(userId, platform, metadata);

      // 2. Загружаем контекст ПЕРЕД сохранением (иначе текущее сообщение дублируется)
      const historyData = await sessionManager.getHistoryWithSummary(session.id, 10);

      // 3. Сохраняем сообщение пользователя в БД (для фото без подписи сохраняем placeholder)
      const textToSave = messageText || (messageType === 'photo' ? '[Фото]' : '[Сообщение]');
      await sessionManager.addMessage(session.id, 'user', textToSave, messageType);

      // 4. Если нужно создать summary - создаём асинхронно (не блокируем ответ)
      if (historyData.shouldCreateSummary) {
        // Создаём summary в фоне (не ждём завершения)
        sessionManager.generateSummary(session.id).catch((err) => {
          logger.error(`Ошибка фонового создания summary для сессии ${session.id}:`, err);
        });
      }

      // 5. Определяем намерение и выполняем действие
      const { intent, response, toolCalls } = await this.detectIntentAndAct(
        messageText,
        historyData,
        userId,
        { imageBuffer }
      );

      // 5. Сохраняем ответ бота
      await sessionManager.addMessage(
        session.id,
        'bot',
        response,
        'text',
        toolCalls,
        'claude-haiku-4-5'
      );

      logger.info(`Сообщение обработано: user=${userId}, session=${session.id}, intent=${intent}`);

      return {
        success: true,
        response,
        session,
        intent,
      };
    } catch (error) {
      logger.error('Ошибка обработки сообщения:', error);
      throw error;
    }
  }

  /**
   * Определить намерение и выполнить действие
   * Использует Claude AI для понимания запросов
   */
  async detectIntentAndAct(messageText, history, userId, options = {}) {
    try {
      // 1. Отправляем сообщение в Claude AI (с фото если есть)
      const aiResponse = await claudeService.sendMessage(messageText, history, {
        imageBuffer: options.imageBuffer,
        mimeType: 'image/jpeg',
      });

      const { intent, response, data, modelUsed } = aiResponse;

      logger.info(`AI: intent=${intent}, model=${modelUsed}`);

      // 2. Выполняем действие в зависимости от намерения
      let toolCalls = null;

      switch (intent) {
        case 'create_note':
          toolCalls = await this.executeCreateNote(userId, data);
          break;

        case 'create_task':
          toolCalls = await this.executeCreateTask(userId, data);
          break;

        case 'create_event':
          toolCalls = await this.executeCreateEvent(userId, data);
          break;

        case 'search':
        case 'list':
          // TODO: реализовать поиск/список (Stage 5)
          break;

        case 'chat':
        case 'help':
        default:
          // Просто разговор, ничего не делаем
          break;
      }

      return { intent, response, toolCalls };
    } catch (error) {
      logger.error('Ошибка detectIntentAndAct:', error);

      // Fallback на простой ответ
      return {
        intent: 'error',
        response: 'Извините, произошла ошибка. Попробуйте ещё раз.',
        toolCalls: null,
      };
    }
  }

  /**
   * Создать заметку
   */
  async executeCreateNote(userId, data) {
    // Claude может вернуть content, title+description, или просто title
    const content = data?.content || data?.description || data?.title;
    if (!content) {
      logger.warn('executeCreateNote: нет content/title/description в data');
      return null;
    }

    try {
      const note = await models.Note.create({
        user_id: userId,
        content: data.title ? `${data.title}: ${data.description || ''}`.trim() : content,
        category: data.category || 'general',
        completed: false,
      });

      logger.info(`Создана заметка: id=${note.id}, user=${userId}`);

      return {
        action: 'create_note',
        result: { note_id: note.id },
      };
    } catch (error) {
      logger.error('Ошибка создания заметки:', error);
      return null;
    }
  }

  /**
   * Создать задачу
   */
  async executeCreateTask(userId, data) {
    if (!data?.title) {
      logger.warn('executeCreateTask: нет title в data');
      return null;
    }

    try {
      const task = await models.Task.create({
        created_by: userId,
        title: data.title,
        description: data.description || null,
        priority: data.priority || 'medium',
        status: 'pending',
        due_date: data.due_date || null,
        tags: data.tags || [],
      });

      logger.info(`Создана задача: id=${task.id}, user=${userId}`);

      return {
        action: 'create_task',
        result: { task_id: task.id },
      };
    } catch (error) {
      logger.error('Ошибка создания задачи:', error);
      return null;
    }
  }

  /**
   * Создать событие
   */
  async executeCreateEvent(userId, data) {
    if (!data?.title || !data?.event_date) {
      logger.warn('executeCreateEvent: нет title или event_date в data');
      return null;
    }

    try {
      const eventDate = new Date(data.event_date);
      const endDate = data.end_date ? new Date(data.end_date) : new Date(eventDate.getTime() + 60 * 60 * 1000); // +1 час по умолчанию

      // 1. Сохраняем в локальную БД
      const event = await models.Event.create({
        user_id: userId,
        title: data.title,
        description: data.description || null,
        event_date: eventDate,
        end_date: endDate,
        reminder_minutes: data.reminder_minutes || 15,
      });

      // 2. Синхронизируем с Google Calendar
      try {
        const gcalEvent = await createGoogleEvent({
          summary: data.title,
          description: data.description || '',
          start: { dateTime: eventDate.toISOString() },
          end: { dateTime: endDate.toISOString() },
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: data.reminder_minutes || 15 }],
          },
        });

        // Сохраняем Google Calendar ID для будущей синхронизации
        await event.update({ google_calendar_event_id: gcalEvent.id });
        logger.info(`Событие синхронизировано с Google Calendar: gcal_id=${gcalEvent.id}`);
      } catch (gcalError) {
        // Google Calendar недоступен — событие всё равно сохранено в БД
        logger.warn('Google Calendar sync failed (событие сохранено локально):', gcalError.message);
      }

      logger.info(`Создано событие: id=${event.id}, user=${userId}`);

      return {
        action: 'create_event',
        result: { event_id: event.id, google_synced: !!event.google_calendar_event_id },
      };
    } catch (error) {
      logger.error('Ошибка создания события:', error);
      return null;
    }
  }

  /**
   * Обработать голосовое сообщение
   */
  async processVoiceMessage({ userId, voiceFileId, platform = 'telegram', metadata = {} }) {
    logger.info(`Голосовое сообщение от user=${userId}`);

    // TODO: Транскрипция через Yandex SpeechKit (уже есть в yandexSpeechService.js)
    // После транскрипции - передать в processMessage как текст

    return {
      success: true,
      response: 'Обработка голосовых сообщений будет добавлена в следующих версиях',
    };
  }

  /**
   * Обработать фото
   */
  async processPhoto({ userId, photoUrl, caption, platform = 'telegram', metadata = {} }) {
    logger.info(`Фото от user=${userId}, caption="${caption}"`);

    // TODO: Обработка фото через Claude Vision API (Stage 6)

    return {
      success: true,
      response: 'Обработка фото будет добавлена в Stage 6 (Vision)',
    };
  }
}

export default new MessageProcessor();
