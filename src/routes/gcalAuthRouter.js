import express from 'express';
import { google } from 'googleapis';
import config from '../config/index.js';
import logger from '../config/logger.js';

const router = express.Router();

// Читаем данные из конфигурации
const { clientId: GCAL_CLIENT_ID, clientSecret: GCAL_CLIENT_SECRET } = config.google.calendar;
// Redirect URI (можно добавить в config если понадобится)
const REDIRECT_URI = `http://localhost:${config.port}/api/gcal/callback`;

// Создаем OAuth2 клиент
const oauth2Client = new google.auth.OAuth2(GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, REDIRECT_URI);

/**
 * getAuthUrl – генерирует URL, по которому необходимо пройти авторизацию.
 */
function getAuthUrl() {
  // Указываем необходимые scopes. Для работы с календарем нужен, например:
  const scopes = ['https://www.googleapis.com/auth/calendar'];

  // Для получения refresh token обязательно указывайте:
  // access_type: 'offline' и prompt: 'consent'
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // обязательное для получения refresh_token
    prompt: 'consent', // заставляет пользователя подтвердить доступ заново
    scope: scopes,
  });

  return url;
}

/**
 * handleOAuthCallback – обрабатывает код авторизации и возвращает токены.
 * @param {string} code – код авторизации из query-параметра.
 * @returns {Object} tokens – объект с access_token, refresh_token и др.
 */
async function handleOAuthCallback(code) {
  const { tokens } = await oauth2Client.getToken(code);
  // Устанавливаем полученные токены в клиент
  oauth2Client.setCredentials(tokens);
  return tokens;
}

/**
 * GET /api/gcal/auth
 * Возвращает URL для авторизации
 */
router.get('/auth', (req, res) => {
  const url = getAuthUrl();
  res.json({ authUrl: url });
});

/**
 * GET /api/gcal/callback
 * Обрабатывает callback от Google после авторизации.
 * Ожидается, что Google перенаправит с ?code=...
 */
router.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    const tokens = await handleOAuthCallback(code);
    // Здесь вы можете сохранить refresh_token (и access_token) в базе или в настройках
    res.json({ msg: 'Success! You can store refresh_token now', tokens });
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
