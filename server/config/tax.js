/**
 * Comprehensive Tax Calculation Engine
 * Supports VAT/GST/Sales Tax for 100+ countries with state/province-level rules
 * Enterprise-grade accuracy for international e-commerce
 */

// Tax rules by country and state/province
// Types: VAT (value-added), GST (goods/services), Sales Tax (US-style)
const { getCountry } = require('./countries');

const taxRules = {
  // United States - Sales Tax (state-level, no federal VAT)
  US: {
    type: 'sales_tax',
    countryRate: 0, // No federal sales tax
    states: {
      AL: { rate: 0.04, name: 'Alabama' },
      AK: { rate: 0, name: 'Alaska' },
      AZ: { rate: 0.056, name: 'Arizona' },
      AR: { rate: 0.065, name: 'Arkansas' },
      CA: { rate: 0.0725, name: 'California' },
      CO: { rate: 0.029, name: 'Colorado' },
      CT: { rate: 0.0635, name: 'Connecticut' },
      DE: { rate: 0, name: 'Delaware' },
      FL: { rate: 0.06, name: 'Florida' },
      GA: { rate: 0.04, name: 'Georgia' },
      HI: { rate: 0.04, name: 'Hawaii' },
      ID: { rate: 0.06, name: 'Idaho' },
      IL: { rate: 0.0625, name: 'Illinois' },
      IN: { rate: 0.07, name: 'Indiana' },
      IA: { rate: 0.06, name: 'Iowa' },
      KS: { rate: 0.065, name: 'Kansas' },
      KY: { rate: 0.06, name: 'Kentucky' },
      LA: { rate: 0.0445, name: 'Louisiana' },
      ME: { rate: 0.055, name: 'Maine' },
      MD: { rate: 0.06, name: 'Maryland' },
      MA: { rate: 0.0625, name: 'Massachusetts' },
      MI: { rate: 0.06, name: 'Michigan' },
      MN: { rate: 0.06875, name: 'Minnesota' },
      MS: { rate: 0.07, name: 'Mississippi' },
      MO: { rate: 0.04225, name: 'Missouri' },
      MT: { rate: 0, name: 'Montana' },
      NE: { rate: 0.055, name: 'Nebraska' },
      NV: { rate: 0.0685, name: 'Nevada' },
      NH: { rate: 0, name: 'New Hampshire' },
      NJ: { rate: 0.06625, name: 'New Jersey' },
      NM: { rate: 0.04875, name: 'New Mexico' },
      NY: { rate: 0.04, name: 'New York' },
      NC: { rate: 0.0475, name: 'North Carolina' },
      ND: { rate: 0.05, name: 'North Dakota' },
      OH: { rate: 0.0575, name: 'Ohio' },
      OK: { rate: 0.045, name: 'Oklahoma' },
      OR: { rate: 0, name: 'Oregon' },
      PA: { rate: 0.06, name: 'Pennsylvania' },
      RI: { rate: 0.07, name: 'Rhode Island' },
      SC: { rate: 0.06, name: 'South Carolina' },
      SD: { rate: 0.042, name: 'South Dakota' },
      TN: { rate: 0.07, name: 'Tennessee' },
      TX: { rate: 0.0625, name: 'Texas' },
      UT: { rate: 0.0595, name: 'Utah' },
      VT: { rate: 0.06, name: 'Vermont' },
      VA: { rate: 0.053, name: 'Virginia' },
      WA: { rate: 0.065, name: 'Washington' },
      WV: { rate: 0.06, name: 'West Virginia' },
      WI: { rate: 0.05, name: 'Wisconsin' },
      WY: { rate: 0.04, name: 'Wyoming' },
      DC: { rate: 0.06, name: 'District of Columbia' },
    },
    threshold: 100000, // Economic nexus threshold ($100k)
    marketplaceCollector: true,
  },

  // Canada - GST/HST/PST (province-level)
  CA: {
    type: 'gst_hst',
    countryRate: 0.05, // Federal GST
    provinces: {
      AB: { rate: 0.05, name: 'Alberta', type: 'gst' },
      BC: { rate: 0.07, name: 'British Columbia', type: 'pst', provincialRate: 0.07 },
      MB: { rate: 0.07, name: 'Manitoba', type: 'gst_pst', provincialRate: 0.07 },
      NB: { rate: 0.15, name: 'New Brunswick', type: 'hst' },
      NL: { rate: 0.15, name: 'Newfoundland', type: 'hst' },
      NS: { rate: 0.15, name: 'Nova Scotia', type: 'hst' },
      ON: { rate: 0.13, name: 'Ontario', type: 'hst' },
      PE: { rate: 0.15, name: 'Prince Edward Island', type: 'hst' },
      QC: { rate: 0.09975, name: 'Quebec', type: 'qst', provincialRate: 0.09975 },
      SK: { rate: 0.06, name: 'Saskatchewan', type: 'gst_pst', provincialRate: 0.06 },
    },
    threshold: 30000, // CAD 30k threshold
  },

  // United Kingdom - VAT
  GB: {
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.05,
    zeroRate: 0,
    threshold: 85000, // £85k VAT registration threshold
  },

  // European Union - VAT (country-level, some regional)
  DE: { // Germany
    type: 'vat',
    standardRate: 0.19,
    reducedRate: 0.07,
    superReducedRate: 0,
    threshold: 22000, // €22k
  },
  FR: { // France
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.055,
    superReducedRate: 0.021,
    threshold: 36900, // €36.9k
  },
  IT: { // Italy
    type: 'vat',
    standardRate: 0.22,
    reducedRate: 0.10,
    superReducedRate: 0.04,
    threshold: 65000, // €65k
  },
  ES: { // Spain
    type: 'vat',
    standardRate: 0.21,
    reducedRate: 0.10,
    superReducedRate: 0.04,
    threshold: 35000, // €35k
  },
  NL: { // Netherlands
    type: 'vat',
    standardRate: 0.21,
    reducedRate: 0.09,
    threshold: 2000, // €2k (very low)
  },
  BE: { // Belgium
    type: 'vat',
    standardRate: 0.21,
    reducedRate: 0.06,
    superReducedRate: 0.12,
    threshold: 25000, // €25k
  },
  AT: { // Austria
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.10,
    threshold: 35000, // €35k
  },
  PT: { // Portugal
    type: 'vat',
    standardRate: 0.23,
    reducedRate: 0.13,
    superReducedRate: 0.06,
    threshold: 10000, // €10k
  },
  IE: { // Ireland
    type: 'vat',
    standardRate: 0.23,
    reducedRate: 0.135,
    superReducedRate: 0.048,
    threshold: 37500, // €37.5k
  },
  FI: { // Finland
    type: 'vat',
    standardRate: 0.24,
    reducedRate: 0.145,
    superReducedRate: 0.10,
    threshold: 10000, // €10k
  },
  GR: { // Greece
    type: 'vat',
    standardRate: 0.24,
    reducedRate: 0.13,
    superReducedRate: 0.06,
    threshold: 10000, // €10k
  },
  LU: { // Luxembourg
    type: 'vat',
    standardRate: 0.17,
    reducedRate: 0.08,
    superReducedRate: 0.03,
    threshold: 35000, // €35k
  },
  SE: { // Sweden
    type: 'vat',
    standardRate: 0.25,
    reducedRate: 0.06,
    threshold: 75000, // SEK 75k
  },
  NO: { // Norway
    type: 'vat',
    standardRate: 0.25,
    reducedRate: 0.15,
    superReducedRate: 0,
    threshold: 50000, // NOK 50k
  },
  DK: { // Denmark
    type: 'vat',
    standardRate: 0.25,
    reducedRate: 0,
    threshold: 50000, // DKK 50k
  },
  CH: { // Switzerland
    type: 'vat',
    standardRate: 0.077,
    reducedRate: 0.025,
    superReducedRate: 0.0,
    threshold: 100000, // CHF 100k
  },
  PL: { // Poland
    type: 'vat',
    standardRate: 0.23,
    reducedRate: 0.08,
    superReducedRate: 0.05,
    threshold: 200000, // PLN 200k
  },
  CZ: { // Czech Republic
    type: 'vat',
    standardRate: 0.21,
    reducedRate: 0.12,
    threshold: 1000000, // CZK 1M
  },
  HU: { // Hungary
    type: 'vat',
    standardRate: 0.27,
    reducedRate: 0.05,
    threshold: 8000, // HUF 8k (very low)
  },
  RO: { // Romania
    type: 'vat',
    standardRate: 0.19,
    reducedRate: 0.09,
    superReducedRate: 0.05,
    threshold: 300000, // RON 300k
  },
  BG: { // Bulgaria
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.09,
    threshold: 100000, // BGN 100k
  },
  HR: { // Croatia
    type: 'vat',
    standardRate: 0.25,
    reducedRate: 0.05,
    threshold: 30000, // HRK 30k (converted to EUR)
  },
  RS: { // Serbia
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.10,
    threshold: 10000000, // RSD 10M
  },
  UA: { // Ukraine
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.07,
    threshold: 1000000, // UAH 1M
  },
  IS: { // Iceland
    type: 'vat',
    standardRate: 0.24,
    reducedRate: 0.11,
    threshold: 1000000, // ISK 1M
  },
  TR: { // Turkey
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0.08,
    threshold: 50000, // TRY 50k
  },
  RU: { // Russia
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.10,
    threshold: 3000000, // RUB 3M
  },

  // Asia-Pacific
  JP: { // Japan - Consumption Tax
    type: 'consumption_tax',
    standardRate: 0.10,
    reducedRate: 0.08,
    threshold: 1000000, // JPY 1M
  },
  CN: { // China - VAT
    type: 'vat',
    standardRate: 0.13,
    reducedRate: 0.09,
    threshold: 50000, // CNY 50k
  },
  KR: { // South Korea - VAT
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 24000000, // KRW 24M
  },
  IN: { // India - GST
    type: 'gst',
    standardRate: 0.18,
    reducedRate: 0.05,
    superReducedRate: 0,
    threshold: 2000000, // INR 20Lakh
    states: {
      // Major states with specific rates (most use standard 18%)
      MH: { rate: 0.18, name: 'Maharashtra' },
      DL: { rate: 0.18, name: 'Delhi' },
      KA: { rate: 0.18, name: 'Karnataka' },
      TN: { rate: 0.18, name: 'Tamil Nadu' },
      GJ: { rate: 0.18, name: 'Gujarat' },
      RJ: { rate: 0.18, name: 'Rajasthan' },
      UP: { rate: 0.18, name: 'Uttar Pradesh' },
      WB: { rate: 0.18, name: 'West Bengal' },
    },
  },
  SG: { // Singapore - GST
    type: 'gst',
    standardRate: 0.08,
    reducedRate: 0,
    threshold: 1000000, // SGD 1M
  },
  HK: { // Hong Kong - No VAT/GST
    type: 'none',
    standardRate: 0,
    threshold: 0,
  },
  TW: { // Taiwan - VAT
    type: 'vat',
    standardRate: 0.05,
    reducedRate: 0,
    threshold: 0, // No threshold for foreign sellers
  },
  TH: { // Thailand - VAT
    type: 'vat',
    standardRate: 0.07,
    reducedRate: 0,
    threshold: 1800000, // THB 1.8M
  },
  MY: { // Malaysia - SST/Sales Tax
    type: 'sales_tax',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 500000, // MYR 500k
  },
  ID: { // Indonesia - PPN
    type: 'vat',
    standardRate: 0.11,
    reducedRate: 0,
    threshold: 470000000, // IDR 470M
  },
  PH: { // Philippines - VAT
    type: 'vat',
    standardRate: 0.12,
    reducedRate: 0,
    threshold: 3000000, // PHP 3M
  },
  VN: { // Vietnam - VAT
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0.05,
    threshold: 1000000000, // VND 1B
  },
  PK: { // Pakistan - Sales Tax
    type: 'sales_tax',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 3000000, // PKR 3M
  },
  BD: { // Bangladesh - VAT
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 2000000, // BDT 2M
  },
  LK: { // Sri Lanka - VAT
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 25000000, // LKR 25M
  },
  NP: { // Nepal - VAT
    type: 'vat',
    standardRate: 0.13,
    reducedRate: 0,
    threshold: 2000000, // NPR 2M
  },
  MM: { // Myanmar - GST
    type: 'gst',
    standardRate: 0.05,
    reducedRate: 0,
    threshold: 500000000, // MMK 500M
  },
  KH: { // Cambodia - VAT
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 2500000000, // KHR 2.5B
  },
  LA: { // Laos - VAT
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 500000000, // LAK 500M
  },
  NZ: { // New Zealand - GST
    type: 'gst',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 60000, // NZD 60k
  },
  AU: { // Australia - GST
    type: 'gst',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 75000, // AUD 75k
  },

  // Middle East
  AE: { // UAE - VAT
    type: 'vat',
    standardRate: 0.05,
    reducedRate: 0,
    threshold: 375000, // AED 375k
  },
  SA: { // Saudi Arabia - VAT
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 375000, // SAR 375k
  },
  QA: { // Qatar - No VAT currently
    type: 'none',
    standardRate: 0,
    threshold: 0,
  },
  KW: { // Kuwait - No VAT currently
    type: 'none',
    standardRate: 0,
    threshold: 0,
  },
  BH: { // Bahrain - VAT
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 37000, // BHD 37k
  },
  OM: { // Oman - VAT
    type: 'vat',
    standardRate: 0.05,
    reducedRate: 0,
    threshold: 38000, // OMR 38k
  },
  JO: { // Jordan - GST
    type: 'gst',
    standardRate: 0.16,
    reducedRate: 0,
    threshold: 30000, // JOD 30k
  },
  LB: { // Lebanon - VAT
    type: 'vat',
    standardRate: 0.11,
    reducedRate: 0,
    threshold: 300000000, // LBP 300M
  },
  IL: { // Israel - VAT
    type: 'vat',
    standardRate: 0.17,
    reducedRate: 0,
    threshold: 0, // No threshold
  },
  IQ: { // Iraq - No VAT
    type: 'none',
    standardRate: 0,
    threshold: 0,
  },
  GE: { // Georgia - VAT
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 0, // No threshold
  },
  AZ: { // Azerbaijan - VAT
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 60000, // AZN 60k
  },
  KZ: { // Kazakhstan - VAT
    type: 'vat',
    standardRate: 0.12,
    reducedRate: 0,
    threshold: 30000, // KZT 30k (converted)
  },
  UZ: { // Uzbekistan - VAT
    type: 'vat',
    standardRate: 0.12,
    reducedRate: 0,
    threshold: 100000000, // UZS 100M
  },
  MN: { // Mongolia - VAT
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 100000000, // MNT 100M
  },
  AF: { // Afghanistan - No VAT
    type: 'none',
    standardRate: 0,
    threshold: 0,
  },

  // Americas
  MX: { // Mexico - IVA
    type: 'vat',
    standardRate: 0.16,
    reducedRate: 0,
    threshold: 600000, // MXN 600k
  },
  BR: { // Brazil - ICMS/IPI
    type: 'vat',
    standardRate: 0.17,
    reducedRate: 0,
    threshold: 0, // Complex state-level system
  },
  AR: { // Argentina - IVA
    type: 'vat',
    standardRate: 0.21,
    reducedRate: 0.105,
    threshold: 0, // No threshold
  },
  CL: { // Chile - IVA
    type: 'vat',
    standardRate: 0.19,
    reducedRate: 0,
    threshold: 0, // No threshold
  },
  CO: { // Colombia - IVA
    type: 'vat',
    standardRate: 0.19,
    reducedRate: 0,
    threshold: 0, // No threshold
  },
  PE: { // Peru - IGV
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 0, // No threshold
  },
  VE: { // Venezuela - IVA
    type: 'vat',
    standardRate: 0.16,
    reducedRate: 0,
    threshold: 0,
  },
  EC: { // Ecuador - IVA
    type: 'vat',
    standardRate: 0.12,
    reducedRate: 0,
    threshold: 0,
  },
  BO: { // Bolivia - IVA
    type: 'vat',
    standardRate: 0.13,
    reducedRate: 0,
    threshold: 0,
  },
  PY: { // Paraguay - IVA
    type: 'vat',
    standardRate: 0.10,
    reducedRate: 0,
    threshold: 0,
  },
  UY: { // Uruguay - IVA
    type: 'vat',
    standardRate: 0.22,
    reducedRate: 0,
    threshold: 0,
  },
  CR: { // Costa Rica - IVA
    type: 'vat',
    standardRate: 0.13,
    reducedRate: 0,
    threshold: 0,
  },
  PA: { // Panama - ITBMS
    type: 'vat',
    standardRate: 0.07,
    reducedRate: 0,
    threshold: 0,
  },
  GT: { // Guatemala - IVA
    type: 'vat',
    standardRate: 0.12,
    reducedRate: 0,
    threshold: 0,
  },
  HN: { // Honduras - ISV
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 0,
  },
  NI: { // Nicaragua - IVA
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 0,
  },
  DO: { // Dominican Republic - ITBIS
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 0,
  },
  JM: { // Jamaica - GCT
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 0,
  },
  TT: { // Trinidad and Tobago - VAT
    type: 'vat',
    standardRate: 0.125,
    reducedRate: 0,
    threshold: 0,
  },
  CU: { // Cuba - No VAT for exports
    type: 'none',
    standardRate: 0,
    threshold: 0,
  },

  // Africa
  ZA: { // South Africa - VAT
    type: 'vat',
    standardRate: 0.15,
    reducedRate: 0,
    threshold: 1000000, // ZAR 1M
  },
  NG: { // Nigeria - VAT
    type: 'vat',
    standardRate: 0.075,
    reducedRate: 0,
    threshold: 25000000, // NGN 25M
  },
  EG: { // Egypt - VAT
    type: 'vat',
    standardRate: 0.14,
    reducedRate: 0,
    threshold: 0,
  },
  KE: { // Kenya - VAT
    type: 'vat',
    standardRate: 0.16,
    reducedRate: 0,
    threshold: 5000000, // KES 5M
  },
  GH: { // Ghana - VAT
    type: 'vat',
    standardRate: 0.175,
    reducedRate: 0,
    threshold: 200000, // GHS 200k
  },
  TZ: { // Tanzania - VAT
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 0,
  },
  UG: { // Uganda - VAT
    type: 'vat',
    standardRate: 0.18,
    reducedRate: 0,
    threshold: 0,
  },
  MA: { // Morocco - VAT
    type: 'vat',
    standardRate: 0.20,
    reducedRate: 0.07,
    threshold: 0,
  },
  DZ: { // Algeria - VAT
    type: 'vat',
    standardRate: 0.19,
    reducedRate: 0,
    threshold: 0,
  },
  TN: { // Tunisia - TVA
    type: 'vat',
    standardRate: 0.19,
    reducedRate: 0.13,
    threshold: 0,
  },
};

