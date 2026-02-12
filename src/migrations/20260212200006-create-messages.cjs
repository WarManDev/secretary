'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'sessions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      sender: {
        type: Sequelize.ENUM('user', 'bot', 'system'),
        allowNull: false,
      },
      message_text: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      message_type: {
        type: Sequelize.ENUM('text', 'voice', 'photo', 'system'),
        allowNull: false,
        defaultValue: 'text',
      },
      tool_calls: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Claude tool_use blocks (replaces function_call)',
      },
      token_count: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Total tokens (input + output)',
      },
      model_used: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'AI model: claude-haiku-4-5, claude-sonnet-4-5, etc.',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Индексы
    await queryInterface.addIndex('messages', ['session_id', 'created_at']);
    await queryInterface.addIndex('messages', ['model_used']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('messages');
  },
};
