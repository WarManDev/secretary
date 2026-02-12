import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define(
    'Task',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'pending' },
      due_date: { type: DataTypes.DATE, allowNull: true },
      assigned_employee_id: { type: DataTypes.INTEGER, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'tasks',
      timestamps: false,
    }
  );
};
