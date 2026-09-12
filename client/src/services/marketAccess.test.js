import { getRegionCountry, setRegionCountry, checkRegionStatus, getStoredSupported } from './marketAccess';

jest.mock('./api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import api from './api';

describe('marketAccess region helper (Feature 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test('getRegionCountry defaults to US for anonymous users with no stored region', () => {
    expect(getRegionCountry(null)).toBe('US');
    expect(getRegionCountry({ name: 'Anon' })).toBe('US');
  });

  test('getRegionCountry prefers stored region over user profile', () => {
    setRegionCountry('DE');
    expect(getRegionCountry({ country: 'GB' })).toBe('DE');
  });

  test('getRegionCountry falls back to the user profile country', () => {
    expect(getRegionCountry({ country: 'gb' })).toBe('GB');
  });

  test('setRegionCountry normalizes to uppercase and persists', () => {
    setRegionCountry('fr ');
    expect(localStorage.getItem('td_region_country')).toBe('FR');
  });

  test('checkRegionStatus calls the API and caches supported=false for unsupported regions', async () => {
    api.get.mockResolvedValueOnce({
      data: { country: 'IN', supported: false, message: 'not available' },
    });
    const result = await checkRegionStatus(null);
    expect(api.get).toHaveBeenCalledWith('/marketplace/status?country=US');
    expect(result.supported).toBe(false);
    expect(getStoredSupported()).toBe(false);
  });

  test('checkRegionStatus fails open (supported) when the API call errors', async () => {
    api.get.mockRejectedValueOnce(new Error('network down'));
    const result = await checkRegionStatus(null);
    expect(result.supported).toBe(true);
    expect(result.error).toBe(true);
    // A failed check must never cache a negative region verdict.
    expect(getStoredSupported()).toBe(false);
  });
});