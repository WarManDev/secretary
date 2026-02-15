import config from '../config/index.js';
import logger from '../config/logger.js';

const API_KEY = config.openWeatherMap?.apiKey;
const BASE_URL = 'https://api.openweathermap.org/data/2.5';

/**
 * Получает текущую погоду для города
 * @param {string} city - Название города
 * @returns {Object} - { temp, feels_like, description, humidity, wind, icon }
 */
export async function getCurrentWeather(city) {
  if (!API_KEY) {
    throw new Error('OPENWEATHERMAP_API_KEY не настроен');
  }

  const url = `${BASE_URL}/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric&lang=ru`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Город "${city}" не найден`);
    }
    throw new Error(`OpenWeatherMap API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    city: data.name,
    temp: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    description: data.weather[0]?.description || '',
    humidity: data.main.humidity,
    wind: Math.round(data.wind.speed),
    icon: data.weather[0]?.icon || '',
  };
}

/**
 * Получает прогноз погоды на указанную дату
 * @param {string} city - Название города
 * @param {string} date - Дата (YYYY-MM-DD)
 * @returns {Object} - { city, date, forecasts: [{ time, temp, description }] }
 */
export async function getForecast(city, date) {
  if (!API_KEY) {
    throw new Error('OPENWEATHERMAP_API_KEY не настроен');
  }

  const url = `${BASE_URL}/forecast?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric&lang=ru`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Город "${city}" не найден`);
    }
    throw new Error(`OpenWeatherMap API error: ${response.status}`);
  }

  const data = await response.json();

  // Фильтруем прогнозы на нужную дату
  const targetDate = date || new Date().toISOString().split('T')[0];
  const forecasts = data.list
    .filter(item => item.dt_txt.startsWith(targetDate))
    .map(item => ({
      time: item.dt_txt.split(' ')[1].slice(0, 5),
      temp: Math.round(item.main.temp),
      feels_like: Math.round(item.main.feels_like),
      description: item.weather[0]?.description || '',
    }));

  return {
    city: data.city.name,
    date: targetDate,
    forecasts,
  };
}

/**
 * Форматирует погоду в текстовый ответ
 */
export function formatWeatherResponse(weather, forecast = null) {
  const weatherIcons = {
    '01': '☀️', '02': '⛅', '03': '☁️', '04': '☁️',
    '09': '🌧', '10': '🌦', '11': '⛈', '13': '🌨', '50': '🌫',
  };

  const iconCode = weather.icon?.slice(0, 2) || '';
  const icon = weatherIcons[iconCode] || '🌤';

  let text = `${icon} **${weather.city}:** ${weather.temp}°C (ощущается ${weather.feels_like}°C)\n`;
  text += `${weather.description}, влажность ${weather.humidity}%, ветер ${weather.wind} м/с\n`;

  // Подсказка по одежде
  if (weather.temp < 0) {
    text += '\n🧥 Оденься тепло — на улице мороз!';
  } else if (weather.temp < 10) {
    text += '\n🧣 Прохладно — возьми куртку.';
  } else if (weather.temp > 30) {
    text += '\n🥤 Жарко — не забудь воду!';
  }

  if (forecast && forecast.forecasts.length > 0) {
    text += '\n\n📊 **Прогноз на день:**\n';
    for (const f of forecast.forecasts) {
      text += `  ${f.time} — ${f.temp}°C, ${f.description}\n`;
    }
  }

  return text;
}
