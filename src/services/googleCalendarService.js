import { google } from 'googleapis';
import config from '../config/index.js';
import logger from '../config/logger.js';
import models from '../models/index.js';

const { clientId: GCAL_CLIENT_ID, clientSecret: GCAL_CLIENT_SECRET } = config.google.calendar;
const REDIRECT_URI = `${config.appUrl}/api/gcal/callback`;

/**
 * Создаёт per-user OAuth2 клиент и Calendar API instance.
 * Автоматически обновляет access_token если истёк.
 *
 * @param {number} userId - ID пользователя
 * @returns {import('googleapis').calendar_v3.Calendar} - Calendar API клиент
 */
async function getUserCalendarClient(userId) {
  const user = await models.User.findByPk(userId);

  if (!user?.google_refresh_token) {
    throw new Error('Google Calendar не подключён. Используй /calendar для подключения.');
  }

  const oAuth2Client = new google.auth.OAuth2(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, REDIRECT_URI);

  oAuth2Client.setCredentials({
    refresh_token: user.google_refresh_token,
    access_token: user.google_access_token,
    expiry_date: user.google_token_expiry ? new Date(user.google_token_expiry).getTime() : null,
  });

  // Автосохранение обновлённых токенов
  oAuth2Client.on('tokens', async (tokens) => {
    try {
      const updateData = {};
      if (tokens.access_token) updateData.google_access_token = tokens.access_token;
      if (tokens.expiry_date) updateData.google_token_expiry = new Date(tokens.expiry_date);
      if (tokens.refresh_token) updateData.google_refresh_token = tokens.refresh_token;

      await user.update(updateData);
      logger.info(`Google OAuth tokens обновлены для user=${userId}`);
    } catch (err) {
      logger.error(`Ошибка автообновления токенов для user=${userId}:`, err.message);
    }
  });

  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

/**
 * Создает событие в Google Calendar пользователя.
 * @param {number} userId - ID пользователя
 * @param {Object} eventDetails - Объект с данными события
 * @returns {Object} - Созданное событие
 */
export async function createEvent(userId, eventDetails) {
  const calendar = await getUserCalendarClient(userId);
  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: eventDetails,
  });
  return response.data;
}

/**
 * Обновляет событие по его идентификатору.
 * @param {number} userId - ID пользователя
 * @param {string} eventId - ID события
 * @param {Object} updatedDetails - Обновленные данные
 * @returns {Object} - Обновленное событие
 */
export async function updateEvent(userId, eventId, updatedDetails) {
  const calendar = await getUserCalendarClient(userId);
  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: updatedDetails,
  });
  return response.data;
}

/**
 * Удаляет событие по его идентификатору.
 * @param {number} userId - ID пользователя
 * @param {string} eventId - ID события
 */
export async function deleteEvent(userId, eventId) {
  const calendar = await getUserCalendarClient(userId);
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
  });
}

/**
 * Получает список событий из Google Calendar за указанный период.
 * @param {number} userId - ID пользователя
 * @param {Date} startTime - Начало периода
 * @param {Date} endTime - Конец периода
 * @returns {Promise<Array>} - Массив событий
 */
export async function getEventsForPeriod(userId, startTime, endTime) {
  const calendar = await getUserCalendarClient(userId);
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startTime.toISOString(),
    timeMax: endTime.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });
  return response.data.items || [];
}
