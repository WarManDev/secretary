import dotenv from 'dotenv';
dotenv.config();
import { transcribeAudio } from './services/yandexSpeechService.js';
import fs from 'fs';

async function testTranscription() {
  // Укажите путь к тестовому аудиофайлу (например, 'test_audio.ogg')
  const audioFilePath = './test_audio.ogg';

  try {
    const audioBuffer = fs.readFileSync(audioFilePath);
    const transcription = await transcribeAudio(audioBuffer);
    console.log('Распознанный текст:', transcription);
  } catch (error) {
    console.error('Ошибка распознавания речи:', error);
  }
}

testTranscription();
