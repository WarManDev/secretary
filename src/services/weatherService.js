import config from '../config/index.js';
import logger from '../config/logger.js';

const API_KEY = config.yandex?.weatherApiKey;
const BASE_URL = 'https://api.weather.yandex.ru/v2';

/**
 * Словарь городов → координаты
 * Яндекс Weather API работает только с lat/lon
 */
const CITY_COORDS = {
  // Россия
  'москва': { lat: 55.7558, lon: 37.6173, name: 'Москва' },
  'moscow': { lat: 55.7558, lon: 37.6173, name: 'Москва' },
  'санкт-петербург': { lat: 59.9343, lon: 30.3351, name: 'Санкт-Петербург' },
  'петербург': { lat: 59.9343, lon: 30.3351, name: 'Санкт-Петербург' },
  'спб': { lat: 59.9343, lon: 30.3351, name: 'Санкт-Петербург' },
  'новосибирск': { lat: 55.0084, lon: 82.9357, name: 'Новосибирск' },
  'екатеринбург': { lat: 56.8389, lon: 60.6057, name: 'Екатеринбург' },
  'казань': { lat: 55.7887, lon: 49.1221, name: 'Казань' },
  'нижний новгород': { lat: 56.2965, lon: 43.9361, name: 'Нижний Новгород' },
  'челябинск': { lat: 55.1644, lon: 61.4368, name: 'Челябинск' },
  'самара': { lat: 53.1959, lon: 50.1002, name: 'Самара' },
  'омск': { lat: 54.9885, lon: 73.3242, name: 'Омск' },
  'ростов-на-дону': { lat: 47.2357, lon: 39.7015, name: 'Ростов-на-Дону' },
  'ростов': { lat: 47.2357, lon: 39.7015, name: 'Ростов-на-Дону' },
  'уфа': { lat: 54.7388, lon: 55.9721, name: 'Уфа' },
  'красноярск': { lat: 56.0153, lon: 92.8932, name: 'Красноярск' },
  'пермь': { lat: 58.0105, lon: 56.2502, name: 'Пермь' },
  'воронеж': { lat: 51.6754, lon: 39.2089, name: 'Воронеж' },
  'волгоград': { lat: 48.7080, lon: 44.5133, name: 'Волгоград' },
  'краснодар': { lat: 45.0353, lon: 38.9753, name: 'Краснодар' },
  'сочи': { lat: 43.6028, lon: 39.7342, name: 'Сочи' },
  'калининград': { lat: 54.7104, lon: 20.4522, name: 'Калининград' },
  'тюмень': { lat: 57.1522, lon: 65.5272, name: 'Тюмень' },
  'иркутск': { lat: 52.2978, lon: 104.2964, name: 'Иркутск' },
  'владивосток': { lat: 43.1056, lon: 131.8735, name: 'Владивосток' },
  'хабаровск': { lat: 48.4827, lon: 135.0838, name: 'Хабаровск' },
  'махачкала': { lat: 42.9849, lon: 47.5047, name: 'Махачкала' },
  'томск': { lat: 56.4884, lon: 84.9480, name: 'Томск' },
  'саратов': { lat: 51.5336, lon: 46.0342, name: 'Саратов' },
  'ярославль': { lat: 57.6261, lon: 39.8845, name: 'Ярославль' },
  'тула': { lat: 54.1931, lon: 37.6173, name: 'Тула' },
  'рязань': { lat: 54.6296, lon: 39.7417, name: 'Рязань' },
  'мурманск': { lat: 68.9585, lon: 33.0827, name: 'Мурманск' },
  'архангельск': { lat: 64.5399, lon: 40.5152, name: 'Архангельск' },
  // Популярные зарубежные
  'дубай': { lat: 25.2048, lon: 55.2708, name: 'Дубай' },
  'dubai': { lat: 25.2048, lon: 55.2708, name: 'Дубай' },
  'стамбул': { lat: 41.0082, lon: 28.9784, name: 'Стамбул' },
  'анталья': { lat: 36.8969, lon: 30.7133, name: 'Анталья' },
  'минск': { lat: 53.9006, lon: 27.5590, name: 'Минск' },
  'астана': { lat: 51.1694, lon: 71.4491, name: 'Астана' },
  'ташкент': { lat: 41.2995, lon: 69.2401, name: 'Ташкент' },
  'тбилиси': { lat: 41.7151, lon: 44.8271, name: 'Тбилиси' },
  'ереван': { lat: 40.1792, lon: 44.4991, name: 'Ереван' },
  'баку': { lat: 40.4093, lon: 49.8671, name: 'Баку' },
};

/**
 * Находит координаты города по названию
 */
