/**
 * EasyPost shipping provider.
 *
 * TrendDrop is the merchant of record for shipping: the platform buys the
 * label with its own EasyPost account before the buyer's card is captured.
 * Sellers never supply tracking numbers and never receive the shipping fee.
 *
 * Production behavior is fail-closed: without EASYPOST_API_KEY every label
 * request throws EASYPOST_NOT_CONFIGURED, so the purchase endpoints abort
 * before an order is written or a card is charged. Tests and local
 * development use a deterministic mock provider (never in production).
 */
const crypto = require('crypto');

const API_BASE = (process.env.EASYPOST_API_BASE || 'https://api.easypost.com/v2').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.EASYPOST_TIMEOUT_MS) || 15000);
const DEFAULT_PARCEL = {
  length: Number(process.env.EASYPOST_DEFAULT_LENGTH_IN) || 10,
  width: Number(process.env.EASYPOST_DEFAULT_WIDTH_IN) || 8,
  height: Number(process.env.EASYPOST_DEFAULT_HEIGHT_IN) || 4,
};
const KG_TO_OZ = 35.27396195;

class ShippingProviderError extends Error {
  constructor(message, { code = 'SHIPPING_LABEL_FAILED', status = null, retryable = false, cause = null, ...details } = {}) {
    super(message);
    this.name = 'ShippingProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
    // Preserve compensation metadata (shipmentId/labelRefunded) so callers
    // can audit a post-purchase failure instead of losing the trail.
    Object.assign(this, details);
  }
}

const cleanMode = (value) => String(value || '').trim().toLowerCase();
const isProduction = () => process.env.NODE_ENV === 'production';
const stripeTestMode = () => String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

// EasyPost has one API endpoint and separate Test/Production keys. The mode is
// explicit so a test key can never be selected accidentally in a live deploy.
// `sandbox` is EasyPost's Test environment, backed by the SAME platform-owned
// account (no seller or per-marketplace EasyPost account is created).
const isSandboxRequested = () => ['sandbox', 'test'].includes(cleanMode(process.env.EASYPOST_MODE));
const apiKey = () => String(
  isSandboxRequested()
    ? (process.env.EASYPOST_TEST_API_KEY || '')
    : (process.env.EASYPOST_API_KEY || '')
).trim();

const sandboxAllowed = () => (
  !isSandboxRequested() || !isProduction() || stripeTestMode()
);

const assertSandboxAllowed = () => {
  if (sandboxAllowed()) return;
  throw new ShippingProviderError(
    'EasyPost sandbox mode is disabled for live deployments. Use a production EasyPost key.',
    { code: 'EASYPOST_SANDBOX_FORBIDDEN', status: 503, retryable: false },
  );
};

/**
 * Development/demo shipping provider.
 *
 * EasyPost does not publish a shared test key: every test key belongs to one
 * account. Until a real key is installed, a deployment running Stripe TEST
 * keys may use deterministic mock labels so the full purchase -> ship ->
 * deliver -> return -> payout flow is exercisable. A configured EasyPost key
 * ALWAYS wins; live Stripe keys never fall back to mock labels.
 */
const isMockMode = () => (
  // The in-memory Playwright harness boots with NODE_ENV=production to test
  // production middleware without any external services; it sets this flag
  // explicitly. Real deployments never set it.
  process.env.E2E_IN_MEMORY === '1'
  || process.env.SHIPPING_MOCK_MODE === '1'
  // An explicit sandbox selection must fail closed when its test key is
  // missing; silently falling back to fake labels would hide a bad sandbox
  // configuration during acceptance testing.
  || (!isSandboxRequested() && !apiKey() && (!isProduction() || stripeTestMode()))
);

const shippingMode = () => {
  if (isMockMode()) return 'mock';
  return isSandboxRequested() ? 'sandbox' : 'production';
};

// Only a non-production deployment, the in-memory harness, or a Stripe TEST
// deployment may expose the state driver. Live production can never advance a
// shipment from an unauthenticated test control.
const sandboxSimulationAllowed = () => (
  isMockMode() || (isSandboxRequested() && sandboxAllowed() && Boolean(apiKey()))
);

const shippingProviderStatus = () => ({
  provider: 'easypost',
  mode: shippingMode(),
  platformManaged: true,
  // The marketplace controls postage and labels. Stripe Connect is the
  // separate seller-payout rail; it never supplies carrier credentials.
  payoutRail: 'stripe_connect',
  configured: Boolean(apiKey()) || isMockMode(),
  // Never expose the key or any account identifier to the client.
  webhookConfigured: Boolean(process.env.EASYPOST_WEBHOOK_SECRET),
});

