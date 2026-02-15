import sessionManager from './sessionManager.js';
import claudeService from './claudeService.js';
import { createEvent as createGoogleEvent, updateEvent as updateGoogleEvent, deleteEvent as deleteGoogleEvent } from './googleCalendarService.js';
import { Op } from 'sequelize';
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
   * Определить намерение и выполнить действия (поддержка нескольких действий в одном сообщении)
   * Использует Claude AI для понимания запросов
   */
  async detectIntentAndAct(messageText, history, userId, options = {}) {
    try {
      // 1. Отправляем сообщение в Claude AI (с фото если есть)
      const aiResponse = await claudeService.sendMessage(messageText, history, {
        imageBuffer: options.imageBuffer,
        mimeType: 'image/jpeg',
      });

      const { response, actions, modelUsed } = aiResponse;

      // Определяем intent для логирования
      const mainIntent = actions.length > 0 ? actions.map((a) => a.type).join('+') : 'chat';
      logger.info(`AI: intent=${mainIntent}, model=${modelUsed}`);

      // 2. Выполняем ВСЕ действия из массива actions
      const allToolCalls = [];
      let enrichedResponse = null;

      for (const action of actions) {
        let toolCall = null;

        switch (action.type) {
          case 'create_note':
            toolCall = await this.executeCreateNote(userId, action.data);
            break;

          case 'create_task':
            toolCall = await this.executeCreateTask(userId, action.data);
            break;

          case 'create_event':
            toolCall = await this.executeCreateEvent(userId, action.data);
            break;

          case 'update_event':
            toolCall = await this.executeUpdateEvent(userId, action.data);
            break;

          case 'delete_event':
            toolCall = await this.executeDeleteEvent(userId, action.data);
            break;

          case 'delete_note':
            toolCall = await this.executeDeleteNote(userId, action.data);
            break;

          case 'delete_task':
            toolCall = await this.executeDeleteTask(userId, action.data);
            break;

          case 'create_reminder':
            toolCall = await this.executeCreateReminder(userId, action.data);
            break;

          case 'search':
          case 'list':
            toolCall = await this.executeList(userId, action.data, response);
            if (toolCall?.enrichedResponse) {
              enrichedResponse = toolCall.enrichedResponse;
            }
            break;

          case 'chat':
          default:
            break;
        }

        if (toolCall) {
          allToolCalls.push(toolCall);
        }
      }

      return {
        intent: mainIntent,
        response: enrichedResponse || response,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
      };
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
    // Claude может вернуть content, title+description, text, или просто title
    const content = data?.content || data?.text || data?.description || data?.title || data?.note;
    if (!content) {
      logger.warn('executeCreateNote: нет подходящего поля в data:', JSON.stringify(data));
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
        location: data.location || null,
        event_date: eventDate,
        end_date: endDate,
        reminder_minutes: data.reminder_minutes || 15,
      });

      // 2. Синхронизируем с Google Calendar (per-user OAuth2)
      try {
        const gcalEventData = {
          summary: data.title,
          description: data.description || '',
          start: { dateTime: eventDate.toISOString() },
          end: { dateTime: endDate.toISOString() },
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: data.reminder_minutes || 15 }],
          },
        };
        if (data.location) gcalEventData.location = data.location;

        const gcalEvent = await createGoogleEvent(userId, gcalEventData);

        // Сохраняем Google Calendar ID для будущей синхронизации
        await event.update({ google_calendar_event_id: gcalEvent.id });
        logger.info(`Событие синхронизировано с Google Calendar: gcal_id=${gcalEvent.id}`);
      } catch (gcalError) {
        // Google Calendar недоступен — событие всё равно сохранено в БД
        logger.warn('Google Calendar sync failed (событие сохранено локально):', {
          message: gcalError.message,
          code: gcalError.code,
          errors: gcalError.errors,
          status: gcalError.status,
          stack: gcalError.stack?.split('\n').slice(0, 3).join(' | '),
        });
      }

      // 3. Автоматическое напоминание в Telegram (за reminder_minutes до события)
      const reminderMinutes = data.reminder_minutes || 15;
      const remindAt = new Date(eventDate.getTime() - reminderMinutes * 60 * 1000);

      // Создаём напоминание только если время ещё не прошло
      if (remindAt > new Date()) {
        try {
          await models.Reminder.create({
            user_id: userId,
            text: `Через ${reminderMinutes} мин: ${data.title}${data.location ? ` (${data.location})` : ''}`,
            remind_at: remindAt,
            event_id: event.id,
            is_recurring: false,
            is_sent: false,
          });
          logger.info(`Авто-напоминание создано: за ${reminderMinutes} мин до "${data.title}"`);
        } catch (remErr) {
          logger.warn('Ошибка создания авто-напоминания:', remErr.message);
        }
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
   * Обновить существующее событие (локально + Google Calendar)
   */
  async executeUpdateEvent(userId, data) {
    if (!data?.title) {
      logger.warn('executeUpdateEvent: нет title для поиска события');
      return null;
    }

    try {
      // Ищем событие по title (последнее совпадение)
      const event = await models.Event.findOne({
        where: {
          user_id: userId,
          title: { [Op.iLike]: `%${data.title}%` },
        },
        order: [['created_at', 'DESC']],
      });

      if (!event) {
        logger.warn(`executeUpdateEvent: событие "${data.title}" не найдено для user=${userId}`);
        return null;
      }

      // Обновляем локально
      const updateData = {};
      if (data.new_title) updateData.title = data.new_title;
      if (data.location) updateData.location = data.location;
      if (data.description) updateData.description = data.description;
      if (data.event_date) updateData.event_date = new Date(data.event_date);
      if (data.end_date) updateData.end_date = new Date(data.end_date);

      await event.update(updateData);

      // Обновляем в Google Calendar (patch — частичное обновление)
      if (event.google_calendar_event_id) {
        try {
          const gcalUpdate = {};
          if (data.new_title) gcalUpdate.summary = data.new_title;
          if (data.location) gcalUpdate.location = data.location;
          if (data.description) gcalUpdate.description = data.description;
          if (data.event_date) gcalUpdate.start = { dateTime: new Date(data.event_date).toISOString() };
          if (data.end_date) gcalUpdate.end = { dateTime: new Date(data.end_date).toISOString() };

          await updateGoogleEvent(userId, event.google_calendar_event_id, gcalUpdate);
          logger.info(`Событие обновлено в Google Calendar: gcal_id=${event.google_calendar_event_id}`);
        } catch (gcalError) {
          logger.warn('Google Calendar update failed:', {
            message: gcalError.message,
            code: gcalError.code,
            errors: gcalError.errors,
            status: gcalError.status,
            stack: gcalError.stack?.split('\n').slice(0, 3).join(' | '),
          });
        }
      }

      logger.info(`Обновлено событие: id=${event.id}, user=${userId}`);
      return { action: 'update_event', result: { event_id: event.id } };
    } catch (error) {
      logger.error('Ошибка обновления события:', error);
      return null;
    }
  }

  /**
   * Удалить событие (локально + Google Calendar)
   */
  async executeDeleteEvent(userId, data) {
    if (!data?.title) {
      logger.warn('executeDeleteEvent: нет title для поиска события');
      return null;
    }

    try {
      const event = await models.Event.findOne({
        where: {
          user_id: userId,
          title: { [Op.iLike]: `%${data.title}%` },
        },
        order: [['created_at', 'DESC']],
      });

      if (!event) {
        logger.warn(`executeDeleteEvent: событие "${data.title}" не найдено для user=${userId}`);
        return null;
      }

      // Удаляем из Google Calendar
      if (event.google_calendar_event_id) {
        try {
          await deleteGoogleEvent(userId, event.google_calendar_event_id);
          logger.info(`Событие удалено из Google Calendar: gcal_id=${event.google_calendar_event_id}`);
        } catch (gcalError) {
          logger.warn('Google Calendar delete failed:', gcalError.message);
        }
      }

      const eventTitle = event.title;
      await event.destroy();
      logger.info(`Удалено событие: "${eventTitle}", user=${userId}`);

      return { action: 'delete_event', result: { deleted: eventTitle } };
    } catch (error) {
      logger.error('Ошибка удаления события:', error);
      return null;
    }
  }

  /**
   * Удалить заметку
   */
  async executeDeleteNote(userId, data) {
    const searchText = data?.content || data?.text || data?.title;
    if (!searchText) {
      logger.warn('executeDeleteNote: нет текста для поиска заметки');
      return null;
    }

    try {
      const note = await models.Note.findOne({
        where: {
          user_id: userId,
          content: { [Op.iLike]: `%${searchText}%` },
        },
        order: [['created_at', 'DESC']],
      });

      if (!note) {
        logger.warn(`executeDeleteNote: заметка "${searchText}" не найдена для user=${userId}`);
        return null;
      }

      const noteContent = note.content;
      await note.destroy();
      logger.info(`Удалена заметка: "${noteContent}", user=${userId}`);

      return { action: 'delete_note', result: { deleted: noteContent } };
    } catch (error) {
      logger.error('Ошибка удаления заметки:', error);
      return null;
    }
  }

  /**
   * Удалить задачу
   */
  async executeDeleteTask(userId, data) {
    if (!data?.title) {
      logger.warn('executeDeleteTask: нет title для поиска задачи');
      return null;
    }

    try {
      const task = await models.Task.findOne({
        where: {
          created_by: userId,
          title: { [Op.iLike]: `%${data.title}%` },
        },
        order: [['created_at', 'DESC']],
      });

      if (!task) {
        logger.warn(`executeDeleteTask: задача "${data.title}" не найдена для user=${userId}`);
        return null;
      }

      const taskTitle = task.title;
      await task.destroy();
      logger.info(`Удалена задача: "${taskTitle}", user=${userId}`);

      return { action: 'delete_task', result: { deleted: taskTitle } };
    } catch (error) {
      logger.error('Ошибка удаления задачи:', error);
      return null;
    }
  }

  /**
   * Создать напоминание
   */
  async executeCreateReminder(userId, data) {
    if (!data?.text || !data?.remind_at) {
      logger.warn('executeCreateReminder: нет text или remind_at');
      return null;
    }

    try {
      const reminder = await models.Reminder.create({
        user_id: userId,
        text: data.text,
        remind_at: new Date(data.remind_at),
        is_recurring: data.is_recurring || false,
        recurrence_rule: data.recurrence_rule || null,
        is_sent: false,
      });

      logger.info(`Создано напоминание: id=${reminder.id}, user=${userId}, at=${data.remind_at}`);

      return {
        action: 'create_reminder',
        result: { reminder_id: reminder.id, remind_at: data.remind_at },
      };
    } catch (error) {
      logger.error('Ошибка создания напоминания:', error);
      return null;
    }
  }

  /**
   * Показать список заметок, задач или событий
   */
  async executeList(userId, data, aiResponse) {
    try {
      const type = data?.type || 'all';

      let notes = [];
      let tasks = [];
      let events = [];
      let reminders = [];

      if (type === 'all' || type === 'notes') {
        notes = await models.Note.findAll({
          where: { user_id: userId },
          order: [['created_at', 'DESC']],
          limit: 10,
        });
      }

      if (type === 'all' || type === 'tasks') {
        tasks = await models.Task.findAll({
          where: { created_by: userId },
          order: [['created_at', 'DESC']],
          limit: 10,
        });
      }

      if (type === 'all' || type === 'events') {
        events = await models.Event.findAll({
          where: { user_id: userId },
          order: [['event_date', 'ASC']],
          limit: 10,
        });
      }

      if (type === 'all' || type === 'reminders') {
        reminders = await models.Reminder.findAll({
          where: { user_id: userId, is_sent: false },
          order: [['remind_at', 'ASC']],
          limit: 10,
        });
      }

      // Формируем текстовый ответ с реальными данными
      let enrichedResponse = '';

      if (notes.length > 0) {
        enrichedResponse += '📝 **Заметки:**\n';
        notes.forEach((n, i) => {
          enrichedResponse += `${i + 1}. ${n.content}\n`;
        });
        enrichedResponse += '\n';
      }

      if (tasks.length > 0) {
        enrichedResponse += '✅ **Задачи:**\n';
        tasks.forEach((t, i) => {
          const status = t.status === 'completed' ? '✓' : '○';
          enrichedResponse += `${status} ${t.title} [${t.priority}]\n`;
        });
        enrichedResponse += '\n';
      }

      if (events.length > 0) {
        enrichedResponse += '📅 **События:**\n';
        events.forEach((e, i) => {
          const date = new Date(e.event_date).toLocaleString('ru-RU');
          enrichedResponse += `${i + 1}. ${e.title} — ${date}\n`;
        });
        enrichedResponse += '\n';
      }

      if (reminders.length > 0) {
        enrichedResponse += '🔔 **Напоминания:**\n';
        reminders.forEach((r, i) => {
          const date = new Date(r.remind_at).toLocaleString('ru-RU');
          const recurring = r.is_recurring ? ' 🔄' : '';
          enrichedResponse += `${i + 1}. ${r.text} — ${date}${recurring}\n`;
        });
        enrichedResponse += '\n';
      }

      if (!enrichedResponse) {
        enrichedResponse = 'У тебя пока нет заметок, задач, событий или напоминаний. Создай что-нибудь!';
      }

      logger.info(`Список: notes=${notes.length}, tasks=${tasks.length}, events=${events.length}, reminders=${reminders.length}`);

      return {
        action: 'list',
        result: { notes: notes.length, tasks: tasks.length, events: events.length },
        enrichedResponse,
      };
    } catch (error) {
      logger.error('Ошибка executeList:', error);
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
