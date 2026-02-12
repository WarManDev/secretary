import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define(
    'Session',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      session_type: { type: DataTypes.STRING(20), allowNull: false }, // 'work' или 'personal'
      started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      ended_at: { type: DataTypes.DATE, allowNull: true },
      current_summary: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'sessions',
      timestamps: false,
    }
  );
};
