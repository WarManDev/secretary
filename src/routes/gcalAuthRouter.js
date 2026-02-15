import express from 'express';
import { google } from 'googleapis';
import config from '../config/index.js';
import logger from '../config/logger.js';
import models from '../models/index.js';

const router = express.Router();

const { clientId: GCAL_CLIENT_ID, clientSecret: GCAL_CLIENT_SECRET } = config.google.calendar;
const REDIRECT_URI = `${config.appUrl}/api/gcal/callback`;

const oauth2Client = new google.auth.OAuth2(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, REDIRECT_URI);

/**
 * GET /api/gcal/auth?userId=X
 * Редиректит пользователя на Google OAuth consent screen.
 * userId передаётся в state для идентификации после callback.
 */
router.get('/auth', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send('userId is required');
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: userId.toString(),
  });

  res.redirect(authUrl);
});

/**
 * GET /api/gcal/callback?code=X&state=userId
 * Google OAuth callback. Сохраняет токены в БД пользователя.
 */
router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).send('Missing code or state');
  }

  try {
    // Обмениваем code на токены
    const { tokens } = await oauth2Client.getToken(code);

    // Сохраняем токены в User
    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).send('User not found');
    }

    await user.update({
      google_refresh_token: tokens.refresh_token,
      google_access_token: tokens.access_token,
      google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    });

    logger.info(`Google Calendar подключён для user=${userId}`);

    // Уведомляем в Telegram
    if (user.telegram_id) {
      try {
        const { default: bot } = await import('../services/telegramBot.js');
        await bot.sendMessage(
          user.telegram_id,
          '✅ Google Calendar успешно подключён!\n\nТеперь я могу создавать события в твоём календаре. Попробуй: "встреча завтра в 15:00"'
        );
      } catch (tgErr) {
        logger.warn('Не удалось отправить уведомление в Telegram:', tgErr.message);
      }
    }

    // Рендерим HTML страницу успеха
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Google Calendar</title>
        <style>
          body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f0f2f5; }
          .card { background: white; border-radius: 16px; padding: 48px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 400px; }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h1 { color: #1a1a1a; margin: 0 0 8px; font-size: 24px; }
          p { color: #666; margin: 0; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>Календарь подключён!</h1>
          <p>Можете закрыть это окно и вернуться в Telegram.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    logger.error('Google OAuth callback error:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Ошибка</title>
        <style>
          body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f0f2f5; }
          .card { background: white; border-radius: 16px; padding: 48px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.1); max-width: 400px; }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h1 { color: #e53e3e; margin: 0 0 8px; font-size: 24px; }
          p { color: #666; margin: 0; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">❌</div>
          <h1>Ошибка подключения</h1>
          <p>Попробуйте ещё раз через /calendar в боте.</p>
        </div>
      </body>
      </html>
    `);
  }
});

export default router;
