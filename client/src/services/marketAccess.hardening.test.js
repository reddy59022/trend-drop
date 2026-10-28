/**
 * Hardening regressions: localStorage can THROW in restricted WebViews and
 * private browsing. Region checks run during app boot, so storage access must
 * never crash the call chain and a storage failure must never mask the
 * server's authoritative supported:false verdict (the old code caught the
 * throwing setItem inside checkRegionStatus and returned the fail-open
 * {supported: true, error: true} fallback instead of the real response).
 */
import {
  getRegionCountry,
  getStoredCountry,
  getStoredSupported,
  setRegionCountry,
  checkRegionStatus,
} from './marketAccess';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

import api from './api';

describe('restricted WebView (storage throws) hardening', () => {
  let getItemSpy;
  let setItemSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
    setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled');
    });
  });

  afterEach(() => {
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  test('storage reads never throw', () => {
    expect(() => getStoredCountry()).not.toThrow();
    expect(getStoredCountry()).toBeNull();
    expect(() => getStoredSupported()).not.toThrow();
    expect(getStoredSupported()).toBe(false);
    expect(() => getRegionCountry({ country: 'GB' })).not.toThrow();
    // Falls back to the profile country since the stored one is unreadable.
    expect(getRegionCountry({ country: 'GB' })).toBe('GB');
  });

  test('storage writes never throw', () => {
    expect(() => setRegionCountry('DE')).not.toThrow();
    expect(() => setRegionCountry('')).not.toThrow();
  });

  test('a storage failure does NOT mask the server verdict (supported:false stays false)', async () => {
    api.get.mockResolvedValueOnce({
      data: { country: 'IN', supported: false, message: 'not available' },
    });
    const result = await checkRegionStatus({ country: 'IN' });
    expect(result.supported).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test('a storage failure does not break a supported verdict either', async () => {
    api.get.mockResolvedValueOnce({
      data: { country: 'US', supported: true, message: 'Available' },
    });
    const result = await checkRegionStatus(null);
    expect(result.supported).toBe(true);
    expect(result.country).toBe('US');
  });
});
