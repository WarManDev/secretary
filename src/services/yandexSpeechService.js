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
 * speechToTextYandex – отправляет WAV-аудиоданные в API Яндекса для распознавания речи.
 * @param {Buffer} wavBuffer - буфер с аудиоданными в формате WAV.
 * @returns {Promise<string>} - промис, который резолвится в распознанный текст.
 */
export async function speechToTextYandex(wavBuffer) {
  try {
    const apiKey = config.yandex.apiKey; // API-ключ Яндекса из конфигурации
    const url = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?lang=ru-RU&format=lpcm';

    const response = await axios.post(url, wavBuffer, {
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
    });

    return response.data.result || '';
  } catch (err) {
    console.error('Yandex STT error:', err.response?.data || err.message);
    return '';
  }
}
