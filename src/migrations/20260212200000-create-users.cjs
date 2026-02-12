'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: true, // nullable для пользователей через Telegram
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
      },
      telegram_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
        unique: true,
      },
      role: {
        type: Sequelize.ENUM('admin', 'boss', 'employee'),
        allowNull: false,
        defaultValue: 'employee',
      },
      timezone: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'Asia/Dubai',
      },
      language: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'ru',
      },
      subscription_tier: {
        type: Sequelize.ENUM('free', 'professional', 'business', 'enterprise'),
        allowNull: false,
        defaultValue: 'free',
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Индексы
    await queryInterface.addIndex('users', ['username'], { unique: true });
    await queryInterface.addIndex('users', ['email'], {
      unique: true,
      where: { email: { [Sequelize.Op.ne]: null } },
    });
    await queryInterface.addIndex('users', ['telegram_id'], {
      unique: true,
      where: { telegram_id: { [Sequelize.Op.ne]: null } },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
