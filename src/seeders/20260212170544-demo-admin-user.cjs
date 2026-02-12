'use strict';

const bcrypt = require('bcrypt');

/**
 * Seeder для создания тестового администратора
 * Username: admin
 * Password: admin123
 */
module.exports = {
  async up(queryInterface) {
    // Хэшируем пароль
    const passwordHash = await bcrypt.hash('admin123', 10);

    await queryInterface.bulkInsert(
      'users',
      [
        {
          username: 'admin',
          password_hash: passwordHash,
          email: 'admin@secretary.local',
          telegram_id: null, // будет заполнено при первом входе через Telegram
          role: 'admin',
          timezone: 'Asia/Dubai',
          language: 'ru',
          subscription_tier: 'enterprise', // полный доступ
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      {}
    );

    console.log('✓ Создан тестовый администратор:');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('  Email: admin@secretary.local');
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('users', { username: 'admin' }, {});
  },
};
