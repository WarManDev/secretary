import crypto from 'crypto';
import config from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const ENCODING = 'base64';

/**
 * Получаем 32-байтный ключ из TOKEN_ENCRYPTION_KEY.
 * Если ключ не задан — шифрование отключено (возвращаем данные как есть).
 */
function getKey() {
  const raw = config.encryption.key;
  if (!raw) return null;

  // Если ключ уже 32 байта (hex = 64 символа) — используем напрямую
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  // Иначе хешируем через SHA-256 чтобы получить ровно 32 байта
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Шифрует строку с помощью AES-256-GCM.
 * Формат: base64(iv + authTag + ciphertext)
 *
 * @param {string} plaintext - Исходный текст
 * @returns {string} - Зашифрованная строка в base64 с префиксом "enc:"
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;

  const key = getKey();
  if (!key) return plaintext; // шифрование отключено

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Склеиваем: IV (16) + authTag (16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return `enc:${combined.toString(ENCODING)}`;
}

/**
 * Расшифровывает строку, зашифрованную через encrypt().
 * Если строка не зашифрована (нет префикса "enc:") — возвращает как есть.
 *
 * @param {string} encryptedText - Зашифрованная строка
 * @returns {string} - Исходный текст
 */
export function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;

  // Если нет префикса "enc:" — это незашифрованный текст (обратная совместимость)
  if (!encryptedText.startsWith('enc:')) return encryptedText;

  const key = getKey();
  if (!key) return encryptedText; // ключ не задан, не можем расшифровать

  try {
    const combined = Buffer.from(encryptedText.slice(4), ENCODING);

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    // Если расшифровка не удалась — возвращаем как есть (возможно, незашифрованный токен)
    return encryptedText;
  }
}
