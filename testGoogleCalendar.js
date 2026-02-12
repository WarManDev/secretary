import dotenv from 'dotenv';
dotenv.config();
import { createEvent } from './services/googleCalendarService.js';

async function testCreateEvent() {
  const eventDetails = {
    summary: 'Встреча с Иваном',
    description: 'Планирование проекта',
    start: {
      dateTime: '2025-02-25T15:00:00',
      timeZone: 'Europe/Moscow',
    },
    end: {
      dateTime: '2025-02-25T16:00:00',
      timeZone: 'Europe/Moscow',
    },
    attendees: [
      { email: 'ivan@example.com' },
    ],
  };

  try {
    const createdEvent = await createEvent(eventDetails);
    console.log('Событие создано:', createdEvent);
  } catch (error) {
    console.error('Ошибка создания события:', error);
  }
}

testCreateEvent();

// Это вставлять в индекс в корне
// import gcalAuthRouter from './routes/gcalAuthRouter.js';
// // Подключаем роутер для Google Calendar
// app.use('/api/gcal', gcalAuthRouter);
