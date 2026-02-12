import express from 'express';
import { validate, noteSchemas, idParamSchema } from '../middleware/validator.js';
import * as noteController from '../controllers/noteController.js';

const router = express.Router();

// Все роуты требуют аутентификации (применяется в app.js)
router.get('/', validate({ query: noteSchemas.list.query }), noteController.getNotes);
router.get('/:id', validate({ params: idParamSchema }), noteController.getNote);
router.post('/', validate(noteSchemas.create), noteController.createNote);
router.patch('/:id', validate(noteSchemas.update), noteController.updateNote);
router.delete('/:id', validate({ params: idParamSchema }), noteController.deleteNote);

export default router;
