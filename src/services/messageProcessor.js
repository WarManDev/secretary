import sessionManager from './sessionManager.js';
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
    metadata = {},
  }) {
    try {
      // 1. Получаем или создаём сессию
      const session = await sessionManager.getOrCreateSession(userId, platform, metadata);

      // 2. Сохраняем сообщение пользователя
      await sessionManager.addMessage(session.id, 'user', messageText, messageType);

      // 3. Загружаем контекст (история диалога)
      const history = await sessionManager.getHistoryForAI(session.id);

      // 4. Определяем намерение и выполняем действие
      const { intent, response, toolCalls } = await this.detectIntentAndAct(
        messageText,
        history,
        userId
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
   * TODO: Интеграция с Claude API (Stage 4)
   */
  async detectIntentAndAct(messageText, history, userId) {
    // Заглушка - будет заменена на Claude API в Stage 4
    const lowerText = messageText.toLowerCase();

    // Простое определение намерения (пока без AI)
    let intent = 'chat';
    let response =
      'Функционал AI находится в разработке (Stage 4). Пока доступны только REST API endpoints.';
    let toolCalls = null;

    // Простые команды для теста
    if (lowerText.includes('создай заметку') || lowerText.includes('запиши')) {
      intent = 'create_note';
      // Пока заглушка - в Stage 4 будет работать через Claude
      response = 'Используйте POST /api/notes для создания заметок через API';
    } else if (lowerText.includes('события') || lowerText.includes('календарь')) {
      intent = 'show_events';
      response = 'Используйте GET /api/events для просмотра событий через API';
    } else if (lowerText.includes('задачи') || lowerText.includes('todo')) {
      intent = 'show_tasks';
      response = 'Используйте GET /api/tasks для просмотра задач через API';
    }

    return { intent, response, toolCalls };
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
