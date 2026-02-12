import models from '../models/index.js';
import { Op } from 'sequelize';
import logger from '../config/logger.js';

/**
 * SessionManager - управление сессиями и историей сообщений в БД
 * Заменяет chatHistories из памяти
 */
class SessionManager {
  /**
   * Получить или создать активную сессию для пользователя
   */
  async getOrCreateSession(userId, platform = 'telegram', metadata = {}) {
    // Ищем активную сессию (без ended_at)
    let session = await models.Session.findOne({
      where: {
        user_id: userId,
        platform,
        ended_at: null,
      },
      order: [['started_at', 'DESC']],
    });

    // Если нет - создаём новую
    if (!session) {
      session = await models.Session.create({
        user_id: userId,
        platform,
        session_type: 'work',
        metadata,
        started_at: new Date(),
      });

      logger.info(`Создана новая сессия ${session.id} для пользователя ${userId} (${platform})`);
    }

    return session;
  }

  /**
   * Добавить сообщение в сессию
   */
  async addMessage(
    sessionId,
    sender,
    messageText,
    messageType = 'text',
    toolCalls = null,
    modelUsed = null
  ) {
    const message = await models.Message.create({
      session_id: sessionId,
      sender, // 'user', 'bot', 'system'
      message_text: messageText,
      message_type: messageType,
      tool_calls: toolCalls,
      model_used: modelUsed,
    });

    return message;
  }

  /**
   * Получить историю сообщений сессии
   */
  async getSessionHistory(sessionId, limit = 50) {
    const messages = await models.Message.findAll({
      where: { session_id: sessionId },
      order: [['created_at', 'ASC']],
      limit,
    });

    return messages;
  }

  /**
   * Получить историю в формате для AI (Claude/GPT)
   * DEPRECATED: используйте getHistoryWithSummary для оптимизации
   */
  async getHistoryForAI(sessionId, limit = 20) {
    const messages = await this.getSessionHistory(sessionId, limit);

    // Преобразуем в формат Claude API
    return messages.map((msg) => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.message_text,
    }));
  }

  /**
   * Получить историю с оптимизацией (summary + последние сообщения)
   *
   * Логика:
   * - Если <= 10 сообщений: отправить все
   * - Если 11-30 сообщений: отправить последние 10 + prompt cache
   * - Если > 30 сообщений: summary + последние 10
   */
  async getHistoryWithSummary(sessionId, recentLimit = 10) {
    const allMessages = await this.getSessionHistory(sessionId, 100); // Берём больше для анализа
    const totalCount = allMessages.length;

    // Если мало сообщений - отправляем все
    if (totalCount <= recentLimit) {
      return {
        messages: allMessages.map((msg) => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.message_text,
        })),
        hasSummary: false,
        shouldCreateSummary: false,
      };
    }

    // Если средне (11-30) - отправляем последние N
    if (totalCount <= 30) {
      const recentMessages = allMessages.slice(-recentLimit);
      const olderMessages = allMessages.slice(0, -recentLimit);

      return {
        messages: [
          // Старые сообщения (будут закэшированы)
          ...olderMessages.map((msg) => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.message_text,
          })),
          // Последние сообщения (не в кэше)
          ...recentMessages.map((msg) => ({
            role: msg.sender === 'user' ? 'user' : 'assistant',
            content: msg.message_text,
          })),
        ],
        cacheBreakpoint: olderMessages.length > 0 ? olderMessages.length - 1 : null,
        hasSummary: false,
        shouldCreateSummary: false,
      };
    }

    // Если много (>30) - используем summary
    const session = await models.Session.findByPk(sessionId);
    const recentMessages = allMessages.slice(-recentLimit);

    let summaryMessage = null;
    let shouldCreateSummary = false;

    if (session?.current_summary) {
      // Есть summary - используем его
      summaryMessage = {
        role: 'user',
        content: `[КОНТЕКСТ ДИАЛОГА]\n${session.current_summary}\n[КОНЕЦ КОНТЕКСТА]`,
      };
    } else {
      // Нет summary - нужно создать
      shouldCreateSummary = true;
      // Временно отправляем первые 10 как есть
      const oldMessages = allMessages.slice(0, 20);
      summaryMessage = {
        role: 'user',
        content: `[РАННИЕ СООБЩЕНИЯ]\n${oldMessages.map((m) => `${m.sender}: ${m.message_text}`).join('\n')}\n[КОНЕЦ РАННИХ СООБЩЕНИЙ]`,
      };
    }

    return {
      messages: [
        summaryMessage,
        ...recentMessages.map((msg) => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.message_text,
        })),
      ],
      cacheBreakpoint: 0, // Кэшируем summary
      hasSummary: !!session?.current_summary,
      shouldCreateSummary,
    };
  }

  /**
   * Создать summary через Claude AI
   */
  async generateSummary(sessionId) {
    const messages = await this.getSessionHistory(sessionId, 100);

    if (messages.length < 10) {
      logger.warn(`Сессия ${sessionId} слишком короткая для summary (${messages.length} сообщений)`);
      return null;
    }

    // Берём первые 20-30 сообщений для summary
    const messagesToSummarize = messages.slice(0, Math.min(30, messages.length - 10));

    // Формируем промпт для summarization
    const conversationText = messagesToSummarize
      .map((msg) => `${msg.sender === 'user' ? 'Пользователь' : 'Ассистент'}: ${msg.message_text}`)
      .join('\n');

    const summaryPrompt = `Создай краткую сводку следующего диалога (3-5 предложений). Укажи ключевые темы, созданные заметки/задачи/события, важные детали:

${conversationText}

Сводка:`;

    try {
      // Используем Haiku для экономии (summarization не требует Sonnet)
      const claudeService = (await import('./claudeService.js')).default;
      const result = await claudeService.sendMessage(summaryPrompt, [], { forceModel: claudeService.models.haiku });

      const summaryText = result.response;

      // Сохраняем summary
      await this.createSummary(sessionId, summaryText);

      logger.info(`Summary создан для сессии ${sessionId}: ${summaryText.substring(0, 50)}...`);

      return summaryText;
    } catch (error) {
      logger.error(`Ошибка создания summary для сессии ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Завершить сессию
   */
  async endSession(sessionId, summary = null) {
    const session = await models.Session.findByPk(sessionId);

    if (!session) {
      logger.warn(`Попытка завершить несуществующую сессию ${sessionId}`);
      return null;
    }

    await session.update({
      ended_at: new Date(),
      current_summary: summary,
    });

    logger.info(`Сессия ${sessionId} завершена`);
    return session;
  }

  /**
   * Создать сводку сессии (для длинных диалогов)
   */
  async createSummary(sessionId, summaryText) {
    const summary = await models.Summary.create({
      session_id: sessionId,
      summary_text: summaryText,
    });

    // Обновляем current_summary в сессии
    await models.Session.update({ current_summary: summaryText }, { where: { id: sessionId } });

    logger.info(`Создана сводка для сессии ${sessionId}`);
    return summary;
  }

  /**
   * Очистка старых сессий (cron job)
   */
  async cleanupOldSessions(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await models.Session.destroy({
      where: {
        ended_at: {
          [Op.lt]: cutoffDate,
        },
      },
    });

    logger.info(`Удалено ${result} старых сессий (старше ${daysOld} дней)`);
    return result;
  }
}

export default new SessionManager();
