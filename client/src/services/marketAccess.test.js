import { getRegionCountry, setRegionCountry, checkRegionStatus, getStoredSupported } from './marketAccess';

jest.mock('./api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

import api from './api';

describe('marketAccess region helper (Feature 1 + IP geo detection)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test('getRegionCountry returns null for anonymous users so the server auto-detects by IP', () => {
    expect(getRegionCountry(null)).toBeNull();
    expect(getRegionCountry({ name: 'Anon' })).toBeNull();
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

  test('checkRegionStatus passes an explicit country hint when one is known', async () => {
    api.get.mockResolvedValueOnce({
      data: { country: 'GB', supported: true, message: 'Available in your area' },
    });
    const result = await checkRegionStatus({ country: 'gb' });
    expect(api.get).toHaveBeenCalledWith('/marketplace/status?country=GB');
    expect(result.supported).toBe(true);
    expect(getStoredSupported()).toBe(true);
  });

  test('anonymous users call the API without a hint so the server detects from IP', async () => {
    api.get.mockResolvedValueOnce({
      data: { country: 'DE', supported: true, message: 'Available in your area' },
    });
    const result = await checkRegionStatus(null);
    expect(api.get).toHaveBeenCalledWith('/marketplace/status');
    // The IP-detected country is remembered for instant repeat visits.
    expect(localStorage.getItem('td_region_country')).toBe('DE');
    expect(result.country).toBe('DE');
  });

  test('checkRegionStatus caches supported=false for unsupported regions', async () => {
    api.get.mockResolvedValueOnce({
      data: { country: 'IN', supported: false, message: 'not available' },
    });
    const result = await checkRegionStatus({ country: 'IN' });
    expect(api.get).toHaveBeenCalledWith('/marketplace/status?country=IN');
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