const authHeader = () => `Basic ${Buffer.from(`${apiKey()}:`).toString('base64')}`;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeAddress = (address = {}, role = 'address') => {
  const normalized = {
    name: clean(address.name || address.fullName || address.contactName),
    company: clean(address.company),
    street1: clean(address.street1 || address.street || address.address),
    street2: clean(address.street2 || address.address2),
    city: clean(address.city),
    state: clean(address.state || address.province),
    zip: clean(address.zip || address.postalCode || address.postcode),
    country: clean(address.country || address.countryCode).toUpperCase(),
    phone: clean(address.phone),
    email: clean(address.email),
  };

  if (!normalized.name || !normalized.street1 || !normalized.city || !normalized.country) {
    throw new ShippingProviderError(
      `The ${role} is incomplete: name, street, city and country are required.`,
      { code: 'SHIPPING_ADDRESS_INVALID', status: 422 },
    );
  }
  if (normalized.country === 'US' && !normalized.zip) {
    throw new ShippingProviderError(
      `The ${role} is incomplete: US shipments require a ZIP code.`,
      { code: 'SHIPPING_ADDRESS_INVALID', status: 422 },
    );
  }
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value));
};

const parseParcel = ({ weightKg, weight, parcel } = {}) => {
  if (parcel && typeof parcel === 'object') {
    const weightOz = Number(parcel.weightOz || parcel.weight);
    if (!Number.isFinite(weightOz) || weightOz <= 0) {
      throw new ShippingProviderError('Parcel weight must be greater than zero.', {
        code: 'SHIPPING_PARCEL_INVALID', status: 422,
      });
    }
    return {
      length: Number(parcel.length) || DEFAULT_PARCEL.length,
      width: Number(parcel.width) || DEFAULT_PARCEL.width,
      height: Number(parcel.height) || DEFAULT_PARCEL.height,
      weight: Math.round(weightOz * 100) / 100,
    };
  }
  const rawKg = Number(weightKg != null ? weightKg : weight);
  if (!Number.isFinite(rawKg) || rawKg <= 0) {
    throw new ShippingProviderError('Parcel weight must be greater than zero.', {
      code: 'SHIPPING_PARCEL_INVALID', status: 422,
    });
  }
  return {
    ...DEFAULT_PARCEL,
    weight: Math.round(rawKg * KG_TO_OZ * 100) / 100,
  };
};

const parseRate = (rate) => {
  if (!rate || typeof rate !== 'object' || !rate.id) return null;
  return {
    id: String(rate.id),
    carrier: clean(rate.carrier) || 'EasyPost',
    service: clean(rate.service) || 'Ground',
    amount: Number(rate.rate),
    deliveryDays: Number(rate.delivery_days) || null,
    deliveryDate: rate.delivery_date || null,
  };
};

const chooseRate = (rates, preferredCarrier) => {
  const usable = (Array.isArray(rates) ? rates : [])
    .map(parseRate)
    .filter((rate) => rate && Number.isFinite(rate.amount));
  if (!usable.length) return null;
  const wanted = clean(preferredCarrier).toLowerCase();
  const scoped = wanted
    ? usable.filter((rate) => rate.carrier.toLowerCase() === wanted
      || rate.carrier.toLowerCase().startsWith(`${wanted} `))
    : usable;
  return (scoped.length ? scoped : usable).sort((a, b) => a.amount - b.amount)[0];
};

/**
 * EasyPost's selected rate amount is postage only. Buying insurance adds a
 * separate InsuranceFee (1% of declared value, $1 minimum), so using the rate
 * as the platform's cost under-reported every insured label. The fees array is
 * the authoritative charged amount; fall back to the rate for older responses.
 */
const labelCostFromFees = (fees, fallbackRate) => {
  const charged = (Array.isArray(fees) ? fees : [])
    .filter((fee) => fee && fee.charged !== false && fee.refunded !== true)
    .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0);
  return Math.round((charged > 0 ? charged : (Number(fallbackRate) || 0)) * 100) / 100;
};

