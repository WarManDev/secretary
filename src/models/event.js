import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Event = sequelize.define(
    'Event',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      location: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      event_date: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      end_date: {
        type: DataTypes.DATE,
        allowNull: true, // Дата окончания опциональна
      },
      google_calendar_event_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      recurrence_rule: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      reminder_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 15,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'events',
      timestamps: true,
      underscored: true,
    }
  );

  return Event;
};
