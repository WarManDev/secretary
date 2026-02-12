'use strict';

/**
 * Миграция для удаления старых таблиц созданных через sequelize.sync()
 * Запускается перед всеми остальными миграциями (timestamp 10:00:00)
 */
module.exports = {
  async up(queryInterface) {
    // Удаляем таблицы в правильном порядке (сначала зависимые, потом главные)
    const tables = [
      'summaries',
      'messages',
      'sessions',
      'notes',
      'tasks',
      'events',
      'employees',
      'users',
    ];

    for (const table of tables) {
      try {
        await queryInterface.dropTable(table, { cascade: true });
        console.log(`✓ Удалена таблица ${table}`);
      } catch (error) {
        // Таблица не существует - пропускаем
        if (!error.message.includes('does not exist')) {
          throw error;
        }
      }
    }

    // Удаляем старые ENUM типы если они существуют
    const enumTypes = [
      'enum_users_role',
      'enum_users_subscription_tier',
      'enum_sessions_platform',
      'enum_sessions_session_type',
      'enum_tasks_status',
      'enum_tasks_priority',
    ];

    for (const enumType of enumTypes) {
      try {
        await queryInterface.sequelize.query(
          `DROP TYPE IF EXISTS ${enumType} CASCADE;`
        );
        console.log(`✓ Удален ENUM тип ${enumType}`);
      } catch (error) {
        // Игнорируем ошибки при удалении типов
      }
    }
  },

  async down() {
    // Откат невозможен - старая схема была создана через sync(), не миграциями
    throw new Error(
      'Откат этой миграции невозможен. Используйте db:migrate вместо db:migrate:undo'
    );
  },
};
