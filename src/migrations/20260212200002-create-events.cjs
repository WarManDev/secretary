'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('events', {
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
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      event_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      google_calendar_event_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      recurrence_rule: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'RFC 5545 RRULE format',
      },
      reminder_minutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 15,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true, // для обратной совместимости
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
    await queryInterface.addIndex('events', ['user_id', 'event_date']);
    await queryInterface.addIndex('events', ['google_calendar_event_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('events');
  },
};