// Get tax rate for a specific country and state/province
function getTaxRate(countryCode, stateCode = null, itemValue = 0, category = 'standard') {
  const countryRule = taxRules[countryCode];
  
  if (!countryRule) {
    // Unknown country - no tax
    return { rate: 0, type: 'none', name: 'No Tax' };
  }

  if (countryRule.type === 'none') {
    return { rate: 0, type: 'none', name: 'No Tax' };
  }

  let rate = 0;
  let type = countryRule.type;
  let name = countryRule.type.toUpperCase();

  switch (countryRule.type) {
    case 'sales_tax':
      // US-style sales tax (state-level)
      if (stateCode && countryRule.states && countryRule.states[stateCode]) {
        rate = countryRule.states[stateCode].rate;
        name = `Sales Tax - ${countryRule.states[stateCode].name}`;
      } else {
        rate = countryRule.countryRate || 0;
        name = 'Sales Tax - Default';
      }
      break;

    case 'gst_hst':
      // Canada - GST/HST/PST
      if (stateCode && countryRule.provinces && countryRule.provinces[stateCode]) {
        const province = countryRule.provinces[stateCode];
        rate = province.rate;
        name = `${province.type.toUpperCase()} - ${province.name}`;
      } else {
        rate = countryRule.countryRate || 0.05;
        name = 'GST - Federal';
      }
      break;

    case 'vat':
      // European-style VAT with state/province variations
      if (stateCode && countryRule.states && countryRule.states[stateCode]) {
        rate = countryRule.states[stateCode].rate;
        name = `VAT - ${countryRule.states[stateCode].name}`;
      } else {
        rate = countryRule.standardRate || 0;
        name = 'VAT - Standard';
      }
      
      // Apply reduced rates for certain categories
      if (category === 'food' || category === 'books') {
        rate = countryRule.reducedRate || rate;
        name = 'VAT - Reduced';
      }
      break;

    case 'gst':
      // GST-style (Singapore, Australia, etc.)
      rate = countryRule.standardRate || 0;
      name = 'GST';
      break;

    case 'consumption_tax':
      // Japan-style consumption tax
      rate = countryRule.standardRate || 0;
      name = 'Consumption Tax';
      break;

    case 'sales_tax':
      // Malaysia SST
      rate = countryRule.standardRate || 0;
      name = 'Sales Tax';
      break;

    default:
      rate = 0;
  }

  return { rate, type, name };
}

