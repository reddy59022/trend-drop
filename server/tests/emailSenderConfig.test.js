// jest.setup.js replaces config/email with a no-network mock; this suite tests
// the real sender-configuration helper.
const email = jest.requireActual('../config/email');

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SENDER = process.env.BREVO_SENDER_EMAIL;

const restore = () => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_SENDER === undefined) delete process.env.BREVO_SENDER_EMAIL;
  else process.env.BREVO_SENDER_EMAIL = ORIGINAL_SENDER;
};

afterEach(restore);

describe('transactional email sender configuration', () => {
  it('ESC.1 warns when production has no BREVO_SENDER_EMAIL', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BREVO_SENDER_EMAIL;
    const log = jest.fn();

    const result = email.warnIfSenderNotConfigured({ log });

    expect(result).toEqual({
      configured: false,
      sender: email.FALLBACK_SENDER_EMAIL,
      warned: true,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('BREVO_SENDER_EMAIL is not set in production');
    expect(log.mock.calls[0][0]).toContain('connect.trenddrop@gmail.com');
  });

  it('ESC.2 treats a whitespace-only sender as unset in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.BREVO_SENDER_EMAIL = '   ';
    const log = jest.fn();

    const result = email.warnIfSenderNotConfigured({ log });

    expect(result.configured).toBe(false);
    expect(result.warned).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('ESC.3 stays quiet when a production sender is configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.BREVO_SENDER_EMAIL = '  connect.trenddrop@gmail.com  ';
    const log = jest.fn();

    const result = email.warnIfSenderNotConfigured({ log });

    expect(result).toEqual({
      configured: true,
      sender: 'connect.trenddrop@gmail.com',
      warned: false,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('ESC.4 does not warn outside production so local runs stay quiet', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.BREVO_SENDER_EMAIL;
    const log = jest.fn();

    const result = email.warnIfSenderNotConfigured({ log });

    expect(result).toEqual({
      configured: false,
      sender: email.FALLBACK_SENDER_EMAIL,
      warned: false,
    });
    expect(log).not.toHaveBeenCalled();
  });
});
