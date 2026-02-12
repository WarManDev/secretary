import { asyncHandler } from '../middleware/errorHandler.js';
import { NotFoundError } from '../utils/errors.js';
import models from '../models/index.js';

/**
 * GET /api/tasks
 */
export const getTasks = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, priority, assigned_employee_id } = req.query;
  const offset = (page - 1) * limit;

  const where = { created_by: req.user.id };
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (assigned_employee_id) where.assigned_employee_id = parseInt(assigned_employee_id);

  const { rows: tasks, count } = await models.Task.findAndCountAll({
    where,
    limit,
    offset,
    order: [
      ['priority', 'DESC'],
      ['due_date', 'ASC'],
    ],
    include: [
      {
        model: models.Employee,
        as: 'assigned_employee',
        attributes: ['id', 'full_name', 'position'],
      },
    ],
  });

  res.json({
    status: 'success',
    data: {
      tasks,
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
 * GET /api/tasks/:id
 */
export const getTask = asyncHandler(async (req, res) => {
  const task = await models.Task.findOne({
    where: { id: req.params.id, created_by: req.user.id },
    include: [
      {
        model: models.Employee,
        as: 'assigned_employee',
        attributes: ['id', 'full_name', 'position'],
      },
    ],
  });

  if (!task) {
    throw new NotFoundError('Задача');
  }

  res.json({
    status: 'success',
    data: { task },
  });
});

/**
 * POST /api/tasks
 */
export const createTask = asyncHandler(async (req, res) => {
  const { title, description, priority, due_date, tags, assigned_employee_id } = req.body;

  const task = await models.Task.create({
    title,
    description,
    priority: priority || 'medium',
    due_date: due_date ? new Date(due_date) : null,
    tags: tags || [],
    assigned_employee_id,
    created_by: req.user.id,
    status: 'pending',
  });

  res.status(201).json({
    status: 'success',
    message: 'Задача создана',
    data: { task },
  });
});

/**
 * PATCH /api/tasks/:id
 */
export const updateTask = asyncHandler(async (req, res) => {
  const task = await models.Task.findOne({
    where: { id: req.params.id, created_by: req.user.id },
  });

  if (!task) {
    throw new NotFoundError('Задача');
  }

  const { title, description, status, priority, due_date, tags, assigned_employee_id } = req.body;

  await task.update({
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(status !== undefined && { status }),
    ...(priority !== undefined && { priority }),
    ...(due_date !== undefined && { due_date: due_date ? new Date(due_date) : null }),
    ...(tags !== undefined && { tags }),
    ...(assigned_employee_id !== undefined && { assigned_employee_id }),
  });

  res.json({
    status: 'success',
    message: 'Задача обновлена',
    data: { task },
  });
});

/**
 * DELETE /api/tasks/:id
 */
export const deleteTask = asyncHandler(async (req, res) => {
  const task = await models.Task.findOne({
    where: { id: req.params.id, created_by: req.user.id },
  });

  if (!task) {
    throw new NotFoundError('Задача');
  }

  await task.destroy();

  res.json({
    status: 'success',
    message: 'Задача удалена',
  });
});
