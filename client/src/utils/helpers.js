import moment from 'moment';

// Default avatar
export const defaultAvatar = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#e0e0e0"/><circle cx="50" cy="38" r="16" fill="#bdbdbd"/><ellipse cx="50" cy="75" rx="28" ry="22" fill="#bdbdbd"/></svg>`);

// Currency data with rates (mirrors server config/currencies.js)
export const currencies = {
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
  BGN: { symbol: 'lev', name: 'Bulgarian Lev', country: 'BG', rate: 1.8, decimals: 2 },
  RSD: { symbol: 'RSD', name: 'Serbian Dinar', country: 'RS', rate: 105.5, decimals: 2 },
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

// Currency formatting - formats amount in the specified currency
// If fromCurrency is provided, converts from that currency to target currency
export const formatPrice = (amount, currencyCode = 'USD', fromCurrency = null) => {
  if (amount == null) {
    const curr = currencies[currencyCode] || currencies.USD;
    return curr.symbol + '0.' + '0'.repeat(curr.decimals || 2);
  }
  
  // If we need to convert from another currency
  let finalAmount = amount;
  if (fromCurrency && fromCurrency !== currencyCode) {
    // Convert from fromCurrency to currencyCode
    const fromCurr = currencies[fromCurrency];
    const toCurr = currencies[currencyCode];
    if (fromCurr && toCurr) {
      // First convert to USD, then to target
      const usdAmount = amount / fromCurr.rate;
      finalAmount = usdAmount * toCurr.rate;
    }
  }
  
  try {
    const curr = currencies[currencyCode] || currencies.USD;
    const decimals = curr.decimals != null ? curr.decimals : 2;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(finalAmount);
  } catch (e) {
    const curr = currencies[currencyCode] || currencies.USD;
    const decimals = curr.decimals || 2;
    return curr.symbol + Number(finalAmount).toFixed(decimals);
  }
};

// Convert USD amount to target currency
export const convertFromUSDTo = (usdAmount, targetCurrency) => {
  const curr = currencies[targetCurrency];
  if (!curr) return usdAmount;
  const converted = usdAmount / curr.rate;
  return Math.round(converted * 100) / 100;
};

// Convert any amount to USD (base currency)
export const convertToUSD = (amount, fromCurrency) => {
  const curr = currencies[fromCurrency];
  if (!curr) return amount;
  const converted = amount * curr.rate;
  return Math.round(converted * 100) / 100;
};

// Convert any amount from one currency to another
export const convertBetweenCurrencies = (amount, fromCurrency, toCurrency) => {
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return amount;
  const fromCurr = currencies[fromCurrency];
  const toCurr = currencies[toCurrency];
  if (!fromCurr || !toCurr) return amount;
  const usdAmount = amount / fromCurr.rate;
  return Math.round(usdAmount * toCurr.rate * 100) / 100;
};

// Country code to currency mapping (mirrors server config/currencies.js
// countryCurrencyMap) — used by the IP-based country/currency auto-selection
// and as the client-side fallback when an older backend omits the currency.
const countryCurrencyMap = {
  US: 'USD', CA: 'CAD', MX: 'MXN', GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR',
  ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR',
  GR: 'EUR', LU: 'EUR', MT: 'EUR', SK: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR',
  SI: 'EUR', CY: 'EUR', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', HR: 'EUR', RS: 'RSD', UA: 'UAH',
  IS: 'ISK', TR: 'TRY', RU: 'RUB', GE: 'GEL', JP: 'JPY', CN: 'CNY', KR: 'KRW',
  IN: 'INR', SG: 'SGD', HK: 'HKD', TW: 'TWD', TH: 'THB', MY: 'MYR', ID: 'IDR',
  PH: 'PHP', VN: 'VND', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', MM: 'MMK',
  KH: 'KHR', LA: 'LAK', BN: 'BND', MO: 'MOP', NZ: 'NZD', AU: 'AUD', FJ: 'FJD',
  PG: 'PGK', ZA: 'ZAR', NG: 'NGN', EG: 'EGP', KE: 'KES', GH: 'GHS', TZ: 'TZS',
  UG: 'UGX', SN: 'XOF', MA: 'MAD', DZ: 'DZD', TN: 'TND', LY: 'LYD', AE: 'AED',
  SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', JO: 'JOD', LB: 'LBP',
  IL: 'ILS', IQ: 'IQD', CO: 'COP', AR: 'ARS', CL: 'CLP', PE: 'PEN', BR: 'BRL',
  UY: 'UYU', PY: 'PYG', BO: 'BOB', VE: 'VES', CR: 'CRC', GT: 'GTQ', HN: 'HNL',
  NI: 'NIO', PA: 'PAB', DO: 'DOP', JM: 'JMD', TT: 'TTD', HT: 'HTG', KZ: 'KZT',
  UZ: 'UZS', AZ: 'AZN', KG: 'KGS', TJ: 'TJS', MN: 'MNT', AF: 'AFN',
};

// All currency codes the client can format (keys of the map above).
export const SUPPORTED_CURRENCY_CODES = Object.keys(currencies);

// Get currency by country code — normalizes input, USD fallback, never throws
export const getCurrencyByCountry = (countryCode) => {
  try {
    const code = String(countryCode || '').trim().toUpperCase();
    return countryCurrencyMap[code] || 'USD';
  } catch (e) {
    return 'USD';
  }
};

// Convert price using exchange rates (same as server)
export const convertPrice = (usdAmount, targetCurrency) => {
  const curr = currencies[targetCurrency];
  if (!curr) return usdAmount;
  return Math.round(usdAmount * curr.rate * 100) / 100;
};

// Time helpers
export const timeAgo = (date) => moment(date).fromNow();
export const formatDate = (date, format = 'MMM D, YYYY') => moment(date).format(format);
export const formatDateTime = (date) => moment(date).format('MMM D, YYYY h:mm A');

// Status colors
export const getStatusColor = (status) => {
  const colors = {
    pending: '#f59e0b', paid: '#3b82f6', processing: '#8b5cf6',
    shipped: '#3b82f6', in_transit: '#6366f1', out_for_delivery: '#f97316',
    to_ship: '#3b82f6', to_deliver: '#6366f1',
    delivered: '#10b981', completed: '#10b981',
    cancelled: '#ef4444', cancelled_by_buyer: '#ef4444', cancelled_by_seller: '#ef4444',
    refunded: '#ef4444', disputed: '#f97316', dispute_resolved: '#6b7280',
    buyer_confirmed: '#10b981',
    return_requested: '#f59e0b', return_accepted: '#3b82f6', return_rejected: '#ef4444',
    return_in_transit: '#6366f1', return_delivered: '#10b981',
  };
  return colors[status] || '#6b7280';
};

// Status labels
export const getStatusLabel = (status) => {
  const labels = {
    pending: 'Pending', paid: 'Payment Confirmed', processing: 'Processing',
    to_ship: 'To Ship', shipped: 'Shipped', in_transit: 'In Transit', out_for_delivery: 'Out for Delivery',
    to_deliver: 'To Deliver', delivered: 'Delivered', completed: 'Completed',
    cancelled: 'Cancelled', cancelled_by_buyer: 'Cancelled by Buyer', cancelled_by_seller: 'Cancelled by Seller',
    refunded: 'Refunded', disputed: 'Dispute Open', dispute_resolved: 'Dispute Resolved',
    buyer_confirmed: 'Confirmed Received',
    return_requested: 'Return Requested', return_accepted: 'Return Accepted',
    return_rejected: 'Return Rejected', return_in_transit: 'Return Shipped',
    return_delivered: 'Return Received',
  };
  return labels[status] || status;
};

// Condition badge color
export const getConditionColor = (condition) => {
  const colors = {
    'New with tags': '#10b981', 'New without tags': '#34d399',
    'Good': '#3b82f6', 'Fair': '#f59e0b', 'Poor': '#ef4444',
  };
  return colors[condition] || '#6b7280';
};

// Discount percentage
export const getDiscount = (price, originalPrice) => {
  if (!originalPrice || originalPrice <= price) return 0;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
};

// Truncate text
export const truncate = (text, maxLen = 100) => {
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
};

// Validation helpers
export const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validatePhone = (phone) => /^[\d\s\-+()]{7,20}$/.test(phone);

// Country list (simplified for frontend)
export const countries = [
  { code: 'US', name: 'United States', phoneCode: '+1', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'CA', name: 'Canada', phoneCode: '+1', flag: '\u{1F1E8}\u{1F1E6}' },
  { code: 'GB', name: 'United Kingdom', phoneCode: '+44', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'AU', name: 'Australia', phoneCode: '+61', flag: '\u{1F1E6}\u{1F1FA}' },
  { code: 'DE', name: 'Germany', phoneCode: '+49', flag: '\u{1F1E9}\u{1F1EA}' },
  { code: 'FR', name: 'France', phoneCode: '+33', flag: '\u{1F1EB}\u{1F1F7}' },
  { code: 'IT', name: 'Italy', phoneCode: '+39', flag: '\u{1F1EE}\u{1F1F9}' },
  { code: 'ES', name: 'Spain', phoneCode: '+34', flag: '\u{1F1EA}\u{1F1F8}' },
  { code: 'NL', name: 'Netherlands', phoneCode: '+31', flag: '\u{1F1F3}\u{1F1F1}' },
  { code: 'JP', name: 'Japan', phoneCode: '+81', flag: '\u{1F1EF}\u{1F1F5}' },
  { code: 'CN', name: 'China', phoneCode: '+86', flag: '\u{1F1E8}\u{1F1F3}' },
  { code: 'KR', name: 'South Korea', phoneCode: '+82', flag: '\u{1F1F0}\u{1F1F7}' },
  { code: 'IN', name: 'India', phoneCode: '+91', flag: '\u{1F1EE}\u{1F1F3}' },
  { code: 'SG', name: 'Singapore', phoneCode: '+65', flag: '\u{1F1F8}\u{1F1EC}' },
  { code: 'TH', name: 'Thailand', phoneCode: '+66', flag: '\u{1F1F9}\u{1F1ED}' },
  { code: 'BR', name: 'Brazil', phoneCode: '+55', flag: '\u{1F1E7}\u{1F1F7}' },
  { code: 'MX', name: 'Mexico', phoneCode: '+52', flag: '\u{1F1F2}\u{1F1FD}' },
  { code: 'AE', name: 'UAE', phoneCode: '+971', flag: '\u{1F1E6}\u{1F1EA}' },
  { code: 'SA', name: 'Saudi Arabia', phoneCode: '+966', flag: '\u{1F1F8}\u{1F1E6}' },
  { code: 'ZA', name: 'South Africa', phoneCode: '+27', flag: '\u{1F1FF}\u{1F1E6}' },
  { code: 'NG', name: 'Nigeria', phoneCode: '+234', flag: '\u{1F1F3}\u{1F1EC}' },
  { code: 'EG', name: 'Egypt', phoneCode: '+20', flag: '\u{1F1EA}\u{1F1EC}' },
  { code: 'KE', name: 'Kenya', phoneCode: '+254', flag: '\u{1F1F0}\u{1F1EA}' },
  { code: 'GH', name: 'Ghana', phoneCode: '+233', flag: '\u{1F1EC}\u{1F1ED}' },
  { code: 'PK', name: 'Pakistan', phoneCode: '+92', flag: '\u{1F1F5}\u{1F1F0}' },
  { code: 'BD', name: 'Bangladesh', phoneCode: '+880', flag: '\u{1F1E7}\u{1F1E9}' },
  { code: 'PH', name: 'Philippines', phoneCode: '+63', flag: '\u{1F1F5}\u{1F1ED}' },
  { code: 'MY', name: 'Malaysia', phoneCode: '+60', flag: '\u{1F1F2}\u{1F1FE}' },
  { code: 'ID', name: 'Indonesia', phoneCode: '+62', flag: '\u{1F1EE}\u{1F1E9}' },
  { code: 'VN', name: 'Vietnam', phoneCode: '+84', flag: '\u{1F1FB}\u{1F1F3}' },
  { code: 'TR', name: 'Turkey', phoneCode: '+90', flag: '\u{1F1F9}\u{1F1F7}' },
  { code: 'NZ', name: 'New Zealand', phoneCode: '+64', flag: '\u{1F1F3}\u{1F1FF}' },
  { code: 'PL', name: 'Poland', phoneCode: '+48', flag: '\u{1F1F5}\u{1F1F1}' },
  { code: 'SE', name: 'Sweden', phoneCode: '+46', flag: '\u{1F1F8}\u{1F1EA}' },
  { code: 'CH', name: 'Switzerland', phoneCode: '+41', flag: '\u{1F1E8}\u{1F1ED}' },
  { code: 'RU', name: 'Russia', phoneCode: '+7', flag: '\u{1F1F7}\u{1F1FA}' },
  { code: 'AR', name: 'Argentina', phoneCode: '+54', flag: '\u{1F1E6}\u{1F1F7}' },
  { code: 'CO', name: 'Colombia', phoneCode: '+57', flag: '\u{1F1E8}\u{1F1F4}' },
  { code: 'CL', name: 'Chile', phoneCode: '+56', flag: '\u{1F1E8}\u{1F1F1}' },
  { code: 'PE', name: 'Peru', phoneCode: '+51', flag: '\u{1F1F5}\u{1F1EA}' },
];

// Normalize a Comment collection document into the shape the comment UI expects.
// The Comment model stores the author as `userId` (populated into a user subdoc with
// `name`/`avatar`), while the comment UI reads `comment.user.name` / `comment.user.avatar`.
export const normalizeComment = (comment) => {
  if (!comment) return comment;
  const user =
    comment.user ||
    (comment.userId && typeof comment.userId === 'object'
      ? { name: comment.userId.name, avatar: comment.userId.avatar, _id: comment.userId._id || comment.userId.id }
      : { name: 'Anonymous', avatar: null, _id: comment.userId?.toString?.() || comment.userId });

  const normalized = {
    ...comment,
    user,
    _id: comment._id?.toString?.() || comment._id,
    listingId: comment.listingId?.toString?.() || comment.listingId,
    parentId: comment.parentId?.toString?.() || comment.parentId,
    userId: user._id,
  };

  if (normalized.replies?.length) {
    normalized.replies = normalized.replies.map(normalizeComment);
  }
  return normalized;
};

// Get country by code
export const getCountryByCode = (code) => countries.find(c => c.code === code) || countries[0];