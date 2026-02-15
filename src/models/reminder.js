import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Reminder = sequelize.define(
    'Reminder',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      remind_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // Привязка к событию (опционально)
      event_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Повторяющееся напоминание
      is_recurring: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Правило повторения: 'daily', 'weekly', 'monthly' или cron-выражение
      recurrence_rule: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      is_sent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: 'reminders',
      timestamps: true,
      underscored: true,
    }
  );

  return Reminder;
};
