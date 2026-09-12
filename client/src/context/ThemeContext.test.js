/**
 * ThemeContext — IP-based auto-selection of the top-right country + currency.
 *
 * Proves, at the provider level:
 *  - fresh visitors get country + currency from the server IP geo endpoint
 *  - iOS/Android (Capacitor native) run the IDENTICAL code path (no
 *    web-only browser APIs, no third-party fetch)
 *  - explicit user choices are never overridden by IP detection
 *  - garbage/failed API responses fall back safely to USD
 *  - React 18 StrictMode double-effect triggers exactly one API call
 *  - detected values persist and are marked auto (re-detected next load)
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('@capacitor/core', () => {
  // Mutable so a test can flip the platform to native (iOS/Android) at runtime.
  const state = { native: false };
  globalThis.__tdCapacitorState = state;
  return {
    __esModule: true,
    Capacitor: {
      isNativePlatform: () => state.native,
      getPlatform: () => (state.native ? 'ios' : 'web'),
      Platform: { IOS: 'ios', ANDROID: 'android', WEB: 'web' },
    },
  };
});

import api from '../services/api';
// Importing the mocked module forces its factory to run at load time
// (creating the globalThis.__tdCapacitorState handle for the native tests).
import { Capacitor } from '@capacitor/core';
import { ThemeProvider, useTheme } from './ThemeContext';

void Capacitor;


const Probe = () => {
  const { country, currency, currencySource, countrySource } = useTheme();
  return (
    <div>
      <span data-testid="probe-country">{country || 'none'}</span>
      <span data-testid="probe-currency">{currency}</span>
      <span data-testid="probe-currency-source">{currencySource || 'none'}</span>
      <span data-testid="probe-country-source">{countrySource || 'none'}</span>
    </div>
  );
};

const renderProvider = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );

const statusPayload = (body) => ({ data: body });

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  if (globalThis.__tdCapacitorState) globalThis.__tdCapacitorState.native = false;
  jest.spyOn(window, 'fetch').mockImplementation(() =>
    Promise.reject(new Error('third-party fetch must not be used for geo detection'))
  );
});

afterEach(() => {
  window.fetch.mockRestore();
  // Defensively restore any storage spies a failed test may have leaked.
  try { jest.restoreAllMocks(); } catch (e) { /* nothing to restore */ }
});

describe('ThemeContext geo auto-selection (top-right country + currency)', () => {
  test('T1 fresh web visitor: country + currency auto-selected from server IP geo', async () => {
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', currency: 'GBP', supported: true }));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('GBP'));
    expect(screen.getByTestId('probe-country')).toHaveTextContent('GB');
    // Detection goes through the shared API client (works on iOS/Android too).
    expect(api.get).toHaveBeenCalledWith('/marketplace/status');
    // ...and never through a third-party/browser fetch (old ipapi.co path).
    expect(window.fetch).not.toHaveBeenCalled();
    // Detected values persist as AUTO-sourced.
    expect(localStorage.getItem('country')).toBe('GB');
    expect(localStorage.getItem('currency')).toBe('GBP');
    expect(localStorage.getItem('currencySource')).toBe('auto');
    expect(localStorage.getItem('countrySource')).toBe('auto');
  });

  test('T2 native Capacitor (iOS/Android) auto-selects through the identical code path', async () => {
    globalThis.__tdCapacitorState.native = true;
    api.get.mockResolvedValueOnce(statusPayload({ country: 'DE', currency: 'EUR', supported: true }));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('EUR'));
    expect(screen.getByTestId('probe-country')).toHaveTextContent('DE');
    expect(api.get).toHaveBeenCalledWith('/marketplace/status');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  test('T3 manual currency choice is never overridden by IP detection (country still updates)', async () => {
    localStorage.setItem('currency', 'USD');
    localStorage.setItem('currencySource', 'manual');
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', currency: 'GBP', supported: true }));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-country')).toHaveTextContent('GB'));
    expect(screen.getByTestId('probe-currency')).toHaveTextContent('USD');
    expect(screen.getByTestId('probe-currency-source')).toHaveTextContent('manual');
    expect(localStorage.getItem('currency')).toBe('USD');
  });

  test('T4 manual country with no saved currency derives the currency locally (no API roundtrip)', async () => {
    localStorage.setItem('country', 'FR');
    localStorage.setItem('countrySource', 'manual');

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('EUR'));
    expect(screen.getByTestId('probe-country')).toHaveTextContent('FR');
    expect(api.get).not.toHaveBeenCalled();
  });
});