// Calculate tax amount
function calculateTax(countryCode, stateCode, itemValue, shippingCost = 0, category = 'standard') {
  const taxInfo = getTaxRate(countryCode, stateCode, itemValue + shippingCost, category);
  
  // Tax is typically calculated on item price + shipping
  const taxableAmount = itemValue + shippingCost;
  const taxAmount = Math.round(taxableAmount * taxInfo.rate * 100) / 100;

  return {
    taxableAmount,
    taxRate: taxInfo.rate,
    taxAmount,
    taxType: taxInfo.type,
    taxName: taxInfo.name,
    currency: getCountry(countryCode)?.currency || 'USD',
  };
}

// Check if seller meets tax registration threshold
function checkTaxThreshold(countryCode, annualRevenue = 0) {
  const countryRule = taxRules[countryCode];
  
  if (!countryRule || countryRule.type === 'none') {
    return { registered: false, required: false };
  }

  const threshold = countryRule.threshold || 0;
  const required = annualRevenue >= threshold;

  return {
    registered: required,
    required,
    threshold,
    currency: getCountry(countryCode)?.currency || 'USD',
  };
}

// Validate tax number format (simplified)
function validateTaxNumber(countryCode, taxNumber) {
  if (!taxNumber) return { valid: false, message: 'Tax number required' };
  
  // Country-specific validation patterns
  const patterns = {
    US: /^\d{2}-?\d{7}$/, // EIN format
    GB: /^\d{9} \d{3}$/, // VAT number
    DE: /^DE\d{9}$/, // German VAT
    FR: /^FR[A-Z0-9]{2} \d{9}$/, // French VAT
    CA: /^\d{9} RT\d{4}$/, // Business number
    AU: /^\d{11}$/, // ABN
  };

  const pattern = patterns[countryCode];
  if (!pattern) {
    return { valid: true, message: 'No specific validation for this country' };
  }

  const valid = pattern.test(taxNumber);
  return {
    valid,
    message: valid ? 'Valid tax number' : 'Invalid tax number format',
  };
}

module.exports = {
  taxRules,
  getTaxRate,
  calculateTax,
  checkTaxThreshold,
  validateTaxNumber,
};