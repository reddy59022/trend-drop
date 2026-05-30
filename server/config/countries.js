// Comprehensive Country Configuration with Phone Codes (ISO 3166-1)
const countries = [
  { code: 'US', name: 'United States', phoneCode: '+1', phoneFormat: '(XXX) XXX-XXXX', phoneLen: 10, currency: 'USD', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', phoneCode: '+1', phoneFormat: '(XXX) XXX-XXXX', phoneLen: 10, currency: 'CAD', flag: '🇨🇦' },
  { code: 'GB', name: 'United Kingdom', phoneCode: '+44', phoneFormat: 'XXXX XXXXXX', phoneLen: 10, currency: 'GBP', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia', phoneCode: '+61', phoneFormat: 'XXXX XXX XXX', phoneLen: 9, currency: 'AUD', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', phoneCode: '+49', phoneFormat: 'XXX XXXXXXX', phoneLen: 10, currency: 'EUR', flag: '🇩🇪' },
  { code: 'FR', name: 'France', phoneCode: '+33', phoneFormat: 'X XX XX XX XX', phoneLen: 9, currency: 'EUR', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', phoneCode: '+39', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'EUR', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', phoneCode: '+34', phoneFormat: 'XXX XX XX XX', phoneLen: 9, currency: 'EUR', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', phoneCode: '+31', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'EUR', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', phoneCode: '+32', phoneFormat: 'XXX XX XX XX', phoneLen: 9, currency: 'EUR', flag: '🇧🇪' },
  { code: 'AT', name: 'Austria', phoneCode: '+43', phoneFormat: 'XXX XXXXXX', phoneLen: 10, currency: 'EUR', flag: '🇦🇹' },
  { code: 'PT', name: 'Portugal', phoneCode: '+351', phoneFormat: 'XXX XXX XXX', phoneLen: 9, currency: 'EUR', flag: '🇵🇹' },
  { code: 'IE', name: 'Ireland', phoneCode: '+353', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'EUR', flag: '🇮🇪' },
  { code: 'FI', name: 'Finland', phoneCode: '+358', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'EUR', flag: '🇫🇮' },
  { code: 'GR', name: 'Greece', phoneCode: '+30', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'EUR', flag: '🇬🇷' },
  { code: 'LU', name: 'Luxembourg', phoneCode: '+352', phoneFormat: 'XXX XXX XXX', phoneLen: 9, currency: 'EUR', flag: '🇱🇺' },
  { code: 'SE', name: 'Sweden', phoneCode: '+46', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'SEK', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', phoneCode: '+47', phoneFormat: 'XXX XX XXX', phoneLen: 8, currency: 'NOK', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', phoneCode: '+45', phoneFormat: 'XX XX XX XX', phoneLen: 8, currency: 'DKK', flag: '🇩🇰' },
  { code: 'CH', name: 'Switzerland', phoneCode: '+41', phoneFormat: 'XX XXX XX XX', phoneLen: 9, currency: 'CHF', flag: '🇨🇭' },
  { code: 'PL', name: 'Poland', phoneCode: '+48', phoneFormat: 'XXX XXX XXX', phoneLen: 9, currency: 'PLN', flag: '🇵🇱' },
  { code: 'CZ', name: 'Czech Republic', phoneCode: '+420', phoneFormat: 'XXX XXX XXX', phoneLen: 9, currency: 'CZK', flag: '🇨🇿' },
  { code: 'HU', name: 'Hungary', phoneCode: '+36', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'HUF', flag: '🇭🇺' },
  { code: 'RO', name: 'Romania', phoneCode: '+40', phoneFormat: 'XXX XXX XXX', phoneLen: 9, currency: 'RON', flag: '🇷🇴' },
  { code: 'BG', name: 'Bulgaria', phoneCode: '+359', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'BGN', flag: '🇧🇬' },
  { code: 'HR', name: 'Croatia', phoneCode: '+385', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'EUR', flag: '🇭🇷' },
  { code: 'RS', name: 'Serbia', phoneCode: '+381', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'RSD', flag: '🇷🇸' },
  { code: 'UA', name: 'Ukraine', phoneCode: '+380', phoneFormat: 'XX XXX XX XX', phoneLen: 9, currency: 'UAH', flag: '🇺🇦' },
  { code: 'IS', name: 'Iceland', phoneCode: '+354', phoneFormat: 'XXX XXXX', phoneLen: 7, currency: 'ISK', flag: '🇮🇸' },
  { code: 'TR', name: 'Turkey', phoneCode: '+90', phoneFormat: 'XXX XXX XX XX', phoneLen: 10, currency: 'TRY', flag: '🇹🇷' },
  { code: 'RU', name: 'Russia', phoneCode: '+7', phoneFormat: 'XXX XXX XX XX', phoneLen: 10, currency: 'RUB', flag: '🇷🇺' },
  { code: 'JP', name: 'Japan', phoneCode: '+81', phoneFormat: 'XX XXXX XXXX', phoneLen: 10, currency: 'JPY', flag: '🇯🇵' },
  { code: 'CN', name: 'China', phoneCode: '+86', phoneFormat: 'XXX XXXX XXXX', phoneLen: 11, currency: 'CNY', flag: '🇨🇳' },
  { code: 'KR', name: 'South Korea', phoneCode: '+82', phoneFormat: 'XX XXXX XXXX', phoneLen: 10, currency: 'KRW', flag: '🇰🇷' },
  { code: 'IN', name: 'India', phoneCode: '+91', phoneFormat: 'XXXXX XXXXX', phoneLen: 10, currency: 'INR', flag: '🇮🇳' },
  { code: 'SG', name: 'Singapore', phoneCode: '+65', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'SGD', flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong', phoneCode: '+852', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'HKD', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', phoneCode: '+886', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'TWD', flag: '🇹🇼' },
  { code: 'TH', name: 'Thailand', phoneCode: '+66', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'THB', flag: '🇹🇭' },
  { code: 'MY', name: 'Malaysia', phoneCode: '+60', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'MYR', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia', phoneCode: '+62', phoneFormat: 'XXX XXXX XXXX', phoneLen: 10, currency: 'IDR', flag: '🇮🇩' },
  { code: 'PH', name: 'Philippines', phoneCode: '+63', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'PHP', flag: '🇵🇭' },
  { code: 'VN', name: 'Vietnam', phoneCode: '+84', phoneFormat: 'XXX XXXX XXX', phoneLen: 9, currency: 'VND', flag: '🇻🇳' },
  { code: 'PK', name: 'Pakistan', phoneCode: '+92', phoneFormat: 'XXX XXXX XXXX', phoneLen: 10, currency: 'PKR', flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh', phoneCode: '+880', phoneFormat: 'XXXX XXXXXX', phoneLen: 10, currency: 'BDT', flag: '🇧🇩' },
  { code: 'LK', name: 'Sri Lanka', phoneCode: '+94', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'LKR', flag: '🇱🇰' },
  { code: 'NP', name: 'Nepal', phoneCode: '+977', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'NPR', flag: '🇳🇵' },
  { code: 'MM', name: 'Myanmar', phoneCode: '+95', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'MMK', flag: '🇲🇲' },
  { code: 'KH', name: 'Cambodia', phoneCode: '+855', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'KHR', flag: '🇰🇭' },
  { code: 'LA', name: 'Laos', phoneCode: '+856', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'LAK', flag: '🇱🇦' },
  { code: 'NZ', name: 'New Zealand', phoneCode: '+64', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'NZD', flag: '🇳🇿' },
  { code: 'FJ', name: 'Fiji', phoneCode: '+679', phoneFormat: 'XXXX XXXX', phoneLen: 7, currency: 'FJD', flag: '🇫🇯' },
  { code: 'ZA', name: 'South Africa', phoneCode: '+27', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'ZAR', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', phoneCode: '+234', phoneFormat: 'XX XXX XXXX', phoneLen: 10, currency: 'NGN', flag: '🇳🇬' },
  { code: 'EG', name: 'Egypt', phoneCode: '+20', phoneFormat: 'XX XXX XXXX', phoneLen: 10, currency: 'EGP', flag: '🇪🇬' },
  { code: 'KE', name: 'Kenya', phoneCode: '+254', phoneFormat: 'XXX XXXXXX', phoneLen: 9, currency: 'KES', flag: '🇰🇪' },
  { code: 'GH', name: 'Ghana', phoneCode: '+233', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'GHS', flag: '🇬🇭' },
  { code: 'TZ', name: 'Tanzania', phoneCode: '+255', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'TZS', flag: '🇹🇿' },
  { code: 'UG', name: 'Uganda', phoneCode: '+256', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'UGX', flag: '🇺🇬' },
  { code: 'MA', name: 'Morocco', phoneCode: '+212', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'MAD', flag: '🇲🇦' },
  { code: 'DZ', name: 'Algeria', phoneCode: '+213', phoneFormat: 'XXX XX XX XX', phoneLen: 9, currency: 'DZD', flag: '🇩🇿' },
  { code: 'TN', name: 'Tunisia', phoneCode: '+216', phoneFormat: 'XX XXX XXX', phoneLen: 8, currency: 'TND', flag: '🇹🇳' },
  { code: 'AE', name: 'United Arab Emirates', phoneCode: '+971', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'AED', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', phoneCode: '+966', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'SAR', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', phoneCode: '+974', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'QAR', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', phoneCode: '+965', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'KWD', flag: '🇰🇼' },
  { code: 'BH', name: 'Bahrain', phoneCode: '+973', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'BHD', flag: '🇧🇭' },
  { code: 'OM', name: 'Oman', phoneCode: '+968', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'OMR', flag: '🇴🇲' },
  { code: 'JO', name: 'Jordan', phoneCode: '+962', phoneFormat: 'X XXXX XXXX', phoneLen: 9, currency: 'JOD', flag: '🇯🇴' },
  { code: 'LB', name: 'Lebanon', phoneCode: '+961', phoneFormat: 'XX XXX XXX', phoneLen: 8, currency: 'LBP', flag: '🇱🇧' },
  { code: 'IL', name: 'Israel', phoneCode: '+972', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'ILS', flag: '🇮🇱' },
  { code: 'IQ', name: 'Iraq', phoneCode: '+964', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'IQD', flag: '🇮🇶' },
  { code: 'GE', name: 'Georgia', phoneCode: '+995', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'GEL', flag: '🇬🇪' },
  { code: 'AZ', name: 'Azerbaijan', phoneCode: '+994', phoneFormat: 'XX XXX XX XX', phoneLen: 9, currency: 'AZN', flag: '🇦🇿' },
  { code: 'KZ', name: 'Kazakhstan', phoneCode: '+7', phoneFormat: 'XXX XXX XX XX', phoneLen: 10, currency: 'KZT', flag: '🇰🇿' },
  { code: 'UZ', name: 'Uzbekistan', phoneCode: '+998', phoneFormat: 'XX XXX XX XX', phoneLen: 9, currency: 'UZS', flag: '🇺🇿' },
  { code: 'MN', name: 'Mongolia', phoneCode: '+976', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'MNT', flag: '🇲🇳' },
  { code: 'AF', name: 'Afghanistan', phoneCode: '+93', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'AFN', flag: '🇦🇫' },
  { code: 'MX', name: 'Mexico', phoneCode: '+52', phoneFormat: 'XX XXXX XXXX', phoneLen: 10, currency: 'MXN', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', phoneCode: '+55', phoneFormat: 'XX XXXX XXXX', phoneLen: 10, currency: 'BRL', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', phoneCode: '+54', phoneFormat: 'XX XXXX XXXX', phoneLen: 10, currency: 'ARS', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', phoneCode: '+56', phoneFormat: 'X XXXX XXXX', phoneLen: 9, currency: 'CLP', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', phoneCode: '+57', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'COP', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', phoneCode: '+51', phoneFormat: 'XXX XXX XXX', phoneLen: 9, currency: 'PEN', flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela', phoneCode: '+58', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'VES', flag: '🇻🇪' },
  { code: 'EC', name: 'Ecuador', phoneCode: '+593', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'USD', flag: '🇪🇨' },
  { code: 'BO', name: 'Bolivia', phoneCode: '+591', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'BOB', flag: '🇧🇴' },
  { code: 'PY', name: 'Paraguay', phoneCode: '+595', phoneFormat: 'XX XXX XXXX', phoneLen: 9, currency: 'PYG', flag: '🇵🇾' },
  { code: 'UY', name: 'Uruguay', phoneCode: '+598', phoneFormat: 'XX XXX XXXX', phoneLen: 8, currency: 'UYU', flag: '🇺🇾' },
  { code: 'CR', name: 'Costa Rica', phoneCode: '+506', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'CRC', flag: '🇨🇷' },
  { code: 'PA', name: 'Panama', phoneCode: '+507', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'PAB', flag: '🇵🇦' },
  { code: 'GT', name: 'Guatemala', phoneCode: '+502', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'GTQ', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', phoneCode: '+504', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'HNL', flag: '🇭🇳' },
  { code: 'NI', name: 'Nicaragua', phoneCode: '+505', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'NIO', flag: '🇳🇮' },
  { code: 'DO', name: 'Dominican Republic', phoneCode: '+1', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'DOP', flag: '🇩🇴' },
  { code: 'JM', name: 'Jamaica', phoneCode: '+1', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'JMD', flag: '🇯🇲' },
  { code: 'TT', name: 'Trinidad and Tobago', phoneCode: '+1', phoneFormat: 'XXX XXX XXXX', phoneLen: 10, currency: 'TTD', flag: '🇹🇹' },
  { code: 'CU', name: 'Cuba', phoneCode: '+53', phoneFormat: 'XXXX XXXX', phoneLen: 8, currency: 'CUP', flag: '🇨🇺' },
];

// Validate phone number for a country
const validatePhone = (phone, countryCode) => {
  const country = countries.find(c => c.code === countryCode);
  if (!country) return { valid: false, message: 'Country not found' };
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (!cleaned.startsWith(country.phoneCode.replace('+', '')) && !cleaned.startsWith(country.phoneCode)) {
    return { valid: false, message: `Phone must start with ${country.phoneCode}` };
  }
  const digits = cleaned.replace(/^\+?\d+/, '');
  if (digits.length !== country.phoneLen) {
    return { valid: false, message: `Phone must be ${country.phoneLen} digits after country code` };
  }
  return { valid: true, formatted: phone };
};

// Get country by code
const getCountry = (code) => countries.find(c => c.code === code);

// Get all country codes
const getAllCountryCodes = () => countries.map(c => c.code);

module.exports = { countries, validatePhone, getCountry, getAllCountryCodes };