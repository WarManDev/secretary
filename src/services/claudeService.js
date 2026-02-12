import Anthropic from '@anthropic-ai/sdk';
import config from '../config/index.js';
import logger from '../config/logger.js';

/**
 * Claude AI Service
 *
 * Интеграция с Anthropic Claude API
 * - Гибридная модель: Haiku (быстро/дешево) + Sonnet (умно/дорого)
 * - Prompt caching: экономия до 90% на системном промпте
 * - Intent detection: понимание намерений пользователя
 * - Tool calling: интеграция с базой данных и сервисами
 */
class ClaudeService {
  constructor() {
    if (!config.anthropic.apiKey) {
      logger.warn('⚠️ ANTHROPIC_API_KEY не найден. ClaudeService работает в режиме заглушки.');
      this.client = null;
    } else {
      this.client = new Anthropic({
        apiKey: config.anthropic.apiKey,
      });
      logger.info('✓ Claude AI Service инициализирован');
    }

    // Модели
    this.models = {
      haiku: 'claude-haiku-4-5-20251001', // Быстрая и дешевая (70% запросов)
      sonnet: 'claude-sonnet-4-5-20250929', // Умная и дорогая (30% запросов)
    };

    // Системный промпт (будет кэшироваться)
    this.systemPrompt = this._buildSystemPrompt();
  }

  /**
   * Строим системный промпт для секретаря
   */
  _buildSystemPrompt() {
    return `Ты - AI-секретарь, который помогает предпринимателям управлять задачами, событиями и заметками.

**Твои возможности:**

1. **Заметки (Notes)**
   - Создавать быстрые заметки: "запомни что надо купить молоко"
   - Категории: work, personal, ideas, meeting_notes, general

2. **Задачи (Tasks)**
   - Создавать задачи с приоритетом: "создай задачу подготовить отчет, высокий приоритет"
   - Приоритеты: low, medium, high, urgent
   - Статусы: pending, in_progress, completed, cancelled

3. **События (Events)**
   - Создавать события в календаре: "встреча с клиентом завтра в 15:00"
   - Поддержка рекуррентных событий
   - Напоминания

4. **Поиск и аналитика**
   - Искать заметки, задачи, события
   - Сводки и отчеты

**Стиль общения:**
- Дружелюбный и профессиональный
- Краткие и четкие ответы
- Проактивные предложения
- На русском языке

**Intent Detection:**
Определяй намерение пользователя и возвращай один из:
- create_note - создать заметку
- create_task - создать задачу
- create_event - создать событие
- search - поиск информации
- list - показать список
- chat - обычный разговор
- help - помощь

**Формат ответа:**
Всегда отвечай в JSON формате:
{
  "intent": "create_task",
  "response": "Создал задачу 'Подготовить отчет' с высоким приоритетом",
  "data": {
    "title": "Подготовить отчет",
    "priority": "high",
    "description": "..."
  }
}`;
  }

  /**
   * Определяем какую модель использовать
   * Haiku - для простых задач (70% запросов)
   * Sonnet - для сложных (30% запросов)
   */
  _selectModel(messageText, history = []) {
    // Простые паттерны → Haiku
    const simplePatterns = [
      /^(привет|здравствуй|hi|hello)/i,
      /^(создай|добавь|запиши|запомни)/i,
      /^(покажи|список|что|когда)/i,
    ];

    if (simplePatterns.some((pattern) => pattern.test(messageText))) {
      return this.models.haiku;
    }

    // Длинная история → Sonnet (нужно больше контекста)
    if (history.length > 10) {
      return this.models.sonnet;
    }

    // Длинное сообщение → Sonnet
    if (messageText.length > 200) {
      return this.models.sonnet;
    }

    // По умолчанию Haiku (экономим)
    return this.models.haiku;
  }

