// Email (Brevo/Sendinblue) Tests — TD-1.3 (key-independent)
// Covers config/email.js: keyless skip path (no network), keyed send path,
// FRONTEND_URL precedence, and localhost fallback for email links.
// jest.setup.js globally mocks ./config/email (returns true) for hermetically;
// unmock here so the REAL module logic is exercised (still no network: the
// @sendinblue/client SDK below is mocked).
jest.unmock('../config/email');

const mockSend = jest.fn(async function sendTransacEmail(email) {
  this.sent = (this.sent || []).concat(email);
  return { body: { messageId: `msg-${this.sent.length}` } };
});

jest.mock('@sendinblue/client', () => ({
  TransactionalEmailsApi: class {
    constructor() {
      this.sent = [];
    }
    setApiKey() {
      this.keySet = true;
    }
    sendTransacEmail(email) {
      return mockSend.call(this, email);
    }
  },
  TransactionalEmailsApiApiKeys: { apiKey: 'api-key' },
  SendSmtpEmail: class {},
}));

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('Email module (TD-1.3)', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let email;

  afterAll(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('Keyless mode (no BREVO_API_KEY)', () => {
    beforeAll(() => {
      delete process.env.BREVO_API_KEY;
      delete process.env.FRONTEND_URL;
      delete process.env.CLIENT_URL;
      mockSend.mockClear();
      jest.resetModules();
      email = require('../config/email');
    });

    it('EM.1 sendVerificationEmail skips without a key and makes no network call', async () => {
      const result = await email.sendVerificationEmail('buyer@example.com', 'Buyer', 'tok-123');
      expect(result).toEqual({ emailSent: false, skipped: true });
      await flushAsync();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('EM.2 sendPasswordResetEmail skips without a key and makes no network call', async () => {
      const result = await email.sendPasswordResetEmail('seller@example.com', 'Seller', 'reset-456');
      expect(result).toEqual({ emailSent: false, skipped: true });
      await flushAsync();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('Keyed mode (BREVO_API_KEY set)', () => {
    beforeAll(() => {
      process.env.BREVO_API_KEY = 'test-brevo-key';
      process.env.FRONTEND_URL = 'https://app.trenddrop.example/';
      delete process.env.CLIENT_URL;
      mockSend.mockClear();
      jest.resetModules();
      email = require('../config/email');
    });

    afterEach(() => {
      mockSend.mockClear();
    });

    it('EM.3 sends a verification email to the right address with a tokenized FRONTEND_URL link', async () => {
      const result = await email.sendVerificationEmail('buyer@example.com', 'Buyer', 'tok-abc');
      expect(result.emailSent).toBe(true);
      await flushAsync();
      expect(mockSend).toHaveBeenCalledTimes(1);
      const sent = mockSend.mock.calls[0][0];
      expect(sent.subject).toContain('Verify your TrendDrop');
      expect(sent.to).toEqual([{ email: 'buyer@example.com', name: 'Buyer' }]);
      expect(sent.htmlContent).toContain('https://app.trenddrop.example/verify-email?token=tok-abc');
      expect(sent.htmlContent).toContain('Buyer');
    });

    it('EM.4 sends a password reset email with a tokenized link and 1-hour expiry note', async () => {
      const result = await email.sendPasswordResetEmail('seller@example.com', 'Seller', 'reset-xyz');
      expect(result.emailSent).toBe(true);
      await flushAsync();
      expect(mockSend).toHaveBeenCalledTimes(1);
      const sent = mockSend.mock.calls[0][0];
      expect(sent.subject).toContain('Reset your TrendDrop');
      expect(sent.to).toEqual([{ email: 'seller@example.com', name: 'Seller' }]);
      expect(sent.htmlContent).toContain('https://app.trenddrop.example/reset-password?token=reset-xyz');
      expect(sent.htmlContent).toContain('expires in 1 hour');
    });

    it('EM.5 falls back to CLIENT_URL when FRONTEND_URL is absent', async () => {
      delete process.env.FRONTEND_URL;
      process.env.CLIENT_URL = 'https://client.trenddrop.example/';
      mockSend.mockClear();
      jest.resetModules();
      email = require('../config/email');
      await email.sendVerificationEmail('a@example.com', 'A', 'tok-fb');
      await flushAsync();
      const sent = mockSend.mock.calls[0][0];
      expect(sent.htmlContent).toContain('https://client.trenddrop.example/verify-email?token=tok-fb');
    });

    it('EM.6 falls back to localhost when neither FRONTEND_URL nor CLIENT_URL is set', async () => {
      delete process.env.FRONTEND_URL;
      delete process.env.CLIENT_URL;
      mockSend.mockClear();
      jest.resetModules();
      email = require('../config/email');
      await email.sendVerificationEmail('a@example.com', 'A', 'tok-lh');
      await flushAsync();
      const sent = mockSend.mock.calls[0][0];
      expect(sent.htmlContent).toContain('http://localhost:3000/verify-email?token=tok-lh');
    });

    it('EM.7 strips trailing slashes so links never contain //', async () => {
      process.env.FRONTEND_URL = 'https://app.trenddrop.example///';
      mockSend.mockClear();
      jest.resetModules();
      email = require('../config/email');
      await email.sendVerificationEmail('a@example.com', 'A', 'tok-ts');
      await flushAsync();
      const sent = mockSend.mock.calls[0][0];
      expect(sent.htmlContent).not.toContain('//verify-email');
      expect(sent.htmlContent).toContain('https://app.trenddrop.example/verify-email?token=tok-ts');
    });
  });
});
