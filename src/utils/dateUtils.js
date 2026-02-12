import moment from 'moment-timezone';

export function expectedDateForUserInput(userText) {
  const lowerText = userText.toLowerCase();
  const today = new Date();
  if (lowerText.includes('сегодня') || lowerText.includes('на сегодня')) {
    return today.toISOString().split('T')[0];
  } else if (lowerText.includes('послезавтра')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    return date.toISOString().split('T')[0];
  } else if (lowerText.includes('завтра')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  }
  return null;
}

/**
 * Функция correctYear принимает строку даты в формате "YYYY-MM-DD",
 * обрезает лишние пробелы и, если год меньше текущего, заменяет его на текущий.
 */
export function correctYear(dateStr) {
  dateStr = dateStr.trim();
  const currentYear = new Date().getFullYear();
  const parts = dateStr.split('-').map((p) => p.trim());
  if (parts.length !== 3) {
    throw new Error('Неверный формат даты: ' + dateStr);
  }
  const [year, month, day] = parts;
  if (parseInt(year) < currentYear) {
    return `${currentYear}-${month}-${day}`;
  }
  return dateStr;
}

export function isValidDateTime(dateStr, timeStr) {
  // Обновляем год в dateStr с помощью correctYear
  dateStr = correctYear(dateStr);
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  return !isNaN(dt.getTime());
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Форматирует дату в локальном часовом поясе в формате "YYYY-MM-DDTHH:MM:SS"
 */
export function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Вычисляет время окончания встречи, добавляя 1 час к времени начала,
 * и возвращает дату в локальном формате.
 */
export function computeEndDateTime(dateStr, timeStr) {
  // Обновляем дату через correctYear
  dateStr = correctYear(dateStr);
  const start = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(start.getTime())) {
    throw new Error('Некорректная дата или время для начала встречи.');
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000); // добавляем 1 час
  return formatLocalDate(end);
}

/**
 * Извлекает время окончания из текста в формате "до HH" или "до HH:MM".
 * Возвращает строку времени в формате "HH:MM" или null, если не найдено.
 */
export function extractEndTime(text) {
  const regex = /до\s*(\d{1,2})(?::(\d{1,2}))?/i;
  const match = text.match(regex);
  if (match) {
    let hour = match[1];
    let minute = match[2] || '00';
    // Добавляем ведущий ноль, если необходимо
    if (hour.length === 1) hour = '0' + hour;
    if (minute.length === 1) minute = '0' + minute;
    return `${hour}:${minute}`;
  }
  return null;
}

/**
 * Возвращает объект Date, соответствующий времени в часовом поясе Asia/Dubai.
 * @param {string} dateStr - Дата в формате "YYYY-MM-DD"
 * @param {string} timeStr - Время в формате "HH:MM"
 * @returns {Date}
 */
export function getLocalDateTime(dateStr, timeStr) {
  return moment.tz(`${dateStr}T${timeStr}:00`, 'Asia/Dubai').toDate();
}

export function nextDay(dateStr) {
  // Предполагаем, что dateStr в формате "YYYY-MM-DD"
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}
