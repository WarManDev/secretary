'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sessions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      platform: {
        type: Sequelize.ENUM('telegram', 'web', 'mobile', 'api'),
        allowNull: false,
        defaultValue: 'telegram',
      },
      session_type: {
        type: Sequelize.ENUM('work', 'personal'),
        allowNull: false,
        defaultValue: 'work',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Platform-specific metadata (chat_id, device info, etc.)',
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      current_summary: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Current conversation summary for prompt compression',
      },
    });

    // Индексы
    await queryInterface.addIndex('sessions', ['user_id', 'ended_at']);
    await queryInterface.addIndex('sessions', ['platform']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sessions');
  },
};
