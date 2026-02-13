import { google } from 'googleapis';
import config from '../config/index.js';
import logger from '../config/logger.js';

const {
  clientId: GCAL_CLIENT_ID,
  clientSecret: GCAL_CLIENT_SECRET,
  refreshToken: GCAL_REFRESH_TOKEN,
} = config.google.calendar;

// Создаем OAuth2 клиент
const oAuth2Client = new google.auth.OAuth2(
  GCAL_CLIENT_ID,
  GCAL_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob' // Используем этот redirect URI, либо укажите ваш, если требуется
);

// Устанавливаем учетные данные с refresh token
oAuth2Client.setCredentials({ refresh_token: GCAL_REFRESH_TOKEN });

// Инициализируем клиент календаря с OAuth2 авторизацией
const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

/**
 * Создает событие в календаре.
 * @param {Object} eventDetails - Объект с данными события.
 * @returns {Object} - Созданное событие.
 */
export async function createEvent(eventDetails) {
  try {
    const response = await calendar.events.insert({
      calendarId: 'primary', // можно заменить на нужный ID календаря
      requestBody: eventDetails,
    });
    return response.data;
  } catch (error) {
    throw new Error(`Ошибка создания события: ${error.message}`);
  }
}

/**
 * Обновляет событие по его идентификатору.
 * @param {string} eventId - ID события.
 * @param {Object} updatedDetails - Обновленные данные события.
 * @returns {Object} - Обновленное событие.
 */
export async function updateEvent(eventId, updatedDetails) {
  try {
    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId,
      requestBody: updatedDetails,
    });
    return response.data;
  } catch (error) {
    throw new Error(`Ошибка обновления события: ${error.message}`);
  }
}

/**
 * Удаляет событие по его идентификатору.
 * @param {string} eventId - ID события.
 */
export async function deleteEvent(eventId) {
  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId,
    });
  } catch (error) {
    throw new Error(`Ошибка удаления события: ${error.message}`);
  }
}

/**
 * Получает список событий из Google Calendar за указанный период.
 * @param {Date} startTime - Объект Date, представляющий начало периода.
 * @param {Date} endTime - Объект Date, представляющий конец периода.
 * @returns {Promise<Array>} - Массив событий (items) из Google Calendar.
 */
export async function getEventsForPeriod(startTime, endTime) {
  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    return response.data.items || [];
  } catch (error) {
    throw new Error(`Ошибка получения событий: ${error.message}`);
  }
}
