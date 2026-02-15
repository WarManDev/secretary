import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const Expense = sequelize.define(
    'Expense',
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
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      currency: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'RUB',
      },
      category: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'other',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      expense_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'expenses',
      timestamps: true,
      underscored: true,
    }
  );

  return Expense;
};
