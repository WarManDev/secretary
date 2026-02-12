import config from '../config/index.js';
import logger from '../config/logger.js';

const API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * processChatMessage – отправляет историю диалога в OpenAI и возвращает ответ.
 * @param {Array} messages - Массив объектов сообщений, каждый объект должен иметь поля { role, content }.
 * @returns {Object} - Ответ от ChatGPT (объект message из choices).
 */
export async function processChatMessage(messages) {
  const openaiApiKey = config.openai.apiKey;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY не определён в конфигурации.');
  }

  // const systemMessage = {
  //   role: 'system',
  //   content: 'Ты – умный и отзывчивый ассистент, помогающий планировать мероприятия, поручать задачи, вести заметки и предоставлять информацию о запланированных событиях. Анализируй входящий запрос и возвращай ответ в виде корректного JSON-объекта со следующей структурой:\n\n' +
  //   '{\n' +
  //   '  "type": "event" | "show_events" | "task" | "note" | "chat",\n' +
  //   '  // Если type равен "event", возвращай поля: "date" (YYYY-MM-DD, с текущим годом), "time" (HH:MM), "title" (точное название мероприятия), "location" (опционально), "participants" (опционально), "endTime" (опционально, если указан интервал).\n' +
  //   '  // Если type равен "show_events", возвращай поле "date" (YYYY-MM-DD) – дату, для которой нужно показать мероприятия.\n' +
  //   '  // Если type равен "note", возвращай поля для заметок: для создания - "action": "create" и "content", для показа - "action": "show" и опционально "filter" ("pending", "completed", "all"), для обновления - "action": "complete" и "ids" или "content".\n' +
  //   '  // Если type равен "task", возвращай соответствующие поля.\n' +
  //   '  // Если type равен "chat", возвращай обычный текст в поле "text".\n' +
  //   '}\n\n' +
  //   'Всегда возвращай корректный JSON. Если в запросе спрашивают о мероприятиях, например "покажи мероприятия на сегодня" или "покажи мероприятия на 25 февраля", возвращай тип "show_events" и поле "date" с нужной датой. Всегда старайся выделить в запросе местоположение мероприятия и добавлять его в соответствующее поле location в своем JSON-ответе'
  // };

  // const systemMessage = {
  //   role: 'system',
  //   content:
  //     'Ты — умный и отзывчивый ассистент, помогающий планировать мероприятия, поручать задачи, вести заметки и предоставлять информацию о запланированных событиях. Анализируй входящий запрос и возвращай ответ в виде корректного JSON-объекта со следующей структурой:\n\n' +
  //     '{\n' +
  //     '  "type": "event" | "show_events" | "task" | "note" | "chat",\n' +
  //     '  // Если type равен "event", возвращай следующие поля:\n' +
  //     '  //   "startDate": "YYYY-MM-DD" – дата начала мероприятия (год должен соответствовать текущему),\n' +
  //     '  //   "startTime": "HH:MM" – время начала мероприятия, если оно указано,\n' +
  //     '  //   "endDate": "YYYY-MM-DD" – дата окончания мероприятия, если оно длится несколько дней,\n' +
  //     '  //   "endTime": "HH:MM" – время окончания мероприятия, если оно указано,\n' +
  //     '  //   "allDay": false – если мероприятие имеет временные рамки; однако, если пользователь не указывает время (или в ответе на уточнение говорит "Весь день"), возвращай "allDay": true и не включай поля "startTime" и "endTime".\n' +
  //     '  //   Также возвращай обязательное поле "title" (точное название мероприятия) и опциональное поле "location" (местоположение), а также "participants" (опционально).\n' +
  //     '  // Если type равен "show_events", возвращай поле "date" (YYYY-MM-DD) – дату, для которой нужно показать мероприятия.\n' +
  //     '  // Если type равен "note", возвращай поля для заметок: для создания – "action": "create" и "content", для показа – "action": "show" и опционально "filter" ("pending", "completed", "all"), для обновления – "action": "complete" и "ids" или "content".\n' +
  //     '  // Если type равен "task", возвращай соответствующие поля.\n' +
  //     '  // Если type равен "chat", возвращай обычный текст в поле "text".\n' +
  //     '}\n\n' +
  //     'Всегда возвращай корректный JSON. Если в запросе спрашивают о мероприятиях, например "покажи мероприятия на сегодня" или "покажи мероприятия на 25 февраля", возвращай тип "show_events" и поле "date" с нужной датой. Всегда старайся выделить в запросе местоположение мероприятия и добавлять его в соответствующее поле "location". При создании мероприятия всегда передавай название мероприятия в поле title с заглавной буквы.\n' +
  //     '\n' +
  //     'Важно: Если во входном запросе отсутствует время начала или окончания мероприятия, сначала уточни у пользователя эти данные. Если пользователь ответит "Весь день", верни "allDay": true и не возвращай поля "startTime" и "endTime". В противном случае, возвращай и "startTime", и "endTime" с заданными значениями.'
  // };

  const systemMessage = {
    role: 'system',
    content:
      'Ты — умный и отзывчивый ассистент, помогающий планировать мероприятия, поручать задачи, вести заметки и предоставлять информацию о запланированных событиях. Анализируй входящий запрос и возвращай ответ в виде корректного JSON-объекта со следующей структурой:\n\n' +
      '{\n' +
      '  "type": "event" | "show_events" | "task" | "note" | "chat",\n' +
      '  // Если type равен "event", возвращай следующие поля:\n' +
      '  //   "action": "create" | "update" | "delete". Если поле "action" отсутствует, по умолчанию подразумевается создание нового мероприятия.\n' +
      '  //   Если action = "create":\n' +
      '  //       "startDate": "YYYY-MM-DD" – дата начала мероприятия (год должен соответствовать текущему),\n' +
      '  //       "startTime": "HH:MM" – время начала мероприятия, если оно указано,\n' +
      '  //       "endDate": "YYYY-MM-DD" – дата окончания мероприятия, если оно длится несколько дней,\n' +
      '  //       "endTime": "HH:MM" – время окончания мероприятия, если оно указано,\n' +
      '  //       "allDay": false – если мероприятие имеет временные рамки; однако, если пользователь не указывает время (или в ответе на уточнение говорит "Весь день"), возвращай "allDay": true и не возвращай поля "startTime" и "endTime".\n' +
      '  //       Также возвращай обязательное поле "title" (название мероприятия, начинаться с заглавной буквы) и опциональное поле "location" (местоположение), а также "participants" (опционально).\n' +
      '  //   Если action = "update":\n' +
      '  //       "eventId": "ID мероприятия",\n' +
      '  //       "updatedDetails": { "startDate": "YYYY-MM-DD", "startTime": "HH:MM", "endDate": "YYYY-MM-DD", "endTime": "HH:MM", "title": "Новое название", "location": "Новое местоположение", "participants": [...] }.\n' +
      '  //   Если action = "delete":\n' +
      '  //       "eventId": "ID мероприятия"\n' +
      '  \n' +
      '  // Если type равен "show_events", возвращай поле "date": "YYYY-MM-DD" – дату, для которой нужно показать мероприятия.\n' +
      '  \n' +
      '  // Если type равен "note", возвращай поля для заметок: для создания – "action": "create" и "content", для показа – "action": "show" и опционально "filter" ("pending", "completed", "all"), для обновления – "action": "complete" и "ids" или "content".\n' +
      '  \n' +
      '  // Если type равен "task", возвращай соответствующие поля.\n' +
      '  \n' +
      '  // Если type равен "chat", возвращай обычный текст в поле "text".\n' +
      '}\n\n' +
      'Всегда возвращай корректный JSON. Если в запросе спрашивают о мероприятиях, например "покажи мероприятия на сегодня" или "покажи мероприятия на 25 февраля", возвращай тип "show_events" и поле "date" с нужной датой. Всегда старайся выделить в запросе местоположение мероприятия и добавлять его в соответствующее поле "location".\n' +
      '\n' +
      'Важно: Если во входном запросе отсутствует время начала или окончания мероприятия, сначала уточни у пользователя эти данные. Если пользователь ответит "Весь день", верни "allDay": true и не возвращай поля "startTime" и "endTime". В противном случае, возвращай и "startTime", и "endTime" с заданными значениями.',
  };

  const slidingWindow = messages.slice(-10);
  const chatMessages = [systemMessage, ...slidingWindow];

  const functions = [
    {
      name: 'createMeeting',
      description: 'Создаёт встречу с указанной датой, временем и участниками.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Дата встречи в формате YYYY-MM-DD',
          },
          time: {
            type: 'string',
            description: 'Время встречи в формате HH:MM',
          },
          participants: {
            type: 'array',
            items: { type: 'string' },
            description: 'Список имён участников встречи',
          },
        },
        required: ['date', 'time'],
      },
    },
  ];

  const body = {
    model: 'gpt-4-0613', // убедитесь, что выбранная модель поддерживает function calling
    messages: chatMessages,
    functions: functions,
    function_call: 'auto',
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `Ошибка OpenAI API: ${response.status} ${response.statusText}: ${JSON.stringify(errorData)}`
    );
  }

  const data = await response.json();
  console.log('[ChatGPT] Raw response:', data); // добавьте логирование полного ответа

  // Проверяем, что пришёл ответ, и что в нём есть сообщение
  if (data.choices && data.choices.length > 0 && data.choices[0].message) {
    return data.choices[0].message;
  } else {
    throw new Error('Пустой ответ от ChatGPT');
  }
}
