import { Sequelize } from 'sequelize';
import UserModel from './user.js';
import EmployeeModel from './employee.js';
import TaskModel from './task.js';
import EventModel from './event.js';
import SessionModel from './session.js';
import MessageModel from './message.js';
import SummaryModel from './summary.js';
import NoteModel from './note.js';
import ReminderModel from './reminder.js';
import config from '../config/index.js';
import logger from '../config/logger.js';

// Инициализация Sequelize с конфигурацией из config
const sequelize = new Sequelize(config.database.url, {
  dialect: 'postgres',
  logging: config.isDevelopment ? (msg) => logger.debug(msg) : false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
});

// Инициализируем модели
const models = {
  User: UserModel(sequelize),
  Employee: EmployeeModel(sequelize),
  Task: TaskModel(sequelize),
  Event: EventModel(sequelize),
  Session: SessionModel(sequelize),
  Message: MessageModel(sequelize),
  Summary: SummaryModel(sequelize),
  Note: NoteModel(sequelize),
  Reminder: ReminderModel(sequelize),
};

// Настройка ассоциаций

// Пользователи и сотрудники
models.Employee.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Employee, { foreignKey: 'user_id' });

// Задачи
models.Task.belongsTo(models.Employee, {
  foreignKey: 'assigned_employee_id',
  as: 'assigned_employee',
});
models.Task.belongsTo(models.User, { foreignKey: 'created_by' });

// События (встречи)
models.Event.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Event, { foreignKey: 'user_id' });

// Заметки
models.Note.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Note, { foreignKey: 'user_id' });

// Сессии
models.Session.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Session, { foreignKey: 'user_id' });

// Сообщения в сессиях
models.Message.belongsTo(models.Session, { foreignKey: 'session_id' });
models.Session.hasMany(models.Message, { foreignKey: 'session_id' });

// Сводки для сессий
models.Summary.belongsTo(models.Session, { foreignKey: 'session_id' });
models.Session.hasMany(models.Summary, { foreignKey: 'session_id' });

// Напоминания
models.Reminder.belongsTo(models.User, { foreignKey: 'user_id' });
models.User.hasMany(models.Reminder, { foreignKey: 'user_id' });
models.Reminder.belongsTo(models.Event, { foreignKey: 'event_id' });
models.Event.hasMany(models.Reminder, { foreignKey: 'event_id' });

// Экспортируем sequelize и models
// Аутентификация и sync теперь происходят в server.js
export { sequelize };
export default models;
