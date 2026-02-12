import express from 'express';
import { validate, eventSchemas, idParamSchema } from '../middleware/validator.js';
import * as eventController from '../controllers/eventController.js';

const router = express.Router();

router.get('/', validate({ query: eventSchemas.list.query }), eventController.getEvents);
router.get('/:id', validate({ params: idParamSchema }), eventController.getEvent);
router.post('/', validate(eventSchemas.create), eventController.createEvent);
router.patch('/:id', validate(eventSchemas.update), eventController.updateEvent);
router.delete('/:id', validate({ params: idParamSchema }), eventController.deleteEvent);

export default router;
