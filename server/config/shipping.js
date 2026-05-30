// Comprehensive Global Shipping Configuration
// Supports 200+ countries with zone-based pricing

// All major shipping carriers worldwide
const carriers = {
  // United States
  USPS: { name: 'USPS', country: 'US', type: 'postal', trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=', services: ['First Class', 'Priority Mail', 'Priority Mail Express', 'Media Mail'] },
  UPS: { name: 'UPS', country: 'US', type: 'private', trackingUrl: 'https://www.ups.com/track?tracknum=', services: ['Ground', '3 Day Select', '2nd Day Air', 'Next Day Air'] },
  FedEx: { name: 'FedEx', country: 'US', type: 'private', trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=', services: ['Ground', 'Express Saver', '2Day', 'Standard Overnight', 'Priority Overnight'] },

  // Global
  DHL: { name: 'DHL Express', country: 'DE', type: 'private', trackingUrl: 'https://www.dhl.com/en/express/tracking.html?AWB=', services: ['Express Worldwide', 'Express 12:00', 'Express 9:00', 'Economy Select'] },
  DHL eCommerce: { name: 'DHL eCommerce', country: 'DE', type: 'postal', trackingUrl: 'https://www.dhl.com/en/express/tracking.html?AWB=', services: ['Packet', 'Parcel Direct', 'Parcel Standard'] },

  // United Kingdom
  RoyalMail: { name: 'Royal Mail', country: 'GB', type: 'postal', trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/', services: ['1st Class', '2nd Class', 'Special Delivery', 'Tracked 24', 'Tracked 48'] },
  Hermes: { name: 'Evri (Hermes)', country: 'GB', type: 'private', trackingUrl: 'https://www.evri.com/track-a-parcel/?trackingCode=', services: ['Standard', 'Next Day'] },

  // Canada
  CanadaPost: { name: 'Canada Post', country: 'CA', type: 'postal', trackingUrl: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=', services: ['Regular Parcel', 'Expedited Parcel', 'Xpresspost', 'Priority'] },

  // Australia
  AustraliaPost: { name: 'Australia Post', country: 'AU', type: 'postal', trackingUrl: 'https://auspost.com.au/mypost/track/#/details/', services: ['Standard', 'Express', 'International Standard', 'International Express'] },
  Sendle: { name: 'Sendle', country: 'AU', type: 'private', trackingUrl: 'https://www.sendle.com/tracking?tracking_number=', services: ['Standard', 'Express'] },

  // Germany
  DeutschePost: { name: 'Deutsche Post', country: 'DE', type: 'postal', trackingUrl: 'https://www.deutschepost.de/sendungsverfolgung.html?piececode=', services: ['Standardbrief', 'Kompaktbrief', 'Großbrief', 'Maxibrief'] },
  DPD: { name: 'DPD', country: 'DE', type: 'private', trackingUrl: 'https://tracking.dpd.de/status/en_DE/parcel/', services: ['Classic', 'Express', 'Express 12:00'] },
  GLS: { name: 'GLS', country: 'DE', type: 'private', trackingUrl: 'https://www.gls-group.com/EU/en/parcel-tracking.html?trackingId=', services: ['Standard', 'Express'] },

  // France
  LaPoste: { name: 'La Poste', country: 'FR', type: 'postal', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=', services: ['Lettre', 'Colissimo', 'Chronopost'] },
  MondialRelay: { name: 'Mondial Relay', country: 'FR', type: 'private', trackingUrl: 'https://www.mondialrelay.fr/suivi-de-colis/?colispartenaire=', services: ['Standard', 'Express'] },

  // Spain
  Correos: { name: 'Correos', country: 'ES', type: 'postal', trackingUrl: 'https://www.correos.es/ss/Satellite/site/pagina_702_2_dinamica?idioma=2', services: ['Carta', 'Paquete', 'Paquete Prioritario'] },
  SEUR: { name: 'SEUR', country: 'ES', type: 'private', trackingUrl: 'https://www.seur.com/en/track-your-shipment/?segOnlineId=', services: ['Estándar', '24h', '48h'] },

  // Netherlands
  PostNL: { name: 'PostNL', country: 'NL', type: 'postal', trackingUrl: 'https://www.postnl.nl/en/track-and-trace/', services: ['Standard', 'Registered', 'Express'] },
  DHLNL: { name: 'DHL Netherlands', country: 'NL', type: 'private', trackingUrl: 'https://www.dhl.com/nl-en/home/tracking.html?tracking-id=', services: ['Parcel', 'Express'] },

  // Italy
  PosteItaliane: { name: 'Poste Italiane', country: 'IT', type: 'postal', trackingUrl: 'https://www.poste.it/cerca/index.html#/risultati-702', services: ['Corriere Espresso', 'Posta Raccomandata'] },
  Bartolini: { name: 'BRT (Bartolini)', country: 'IT', type: 'private', trackingUrl: 'https://www.brt.it/en/tracking', services: ['Standard', 'Express'] },

  // Japan
  JapanPost: { name: 'Japan Post', country: 'JP', type: 'postal', trackingUrl: 'https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo=', services: ['Yu-Pack', 'EMS', 'SAL', 'Airmail'] },

  // China
  ChinaPost: { name: 'China Post', country: 'CN', type: 'postal', trackingUrl: 'http://english.ems.post/service/publictracking?mailNum=', services: ['ePacket', 'EMS', 'Registered Air Mail'] },
  SFExpress: { name: 'SF Express', country: 'CN', type: 'private', trackingUrl: 'https://www.sf-express.com/us/en/dynamic_function/waybill/#search/bill-number/', services: ['Standard', 'Economy', 'Same Day'] },
  ZTO: { name: 'ZTO Express', country: 'CN', type: 'private', trackingUrl: 'https://www.zto.com/GuestService/Bill', services: ['Standard', 'Economy'] },

  // India
  IndiaPost: { name: 'India Post', country: 'IN', type: 'postal', trackingUrl: 'https://www.indiapost.gov.in/VAS/Pages/trackconsignment.aspx', services: ['Speed Post', 'Registered Post', 'Parcel', 'International'] },
  Delhivery: { name: 'Delhivery', country: 'IN', type: 'private', trackingUrl: 'https://www.delhivery.com/track/package/', services: ['Express', 'Surface'] },
  BlueDart: { name: 'Blue Dart', country: 'IN', type: 'private', trackingUrl: 'https://www.bluedart.com/tracking', services: ['Dart Plus', 'Dart Apex', 'Dart Surface'] },

  // South Korea
  KoreaPost: { name: 'Korea Post', country: 'KR', type: 'postal', trackingUrl: 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid=', services: ['EMS', 'Registered', 'Parcel'] },
  CJLogistics: { name: 'CJ Logistics', country: 'KR', type: 'private', trackingUrl: 'https://www.cjlogistics.com/ko/tool/parcel/tracking', services: ['Standard', 'Express'] },

  // Singapore
  SingPost: { name: 'Singapore Post', country: 'SG', type: 'postal', trackingUrl: 'https://www.singpost.com/track-your-item', services: ['Registered', 'SpeedPost', 'SmartPac'] },
  NinjaVan: { name: 'Ninja Van', country: 'SG', type: 'private', trackingUrl: 'https://www.ninjavan.co/en-sg/track-your-parcel', services: ['Standard', 'Express'] },

  // UAE/Arab Emirates
  Aramex: { name: 'Aramex', country: 'AE', type: 'private', trackingUrl: 'https://www.aramex.com/us/en/track/shipments?ShipmentNumber=', services: ['Express', 'Ground', 'Priority'] },
  EmiratesPost: { name: 'Emirates Post', country: 'AE', type: 'postal', trackingUrl: 'https://www.epg.gov.ae/tracking/', services: ['Priority', 'Standard', 'Registered'] },

  // Brazil
  Correios: { name: 'Correios', country: 'BR', type: 'postal', trackingUrl: 'https://www2.correios.com.br/sistemas/rastreamento/', services: ['SEDEX', 'PAC', 'Mini Envios'] },
  JadLog: { name: 'JadLog', country: 'BR', type: 'private', trackingUrl: 'https://www.jadlog.com.br/jadlog/rastreamento', services: ['Standard', 'Express'] },

  // Mexico
  Estafeta: { name: 'Estafeta', country: 'MX', type: 'private', trackingUrl: 'https://www.estafeta.com/en/tracking', services: ['Standard', 'Express', 'Next Day'] },

  // South Africa
  TheCourierGuy: { name: 'The Courier Guy', country: 'ZA', type: 'private', trackingUrl: 'https://www.thecourierguy.co.za/tracking/', services: ['Economy', 'Express'] },
  ARAMEX_SA: { name: 'Aramex SA', country: 'ZA', type: 'private', trackingUrl: 'https://www.aramex.com/track/shipments', services: ['Express', 'Economy'] },

  // Turkey
  PTT: { name: 'PTT', country: 'TR', type: 'postal', trackingUrl: 'https://ptt.gov.tr/kargo-sorgulama', services: ['APS', 'Koli', 'Mektup'] },
  Yurtici: { name: 'Yurtici Kargo', country: 'TR', type: 'private', trackingUrl: 'https://www.yurticikargo.com/tr/gonderi-sorgulama', services: ['Standard', 'Express'] },

  // Thailand
  ThailandPost: { name: 'Thailand Post', country: 'TH', type: 'postal', trackingUrl: 'https://track.thailandpost.co.th/tracking/default.aspx', services: ['EMS', 'Registered', 'Parcel'] },
  KerryExpress: { name: 'Kerry Express', country: 'TH', type: 'private', trackingUrl: 'https://th.kerryexpress.com/th/track/?track=', services: ['Standard', 'Express'] },

  // Indonesia
  PosIndonesia: { name: 'Pos Indonesia', country: 'ID', type: 'postal', trackingUrl: 'https://www.posindonesia.co.id/en/track-and-trace', services: ['Regular', 'Express', 'Cargo'] },
  JNE: { name: 'JNE', country: 'ID', type: 'private', trackingUrl: 'https://www.jne.co.id/en/tracking/detail', services: ['OKE', 'REGULER', 'YES'] },

  // Philippines
  PhilPost: { name: 'Philippine Post', country: 'PH', type: 'postal', trackingUrl: 'https://www.phlpost.gov.ph/', services: ['Express', 'Regular'] },
  LBC: { name: 'LBC Express', country: 'PH', type: 'private', trackingUrl: 'https://www.lbcexpress.com/v2/tracking', services: ['Express', 'Standard'] },

  // Malaysia
  PosMalaysia: { name: 'Pos Malaysia', country: 'MY', type: 'postal', trackingUrl: 'https://www.pos.com.my/tracking', services: ['Express', 'Standard', 'Registered'] },
  Gdex: { name: 'GDEX', country: 'MY', type: 'private', trackingUrl: 'https://www.gdexpress.com/tracking', services: ['Standard', 'Express'] },

  // New Zealand
  NZPost: { name: 'New Zealand Post', country: 'NZ', type: 'postal', trackingUrl: 'https://www.nzpost.co.nz/tools/tracking', services: ['Standard', 'Express', 'Tracked'] },

  // Switzerland
  SwissPost: { name: 'Swiss Post', country: 'CH', type: 'postal', trackingUrl: 'https://www.post.ch/en/tracking', services: ['Standard', 'Priority', 'Express'] },

  // Poland
  PocztaPolska: { name: 'Poczta Polska', country: 'PL', type: 'postal', trackingUrl: 'https://www.poczta-polska.pl/en/tracking/', services: ['Standard', 'Priority', 'Express'] },
  InPost: { name: 'InPost', country: 'PL', type: 'private', trackingUrl: 'https://inpost.pl/en/tracking', services: ['Standard', 'Express'] },

  // Sweden
  Postnord: { name: 'PostNord', country: 'SE', type: 'postal', trackingUrl: 'https://www.postnord.se/en/track-and-trace', services: ['Standard', 'Express', 'Business'] },

  // Russia
  RussianPost: { name: 'Russian Post', country: 'RU', type: 'postal', trackingUrl: 'https://www.pochta.ru/tracking', services: ['Standard', 'Express', 'EMS'] },
};

// Shipping zones for rate calculation
// Zone 1 = Domestic, Zone 2 = Neighboring, Zone 3 = Continental, Zone 4 = Intercontinental
const shippingZones = {
  // Zone definitions per country (which zone another country falls into)
  getZone: (fromCountry, toCountry) => {
    if (fromCountry === toCountry) return 1;

    const continentMap = {
      NA: ['US', 'CA', 'MX', 'CR', 'PA', 'GT', 'HN', 'NI', 'DO', 'JM', 'TT', 'CU', 'HT', 'BS', 'BB', 'BZ', 'SV', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC', 'TT', 'PR', 'VI', 'GP', 'MQ', 'GF', 'HT', 'BM', 'TC', 'KY', 'AW', 'CW', 'SX', 'BQ', 'MS', 'AN', 'VG', 'AI', 'TC', 'FK', 'GL', 'PM'],
      SA: ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR', 'FK'],
      EU: ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'GR', 'LU', 'SE', 'NO', 'DK', 'CH', 'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'RS', 'UA', 'IS', 'SK', 'SI', 'EE', 'LV', 'LT', 'MT', 'CY', 'LU', 'MC', 'LI', 'AD', 'SM', 'VA'],
      ASIA: ['JP', 'CN', 'KR', 'IN', 'SG', 'HK', 'TW', 'TH', 'MY', 'ID', 'PH', 'VN', 'PK', 'BD', 'LK', 'NP', 'MM', 'KH', 'LA', 'BN', 'MN', 'KZ', 'UZ', 'AZ', 'GE', 'AF', 'TM', 'KG', 'TJ'],
      ME: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IL', 'IQ', 'IR', 'SY', 'YE', 'PS'],
      AF: ['ZA', 'NG', 'EG', 'KE', 'GH', 'TZ', 'UG', 'MA', 'DZ', 'TN', 'LY', 'ET', 'RW', 'CM', 'CI', 'SN', 'ML', 'BF', 'NE', 'TD', 'MG', 'MZ', 'AO', 'ZM', 'ZW', 'BW', 'NA', 'MW', 'SZ'],
      OC: ['AU', 'NZ', 'FJ', 'PG'],
    };

    const getContinent = (code) => {
      for (const [cont, countries] of Object.entries(continentMap)) {
        if (countries.includes(code)) return cont;
      }
      return null;
    };

    const fromCont = getContinent(fromCountry);
    const toCont = getContinent(toCountry);

    if (fromCont === toCont) return 2; // Same continent
    return 3; // Different continent
  },
};

// Weight-based shipping rates by zone (in USD)
const rateTable = {
  1: { // Domestic
    baseRate: 3.99,       // Base rate up to 0.5kg
    perKg: 2.50,          // Additional per kg
    maxWeight: 30,        // Max weight in kg
    freeShippingThreshold: 50, // Free shipping above this price
    freeShippingWeight: 0.5,   // Max weight for free shipping
    estimatedDays: { min: 2, max: 5 },
  },
  2: { // Continental / Neighboring
    baseRate: 9.99,
    perKg: 5.50,
    maxWeight: 25,
    freeShippingThreshold: 100,
    freeShippingWeight: 0.3,
    estimatedDays: { min: 5, max: 10 },
  },
  3: { // Intercontinental
    baseRate: 18.99,
    perKg: 9.50,
    maxWeight: 20,
    freeShippingThreshold: null, // No free international shipping
    freeShippingWeight: 0,
    estimatedDays: { min: 7, max: 21 },
  },
};

// Additional surcharges
const surcharges = {
  remoteArea: 5.00,        // Remote/rural area surcharge
  signatureRequired: 2.50, // Signature on delivery
  insurance: 0,            // Will be calculated as % of item value
  insuranceRate: 0.02,     // 2% of item value
  hazardousHandling: 15.00,// Dangerous goods handling
  oversized: 8.00,         // Oversized package surcharge
  SaturdayDelivery: 4.00,  // Saturday delivery
};

// Calculate comprehensive shipping cost
const calculateShipping = (fromCountry, toCountry, weightKg = 0.5, itemPrice = 0, options = {}) => {
  const zone = shippingZones.getZone(fromCountry, toCountry);
  const rates = rateTable[zone];
  const isDomestic = zone === 1;

  // Check for free shipping
  if (rates.freeShippingThreshold && itemPrice >= rates.freeShippingThreshold && weightKg <= rates.freeShippingWeight) {
    return {
      cost: 0,
      currency: 'USD',
      zone,
      carrier: getPreferredCarrier(toCountry, isDomestic),
      estimatedDays: `${rates.estimatedDays.min}-${rates.estimatedDays.max}`,
      isDomestic,
      freeShipping: true,
      breakdown: { baseRate: 0, weightCharge: 0, surcharges: 0, total: 0 },
    };
  }

  // Calculate base + weight charges
  const weightCharge = Math.max(0, (weightKg - 0.5)) * rates.perKg;
  let totalSurcharges = 0;
  const appliedSurcharges = {};

  if (options.signatureRequired) {
    totalSurcharges += surcharges.signatureRequired;
    appliedSurcharges.signature = surcharges.signatureRequired;
  }
  if (itemPrice > 0) {
    const insurance = Math.round(itemPrice * surcharges.insuranceRate * 100) / 100;
    if (insurance > 0) {
      totalSurcharges += insurance;
      appliedSurcharges.insurance = insurance;
    }
  }
  if (options.remoteArea) {
    totalSurcharges += surcharges.remoteArea;
    appliedSurcharges.remoteArea = surcharges.remoteArea;
  }
  if (options.oversized) {
    totalSurcharges += surcharges.oversized;
    appliedSurcharges.oversized = surcharges.oversized;
  }

  const totalCost = Math.round((rates.baseRate + weightCharge + totalSurcharges) * 100) / 100;

  return {
    cost: totalCost,
    currency: 'USD',
    zone,
    carrier: getPreferredCarrier(toCountry, isDomestic),
    estimatedDays: `${rates.estimatedDays.min}-${rates.estimatedDays.max}`,
    isDomestic,
    freeShipping: false,
    breakdown: {
      baseRate: rates.baseRate,
      weightCharge: Math.round(weightCharge * 100) / 100,
      surcharges: totalSurcharges,
      total: totalCost,
    },
    appliedSurcharges,
  };
};

// Get preferred carrier for a destination country
const getPreferredCarrier = (countryCode, isDomestic = true) => {
  const countryCarriers = {
    US: { domestic: 'USPS', international: 'USPS' },
    CA: { domestic: 'CanadaPost', international: 'CanadaPost' },
    GB: { domestic: 'RoyalMail', international: 'RoyalMail' },
    AU: { domestic: 'AustraliaPost', international: 'AustraliaPost' },
    DE: { domestic: 'DeutschePost', international: 'DHL' },
    FR: { domestic: 'LaPoste', international: 'DHL' },
    ES: { domestic: 'Correos', international: 'DHL' },
    IT: { domestic: 'PosteItaliane', international: 'DHL' },
    NL: { domestic: 'PostNL', international: 'DHL' },
    JP: { domestic: 'JapanPost', international: 'DHL' },
    CN: { domestic: 'ChinaPost', international: 'DHL' },
    KR: { domestic: 'KoreaPost', international: 'DHL' },
    IN: { domestic: 'IndiaPost', international: 'DHL' },
    SG: { domestic: 'SingPost', international: 'DHL' },
    AE: { domestic: 'EmiratesPost', international: 'Aramex' },
    SA: { domestic: 'Aramex', international: 'DHL' },
    BR: { domestic: 'Correios', international: 'DHL' },
    MX: { domestic: 'Estafeta', international: 'DHL' },
    TR: { domestic: 'PTT', international: 'DHL' },
    TH: { domestic: 'ThailandPost', international: 'KerryExpress' },
    ID: { domestic: 'PosIndonesia', international: 'DHL' },
    PH: { domestic: 'LBC', international: 'DHL' },
    MY: { domestic: 'PosMalaysia', international: 'DHL' },
    NZ: { domestic: 'NZPost', international: 'DHL' },
    ZA: { domestic: 'TheCourierGuy', international: 'DHL' },
    PL: { domestic: 'PocztaPolska', international: 'DHL' },
    SE: { domestic: 'Postnord', international: 'DHL' },
    CH: { domestic: 'SwissPost', international: 'DHL' },
    RU: { domestic: 'RussianPost', international: 'DHL' },
  };

  const mapping = countryCarriers[countryCode];
  if (!mapping) return 'DHL';
  return isDomestic ? mapping.domestic : mapping.international;
};

// Generate shipping label data
const generateLabel = (order, carrierCode) => {
  const carrier = carriers[carrierCode] || carriers.DHL;
  const trackingPrefix = carrierCode.substring(0, 2).toUpperCase();
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  const trackingNumber = `${trackingPrefix}${timestamp}${random}`;

  return {
    trackingNumber,
    carrier: carrier.name,
    carrierCode,
    service: carrier.services[0],
    trackingUrl: `${carrier.trackingUrl}${trackingNumber}`,
    labelUrl: null,
    status: 'label_created',
    statusHistory: [{
      status: 'label_created',
      label: 'Label Created',
      description: 'Shipping label has been created',
      timestamp: new Date().toISOString(),
      location: null,
    }],
    estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    shippingAddress: order.shippingAddress,
    fromAddress: order.sellerAddress,
    weight: order.weight || 0.5,
    dimensions: order.dimensions || null,
  };
};

// Auto-tracking status progression
const trackingStatuses = [
  { code: 'label_created', label: 'Label Created', description: 'Shipping label has been created', sortOrder: 0 },
  { code: 'picked_up', label: 'Picked Up', description: 'Package picked up by carrier', sortOrder: 1 },
  { code: 'in_transit', label: 'In Transit', description: 'Package is on its way', sortOrder: 2 },
  { code: 'in_transit_local', label: 'In Transit - Local Facility', description: 'Package arrived at local facility', sortOrder: 3 },
  { code: 'out_for_delivery', label: 'Out for Delivery', description: 'Package is out for delivery today', sortOrder: 4 },
  { code: 'delivered', label: 'Delivered', description: 'Package has been delivered', sortOrder: 5 },
  { code: 'exception', label: 'Exception', description: 'Delivery issue - check tracking details', sortOrder: -1 },
  { code: 'returned', label: 'Returned', description: 'Package is being returned to sender', sortOrder: -2 },
];

// Simulate auto-tracking status update (in production: poll carrier APIs daily via cron job)
const simulateTrackingUpdate = (currentStatus, daysSinceLabel) => {
  const statusOrder = trackingStatuses.filter(s => s.sortOrder >= 0).sort((a, b) => a.sortOrder - b.sortOrder);
  const currentIndex = statusOrder.findIndex(s => s.code === currentStatus);

  if (currentIndex === -1 || currentIndex >= statusOrder.length - 1) return currentStatus;

  // Auto-advance based on days
  if (daysSinceLabel >= 5 && currentIndex < 3) return statusOrder[3].code;
  if (daysSinceLabel >= 3 && currentIndex < 2) return statusOrder[2].code;
  if (daysSinceLabel >= 1 && currentIndex < 1) return statusOrder[1].code;
  if (daysSinceLabel >= 0 && currentIndex < 1) return statusOrder[1].code;

  return currentStatus;
};

module.exports = {
  carriers,
  shippingZones,
  rateTable,
  surcharges,
  calculateShipping,
  getPreferredCarrier,
  generateLabel,
  trackingStatuses,
  simulateTrackingUpdate,
};