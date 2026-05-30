// Global shipping carriers and rate configuration
const carriers = {
  USPS: { name: 'USPS', country: 'US', logo: 'usps.png', trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' },
  UPS: { name: 'UPS', country: 'US', logo: 'ups.png', trackingUrl: 'https://www.ups.com/track?tracknum=' },
  FedEx: { name: 'FedEx', country: 'US', logo: 'fedex.png', trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=' },
  DHL: { name: 'DHL Express', country: 'DE', logo: 'dhl.png', trackingUrl: 'https://www.dhl.com/en/express/tracking.html?AWB=' },
  RoyalMail: { name: 'Royal Mail', country: 'GB', logo: 'royalmail.png', trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/' },
  CanadaPost: { name: 'Canada Post', country: 'CA', logo: 'canadapost.png', trackingUrl: 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=' },
  AustraliaPost: { name: 'Australia Post', country: 'AU', logo: 'auspost.png', trackingUrl: 'https://auspost.com.au/mypost/track/#/details/' },
  IndiaPost: { name: 'India Post', country: 'IN', logo: 'indiapost.png', trackingUrl: 'https://www.indiapost.gov.in/VAS/Pages/trackconsignment.aspx' },
  JapanPost: { name: 'Japan Post', country: 'JP', trackingUrl: 'https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo=' },
  ChinaPost: { name: 'China Post', country: 'CN', trackingUrl: 'http://english.ems.post/service/publictracking?mailNum=' },
  DeutschePost: { name: 'Deutsche Post', country: 'DE', trackingUrl: 'https://www.deutschepost.de/sendungsverfolgung.html?piececode=' },
  LaPoste: { name: 'La Poste', country: 'FR', trackingUrl: 'https://www.laposte.fr/outils/suivre-vos-envois?code=' },
  Correos: { name: 'Correos', country: 'ES', trackingUrl: 'https://www.correos.es/ss/Satellite/site/pagina_702_2_dinamica?idioma=2&language=2&section=7020000&tp=7020000' },
  PostNL: { name: 'PostNL', country: 'NL', trackingUrl: 'https://www.postnl.nl/en/track-and-trace/' },
  Aramex: { name: 'Aramex', country: 'AE', trackingUrl: 'https://www.aramex.com/us/en/track/shipments?ShipmentNumber=' },
};

// Country-to-carrier mapping (primary carrier per country)
const countryCarriers = {
  US: ['USPS', 'UPS', 'FedEx'],
  CA: ['CanadaPost', 'UPS', 'FedEx'],
  GB: ['RoyalMail', 'DHL', 'UPS'],
  AU: ['AustraliaPost', 'DHL'],
  DE: ['DeutschePost', 'DHL', 'UPS'],
  FR: ['LaPoste', 'DHL', 'UPS'],
  ES: ['Correos', 'DHL'],
  NL: ['PostNL', 'DHL'],
  JP: ['JapanPost', 'DHL'],
  CN: ['ChinaPost', 'DHL'],
  IN: ['IndiaPost', 'DHL', 'FedEx'],
  KR: ['DHL', 'FedEx'],
  BR: ['DHL', 'FedEx'],
  MX: ['DHL', 'FedEx'],
  AE: ['Aramex', 'DHL'],
  SA: ['Aramex', 'DHL'],
  SG: ['DHL', 'FedEx'],
  default: ['DHL', 'UPS', 'FedEx'],
};

// Shipping rate calculation
// domestic = within same country, international = cross-border
const calculateShipping = (fromCountry, toCountry, weightKg = 0.5, itemPrice = 0) => {
  const isDomestic = fromCountry === toCountry;
  const baseRates = {
    domestic: { start: 3.99, perKg: 2.50 },
    international: { start: 12.99, perKg: 8.50 },
  };

  const tier = isDomestic ? 'domestic' : 'international';
  const rates = baseRates[tier];

  // Free shipping for orders over threshold
  const freeShippingThreshold = 50;
  if (itemPrice >= freeShippingThreshold && isDomestic) {
    return { cost: 0, carrier: 'Free Shipping', estimatedDays: '5-7', isDomestic, freeShipping: true };
  }

  const shippingCost = rates.start + (Math.max(weightKg, 0.5) - 0.5) * rates.perKg;
  const carriersForCountry = countryCarriers[toCountry] || countryCarriers.default;
  const primaryCarrier = carriersForCountry[0];

  const estimatedDays = isDomestic ? '3-5' : '7-14';

  return {
    cost: Math.round(shippingCost * 100) / 100,
    carrier: primaryCarrier,
    estimatedDays,
    isDomestic,
    freeShipping: false,
  };
};

// Generate shipping label data (simulated - in production, integrate with carrier APIs)
const generateLabel = (order, carrier) => {
  const carrierInfo = carriers[carrier] || carriers.DHL;
  const trackingNumber = `${carrier.substring(0, 2).toUpperCase()}${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  return {
    trackingNumber,
    carrier: carrierInfo.name,
    carrierCode: carrier,
    trackingUrl: `${carrierInfo.trackingUrl}${trackingNumber}`,
    labelUrl: null, // In production: generate PDF label via carrier API
    status: 'label_created',
    estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    shippingAddress: order.shippingAddress,
    fromAddress: order.sellerAddress,
  };
};

// Auto-tracking simulation (in production: poll carrier APIs daily)
const getTrackingStatuses = () => [
  { code: 'label_created', label: 'Label Created', description: 'Shipping label has been created' },
  { code: 'picked_up', label: 'Picked Up', description: 'Package picked up by carrier' },
  { code: 'in_transit', label: 'In Transit', description: 'Package is on its way' },
  { code: 'out_for_delivery', label: 'Out for Delivery', description: 'Package is out for delivery today' },
  { code: 'delivered', label: 'Delivered', description: 'Package has been delivered' },
  { code: 'exception', label: 'Exception', description: 'Delivery issue - check tracking details' },
];

module.exports = { carriers, countryCarriers, calculateShipping, generateLabel, getTrackingStatuses };