describe('ThemeContext geo auto-selection (preference precedence + failure modes)', () => {
  test('T5 API failure: keeps the USD default, no crash, stays auto for the next load', async () => {
    api.get.mockRejectedValueOnce(new Error('network down'));

    renderProvider();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByTestId('probe-currency')).toHaveTextContent('USD');
    expect(screen.getByTestId('probe-currency-source')).toHaveTextContent('auto');
    expect(screen.getByTestId('probe-country')).toHaveTextContent('none');
  });

  test('T6 invalid currency in the response falls back via the country map', async () => {
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', currency: 'us', supported: true }));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('GBP'));
    expect(screen.getByTestId('probe-country')).toHaveTextContent('GB');
  });

  test('T7 non-existent currency code falls back to USD, no crash', async () => {
    api.get.mockResolvedValueOnce(statusPayload({ country: 'XK', currency: 'ZZZ', supported: true }));

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('probe-currency')).toHaveTextContent('USD');
      expect(screen.getByTestId('probe-country')).toHaveTextContent('XK');
    });
  });

  test('T8 older backend without a currency field still selects the right currency', async () => {
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', supported: true }));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('GBP'));
  });

  test('T9 React 18 StrictMode double-effect triggers exactly ONE detection request', async () => {
    api.get.mockResolvedValue(statusPayload({ country: 'GB', currency: 'GBP', supported: true }));

    render(
      <React.StrictMode>
        <ThemeProvider>
          <Probe />
        </ThemeProvider>
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('GBP'));
    await act(async () => { await Promise.resolve(); });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('T10 localStorage unavailable (private-mode WebView): still auto-detects, no crash', async () => {
    const getSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', currency: 'GBP', supported: true }));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('GBP'));
    expect(screen.getByTestId('probe-country')).toHaveTextContent('GB');
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  test('T11 changeCountry switches currency to the country default and marks both manual', async () => {
    let probe;
    const Harness = () => {
      const { changeCountry, changeCurrency, country, currency } = useTheme();
      probe = { changeCountry, changeCurrency, country, currency };
      return <div>{`${country || 'none'}|${currency}`}</div>;
    };
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', currency: 'GBP', supported: true }));

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    );
    await waitFor(() => expect(probe.currency).toBe('GBP'));

    act(() => { probe.changeCountry('US'); });
    expect(probe.country).toBe('US');
    expect(probe.currency).toBe('USD');
    expect(localStorage.getItem('country')).toBe('US');
    expect(localStorage.getItem('currencySource')).toBe('manual');
    expect(localStorage.getItem('countrySource')).toBe('manual');

    act(() => { probe.changeCurrency('EUR'); });
    expect(probe.currency).toBe('EUR');
    expect(localStorage.getItem('currency')).toBe('EUR');
    expect(localStorage.getItem('currencySource')).toBe('manual');
  });

  test('T12 auto-sourced values refresh on the next app load (travel/VPN self-heal)', async () => {
    api.get.mockResolvedValueOnce(statusPayload({ country: 'GB', currency: 'GBP', supported: true }));
    const first = renderProvider();
    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('GBP'));
    first.unmount();

    api.get.mockResolvedValueOnce(statusPayload({ country: 'DE', currency: 'EUR', supported: true }));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('probe-currency')).toHaveTextContent('EUR'));
    expect(screen.getByTestId('probe-country')).toHaveTextContent('DE');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('T13 fully manual values skip re-detection on the next load entirely', async () => {
    localStorage.setItem('currency', 'USD');
    localStorage.setItem('currencySource', 'manual');
    localStorage.setItem('country', 'US');
    localStorage.setItem('countrySource', 'manual');

    renderProvider();

    await act(async () => { await Promise.resolve(); });
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe-currency')).toHaveTextContent('USD');
    expect(screen.getByTestId('probe-country')).toHaveTextContent('US');
  });
});
