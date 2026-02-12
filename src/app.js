import express from 'express';
import config from './config/index.js';
import logger from './config/logger.js';
import gcalAuthRouter from './routes/gcalAuthRouter.js';
import models from './models/index.js';

const app = express();

// Middleware для парсинга JSON и URL-кодированных данных
// Используем встроенный в Express (body-parser больше не нужен)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Роутеры
app.use('/api/gcal', gcalAuthRouter);

// -------------------------
// API endpoints
// -------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await models.User.findAll({
      attributes: ['id', 'username', 'role', 'created_at'],
    });
    res.json(users);
  } catch (err) {
    logger.error('Ошибка получения пользователей:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Укажите username, password и role' });
  }
  try {
    const newUser = await models.User.create({ username, password, role });
    res.status(201).json(newUser);
  } catch (err) {
    logger.error('Ошибка создания пользователя:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default app;
