// Email transport contract (Brevo REST via fetch)
//
// The old transport used @sendinblue/client → deprecated request@2.88.2,
// which dragged in CRITICAL advisories (request SSRF, form-data CRLF/weak
// boundary) plus moderate ones (qs, tough-cookie, uuid@3). The replacement
// posts JSON to Brevo's v3 REST endpoint with a plain fetch — zero deps.
// These tests pin that contract. (Red against the SDK-based module; green
// after the rewrite.)
jest.unmock('../config/email');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('Email transport uses Brevo REST (no request-based SDK)', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  let fetchMock;
  let email;

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-brevo-key';
    process.env.FRONTEND_URL = 'https://app.trenddrop.example';
    delete process.env.CLIENT_URL;
    delete process.env.E2E_IN_MEMORY;
    delete process.env.ALERT_EMAILS;
    delete process.env.ADMIN_EMAILS;
    delete process.env.ALERT_WEBHOOK_URL;
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ messageId: 'msg-1' }),
    }));
    global.fetch = fetchMock;
    jest.resetModules();
    email = require('../config/email');
  });

  afterAll(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('TR.1 posts JSON to the Brevo SMTP endpoint with the api-key header', async () => {
    const result = await email.sendVerificationEmail('buyer@example.com', 'Buyer', 'tok-1');
    expect(result).toEqual({ emailSent: true, queued: true });
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(BREVO_URL);
    expect(opts.method).toBe('POST');
    expect(opts.headers['api-key']).toBe('test-brevo-key');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('TR.2 payload carries subject, htmlContent, to and sender', async () => {
    await email.sendVerificationEmail('buyer@example.com', 'Buyer', 'tok-2');
    await flushAsync();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain('Verify your TrendDrop');
    expect(body.to).toEqual([{ email: 'buyer@example.com', name: 'Buyer' }]);
    expect(body.sender).toEqual({ email: expect.any(String), name: 'TrendDrop' });
    expect(body.htmlContent).toContain('https://app.trenddrop.example/verify-email?token=tok-2');
  });

  it('TR.3 password reset payload uses the reset link and 1-hour note', async () => {
    await email.sendPasswordResetEmail('seller@example.com', 'Seller', 'reset-9');
    await flushAsync();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain('Reset your TrendDrop');
    expect(body.to).toEqual([{ email: 'seller@example.com', name: 'Seller' }]);
    expect(body.htmlContent).toContain('https://app.trenddrop.example/reset-password?token=reset-9');
    expect(body.htmlContent).toContain('expires in 1 hour');
  });

  it('TR.4 no key → no fetch call, skipped result', async () => {
    delete process.env.BREVO_API_KEY;
    jest.resetModules();
    email = require('../config/email');

    const result = await email.sendVerificationEmail('a@example.com', 'A', 'tok-3');
    expect(result).toEqual({ emailSent: false, skipped: true });
    await flushAsync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TR.5 fetch rejection is logged, never thrown (fire-and-forget)', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new Error('network down');
    });

    await expect(email.sendVerificationEmail('a@example.com', 'A', 'tok-4')).resolves.toEqual({
      emailSent: true,
      queued: true,
    });
    await flushAsync();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('TR.6 non-2xx response is logged, never thrown', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'unauthorized' }),
    }));

    await expect(email.sendPasswordResetEmail('a@example.com', 'A', 'tok-5')).resolves.toEqual({
      emailSent: true,
      queued: true,
    });
    await flushAsync();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('TR.7 operational alert sends to ALERT_EMAILS with escaped text', async () => {
    process.env.ALERT_EMAILS = 'ops@example.com, oncall@example.com';

    const result = await email.sendOperationalAlert({
      subject: '[TrendDrop][ALERT] 2 orphan notifications detected',
      text: '2 notifications\n<script>alert(1)</script>',
    });

    expect(result).toEqual({ emailSent: true, messageId: 'msg-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual([
      { email: 'ops@example.com' },
      { email: 'oncall@example.com' },
    ]);
    expect(body.subject).toContain('2 orphan notifications');
    expect(body.textContent).toContain('<script>');
    expect(body.htmlContent).toContain('&lt;script&gt;');
    expect(body.htmlContent).not.toContain('<script>');
  });

  it('TR.8 operational alert falls back to ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';

    await email.sendOperationalAlert({ subject: 'Alert', text: 'body' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual([{ email: 'admin@example.com' }]);
  });

  it('TR.9 operational alert retries transient failures and then propagates so cron can log it', async () => {
    process.env.ALERT_EMAILS = 'ops@example.com';
    process.env.BREVO_MAX_RETRIES = '2';
    process.env.BREVO_RETRY_BASE_MS = '1';
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ message: 'unavailable' }),
    }));

    await expect(email.sendOperationalAlert({ subject: 'Alert', text: 'body' }))
      .rejects.toThrow('Brevo API error 503');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    delete process.env.BREVO_MAX_RETRIES;
    delete process.env.BREVO_RETRY_BASE_MS;
  });

  it('TR.10 operational alert skips without a key and makes no network call', async () => {
    delete process.env.BREVO_API_KEY;
    jest.resetModules();
    email = require('../config/email');

    await expect(email.sendOperationalAlert({ subject: 'Alert', text: 'body' }))
      .resolves.toEqual({ emailSent: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TR.11 falls back to the configured paging webhook when email is unavailable', async () => {
    delete process.env.BREVO_API_KEY;
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/trenddrop';
    jest.resetModules();
    email = require('../config/email');

    const result = await email.sendOperationalAlert({ subject: 'Alert', text: 'body' });
    expect(result).toEqual({ emailSent: false, webhookSent: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/trenddrop');
    expect(JSON.parse(opts.body)).toMatchObject({ source: 'trenddrop', subject: 'Alert' });
    delete process.env.ALERT_WEBHOOK_URL;
  });

  it('TR.12 falls back to the webhook after the email provider fails', async () => {
    process.env.ALERT_EMAILS = 'ops@example.com';
    process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/trenddrop';
    jest.resetModules();
    email = require('../config/email');
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('hooks.example.com')) return { ok: true, status: 204 };
      return { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) };
    });

    const result = await email.sendOperationalAlert({ subject: 'Alert', text: 'body' });
    expect(result).toMatchObject({ emailSent: false, webhookSent: true });
    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 email attempts + 1 webhook
    delete process.env.ALERT_WEBHOOK_URL;
  });
});
