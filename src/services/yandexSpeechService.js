import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { Readable } from 'stream';
import config from '../config/index.js';
import logger from '../config/logger.js';

// Определение __dirname в ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Задайте путь к ffmpeg.exe (убедитесь, что ffmpeg находится по этому пути)
// TODO (Этап 5): использовать системный ffmpeg или ffmpeg-static пакет
// Пока оставляем Windows-специфичный путь
const ffmpegPath = path.join(__dirname, '..', '..', 'ffmpeg', 'bin', 'ffmpeg.exe');

// Установка пути к ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * convertOggToWav – конвертирует аудиоданные из формата OGG в формат WAV.
 * @param {Buffer} oggBuffer - буфер с аудиоданными в формате OGG.
 * @returns {Promise<Buffer>} - промис, который резолвится в буфер с WAV-аудиоданными.
 */
export async function convertOggToWav(oggBuffer) {
  return new Promise((resolve, reject) => {
    try {
      // 1. Создаём поток для входных данных из oggBuffer
      const inputStream = new Readable({
        read() {},
      });
      inputStream.push(oggBuffer);
      inputStream.push(null); // сигнал конца данных

      // 2. Настраиваем ffmpeg для конвертации: вход — OGG, выход — WAV с PCM 16-bit
      const command = ffmpeg(inputStream)
        .inputFormat('ogg')
        .audioChannels(1) // устанавливаем моно
        .audioFrequency(22050) // попробуйте повысить до 22050 Гц
        .audioBitrate('64k') // можно задать битрейт, если поддерживается
        .audioCodec('pcm_s16le')
        .format('wav')
        .on('start', (cmdLine) => {
          console.log('[ffmpeg] start command:', cmdLine);
        })
        .on('error', (err) => {
          console.error('[ffmpeg] error:', err);
          reject(err);
        });

      // 3. Организуем чтение выходных данных (WAV) через Node.js stream
      const outputStream = command.pipe();

      const chunks = [];
      outputStream.on('data', (chunk) => {
        chunks.push(chunk);
      });

      outputStream.on('end', () => {
        const wavBuffer = Buffer.concat(chunks);
        console.log('[ffmpeg] end, wav size =', wavBuffer.length);
        resolve(wavBuffer);
      });

      outputStream.on('error', (err) => {
        console.error('[ffmpeg] outputStream error:', err);
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * textToSpeechYandex – синтезирует речь из текста через Yandex SpeechKit.
 * Возвращает OGG/Opus буфер, который Telegram принимает напрямую как голосовое сообщение.
 *
 * @param {string} text - Текст для озвучивания (макс ~5000 символов)
 * @param {Object} options - Параметры голоса
 * @param {string} options.voice - Голос: 'filipp', 'alena', 'jane', 'madirus', 'omazh', 'zahar', 'ermil'
 * @param {string} options.emotion - Эмоция: 'neutral', 'good', 'evil'
 * @param {string} options.speed - Скорость: '0.5'-'3.0' (1.0 = нормальная)
 * @returns {Promise<Buffer|null>} - OGG/Opus буфер или null при ошибке
 */
export async function textToSpeechYandex(text, options = {}) {
  try {
    if (!text || text.trim().length === 0) return null;

    // Убираем Markdown-разметку для более чистого озвучивания
    const cleanText = text
      .replace(/\*\*/g, '')
      .replace(/[*_~`]/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Ограничиваем длину текста (Yandex лимит ~5000 символов)
    const trimmedText = cleanText.length > 4500 ? cleanText.substring(0, 4500) + '...' : cleanText;

    const apiKey = config.yandex.apiKey;
    const params = new URLSearchParams({
      text: trimmedText,
      lang: 'ru-RU',
      voice: options.voice || 'filipp',
      emotion: options.emotion || 'neutral',
      speed: options.speed || '1.1',
      format: 'oggopus',
    });

    const response = await axios.post(
      'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize',
      params.toString(),
      {
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        responseType: 'arraybuffer',
      }
    );

    const buffer = Buffer.from(response.data);
    logger.info(`TTS: синтезировано ${buffer.length} байт (${trimmedText.length} символов)`);
    return buffer;
  } catch (err) {
    logger.error('Yandex TTS error:', err.response?.data?.toString() || err.message);
    return null;
  }
}

/**
 * speechToTextYandex – отправляет аудиоданные в API Яндекса для распознавания речи.
 * Поддерживает OGG/Opus (нативный формат Telegram) и WAV.
 *
 * @param {Buffer} audioBuffer - буфер с аудиоданными.
 * @param {string} format - формат аудио: 'oggopus' (по умолчанию) или 'lpcm'
 * @returns {Promise<string>} - промис, который резолвится в распознанный текст.
 */
export async function speechToTextYandex(audioBuffer, format = 'oggopus') {
  try {
    const apiKey = config.yandex.apiKey;
    const url = `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?lang=ru-RU&format=${format}`;

    const contentType = format === 'oggopus' ? 'audio/ogg' : 'audio/wav';

    const response = await axios.post(url, audioBuffer, {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'Content-Type': contentType,
      },
    });

    return response.data.result || '';
  } catch (err) {
    logger.error('Yandex STT error:', err.response?.data || err.message);
    return '';
  }
}
