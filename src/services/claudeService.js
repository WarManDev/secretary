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

5. **Анализ фото (Vision)**
   - Чеки и документы → создание заметок с суммой и деталями
   - Визитки → извлечение имени, телефона, email, должности
   - Скриншоты → описание содержимого
   - Текст на фото → распознавание и сохранение
   - Если пользователь прислал фото с подписью — учитывай подпись как контекст

**Стиль общения:**
- Дружелюбный и профессиональный
- Краткие и четкие ответы
- Проактивные предложения
- На русском языке

**Действия (actions):**
Ты можешь выполнять НЕСКОЛЬКО действий в одном сообщении. Типы:
- create_note - создать заметку (data: { content, category })
- create_task - создать задачу (data: { title, priority, description })
- create_event - создать событие (data: { title, event_date (ISO 8601), end_date, description, location })
- update_event - обновить существующее событие (data: { title (для поиска), new_title (новое название, если переименовывают), location, description, event_date, end_date })
- delete_event - удалить событие (data: { title (для поиска) })
- delete_note - удалить заметку (data: { content (текст или часть текста для поиска) })
- delete_task - удалить задачу (data: { title (для поиска) })
- create_reminder - создать напоминание (data: { text, remind_at (ISO 8601), is_recurring (bool), recurrence_rule ("daily"|"weekly"|"monthly") })
- list - показать список (data: { type: "notes"|"tasks"|"events"|"reminders"|"all" })
- chat - обычный разговор (без data)

**ВАЖНО при удалении:** Всегда подтверждай в ответе что именно удалил. Если не уверен какой элемент имеется в виду — переспроси.
**ВАЖНО при напоминаниях:** "через 2 часа" — вычисли точное время. "каждый понедельник" — is_recurring=true, recurrence_rule="weekly". Всегда подтверждай время напоминания в ответе.

**Формат ответа — ВСЕГДА JSON:**
{
  "response": "Текст ответа пользователю",
  "actions": [
    { "type": "create_note", "data": { "content": "Купить молоко" } },
    { "type": "create_event", "data": { "title": "Встреча", "event_date": "2026-02-14T15:00:00" } }
  ]
}

Если действий нет (просто разговор):
{ "response": "Привет! Чем помочь?", "actions": [] }

Сегодняшняя дата: ${new Date().toISOString().split('T')[0]}.
Если пользователь говорит "завтра" — вычисли дату. "В 15:00" — используй формат ISO 8601.`;
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

      // Добавляем cache_control на breakpoint (должен быть на content block, не на message)
      if (cacheBreakpoint !== null && messages[cacheBreakpoint]) {
        const msg = messages[cacheBreakpoint];
        if (typeof msg.content === 'string') {
          msg.content = [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }];
        }
      }

      // Добавляем текущее сообщение (с поддержкой изображений)
      if (options.imageBuffer) {
        // Multimodal: изображение + текст
        const userContent = [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: options.mimeType || 'image/jpeg',
              data: options.imageBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text: userMessage || 'Что на этом изображении? Опиши и предложи действие.',
          },
        ];
        messages.push({ role: 'user', content: userContent });
      } else {
        messages.push({ role: 'user', content: userMessage });
      }

      // Выбираем модель (фото → всегда Sonnet для качества Vision)
      const model = options.imageBuffer
        ? this.models.sonnet
        : options.forceModel || this._selectModel(userMessage, messages);

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
    return history
      .filter((msg) => msg.content && msg.content.trim() !== '')
      .map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));
  }

  /**
   * Парсим ответ от Claude
   * Возвращает: { response: string, actions: Array<{ type, data }> }
   */
  _parseResponse(response) {
    const content = response.content[0].text;

    try {
      // Способ 1: извлекаем JSON из markdown блока ```json ... ```
      const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (codeBlockMatch) {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        return this._normalizeResponse(parsed, content);
      }

      // Способ 2: весь ответ — чистый JSON
      const parsed = JSON.parse(content.trim());
      return this._normalizeResponse(parsed, content);
    } catch (error) {
      // Способ 3: ищем JSON объект внутри текста
      const jsonMatch = content.match(/\{[\s\S]*"response"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return this._normalizeResponse(parsed, content);
        } catch (e) {
          // JSON невалидный, возвращаем как текст
        }
      }

      // Fallback: не JSON, возвращаем как обычный текст
      return {
        response: content,
        actions: [],
      };
    }
  }

  /**
   * Нормализуем ответ: поддерживаем и старый формат (intent/data) и новый (actions)
   */
  _normalizeResponse(parsed, rawContent) {
    // Новый формат: { response, actions: [...] }
    if (parsed.actions && Array.isArray(parsed.actions)) {
      return {
        response: parsed.response || rawContent,
        actions: parsed.actions,
      };
    }

    // Старый формат: { intent, response, data } — конвертируем в actions
    if (parsed.intent) {
      const actions = [];
      if (parsed.intent !== 'chat' && parsed.data) {
        actions.push({ type: parsed.intent, data: parsed.data });
      }
      return {
        response: parsed.response || rawContent,
        actions,
      };
    }

    // Только response, без действий
    return {
      response: parsed.response || rawContent,
      actions: [],
    };
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

    return {
      response: 'AI сервис временно недоступен. Попробуйте позже.',
      actions: [],
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
