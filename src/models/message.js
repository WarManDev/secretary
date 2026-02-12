import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define(
    'Message',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      session_id: { type: DataTypes.INTEGER, allowNull: false },
      sender: { type: DataTypes.STRING(20), allowNull: false }, // 'user' или 'bot'
      message_text: { type: DataTypes.TEXT, allowNull: true },
      message_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'text' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      function_call: { type: DataTypes.JSONB, allowNull: true },
    },
    {
      tableName: 'messages',
      timestamps: false,
    }
  );
};
