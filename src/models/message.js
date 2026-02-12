import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Message = sequelize.define(
    'Message',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      session_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
          key: 'id',
        },
      },
      sender: {
        type: DataTypes.ENUM('user', 'bot', 'system'),
        allowNull: false,
      },
      message_text: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      message_type: {
        type: DataTypes.ENUM('text', 'voice', 'photo', 'system'),
        allowNull: false,
        defaultValue: 'text',
      },
      tool_calls: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      token_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      model_used: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'messages',
      timestamps: false,
    }
  );

  return Message;
};
