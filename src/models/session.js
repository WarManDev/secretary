import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Session = sequelize.define(
    'Session',
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
      platform: {
        type: DataTypes.ENUM('telegram', 'web', 'mobile', 'api'),
        allowNull: false,
        defaultValue: 'telegram',
      },
      session_type: {
        type: DataTypes.ENUM('work', 'personal'),
        allowNull: false,
        defaultValue: 'work',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      ended_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      current_summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'sessions',
      timestamps: false,
    }
  );

  return Session;
};
