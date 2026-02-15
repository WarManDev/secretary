import { DataTypes } from 'sequelize';
import { encrypt, decrypt } from '../utils/encryption.js';

export default (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      username: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: true, // nullable для пользователей через Telegram
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
      },
      telegram_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
      },
      role: {
        type: DataTypes.ENUM('admin', 'boss', 'employee'),
        allowNull: false,
        defaultValue: 'employee',
      },
      timezone: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'Asia/Dubai',
      },
      language: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'ru',
      },
      subscription_tier: {
        type: DataTypes.ENUM('free', 'professional', 'business', 'enterprise'),
        allowNull: false,
        defaultValue: 'free',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Google Calendar OAuth2 (per-user, зашифровано AES-256-GCM)
      google_refresh_token: {
        type: DataTypes.TEXT,
        allowNull: true,
        set(value) {
          this.setDataValue('google_refresh_token', value ? encrypt(value) : null);
        },
        get() {
          const raw = this.getDataValue('google_refresh_token');
          return raw ? decrypt(raw) : null;
        },
      },
      google_access_token: {
        type: DataTypes.TEXT,
        allowNull: true,
        set(value) {
          this.setDataValue('google_access_token', value ? encrypt(value) : null);
        },
        get() {
          const raw = this.getDataValue('google_access_token');
          return raw ? decrypt(raw) : null;
        },
      },
      google_token_expiry: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      timestamps: true,
      underscored: true,
    }
  );

  return User;
};
