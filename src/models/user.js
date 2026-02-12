import { DataTypes } from 'sequelize';

export default (sequelize) => {
  return sequelize.define(
    'User',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
      password: { type: DataTypes.STRING(255), allowNull: false },
      role: { type: DataTypes.STRING(20), allowNull: false }, // 'admin', 'boss', 'employee'
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      tableName: 'users',
      timestamps: false,
    }
  );
};
