// Global currency configuration - ISO 4217 standard
const currencies = {
  USD: { symbol: '$', name: 'US Dollar', country: 'US', rate: 1 },
  EUR: { symbol: '€', name: 'Euro', country: 'EU', rate: 0.92 },
  GBP: { symbol: '£', name: 'British Pound', country: 'GB', rate: 0.79 },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', country: 'CA', rate: 1.36 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', country: 'AU', rate: 1.53 },
  JPY: { symbol: '¥', name: 'Japanese Yen', country: 'JP', rate: 149.5 },
  INR: { symbol: '₹', name: 'Indian Rupee', country: 'IN', rate: 83.12 },
  MXN: { symbol: 'MX$', name: 'Mexican Peso', country: 'MX', rate: 17.15 },
  BRL: { symbol: 'R$', name: 'Brazilian Real', country: 'BR', rate: 4.97 },
  KRW: { symbol: '₩', name: 'South Korean Won', country: 'KR', rate: 1328 },
  CNY: { symbol: '¥', name: 'Chinese Yuan', country: 'CN', rate: 7.24 },
  CHF: { symbol: 'CHF', name: 'Swiss Franc', country: 'CH', rate: 0.88 },
  SEK: { symbol: 'kr', name: 'Swedish Krona', country: 'SE', rate: 10.42 },
  NOK: { symbol: 'kr', name: 'Norwegian Krone', country: 'NO', rate: 10.68 },
  DKK: { symbol: 'kr', name: 'Danish Krone', country: 'DK', rate: 6.87 },
  NZD: { symbol: 'NZ$', name: 'New Zealand Dollar', country: 'NZ', rate: 1.64 },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', country: 'SG', rate: 1.34 },
  HKD: { symbol: 'HK$', name: 'Hong Kong Dollar', country: 'HK', rate: 7.83 },
  THB: { symbol: '฿', name: 'Thai Baht', country: 'TH', rate: 35.2 },
  ZAR: { symbol: 'R', name: 'South African Rand', country: 'ZA', rate: 18.92 },
  AED: { symbol: 'د.إ', name: 'UAE Dirham', country: 'AE', rate: 3.67 },
  SAR: { symbol: '﷼', name: 'Saudi Riyal', country: 'SA', rate: 3.75 },
  PLN: { symbol: 'zł', name: 'Polish Zloty', country: 'PL', rate: 4.03 },
  TRY: { symbol: '₺', name: 'Turkish Lira', country: 'TR', rate: 28.9 },
  RUB: { symbol: '₽', name: 'Russian Ruble', country: 'RU', rate: 91.5 },
  NGN: { symbol: '₦', name: 'Nigerian Naira', country: 'NG', rate: 1540 },
  EGP: { symbol: 'E£', name: 'Egyptian Pound', country: 'EG', rate: 48.5 },
  KES: { symbol: 'KSh', name: 'Kenyan Shilling', country: 'KE', rate: 153 },
  PHP: { symbol: '₱', name: 'Philippine Peso', country: 'PH', rate: 56.2 },
  IDR: { symbol: 'Rp', name: 'Indonesian Rupiah', country: 'ID', rate: 15680 },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit', country: 'MY', rate: 4.72 },
  VND: { symbol: '₫', name: 'Vietnamese Dong', country: 'VN', rate: 24350 },
  TWD: { symbol: 'NT$', name: 'Taiwan Dollar', country: 'TW', rate: 31.5 },
  PKR: { symbol: '₨', name: 'Pakistani Rupee', country: 'PK', rate: 286 },
  BDT: { symbol: '৳', name: 'Bangladeshi Taka', country: 'BD', rate: 110 },
  COP: { symbol: 'COL$', name: 'Colombian Peso', country: 'CO', rate: 3960 },
  ARS: { symbol: 'AR$', name: 'Argentine Peso', country: 'AR', rate: 890 },
  CLP: { symbol: 'CL$', name: 'Chilean Peso', country: 'CL', rate: 880 },
  PEN: { symbol: 'S/.', name: 'Peruvian Sol', country: 'PE', rate: 3.72 },
  UAH: { symbol: '₴', name: 'Ukrainian Hryvnia', country: 'UA', rate: 38.5 },
  CZK: { symbol: 'Kč', name: 'Czech Koruna', country: 'CZ', rate: 22.8 },
  HUF: { symbol: 'Ft', name: 'Hungarian Forint', country: 'HU', rate: 356 },
  RON: { symbol: 'lei', name: 'Romanian Leu', country: 'RO', rate: 4.58 },
  ILS: { symbol: '₪', name: 'Israeli Shekel', country: 'IL', rate: 3.72 },
  QAR: { symbol: '﷼', name: 'Qatari Riyal', country: 'QA', rate: 3.64 },
  KWD: { symbol: 'د.ك', name: 'Kuwaiti Dinar', country: 'KW', rate: 0.31 },
  BHD: { symbol: 'BD', name: 'Bahraini Dinar', country: 'BH', rate: 0.38 },
  OMR: { symbol: '﷼', name: 'Omani Rial', country: 'OM', rate: 0.39 },
};

// Convert price from USD to target currency
const convertPrice = (usdAmount, targetCurrency) => {
  const curr = currencies[targetCurrency];
  if (!curr) return usdAmount;
  return Math.round(usdAmount * curr.rate * 100) / 100;
};

// Format price with currency symbol
const formatPrice = (amount, currencyCode = 'USD') => {
  const curr = currencies[currencyCode];
  if (!curr) return `$${amount}`;
  if (['JPY', 'KRW', 'VND', 'IDR', 'CLP'].includes(currencyCode)) {
    return `${curr.symbol}${Math.round(amount).toLocaleString()}`;
  }
  return `${curr.symbol}${Number(amount).toFixed(2)}`;
};

module.exports = { currencies, convertPrice, formatPrice };