const estimatedDelivery = (rate, now = Date.now()) => {
  if (rate?.deliveryDate) {
    const parsed = new Date(rate.deliveryDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(now + (rate?.deliveryDays || 5) * 24 * 60 * 60 * 1000);
};

const mockLabel = ({ reference, carrier, service } = {}) => {
  const seed = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(`${reference || ''}:${seed}`).digest('hex');
  const shipmentId = `shp_mock_${hash.slice(0, 20)}`;
  const trackingNumber = `EZ${hash.slice(0, 18).toUpperCase()}`;
  const rate = {
    carrier: clean(carrier) || 'USPS',
    service: clean(service) || 'Ground Advantage',
    deliveryDays: 5,
  };
  return {
    trackingNumber,
    carrier: rate.carrier,
    carrierCode: rate.carrier.toUpperCase(),
    service: rate.service,
    trackingUrl: `https://www.easypost.com/track?tracking_code=${encodeURIComponent(trackingNumber)}`,
    labelUrl: `https://easypost.test/labels/${shipmentId}.pdf`,
    labelPdfUrl: `https://easypost.test/labels/${shipmentId}.pdf`,
    cost: 0,
    provider: 'mock',
    shipmentId,
    rateId: `rate_mock_${hash.slice(0, 12)}`,
    trackerId: `trk_mock_${hash.slice(0, 12)}`,
    estimatedDelivery: estimatedDelivery(rate),
    status: 'label_created',
    statusHistory: [{ status: 'label_created', description: 'Test label created', timestamp: new Date() }],
  };
};

const requestJson = async (path, { method = 'POST', body, idempotencyKey } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
    if (!response.ok) {
      const providerMessage = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      throw new ShippingProviderError(`EasyPost request failed: ${providerMessage}`, {
        code: response.status >= 500 ? 'SHIPPING_PROVIDER_UNAVAILABLE' : 'SHIPPING_LABEL_FAILED',
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof ShippingProviderError) throw error;
    const timedOut = error?.name === 'AbortError';
    throw new ShippingProviderError(
      timedOut ? 'EasyPost request timed out.' : 'EasyPost could not be reached.',
      { code: timedOut ? 'SHIPPING_PROVIDER_TIMEOUT' : 'SHIPPING_PROVIDER_UNAVAILABLE', retryable: true, cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Purchase a shipping label.
 *
 * Resolves only after EasyPost has actually bought postage. Every caller
 * treats a rejection as fatal to the order: no transaction, no inventory
 * claim, no seller credit, and the buyer's authorization is released (or the
 * charge refunded if the intent was already captured).
 */
const createShippingLabel = async ({
  fromAddress,
  toAddress,
  weightKg,
  parcel,
  reference,
  carrier,
  service,
  declaredValue,
} = {}) => {
  const from = normalizeAddress(fromAddress, 'seller address');
  const to = normalizeAddress(toAddress, 'buyer address');
  const shipmentParcel = parseParcel({ weightKg, parcel });

  const referenceValue = clean(reference).slice(0, 100) || `td_${Date.now()}`;
  if (isMockMode()) {
    return mockLabel({ reference: referenceValue, carrier, service });
  }
  assertSandboxAllowed();
  if (!apiKey()) {
    throw new ShippingProviderError(
      isSandboxRequested()
        ? 'EasyPost sandbox is not configured. EASYPOST_TEST_API_KEY is required for test labels.'
        : 'Shipping is not configured. EASYPOST_API_KEY is required before orders can be placed.',
      { code: 'EASYPOST_NOT_CONFIGURED', status: 503 },
    );
  }

  const idempotencyKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({ reference: referenceValue, from, to, parcel: shipmentParcel }))
    .digest('hex');

  const shipment = await requestJson('/shipments', {
    body: {
      shipment: {
        reference: referenceValue,
        to_address: to,
        from_address: from,
        parcel: shipmentParcel,
        options: { label_format: 'PDF' },
      },
    },
  });

  if (!shipment?.id) {
    throw new ShippingProviderError('EasyPost did not return a shipment.', {
      code: 'SHIPPING_LABEL_FAILED', status: 502,
    });
  }
  const rate = chooseRate(shipment.rates, carrier);
  if (!rate) {
    throw new ShippingProviderError('No shipping rates are available for this parcel.', {
      code: 'SHIPPING_RATE_UNAVAILABLE', status: 422,
    });
  }

  const buyBody = { rate: { id: rate.id } };
  if (Number(declaredValue) > 0) buyBody.insurance = Number(declaredValue).toFixed(2);
  const bought = await requestJson(`/shipments/${encodeURIComponent(shipment.id)}/buy`, {
    body: buyBody,
    idempotencyKey,
  });

  const trackingNumber = clean(bought?.tracking_code);
  const labelUrl = clean(bought?.postage_label?.label_url);
  if (!trackingNumber || !labelUrl) {
    // Postage was charged but the response is unusable. Request the refund
    // here: the caller has no label object/shipment id to compensate with.
    const purchasedId = clean(bought?.id) || clean(shipment.id);
    let refunded = false;
    if (purchasedId) {
      try {
        const refund = await requestJson(`/shipments/${encodeURIComponent(purchasedId)}/refund`, { body: {} });
        const status = clean(refund?.status).toLowerCase();
        refunded = !['rejected', 'error', 'failed', 'canceled', 'cancelled'].includes(status);
      } catch (refundError) {
        console.error('EasyPost incomplete-label refund failed:', refundError.message);
      }
    }
    throw new ShippingProviderError('EasyPost purchased no printable label.', {
      code: 'SHIPPING_LABEL_INCOMPLETE', status: 502, shipmentId: purchasedId, labelRefunded: refunded,
    });
  }

  const publicUrl = clean(bought?.tracker?.public_url);
  return {
    trackingNumber,
    carrier: clean(rate.carrier) || 'EasyPost',
    carrierCode: clean(rate.carrier).toUpperCase(),
    service: clean(rate.service),
    trackingUrl: publicUrl || `https://www.easypost.com/track?tracking_code=${encodeURIComponent(trackingNumber)}`,
    labelUrl,
    labelPdfUrl: labelUrl,
    cost: labelCostFromFees(bought?.fees, rate.amount),
    provider: 'easypost',
    shipmentId: String(bought.id || shipment.id),
    rateId: rate.id,
    trackerId: clean(bought?.tracker?.id),
    estimatedDelivery: estimatedDelivery(rate),
    status: 'label_created',
    statusHistory: [{ status: 'label_created', description: 'Shipping label purchased', timestamp: new Date() }],
  };
};

/**
 * Fetch the carrier tracker for a purchased label. Returns null in the local
 * mock environment; production always queries EasyPost so a package is never
 * marked delivered from a timer.
 */
const getTracker = async (trackerId) => {
  if (!trackerId) throw new ShippingProviderError('A tracker id is required.', { code: 'SHIPPING_TRACKER_MISSING', status: 422 });
  if (isMockMode()) return null;
  assertSandboxAllowed();
  if (!apiKey()) {
    throw new ShippingProviderError('Shipping is not configured.', { code: 'EASYPOST_NOT_CONFIGURED', status: 503 });
  }
  return requestJson(`/trackers/${encodeURIComponent(trackerId)}`, { method: 'GET' });
};

/** Map EasyPost tracker vocabulary onto TrendDrop's shipment states. */
const mapTrackerStatus = (status) => {
  const normalized = clean(status).toLowerCase();
  if (normalized === 'delivered') return 'delivered';
  if (normalized === 'out_for_delivery') return 'out_for_delivery';
  if (normalized === 'in_transit') return 'in_transit';
  if (normalized === 'available_for_pickup') return 'in_transit_local';
  if (normalized === 'return_to_sender') return 'returned';
  if (['failure', 'error', 'cancelled', 'canceled', 'expired'].includes(normalized)) return 'exception';
  // pre_transit / unknown must never regress a shipped order.
  return null;
};

/**
 * Request a carrier refund for an unused label. Best-effort: callers use this
 * for compensation and must never mask the original purchase failure.
 */
const refundShippingLabel = async (shipmentId) => {
  if (!shipmentId) return { refunded: false, status: 'no_shipment' };
  if (isMockMode()) return { refunded: true, status: 'refunded' };
  assertSandboxAllowed();
  if (!apiKey()) {
    throw new ShippingProviderError('Shipping is not configured.', { code: 'EASYPOST_NOT_CONFIGURED', status: 503 });
  }
  const result = await requestJson(`/shipments/${encodeURIComponent(shipmentId)}/refund`, { body: {} });
  const status = clean(result?.status).toLowerCase() || 'submitted';
  // EasyPost can answer 200 with a rejected refund (for example a label already
  // scanned by the carrier). Treating that as recovered postage would hide a
  // permanent platform loss, so only an accepted/submitted refund counts.
  const refunded = !['rejected', 'error', 'failed', 'canceled', 'cancelled'].includes(status);
  return { refunded, status, shipmentId };
};

const shippingLabelPayload = (label) => ({
  carrier: label.carrier,
  carrierCode: label.carrierCode,
  trackingNumber: label.trackingNumber,
  trackingUrl: label.trackingUrl,
  labelUrl: label.labelUrl,
  labelPdfUrl: label.labelPdfUrl,
  labelCreated: true,
  labelCreatedDate: new Date(),
  estimatedDelivery: label.estimatedDelivery,
  service: label.service,
  provider: label.provider,
  shipmentId: label.shipmentId,
  rateId: label.rateId,
  trackerId: label.trackerId,
  labelCost: label.cost,
  trackingHistory: label.statusHistory,
});

module.exports = {
  ShippingProviderError,
  stripeTestMode,
  createShippingLabel,
  getTracker,
  mapTrackerStatus,
  refundShippingLabel,
  shippingLabelPayload,
  chooseRate,
  labelCostFromFees,
  normalizeAddress,
  parseParcel,
  isMockMode,
  isSandboxRequested,
  sandboxSimulationAllowed,
  shippingMode,
  shippingProviderStatus,
};
