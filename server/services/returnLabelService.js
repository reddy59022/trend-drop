/**
 * Return Label Generation Service
 *
 * Integrates with third-party shipping APIs (Shippo / EasyPost) to generate
 * real return shipping labels. Falls back to a deterministic mock label when
 * no API keys are configured (dev / test / hermetic E2E).
 *
 * A return label is generated when a seller APPROVES a return request. The
 * label URL is stored on the return record (returnLabel) and is visible only
 * to the buyer. The return tracking number is visible to both buyer and
 * seller so the seller can track the inbound shipment.
 */

const crypto = require('crypto');

const RETURN_CARRIERS = [
  { carrier: 'usps', service: 'usps_priority_mail', label: 'USPS Priority Mail' },
  { carrier: 'ups', service: 'ups_ground', label: 'UPS Ground' },
  { carrier: 'fedex', service: 'fedex_ground', label: 'FedEx Ground' },
];

const generateMockLabel = (returnRequest, transaction) => {
  const code = crypto.createHash('sha256')
    .update(String(returnRequest._id))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  const trackingNumber = `1Z${code}${String(returnRequest._id).slice(-6).toUpperCase()}`;
  const labelUrl = `/api/returns/${returnRequest._id}/label?token=${crypto.randomBytes(16).toString('hex')}`;
  return {
    trackingNumber,
    labelUrl,
    carrier: RETURN_CARRIERS[0].carrier,
    service: RETURN_CARRIERS[0].service,
    label: RETURN_CARRIERS[0].label,
    cost: 0,
    mock: true,
  };
};

const buildAddress = (person, fallbackCity, fallbackState) => ({
  name: person?.name || 'User',
  street1: person?.shippingAddress?.street1 || '123 Main St',
  city: person?.shippingAddress?.city || fallbackCity,
  state: person?.shippingAddress?.state || fallbackState,
  zip: person?.shippingAddress?.postalCode || '10001',
  country: person?.shippingAddress?.country || 'US',
  phone: person?.phone || '',
  email: person?.email || '',
});

const generateShippoLabel = async (returnRequest) => {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) throw new Error('SHIPPO_API_KEY not configured');
  const listing = returnRequest.listing || {};
  const from = buildAddress(returnRequest.buyer, 'Los Angeles', 'CA');
  const to = buildAddress(returnRequest.seller, 'Austin', 'TX');
  const parcel = {
    length: listing.returnPackage?.length || 10,
    width: listing.returnPackage?.width || 8,
    height: listing.returnPackage?.height || 4,
    distance_unit: 'in',
    weight: listing.weight || 1,
    mass_unit: 'lb',
  };
  const shipmentRes = await fetch('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `ShippoToken ${apiKey}` },
    body: JSON.stringify({ address_from: from, address_to: to, parcels: [parcel], async: false }),
  });
  if (!shipmentRes.ok) throw new Error(`Shippo shipment failed: ${shipmentRes.status}`);
  const shipment = await shipmentRes.json();
  const rate = (shipment.rates || []).find((r) => parseFloat(r.amount) > 0) || shipment.rates?.[0];
  if (!rate) throw new Error('No shipping rates available');
  const txnRes = await fetch('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `ShippoToken ${apiKey}` },
    body: JSON.stringify({ rate: rate.object_id, async: false }),
  });
  if (!txnRes.ok) throw new Error(`Shippo transaction failed: ${txnRes.status}`);
  const txn = await txnRes.json();
  return {
    trackingNumber: txn.tracking_number,
    labelUrl: txn.label_url,
    carrier: rate.provider,
    service: rate.servicelevel?.name || rate.service,
    label: `${rate.provider} ${rate.servicelevel?.name || rate.service}`,
    cost: parseFloat(rate.amount) || 0,
    mock: false,
    shippoTransactionId: txn.object_id,
  };
};

const generateEasyPostLabel = async (returnRequest) => {
  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) throw new Error('EASYPOST_API_KEY not configured');
  const listing = returnRequest.listing || {};
  const from = buildAddress(returnRequest.buyer, 'Los Angeles', 'CA');
  const to = buildAddress(returnRequest.seller, 'Austin', 'TX');
  const res = await fetch('https://api.easypost.com/v2/shipments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
    },
    body: JSON.stringify({
      shipment: {
        from_address: { name: from.name, street1: from.street1, city: from.city, state: from.state, zip: from.zip, country: from.country },
        to_address: { name: to.name, street1: to.street1, city: to.city, state: to.state, zip: to.zip, country: to.country },
        parcel: { length: listing.returnPackage?.length || 10, width: listing.returnPackage?.width || 8, height: listing.returnPackage?.height || 4, weight: (listing.weight || 1) * 16 },
      },
    }),
  });
  if (!res.ok) throw new Error(`EasyPost shipment failed: ${res.status}`);
  const shipment = await res.json();
  const rate = (shipment.rates || []).sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))[0];
  if (!rate) throw new Error('No shipping rates available');
  const buyRes = await fetch(`https://api.easypost.com/v2/shipments/${shipment.id}/buy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') },
    body: JSON.stringify({ rate: rate.id }),
  });
  if (!buyRes.ok) throw new Error(`EasyPost buy failed: ${buyRes.status}`);
  const bought = await buyRes.json();
  return {
    trackingNumber: bought.tracking_code,
    labelUrl: bought.postage_label?.label_url,
    carrier: rate.carrier || 'USPS',
    service: rate.service,
    label: `${rate.carrier} ${rate.service}`,
    cost: parseFloat(rate.rate) || 0,
    mock: false,
    easyPostShipmentId: bought.id,
  };
};

const generateReturnLabel = async (returnRequest, transaction) => {
  if (!returnRequest) throw new Error('returnRequest is required');
  if (!returnRequest.listing || !returnRequest.seller || !returnRequest.buyer) {
    const Return = require('../models/Return');
    returnRequest = await Return.findById(returnRequest._id)
      .populate('listing', 'title images weight returnPackage')
      .populate('seller', 'name email phone shippingAddress')
      .populate('buyer', 'name email phone shippingAddress');
  }
  let result;
  const errors = [];
  if (process.env.EASYPOST_API_KEY) {
    try { result = await generateEasyPostLabel(returnRequest); } catch (e) { errors.push('EasyPost: ' + e.message); }
  }
  if (!result && process.env.SHIPPO_API_KEY) {
    try { result = await generateShippoLabel(returnRequest); } catch (e) { errors.push('Shippo: ' + e.message); }
  }
  if (!result) {
    result = generateMockLabel(returnRequest, transaction);
    result.fallbackReason = errors.join('; ') || 'no API keys configured';
  }
  return result;
};

module.exports = { generateReturnLabel, generateMockLabel };

