const request = require('supertest');
const app = require('../server');
const metrics = require('../utils/metrics');

describe('Prometheus-compatible operational metrics', () => {
  beforeEach(() => metrics.reset());

  test('metrics endpoint returns Prometheus text format with payment, webhook, refund, and payout counters', async () => {
    metrics.increment('trenddrop_payment_failures_total', { operation: 'confirm_batch', reason: 'StripeError' });
    metrics.increment('trenddrop_webhook_events_total', { event_type: 'charge.refunded', result: 'received' });
    metrics.increment('trenddrop_webhook_retries_total', { event_type: 'charge.refunded' }, 2);
    metrics.increment('trenddrop_refunds_total', { source: 'payment_config', status: 'succeeded' });
    metrics.increment('trenddrop_payouts_total', { operation: 'seller_payout', status: 'failed' });

    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('# TYPE trenddrop_payment_failures_total counter');
    expect(response.text).toContain('trenddrop_payment_failures_total{operation="confirm_batch",reason="StripeError"} 1');
    expect(response.text).toContain('trenddrop_webhook_events_total{event_type="charge.refunded",result="received"} 1');
    expect(response.text).toContain('trenddrop_webhook_retries_total{event_type="charge.refunded"} 2');
    expect(response.text).toContain('trenddrop_refunds_total{source="payment_config",status="succeeded"} 1');
    expect(response.text).toContain('trenddrop_payouts_total{operation="seller_payout",status="failed"} 1');
    expect(response.text).toMatch(/trenddrop_process_uptime_seconds\s+[0-9.]+/);
  });

  test('metric labels are bounded and safely escaped', async () => {
    metrics.increment('trenddrop_webhook_events_total', {
      event_type: 'provider"event\nnext',
      result: 'received',
      paymentIntentId: 'must_not_be_a_label',
    });

    const response = await request(app).get('/metrics');

    expect(response.text).toContain('event_type="provider\\"event\\nnext"');
    expect(response.text).not.toContain('paymentIntentId');
  });
});
