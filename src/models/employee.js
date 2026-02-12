import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define(
    'Employee',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      full_name: { type: DataTypes.STRING(100), allowNull: false },
      telegram_id: { type: DataTypes.STRING(50), allowNull: true },
      email: { type: DataTypes.STRING(100), allowNull: true },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'employees',
      timestamps: false,
    }
  );
};
