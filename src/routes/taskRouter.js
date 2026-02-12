import express from 'express';
import { validate, taskSchemas, idParamSchema } from '../middleware/validator.js';
import * as taskController from '../controllers/taskController.js';

const router = express.Router();

router.get('/', validate({ query: taskSchemas.list.query }), taskController.getTasks);
router.get('/:id', validate({ params: idParamSchema }), taskController.getTask);
router.post('/', validate(taskSchemas.create), taskController.createTask);
router.patch('/:id', validate(taskSchemas.update), taskController.updateTask);
router.delete('/:id', validate({ params: idParamSchema }), taskController.deleteTask);

export default router;
