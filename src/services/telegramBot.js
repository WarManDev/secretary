import TelegramBot from 'node-telegram-bot-api';
import { Op } from 'sequelize';
import { convertOggToWav, speechToTextYandex } from './yandexSpeechService.js';
import { processChatMessage } from './chatgptHandler.js';
import { createEvent, getEventsForPeriod, updateEvent, deleteEvent  } from './googleCalendarService.js';
import models from '../models/index.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import {
  expectedDateForUserInput,
  correctYear,
  isValidDateTime,
  computeEndDateTime,
  extractEndTime,
  getLocalDateTime,
  nextDay
} from '../utils/dateUtils.js';
import { createNote, getPendingNotes, markNotesCompleted } from './noteService.js';

const bot = new TelegramBot(config.telegram.botToken, { polling: true });

function formatTime(dateObj) {
  return new Date(dateObj).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Хранение краткой истории сообщений для каждого чата.
 * Для простоты используется объект в памяти.
 */
const chatHistories = {};

// Функция для обработки ответа GPT (общая для голосовых и текстовых сообщений)
async function handleGPTResponse(reply, inputText, msg) {
  let textToSend = "";
  let parsed;
  try {
    // Если GPT возвращает данные через function_call, парсим аргументы; иначе из reply.content
    if (reply.function_call) {
      parsed = JSON.parse(reply.function_call.arguments);
    } else {
      parsed = JSON.parse(reply.content);
    }
  } catch (e) {
    console.error("Ошибка парсинга ответа GPT:", e);
    parsed = { type: "chat", text: reply.content };
  }
  
  switch (parsed.type) {
    case "event": {
      try {
        // Если указан дополнительный параметр action, обрабатываем обновление или удаление
        if (parsed.action === "update") {
          // Обновление мероприятия: ожидаем eventId и updatedDetails
          const { eventId, updatedDetails } = parsed;
          if (!eventId || !updatedDetails) {
            throw new Error("Не указаны eventId или updatedDetails для обновления.");
          }
          
          // Проверяем, выглядит ли eventId как настоящий Google Calendar ID.
          // Обычно это строка, состоящая из букв, цифр, дефисов и подчёркиваний.
          const validIdPattern = /^[A-Za-z0-9_-]+$/;
          let realEventId = eventId;
          
          if (!validIdPattern.test(realEventId)) {
            // Если eventId не проходит проверку, ищем мероприятие по названию в локальной базе.
            // Здесь можно добавить дополнительные критерии (например, по дате).
            const existingEvent = await models.Event.findOne({
              where: { title: updatedDetails.title }
            });
            if (!existingEvent) {
              throw new Error("Мероприятие с указанным названием не найдено для обновления.");
            }
            realEventId = existingEvent.google_calendar_event_id;
          }
          
          // Корректируем даты, если они указаны
          if (updatedDetails.startDate) {
            updatedDetails.startDate = correctYear(updatedDetails.startDate);
          }
          if (updatedDetails.endDate) {
            updatedDetails.endDate = correctYear(updatedDetails.endDate);
          }
          
          let updateBody = {};
          // Если времена не указаны, считаем, что это all-day событие.
          if (!updatedDetails.startTime && !updatedDetails.endTime) {
            updateBody = {
              summary: updatedDetails.title,
              start: { date: updatedDetails.startDate },
              end: { date: nextDay(updatedDetails.endDate) }
            };
            if (updatedDetails.location) updateBody.location = updatedDetails.location;
            if (updatedDetails.participants) {
              updateBody.attendees = updatedDetails.participants.map(email => ({ email }));
            }
          } else {
            // Если времена указаны, формируем тело для timed события.
            if (!updatedDetails.startDate || !updatedDetails.startTime || !updatedDetails.endDate || !updatedDetails.endTime) {
              throw new Error("Для обновления timed мероприятия необходимо указать startDate, startTime, endDate и endTime.");
            }
            updateBody = {
              summary: updatedDetails.title,
              start: { dateTime: `${updatedDetails.startDate}T${updatedDetails.startTime}:00`, timeZone: "Asia/Dubai" },
              end: { dateTime: `${updatedDetails.endDate}T${updatedDetails.endTime}:00`, timeZone: "Asia/Dubai" }
            };
            if (updatedDetails.location) updateBody.location = updatedDetails.location;
            if (updatedDetails.participants) {
              updateBody.attendees = updatedDetails.participants.map(email => ({ email }));
            }
          }
          
          const updatedEvent = await updateEvent(realEventId, updateBody);
          console.log("Мероприятие обновлено:", updatedEvent);
          textToSend = `Мероприятие обновлено:\nНазвание: ${updatedEvent.summary}\nМесто: ${updatedEvent.location || "не указано"}`;
        } else if (parsed.action === "delete") {
          // Удаление мероприятия: ожидаем eventId
          const { eventId } = parsed;
          if (!eventId) {
            throw new Error("Не указан eventId для удаления.");
          }
          await deleteEvent(eventId);
          console.log("Мероприятие удалено:", eventId);
          textToSend = `Мероприятие удалено.`;
        } else {
          // Если action не задан, создаем новое мероприятие (логика создания события)
          let startDateField = parsed.startDate || parsed.date;
          let startTimeField = parsed.startTime || parsed.time;
          let endDateField = parsed.endDate; // может отсутствовать
          let endTimeField = parsed.endTime;
          const title = parsed.title;
          const participants = parsed.participants;
          const location = parsed.location;
          
          // Корректировка даты через входной текст
          const expectedDate = expectedDateForUserInput(inputText);
          if (expectedDate && startDateField !== expectedDate) {
            console.log("Корректировка startDate: ожидалось", expectedDate, "получено", startDateField);
            startDateField = expectedDate;
          }
          startDateField = correctYear(startDateField);
          
          if (!startTimeField || startTimeField.trim() === "") {
            startTimeField = "00:00";
          }
          
          // Определяем, является ли событие многодневным
          let isMultiDay = false;
          if (endDateField && endDateField !== startDateField) {
            isMultiDay = true;
          }
          
          // Если endTime не задан, пробуем извлечь его
          if (!endTimeField) {
            const extracted = extractEndTime(inputText);
            if (extracted && isValidDateTime(startDateField, extracted)) {
              endTimeField = extracted;
              console.log("Извлечено endTime из текста:", endTimeField);
            }
          }
          
          // Определяем, является ли мероприятие all-day.
          // Здесь мы полагаемся на то, что если в запросе отсутствует время, GPT вернула соответствующие поля.
          let isAllDay = false;
          if (!parsed.startTime && !parsed.endTime) {
            isAllDay = true;
          }
          
          let computedStart, computedEnd;
          if (isAllDay) {
            computedStart = startDateField;
            const endDateFinal = isMultiDay ? endDateField : startDateField;
            computedEnd = nextDay(endDateFinal);
          } else {
            computedStart = `${startDateField}T${startTimeField}:00`;
            if (isMultiDay) {
              endDateField = correctYear(endDateField);
              computedEnd = `${endDateField}T${endTimeField}:00`;
            } else {
              computedEnd = `${startDateField}T${endTimeField}:00`;
            }
          }
          
          console.log("Создание события с данными:", {
            start: computedStart,
            end: computedEnd,
            title,
            location,
            participants,
            isMultiDay,
            isAllDay
          });
          
          const summary = title && title.trim() !== "" ? title.trim() : "Мероприятие";
          
          let eventDetails;
          if (isAllDay) {
            eventDetails = {
              summary,
              description: msg.text || inputText,
              location: location || "",
              start: { date: computedStart },
              end: { date: computedEnd }
            };
          } else {
            eventDetails = {
              summary,
              description: msg.text || inputText,
              location: location || "",
              start: { dateTime: computedStart, timeZone: "Asia/Dubai" },
              end: { dateTime: computedEnd, timeZone: "Asia/Dubai" }
            };
          }
          
          const createdEvent = await createEvent(eventDetails);
          console.log("Событие создано в Google Calendar:", createdEvent);
          
          // Сохранение в локальной базе
          let startObj, endObj;
          if (isAllDay) {
            startObj = new Date(`${computedStart}T00:00:00+04:00`);
            endObj = new Date(`${computedEnd}T00:00:00+04:00`);
          } else {
            startObj = getLocalDateTime(startDateField, startTimeField);
            if (isMultiDay) {
              endObj = getLocalDateTime(endDateField, endTimeField);
            } else {
              endObj = getLocalDateTime(startDateField, endTimeField);
            }
          }
          
          const localEvent = await models.Event.create({
            title: summary,
            description: msg.text || inputText,
            event_date: startObj,
            end_date: endObj,
            google_calendar_event_id: createdEvent.id,
            created_at: new Date(),
            updated_at: new Date()
          });
          console.log("Локальное событие сохранено:", localEvent);
          
          if (isAllDay) {
            textToSend = `Событие запланировано:\nНазвание: ${summary}\nВесь день с ${computedStart} по ${computedEnd}\nМесто: ${location || "не указано"}\nУчастники: ${participants ? participants.join(", ") : "нет"}`;
          } else {
            textToSend = `Событие запланировано:\nНазвание: ${summary}\nНачало: ${computedStart}\nОкончание: ${computedEnd}\nМесто: ${location || "не указано"}\nУчастники: ${participants ? participants.join(", ") : "нет"}`;
          }
        }
      } catch (err) {
        console.error("Ошибка при обработке запроса на создание события:", err);
        textToSend = "Ошибка при обработке запроса на создание события.";
      }
      break;
    }       
    case "note": {
      if (parsed.action === "create") {
        try {
          const noteContent = parsed.content || inputText;
          if (!noteContent || noteContent.trim() === "") {
            throw new Error("Содержание заметки не указано.");
          }
          const createdNote = await createNote({ content: noteContent, completed: false });
          console.log("Заметка создана:", createdNote);
          textToSend = "Заметка успешно создана.";
        } catch (err) {
          console.error("Ошибка при создании заметки:", err);
          textToSend = "Ошибка при создании заметки.";
        }
      } else if (parsed.action === "show") {
        try {
          const filter = parsed.filter || "pending";
          let notes;
          if (filter === "all") {
            notes = await models.Note.findAll({ order: [['created_at', 'ASC']] });
          } else if (filter === "completed") {
            notes = await models.Note.findAll({ where: { completed: true }, order: [['created_at', 'ASC']] });
          } else {
            notes = await models.Note.findAll({ where: { completed: false }, order: [['created_at', 'ASC']] });
          }
          if (notes.length === 0) {
            textToSend = "Заметки не найдены.";
          } else {
            textToSend = "Заметки:\n" + notes.map(note => `${note.id}. ${note.content} [${note.completed ? "выполнена" : "актуальна"}]`).join("\n");
          }
        } catch (err) {
          console.error("Ошибка при получении заметок:", err);
          textToSend = "Ошибка при получении заметок.";
        }
      } else if (parsed.action === "complete") {
        try {
          if (parsed.ids && Array.isArray(parsed.ids) && parsed.ids.length > 0) {
            await markNotesCompleted(parsed.ids);
            textToSend = "Указанные заметки помечены как выполненные.";
          } else if (parsed.content) {
            // Используем оператор iLike для поиска заметок без учета регистра
            const notes = await models.Note.findAll({
              where: {
                content: {
                  [Op.iLike]: `%${parsed.content}%`
                },
                completed: false
              }
            });
            if (notes.length === 0) {
              textToSend = "Заметки не найдены для обновления.";
            } else {
              const ids = notes.map(note => note.id);
              await markNotesCompleted(ids);
              textToSend = "Указанные заметки помечены как выполненные.";
            }
          } else {
            textToSend = "Не удалось определить, какие заметки обновить.";
          }
        } catch (err) {
          console.error("Ошибка при обновлении заметок:", err);
          textToSend = "Ошибка при обновлении заметок.";
        }
      } else {
        textToSend = "Неверный тип действия для заметки.";
      }
      break;
    }
    case "show_events": {
      try {
        let { date } = parsed;
        // Если GPT не указала дату, пытаемся определить через входной запрос
        if (!date) {
          date = expectedDateForUserInput(inputText) || new Date().toISOString().split('T')[0];
        }
        // Если во входном запросе явно указана дата (например, "на сегодня"), используем функцию для определения даты
        const expectedDate = expectedDateForUserInput(inputText);
        if (expectedDate && date !== expectedDate) {
          console.log("Корректировка даты: ожидалось", expectedDate, "получено", date);
          date = expectedDate;
        }
        // Обновляем год для даты
        date = correctYear(date);
    
        // Определяем начало и конец дня в часовом поясе Asia/Dubai
        const startOfDay = new Date(`${date}T00:00:00+04:00`);
        const endOfDay = new Date(`${date}T23:59:59+04:00`);
    
        // Получаем события из Google Calendar за указанный период
        const events = await getEventsForPeriod(startOfDay, endOfDay);
    
        if (events.length === 0) {
          textToSend = `На дату ${date} мероприятий не найдено.`;
        } else {
          textToSend = `Мероприятия на ${date}:\n` + events.map(ev => {
            const start = ev.start.dateTime || ev.start.date;
            const end = ev.end.dateTime || ev.end.date;
            return `${ev.summary} с ${formatTime(start)} до ${formatTime(end)}`;
          }).join("\n");
        }
      } catch (err) {
        console.error("Ошибка при получении мероприятий:", err);
        textToSend = "Ошибка при получении мероприятий.";
      }
      break;
    }
    case "task": {
      textToSend = "Создание задачи ещё не реализовано.";
      break;
    }
    case "chat":
    default: {
      textToSend = parsed.text || "Извините, я не смог сформировать ответ.";
      break;
    }
  }
  return textToSend;
}

// Обработчик входящих сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  console.log(`Ваш chat_id: ${chatId}`);
  
  if (!chatHistories[chatId]) {
    chatHistories[chatId] = [];
  }
  
  // Если сообщение голосовое — обрабатываем его, затем как текстовое
  if (msg.voice) {
    try {
      await bot.sendMessage(chatId, 'Получено голосовое сообщение. Идет распознавание...');
      const fileId = msg.voice.file_id;
      const fileUrl = await bot.getFileLink(fileId);
      
      // Скачиваем аудиофайл
      const response = await fetch(fileUrl);
      const oggArrayBuffer = await response.arrayBuffer();
      const oggBuffer = Buffer.from(oggArrayBuffer);
      
      // Конвертируем OGG в WAV и распознаем речь через Yandex SpeechKit
      const wavBuffer = await convertOggToWav(oggBuffer);
      const transcription = await speechToTextYandex(wavBuffer);
      
      const transcriptionText = transcription && transcription.trim() !== ""
                                  ? `Распознанный текст: ${transcription}`
                                  : "Извините, распознавание речи не дало результата.";
      await bot.sendMessage(chatId, transcriptionText);
      
      // Добавляем распознанный текст в историю как сообщение пользователя
      chatHistories[chatId].push({ role: 'user', content: transcription });
      
      // Обрабатываем распознанный текст так, как если бы он пришёл как текстовое сообщение
      const historyToSend = chatHistories[chatId].slice(-10);
      const reply = await processChatMessage(historyToSend);
      console.log("[ChatGPT] Full reply:", reply);
      chatHistories[chatId].push(reply);
      
      const resultText = await handleGPTResponse(reply, transcription, msg);
      await bot.sendMessage(chatId, resultText);
    } catch (error) {
      console.error('Ошибка при обработке голосового сообщения:', error);
      await bot.sendMessage(chatId, `Ошибка при распознавании речи: ${error.message}`);
    }
    return;
  }
  
  // Если сообщение текстовое
  if (msg.text) {
    chatHistories[chatId].push({ role: 'user', content: msg.text });
    const historyToSend = chatHistories[chatId].slice(-10);
    try {
      const reply = await processChatMessage(historyToSend);
      console.log("[ChatGPT] Full reply:", reply);
      chatHistories[chatId].push(reply);
      const resultText = await handleGPTResponse(reply, msg.text, msg);
      await bot.sendMessage(chatId, resultText);
    } catch (error) {
      console.error('Ошибка при обработке текстового сообщения:', error);
      await bot.sendMessage(chatId, `Ошибка при обработке сообщения: ${error.message}`);
    }
    return;
  }
  
  // Если тип сообщения не поддерживается
  await bot.sendMessage(chatId, 'Тип сообщения не поддерживается для обработки.');
});

export default bot;
