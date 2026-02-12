import models from '../models/index.js';
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
          [models.Sequelize.Op.lt]: cutoffDate,
        },
      },
    });

    logger.info(`Удалено ${result} старых сессий (старше ${daysOld} дней)`);
    return result;
  }
}

export default new SessionManager();
