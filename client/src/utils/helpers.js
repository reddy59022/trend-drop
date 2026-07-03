import moment from 'moment';

// Default avatar
export const defaultAvatar = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#e0e0e0"/><circle cx="50" cy="38" r="16" fill="#bdbdbd"/><ellipse cx="50" cy="75" rx="28" ry="22" fill="#bdbdbd"/></svg>`);

// Currency data with rates (mirrors server config/currencies.js)
const currencies = {
  USD: { symbol: '$', name: 'US Dollar', country: 'US', rate: 1, decimals: 2 },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', country: 'CA', rate: 1.36, decimals: 2 },
  EUR: { symbol: '€', name: 'Euro', country: 'EU', rate: 0.92, decimals: 2 },
  GBP: { symbol: '£', name: 'British Pound', country: 'GB', rate: 0.79, decimals: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', country: 'AU', rate: 1.53, decimals: 2 },
  JPY: { symbol: '¥', name: 'Japanese Yen', country: 'JP', rate: 149.5, decimals: 0 },
  INR: { symbol: '₹', name: 'Indian Rupee', country: 'IN', rate: 83.12, decimals: 2 },
  MXN: { symbol: 'MX$', name: 'Mexican Peso', country: 'MX', rate: 17.15, decimals: 2 },
  BRL: { symbol: 'R$', name: 'Brazilian Real', country: 'BR', rate: 4.97, decimals: 2 },
  KRW: { symbol: '₩', name: 'South Korean Won', country: 'KR', rate: 1328, decimals: 0 },
  CNY: { symbol: '¥', name: 'Chinese Yuan', country: 'CN', rate: 7.24, decimals: 2 },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', country: 'SG', rate: 1.34, decimals: 2 },
  HKD: { symbol: 'HK$', name: 'Hong Kong Dollar', country: 'HK', rate: 7.83, decimals: 2 },
  THB: { symbol: '฿', name: 'Thai Baht', country: 'TH', rate: 35.2, decimals: 2 },
  ZAR: { symbol: 'R', name: 'South African Rand', country: 'ZA', rate: 18.92, decimals: 2 },
  AED: { symbol: 'AED', name: 'UAE Dirham', country: 'AE', rate: 3.67, decimals: 2 },
  SAR: { symbol: 'SAR', name: 'Saudi Riyal', country: 'SA', rate: 3.75, decimals: 2 },
  TRY: { symbol: 'TL', name: 'Turkish Lira', country: 'TR', rate: 28.9, decimals: 2 },
  ILS: { symbol: 'ILS', name: 'Israeli Shekel', country: 'IL', rate: 3.72, decimals: 2 },
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

// Get currency by country code
export const getCurrencyByCountry = (countryCode) => {
  const countryMap = {
    US: 'USD', CA: 'CAD', MX: 'MXN', GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR',
    ES: 'EUR', NL: 'EUR', AU: 'AUD', JP: 'JPY', IN: 'INR', SG: 'SGD', BR: 'BRL',
    AE: 'AED', SA: 'SAR', ZA: 'ZAR', NG: 'NG', EG: 'EGP', KE: 'KES', TR: 'TRY',
  };
  return countryMap[countryCode] || 'USD';
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

// Get country by code
export const getCountryByCode = (code) => countries.find(c => c.code === code) || countries[0];