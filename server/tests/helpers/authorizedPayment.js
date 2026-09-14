/**
 * Test helper: register an authorized mock PaymentIntent and return its id.
 *
 * Mirrors the auth-only + capture payment pattern used in production:
 *   - 'requires_capture' => buyer's card is authorized, capture pending
 *     (this is the state money-moving gates accept)
 *   - 'succeeded'        => payment already captured
 *   - 'requires_payment_method' => nothing authorized yet (must be rejected)
 *
 * Purchase endpoints (POST /api/transactions, /guest, /offer/:offerId,
 * /api/cart/checkout) refuse to create money state unless the supplied
 * paymentIntentId resolves to an authorized intent, so tests that exercise
 * the happy path must supply one of these ids.
 */
let seq = 0;

function authorizedPaymentIntent(status = 'requires_capture') {
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  seq += 1;
  const id = `pi_test_${Date.now()}_${seq}`;
  global.__mockPaymentIntents[id] = {
    id,
    status,
    amount: 0,
    currency: 'usd',
    client_secret: 'cs_test_mock',
    metadata: {},
  };
  return id;
}

module.exports = authorizedPaymentIntent;
