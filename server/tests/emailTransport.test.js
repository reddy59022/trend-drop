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
});
