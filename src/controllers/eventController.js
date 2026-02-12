import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError } from '../utils/errors.js';
import models from '../models/index.js';
import { Op } from 'sequelize';

/**
 * GET /api/events
 * Получить события пользователя
 */
export const getEvents = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, start_date, end_date } = req.query;
  const offset = (page - 1) * limit;

  const where = { user_id: req.user.id };

  if (start_date || end_date) {
    where.event_date = {};
    if (start_date) where.event_date[Op.gte] = new Date(start_date);
    if (end_date) where.event_date[Op.lte] = new Date(end_date);
  }

  const { rows: events, count } = await models.Event.findAndCountAll({
    where,
    limit,
    offset,
    order: [['event_date', 'ASC']],
  });

  res.json({
    status: 'success',
    data: {
      events,
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
 * GET /api/events/:id
 */
export const getEvent = asyncHandler(async (req, res) => {
  const event = await models.Event.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });

  if (!event) {
    throw new NotFoundError('Событие');
  }

  res.json({
    status: 'success',
    data: { event },
  });
});

/**
 * POST /api/events
 */
export const createEvent = asyncHandler(async (req, res) => {
  const { title, description, event_date, end_date, recurrence_rule, reminder_minutes } = req.body;

  const event = await models.Event.create({
    user_id: req.user.id,
    title,
    description,
    event_date: new Date(event_date),
    end_date: new Date(end_date),
    recurrence_rule,
    reminder_minutes: reminder_minutes || 15,
  });

  res.status(201).json({
    status: 'success',
    message: 'Событие создано',
    data: { event },
  });
});

/**
 * PATCH /api/events/:id
 */
export const updateEvent = asyncHandler(async (req, res) => {
  const event = await models.Event.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });

  if (!event) {
    throw new NotFoundError('Событие');
  }

  const { title, description, event_date, end_date, recurrence_rule, reminder_minutes } = req.body;

  await event.update({
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(event_date !== undefined && { event_date: new Date(event_date) }),
    ...(end_date !== undefined && { end_date: new Date(end_date) }),
    ...(recurrence_rule !== undefined && { recurrence_rule }),
    ...(reminder_minutes !== undefined && { reminder_minutes }),
  });

  res.json({
    status: 'success',
    message: 'Событие обновлено',
    data: { event },
  });
});

/**
 * DELETE /api/events/:id
 */
export const deleteEvent = asyncHandler(async (req, res) => {
  const event = await models.Event.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });

  if (!event) {
    throw new NotFoundError('Событие');
  }

  await event.destroy();

  res.json({
    status: 'success',
    message: 'Событие удалено',
  });
});