function getCityCoords(city) {
  const normalized = city.toLowerCase().trim();
  const found = CITY_COORDS[normalized];
  if (found) return found;

  // Поиск по частичному совпадению
  for (const [key, value] of Object.entries(CITY_COORDS)) {
    if (key.includes(normalized) || normalized.includes(key)) {
      return value;
    }
  }

  return null;
}

/**
 * Перевод condition Яндекса на русский
 */
const CONDITIONS = {
  'clear': 'ясно',
  'partly-cloudy': 'малооблачно',
  'cloudy': 'облачно с прояснениями',
  'overcast': 'пасмурно',
  'light-rain': 'небольшой дождь',
  'rain': 'дождь',
  'heavy-rain': 'сильный дождь',
  'showers': 'ливень',
  'wet-snow': 'дождь со снегом',
  'light-snow': 'небольшой снег',
  'snow': 'снег',
  'snow-showers': 'снегопад',
  'hail': 'град',
  'thunderstorm': 'гроза',
  'thunderstorm-with-rain': 'дождь с грозой',
  'thunderstorm-with-hail': 'гроза с градом',
};

const CONDITION_ICONS = {
  'clear': '☀️',
  'partly-cloudy': '⛅',
  'cloudy': '🌥',
  'overcast': '☁️',
  'light-rain': '🌦',
  'rain': '🌧',
  'heavy-rain': '🌧',
  'showers': '🌧',
  'wet-snow': '🌨',
  'light-snow': '🌨',
  'snow': '❄️',
  'snow-showers': '❄️',
  'hail': '🌨',
  'thunderstorm': '⛈',
  'thunderstorm-with-rain': '⛈',
  'thunderstorm-with-hail': '⛈',
};

/**
 * Получает текущую погоду для города
 * @param {string} city - Название города
 * @returns {Object} - { city, temp, feels_like, description, humidity, wind, condition }
 */
export async function getCurrentWeather(city) {
  if (!API_KEY) {
    throw new Error('YANDEX_WEATHER_API_KEY не настроен. Добавь ключ в .env');
  }

  const coords = getCityCoords(city);
  if (!coords) {
    throw new Error(`Город "${city}" не найден. Попробуй указать крупный город.`);
  }

  const url = `${BASE_URL}/forecast?lat=${coords.lat}&lon=${coords.lon}&lang=ru_RU&limit=1&hours=false`;
  const response = await fetch(url, {
    headers: { 'X-Yandex-Weather-Key': API_KEY },
  });

  if (!response.ok) {
    throw new Error(`Yandex Weather API error: ${response.status}`);
  }

  const data = await response.json();
  const fact = data.fact;

  return {
    city: coords.name,
    temp: fact.temp,
    feels_like: fact.feels_like,
    description: CONDITIONS[fact.condition] || fact.condition,
    humidity: fact.humidity,
    wind: Math.round(fact.wind_speed),
    condition: fact.condition,
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
    throw new Error('YANDEX_WEATHER_API_KEY не настроен');
  }

  const coords = getCityCoords(city);
  if (!coords) {
    throw new Error(`Город "${city}" не найден`);
  }

  const url = `${BASE_URL}/forecast?lat=${coords.lat}&lon=${coords.lon}&lang=ru_RU&limit=7&hours=true`;
  const response = await fetch(url, {
    headers: { 'X-Yandex-Weather-Key': API_KEY },
  });

  if (!response.ok) {
    throw new Error(`Yandex Weather API error: ${response.status}`);
  }

  const data = await response.json();

  // Ищем нужную дату в прогнозе
  const targetDate = date || new Date().toISOString().split('T')[0];
  const dayForecast = data.forecasts?.find(f => f.date === targetDate);

  if (!dayForecast) {
    return { city: coords.name, date: targetDate, forecasts: [] };
  }

  // Берём почасовой прогноз (каждые 3 часа)
  const forecasts = (dayForecast.hours || [])
    .filter((_, i) => i % 3 === 0)
    .map(h => ({
      time: `${h.hour.padStart(2, '0')}:00`,
      temp: h.temp,
      feels_like: h.feels_like,
      description: CONDITIONS[h.condition] || h.condition,
    }));

  return {
    city: coords.name,
    date: targetDate,
    forecasts,
  };
}

/**
 * Форматирует погоду в текстовый ответ
 */
export function formatWeatherResponse(weather, forecast = null) {
  const icon = CONDITION_ICONS[weather.condition] || '🌤';

  let text = `${icon} **${weather.city}:** ${weather.temp}°C (ощущается ${weather.feels_like}°C)\n`;
  text += `${weather.description}, влажность ${weather.humidity}%, ветер ${weather.wind} м/с\n`;

  // Подсказка по одежде
  if (weather.temp <= -15) {
    text += '\n🥶 На улице очень холодно — одевайся максимально тепло!';
  } else if (weather.temp < 0) {
    text += '\n🧥 Мороз — оденься тепло!';
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
