'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('summaries', {
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
      summary_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Индексы
    await queryInterface.addIndex('summaries', ['session_id', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('summaries');
  },
};
