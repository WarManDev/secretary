import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define(
    'Summary',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      session_id: { type: DataTypes.INTEGER, allowNull: false },
      summary_text: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'summaries',
      timestamps: false,
    }
  );
};
