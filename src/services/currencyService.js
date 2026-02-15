import logger from '../config/logger.js';

const CBR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

// Кэш курсов (обновляем не чаще раза в час)
let cachedRates = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 час

/**
 * Получает актуальные курсы валют от ЦБ РФ
 */
async function getRates() {
  if (cachedRates && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedRates;
  }

  const response = await fetch(CBR_URL);
  if (!response.ok) {
    throw new Error(`CBR API error: ${response.status}`);
  }

  const data = await response.json();
  const rates = { RUB: 1 };

  for (const [, val] of Object.entries(data.Valute)) {
    rates[val.CharCode] = val.Value / val.Nominal;
  }

  cachedRates = rates;
  cacheTimestamp = Date.now();
  return rates;
}

/**
 * Конвертирует валюту
 * @param {number} amount - Сумма
 * @param {string} from - Исходная валюта (USD, EUR, RUB и т.д.)
 * @param {string} to - Целевая валюта
 * @returns {Object} - { amount, from, to, result, rate }
 */
export async function convertCurrency(amount, from, to) {
  const rates = await getRates();

  const fromCode = from.toUpperCase();
  const toCode = to.toUpperCase();

  if (fromCode !== 'RUB' && !rates[fromCode]) {
    throw new Error(`Неизвестная валюта: ${fromCode}`);
  }
  if (toCode !== 'RUB' && !rates[toCode]) {
    throw new Error(`Неизвестная валюта: ${toCode}`);
  }

  // Конвертируем через RUB как базу
  const amountInRub = fromCode === 'RUB' ? amount : amount * rates[fromCode];
  const result = toCode === 'RUB' ? amountInRub : amountInRub / rates[toCode];
  const rate = toCode === 'RUB' ? rates[fromCode] : (fromCode === 'RUB' ? 1 / rates[toCode] : rates[fromCode] / rates[toCode]);

  return {
    amount,
    from: fromCode,
    to: toCode,
    result: Math.round(result * 100) / 100,
    rate: Math.round(rate * 10000) / 10000,
  };
}

/**
 * Форматирует результат конвертации
 */
export function formatCurrencyResponse(data) {
  const symbols = { RUB: '₽', USD: '$', EUR: '€', GBP: '£', CNY: '¥' };
  const fromSym = symbols[data.from] || data.from;
  const toSym = symbols[data.to] || data.to;

  let text = `💱 **Конвертация:**\n`;
  text += `${data.amount.toLocaleString('ru-RU')} ${fromSym} = **${data.result.toLocaleString('ru-RU')} ${toSym}**\n`;
  text += `Курс: 1 ${data.from} = ${data.rate} ${data.to} (ЦБ РФ)`;

  return text;
}
