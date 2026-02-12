import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError } from '../utils/errors.js';
import models from '../models/index.js';

/**
 * GET /api/notes
 * Получить список заметок текущего пользователя
 */
export const getNotes = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, category, completed } = req.query;
  const offset = (page - 1) * limit;

  const where = { user_id: req.user.id };
  if (category) where.category = category;
  if (completed !== undefined) where.completed = completed === 'true';

  const { rows: notes, count } = await models.Note.findAndCountAll({
    where,
    limit,
    offset,
    order: [['created_at', 'DESC']],
  });

  res.json({
    status: 'success',
    data: {
      notes,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit),
      },
    },
  });
});

/**
 * GET /api/notes/:id
 * Получить одну заметку
 */
export const getNote = asyncHandler(async (req, res) => {
  const note = await models.Note.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });

  if (!note) {
    throw new NotFoundError('Заметка');
  }

  res.json({
    status: 'success',
    data: { note },
  });
});

/**
 * POST /api/notes
 * Создать заметку
 */
export const createNote = asyncHandler(async (req, res) => {
  const { content, category } = req.body;

  const note = await models.Note.create({
    user_id: req.user.id,
    content,
    category,
    completed: false,
  });

  res.status(201).json({
    status: 'success',
    message: 'Заметка создана',
    data: { note },
  });
});

/**
 * PATCH /api/notes/:id
 * Обновить заметку
 */
export const updateNote = asyncHandler(async (req, res) => {
  const note = await models.Note.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });

  if (!note) {
    throw new NotFoundError('Заметка');
  }

  const { content, category, completed } = req.body;

  await note.update({
    ...(content !== undefined && { content }),
    ...(category !== undefined && { category }),
    ...(completed !== undefined && { completed }),
  });

  res.json({
    status: 'success',
    message: 'Заметка обновлена',
    data: { note },
  });
});

/**
 * DELETE /api/notes/:id
 * Удалить заметку
 */
export const deleteNote = asyncHandler(async (req, res) => {
  const note = await models.Note.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });

  if (!note) {
    throw new NotFoundError('Заметка');
  }

  await note.destroy();

  res.json({
    status: 'success',
    message: 'Заметка удалена',
  });
});