  /**
   * Основной метод: отправка сообщения в Claude
   *
   * @param {string} userMessage - сообщение пользователя
   * @param {Array|Object} history - история диалога или объект с messages + cacheBreakpoint
   * @param {Object} options - дополнительные опции
   * @returns {Object} { intent, response, data, modelUsed, tokensUsed }
   */
  async sendMessage(userMessage, history = [], options = {}) {
    // Режим заглушки (если нет API ключа)
    if (!this.client) {
      logger.warn('ClaudeService: работа в режиме заглушки (нет API ключа)');
      return this._fallbackResponse(userMessage);
    }

    try {
      // Распаковываем history (может быть массив или объект с cacheBreakpoint)
      let messages = [];
      let cacheBreakpoint = null;

      if (Array.isArray(history)) {
        // Старый формат - простой массив
        messages = this._formatHistory(history);
      } else if (history.messages) {
        // Новый формат - объект с messages и cacheBreakpoint
        messages = this._formatHistory(history.messages);
        cacheBreakpoint = history.cacheBreakpoint;
      }

      // Добавляем cache_control на breakpoint (если есть)
      if (cacheBreakpoint !== null && messages[cacheBreakpoint]) {
        messages[cacheBreakpoint].cache_control = { type: 'ephemeral' };
      }

      // Добавляем текущее сообщение
      messages.push({
        role: 'user',
        content: userMessage,
      });

      // Выбираем модель (Haiku или Sonnet)
      const model = options.forceModel || this._selectModel(userMessage, messages);

      logger.info(`Claude API: используем ${model === this.models.haiku ? 'Haiku' : 'Sonnet'}`);

      // Отправляем запрос в Claude
      const response = await this.client.messages.create({
        model,
        max_tokens: 1024,
        system: [
          {
            type: 'text',
            text: this.systemPrompt,
            cache_control: { type: 'ephemeral' }, // Кэшируем системный промпт!
          },
        ],
        messages,
      });

      // Парсим ответ
      const result = this._parseResponse(response);

      // Логируем использование токенов
      this._logTokenUsage(response.usage, model);

      return {
        ...result,
        modelUsed: model,
        tokensUsed: response.usage,
      };
    } catch (error) {
      logger.error('Claude API error:', error);

      // Fallback на заглушку при ошибке
      return this._fallbackResponse(userMessage, error);
    }
  }

  /**
   * Форматируем историю диалога для Claude API
   */
  _formatHistory(history) {
    return history.map((msg) => ({
      role: msg.role === 'bot' ? 'assistant' : 'user',
      content: msg.content,
    }));
  }

  /**
   * Парсим ответ от Claude
   */
  _parseResponse(response) {
    const content = response.content[0].text;

    try {
      // Пытаемся распарсить JSON
      const parsed = JSON.parse(content);

      return {
        intent: parsed.intent || 'chat',
        response: parsed.response || content,
        data: parsed.data || null,
      };
    } catch (error) {
      // Если не JSON, возвращаем как обычный текст
      return {
        intent: 'chat',
        response: content,
        data: null,
      };
    }
  }

  /**
   * Логируем использование токенов (для мониторинга расходов)
   */
  _logTokenUsage(usage, model) {
    const costs = {
      'claude-haiku-4-5-20251001': {
        input: 0.25 / 1_000_000, // $0.25 per MTok
        output: 1.25 / 1_000_000, // $1.25 per MTok
        cacheWrite: 0.3125 / 1_000_000,
        cacheRead: 0.025 / 1_000_000, // 90% дешевле!
      },
      'claude-sonnet-4-5-20250929': {
        input: 3.0 / 1_000_000, // $3 per MTok
        output: 15.0 / 1_000_000, // $15 per MTok
        cacheWrite: 3.75 / 1_000_000,
        cacheRead: 0.3 / 1_000_000,
      },
    };

    const price = costs[model];
    if (!price) return;

    const inputCost = usage.input_tokens * price.input;
    const outputCost = usage.output_tokens * price.output;
    const cacheWriteCost = (usage.cache_creation_input_tokens || 0) * price.cacheWrite;
    const cacheReadCost = (usage.cache_read_input_tokens || 0) * price.cacheRead;

    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

    logger.info('Claude API usage:', {
      model: model.includes('haiku') ? 'Haiku' : 'Sonnet',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cost: `$${totalCost.toFixed(6)}`,
    });
  }

  /**
   * Fallback ответ (когда нет API ключа или ошибка)
   */
  _fallbackResponse(userMessage, error = null) {
    if (error) {
      logger.error('Fallback из-за ошибки:', error.message);
    }

    // Простое определение intent по ключевым словам
    let intent = 'chat';
    let response = 'AI сервис временно недоступен. Попробуйте позже.';

    if (/создай|добавь|запиши/.test(userMessage)) {
      if (/задач/i.test(userMessage)) {
        intent = 'create_task';
        response = 'Хочу создать задачу, но AI недоступен. Используйте REST API.';
      } else if (/событ|встреч/i.test(userMessage)) {
        intent = 'create_event';
        response = 'Хочу создать событие, но AI недоступен. Используйте REST API.';
      } else {
        intent = 'create_note';
        response = 'Хочу создать заметку, но AI недоступен. Используйте REST API.';
      }
    }

    return {
      intent,
      response,
      data: null,
      modelUsed: 'fallback',
      tokensUsed: { input_tokens: 0, output_tokens: 0 },
    };
  }

  /**
   * Проверка доступности Claude API
   */
  async healthCheck() {
    if (!this.client) {
      return { status: 'unavailable', reason: 'No API key' };
    }

    try {
      // Простой тестовый запрос
      await this.client.messages.create({
        model: this.models.haiku,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });

      return { status: 'ok', models: this.models };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }
}

// Singleton instance
const claudeService = new ClaudeService();

export default claudeService;
