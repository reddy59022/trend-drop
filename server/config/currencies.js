// Comprehensive Global Currency Configuration - ISO 4217 Standard
const currencies = {
  USD: { symbol: '$', name: 'US Dollar', country: 'US', rate: 1, decimals: 2 },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', country: 'CA', rate: 1.36, decimals: 2 },
  MXN: { symbol: 'MX$', name: 'Mexican Peso', country: 'MX', rate: 17.15, decimals: 2 },
  EUR: { symbol: '€', name: 'Euro', country: 'EU', rate: 0.92, decimals: 2 },
  GBP: { symbol: '£', name: 'British Pound', country: 'GB', rate: 0.79, decimals: 2 },
  CHF: { symbol: 'CHF', name: 'Swiss Franc', country: 'CH', rate: 0.88, decimals: 2 },
  SEK: { symbol: 'kr', name: 'Swedish Krona', country: 'SE', rate: 10.42, decimals: 2 },
  NOK: { symbol: 'kr', name: 'Norwegian Krone', country: 'NO', rate: 10.68, decimals: 2 },
  DKK: { symbol: 'kr', name: 'Danish Krone', country: 'DK', rate: 6.87, decimals: 2 },
  PLN: { symbol: 'zl', name: 'Polish Zloty', country: 'PL', rate: 4.03, decimals: 2 },
  CZK: { symbol: 'Kc', name: 'Czech Koruna', country: 'CZ', rate: 22.8, decimals: 2 },
  HUF: { symbol: 'Ft', name: 'Hungarian Forint', country: 'HU', rate: 356, decimals: 0 },
  RON: { symbol: 'lei', name: 'Romanian Leu', country: 'RO', rate: 4.58, decimals: 2 },
  BGN: { symbol: 'lev', name: 'Bulgarian Lev', country: 'BG', rate: 1.80, decimals: 2 },
  UAH: { symbol: 'hrn', name: 'Ukrainian Hryvnia', country: 'UA', rate: 38.5, decimals: 2 },
  ISK: { symbol: 'kr', name: 'Icelandic Krona', country: 'IS', rate: 137.5, decimals: 0 },
  TRY: { symbol: 'TL', name: 'Turkish Lira', country: 'TR', rate: 28.9, decimals: 2 },
  RUB: { symbol: 'RUB', name: 'Russian Ruble', country: 'RU', rate: 91.5, decimals: 2 },
  GEL: { symbol: 'GEL', name: 'Georgian Lari', country: 'GE', rate: 2.65, decimals: 2 },
  JPY: { symbol: 'JPY', name: 'Japanese Yen', country: 'JP', rate: 149.5, decimals: 0 },
  CNY: { symbol: 'CNY', name: 'Chinese Yuan', country: 'CN', rate: 7.24, decimals: 2 },
  KRW: { symbol: 'KRW', name: 'South Korean Won', country: 'KR', rate: 1328, decimals: 0 },
  INR: { symbol: 'INR', name: 'Indian Rupee', country: 'IN', rate: 83.12, decimals: 2 },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', country: 'SG', rate: 1.34, decimals: 2 },
  HKD: { symbol: 'HK$', name: 'Hong Kong Dollar', country: 'HK', rate: 7.83, decimals: 2 },
  TWD: { symbol: 'NT$', name: 'Taiwan Dollar', country: 'TW', rate: 31.5, decimals: 2 },
  THB: { symbol: 'THB', name: 'Thai Baht', country: 'TH', rate: 35.2, decimals: 2 },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit', country: 'MY', rate: 4.72, decimals: 2 },
  IDR: { symbol: 'Rp', name: 'Indonesian Rupiah', country: 'ID', rate: 15680, decimals: 0 },
  PHP: { symbol: 'PHP', name: 'Philippine Peso', country: 'PH', rate: 56.2, decimals: 2 },
  VND: { symbol: 'VND', name: 'Vietnamese Dong', country: 'VN', rate: 24350, decimals: 0 },
  PKR: { symbol: 'PKR', name: 'Pakistani Rupee', country: 'PK', rate: 286, decimals: 2 },
  BDT: { symbol: 'BDT', name: 'Bangladeshi Taka', country: 'BD', rate: 110, decimals: 2 },
  LKR: { symbol: 'LKR', name: 'Sri Lankan Rupee', country: 'LK', rate: 310, decimals: 2 },
  NPR: { symbol: 'NPR', name: 'Nepalese Rupee', country: 'NP', rate: 133, decimals: 2 },
  MMK: { symbol: 'MMK', name: 'Myanmar Kyat', country: 'MM', rate: 2100, decimals: 2 },
  KHR: { symbol: 'KHR', name: 'Cambodian Riel', country: 'KH', rate: 4100, decimals: 0 },
  LAK: { symbol: 'LAK', name: 'Laotian Kip', country: 'LA', rate: 17500, decimals: 0 },
  BND: { symbol: 'B$', name: 'Brunei Dollar', country: 'BN', rate: 1.34, decimals: 2 },
  MOP: { symbol: 'MOP', name: 'Macanese Pataca', country: 'MO', rate: 8.08, decimals: 2 },
  NZD: { symbol: 'NZ$', name: 'New Zealand Dollar', country: 'NZ', rate: 1.64, decimals: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', country: 'AU', rate: 1.53, decimals: 2 },
  FJD: { symbol: 'FJ$', name: 'Fijian Dollar', country: 'FJ', rate: 2.25, decimals: 2 },
  PGK: { symbol: 'PGK', name: 'Papua New Guinea Kina', country: 'PG', rate: 3.85, decimals: 2 },
  ZAR: { symbol: 'ZAR', name: 'South African Rand', country: 'ZA', rate: 18.92, decimals: 2 },
  NGN: { symbol: 'NGN', name: 'Nigerian Naira', country: 'NG', rate: 1540, decimals: 2 },
  EGP: { symbol: 'EGP', name: 'Egyptian Pound', country: 'EG', rate: 48.5, decimals: 2 },
  KES: { symbol: 'KES', name: 'Kenyan Shilling', country: 'KE', rate: 153, decimals: 2 },
  GHS: { symbol: 'GHS', name: 'Ghanaian Cedi', country: 'GH', rate: 12.2, decimals: 2 },
  TZS: { symbol: 'TZS', name: 'Tanzanian Shilling', country: 'TZ', rate: 2500, decimals: 0 },
  UGX: { symbol: 'UGX', name: 'Ugandan Shilling', country: 'UG', rate: 3750, decimals: 0 },
  XOF: { symbol: 'XOF', name: 'CFA Franc', country: 'SN', rate: 610, decimals: 0 },
  MAD: { symbol: 'MAD', name: 'Moroccan Dirham', country: 'MA', rate: 10.0, decimals: 2 },
  DZD: { symbol: 'DZD', name: 'Algerian Dinar', country: 'DZ', rate: 135, decimals: 2 },
  TND: { symbol: 'TND', name: 'Tunisian Dinar', country: 'TN', rate: 3.1, decimals: 3 },
  LYD: { symbol: 'LYD', name: 'Libyan Dinar', country: 'LY', rate: 4.8, decimals: 3 },
  AED: { symbol: 'AED', name: 'UAE Dirham', country: 'AE', rate: 3.67, decimals: 2 },
  SAR: { symbol: 'SAR', name: 'Saudi Riyal', country: 'SA', rate: 3.75, decimals: 2 },
  QAR: { symbol: 'QAR', name: 'Qatari Riyal', country: 'QA', rate: 3.64, decimals: 2 },
  KWD: { symbol: 'KWD', name: 'Kuwaiti Dinar', country: 'KW', rate: 0.31, decimals: 3 },
  BHD: { symbol: 'BHD', name: 'Bahraini Dinar', country: 'BH', rate: 0.38, decimals: 3 },
  OMR: { symbol: 'OMR', name: 'Omani Rial', country: 'OM', rate: 0.39, decimals: 3 },
  JOD: { symbol: 'JOD', name: 'Jordanian Dinar', country: 'JO', rate: 0.71, decimals: 3 },
  LBP: { symbol: 'LBP', name: 'Lebanese Pound', country: 'LB', rate: 15000, decimals: 0 },
  ILS: { symbol: 'ILS', name: 'Israeli Shekel', country: 'IL', rate: 3.72, decimals: 2 },
  IQD: { symbol: 'IQD', name: 'Iraqi Dinar', country: 'IQ', rate: 1310, decimals: 0 },
  COP: { symbol: 'COL$', name: 'Colombian Peso', country: 'CO', rate: 3960, decimals: 0 },
  ARS: { symbol: 'AR$', name: 'Argentine Peso', country: 'AR', rate: 890, decimals: 2 },
  CLP: { symbol: 'CL$', name: 'Chilean Peso', country: 'CL', rate: 880, decimals: 0 },
  PEN: { symbol: 'PEN', name: 'Peruvian Sol', country: 'PE', rate: 3.72, decimals: 2 },
  BRL: { symbol: 'R$', name: 'Brazilian Real', country: 'BR', rate: 4.97, decimals: 2 },
  UYU: { symbol: 'UYU', name: 'Uruguayan Peso', country: 'UY', rate: 38.5, decimals: 2 },
  PYG: { symbol: 'PYG', name: 'Paraguayan Guarani', country: 'PY', rate: 7200, decimals: 0 },
  BOB: { symbol: 'BOB', name: 'Bolivian Boliviano', country: 'BO', rate: 6.9, decimals: 2 },
  VES: { symbol: 'VES', name: 'Venezuelan Bolivar', country: 'VE', rate: 36.5, decimals: 2 },
  CRC: { symbol: 'CRC', name: 'Costa Rican Colon', country: 'CR', rate: 515, decimals: 2 },
  GTQ: { symbol: 'GTQ', name: 'Guatemalan Quetzal', country: 'GT', rate: 7.8, decimals: 2 },
  HNL: { symbol: 'HNL', name: 'Honduran Lempira', country: 'HN', rate: 24.7, decimals: 2 },
  NIO: { symbol: 'NIO', name: 'Nicaraguan Cordoba', country: 'NI', rate: 36.7, decimals: 2 },
  PAB: { symbol: 'B/.', name: 'Panamanian Balboa', country: 'PA', rate: 1.0, decimals: 2 },
  DOP: { symbol: 'DOP', name: 'Dominican Peso', country: 'DO', rate: 55.5, decimals: 2 },
  JMD: { symbol: 'JMD', name: 'Jamaican Dollar', country: 'JM', rate: 155, decimals: 2 },
  TTD: { symbol: 'TT$', name: 'Trinidad Dollar', country: 'TT', rate: 6.78, decimals: 2 },
  HTG: { symbol: 'HTG', name: 'Haitian Gourde', country: 'HT', rate: 132, decimals: 2 },
  XCD: { symbol: 'EC$', name: 'East Caribbean Dollar', country: 'AG', rate: 2.7, decimals: 2 },
  KZT: { symbol: 'KZT', name: 'Kazakhstani Tenge', country: 'KZ', rate: 450, decimals: 2 },
  UZS: { symbol: 'UZS', name: 'Uzbekistani Som', country: 'UZ', rate: 11200, decimals: 0 },
  AZN: { symbol: 'AZN', name: 'Azerbaijani Manat', country: 'AZ', rate: 1.7, decimals: 2 },
  KGS: { symbol: 'KGS', name: 'Kyrgyzstani Som', country: 'KG', rate: 89, decimals: 2 },
  TJS: { symbol: 'TJS', name: 'Tajikistani Somoni', country: 'TJ', rate: 10.9, decimals: 2 },
  MNT: { symbol: 'MNT', name: 'Mongolian Tugrik', country: 'MN', rate: 3400, decimals: 0 },
  AFN: { symbol: 'AFN', name: 'Afghan Afghani', country: 'AF', rate: 88, decimals: 2 },
};

// Country code to currency mapping
const countryCurrencyMap = {
  US: 'USD', CA: 'CAD', MX: 'MXN', GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR',
  ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR',
  GR: 'EUR', LU: 'EUR', MT: 'EUR', SK: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  SI: 'EUR', CY: 'EUR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', HR: 'HRK', RS: 'RS', UA: 'UAH',
  IS: 'ISK', TR: 'TRY', RU: 'RUB', GE: 'GEL', JP: 'JPY', CN: 'CNY', KR: 'KRW',
  IN: 'INR', SG: 'SGD', HK: 'HKD', TW: 'TWD', TH: 'THB', MY: 'MYR', ID: 'IDR',
  PH: 'PH', VN: 'VN', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', MM: 'MMK',
  KH: 'KH', LA: 'LA', BN: 'BN', MO: 'MO', NZ: 'NZD', AU: 'AUD', FJ: 'FJD',
  PG: 'PGK', ZA: 'ZAR', NG: 'NG', EG: 'EG', KE: 'KE', GH: 'GH', TZ: 'TZ',
  UG: 'UG', SN: 'SN', MA: 'MA', DZ: 'DZ', TN: 'TN', LY: 'LY', AE: 'AED',
  SA: 'SA', QA: 'QA', KW: 'KW', BH: 'BH', OM: 'OM', JO: 'JO', LB: 'LB',
  IL: 'IL', IQ: 'IQ', CO: 'CO', AR: 'AR', CL: 'CL', PE: 'PE', BR: 'BRL',
  UY: 'UY', PY: 'PY', BO: 'BO', VE: 'VE', CR: 'CR', GT: 'GT', HN: 'HN',
  NI: 'NI', PA: 'PA', DO: 'DO', JM: 'JM', TT: 'TT', HT: 'HT', KZ: 'KZ',
  UZ: 'UZ', AZ: 'AZ', KG: 'KG', TJ: 'TJ', MN: 'MN', AF: 'AF',
};

// Convert price from USD to target currency
const convertPrice = (usdAmount, targetCurrency) => {
  const curr = currencies[targetCurrency];
  if (!curr) return usdAmount;
  return Math.round(usdAmount * curr.rate * 100) / 100;
};

// Format price with currency symbol using Intl.NumberFormat
const formatPrice = (amount, currencyCode = 'USD') => {
  const curr = currencies[currencyCode];
  if (!curr) return '$' + Number(amount).toFixed(2);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: curr.decimals,
      maximumFractionDigits: curr.decimals,
    }).format(amount);
  } catch (e) {
    const dec = curr.decimals || 2;
    return curr.symbol + Number(amount).toFixed(dec);
  }
};

// Get currency by country code
const getCurrencyByCountry = (countryCode) => {
  const code = countryCurrencyMap[countryCode];
  return code ? currencies[code] : currencies.USD;
};

// Get all currency codes as array
const getAllCurrencyCodes = () => Object.keys(currencies);

module.exports = { currencies, countryCurrencyMap, convertPrice, formatPrice, getCurrencyByCountry, getAllCurrencyCodes };