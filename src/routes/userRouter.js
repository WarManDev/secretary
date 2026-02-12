import express from 'express';
import { validate, userSchemas, idParamSchema } from '../middleware/validator.js';
import { authorize } from '../middleware/auth.js';
import * as userController from '../controllers/userController.js';

const router = express.Router();

// Список пользователей - только для админов
router.get(
  '/',
  authorize('admin'),
  validate({ query: userSchemas.list.query }),
  userController.getUsers
);

// Просмотр любого пользователя - для всех аутентифицированных
router.get('/:id', validate({ params: idParamSchema }), userController.getUser);

// Обновление - свой профиль или админ
router.patch('/:id', validate(userSchemas.update), userController.updateUser);

export default router;
