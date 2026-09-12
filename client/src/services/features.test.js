import { getFeatureFlags, clearFeatureCache, isInternationalShippingEnabled } from './features';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

import api from './api';

describe('feature flags helper (Feature 2)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    clearFeatureCache();
  });

  test('fetches the flag set from /api/config/features', async () => {
    api.get.mockResolvedValueOnce({ data: { internationalShippingEnabled: true } });
    const flags = await getFeatureFlags();
    expect(api.get).toHaveBeenCalledWith('/config/features');
    expect(flags.internationalShippingEnabled).toBe(true);
  });

  test('caches the result within the TTL (no repeated API calls)', async () => {
    api.get.mockResolvedValueOnce({ data: { internationalShippingEnabled: false } });
    const first = await getFeatureFlags();
    const second = await getFeatureFlags();
    expect(first.internationalShippingEnabled).toBe(false);
    expect(second.internationalShippingEnabled).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('fails SAFE (flag off) when the API is unreachable', async () => {
    api.get.mockRejectedValueOnce(new Error('network down'));
    const flags = await getFeatureFlags();
    expect(flags.internationalShippingEnabled).toBe(false);
    expect(isInternationalShippingEnabled(flags)).toBe(false);
  });

  test('isInternationalShippingEnabled reflects the flag value', () => {
    expect(isInternationalShippingEnabled({ internationalShippingEnabled: true })).toBe(true);
    expect(isInternationalShippingEnabled({ internationalShippingEnabled: false })).toBe(false);
    expect(isInternationalShippingEnabled(undefined)).toBe(false);
  });
});