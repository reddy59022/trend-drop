/**
 * Navbar top-right country + currency selectors — IP auto-selection UI proof.
 *
 * The top-right controls must display the auto-detected country and currency
 * (from the server IP geo resolution) with the active option marked, and a
 * manual change must flow through the context (and persist there).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../context/ThemeContext', () => ({
  __esModule: true,
  useTheme: () => globalThis.__tdThemeMock,
}));

jest.mock('../../context/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ user: null, logout: jest.fn() }),
}));

jest.mock('../../context/CartContext', () => ({
  __esModule: true,
  useCart: () => ({ cart: [] }),
}));

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

import api from '../../services/api';
import Navbar from '../Navbar';

const baseTheme = (overrides = {}) => ({
  theme: 'light',
  toggleTheme: jest.fn(),
  language: 'en',
  changeLanguage: jest.fn(),
  currency: 'GBP',
  currencySource: 'auto',
  country: 'GB',
  changeCurrency: jest.fn(),
  changeCountry: jest.fn(),
  ...overrides,
});

const renderNavbar = (theme) => {
  globalThis.__tdThemeMock = baseTheme(theme);
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>
  );
};

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({
    data: [
      { code: 'US', name: 'United States', currency: 'USD', flag: '🇺🇸' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP', flag: '🇬🇧' },
      { code: 'DE', name: 'Germany', currency: 'EUR', flag: '🇩🇪' },
    ],
  });
});

afterEach(() => {
  delete globalThis.__tdThemeMock;
});

describe('Navbar top-right — auto-selected country + currency (IP geo)', () => {
  test('N1 displays the auto-detected country and currency in the top-right controls', async () => {
    renderNavbar();
    await waitFor(() => expect(screen.getByLabelText('Select country')).toHaveTextContent('GB'));
    expect(screen.getByLabelText('Select currency')).toHaveTextContent('GBP');
  });

  test('N2 currency dropdown marks the auto-selected currency as active with a check mark', async () => {
    renderNavbar();
    fireEvent.click(screen.getByLabelText('Select currency'));
    const dropdown = await screen.findByText('Select Currency');
    expect(dropdown).toBeInTheDocument();
    const active = screen.getByText('GBP', { selector: '.currency-code' }).closest('button');
    expect(active).toHaveClass('active');
    expect(active.textContent).toContain('✓');
  });

  test('N3 country dropdown marks the auto-detected country as active with a check mark', async () => {
    renderNavbar();
    fireEvent.click(screen.getByLabelText('Select country'));
    const dropdown = await screen.findByText('Select Country');
    expect(dropdown).toBeInTheDocument();
    const active = screen.getByText('GB', { selector: '.country-code' }).closest('button');
    expect(active).toHaveClass('active');
    expect(active.textContent).toContain('✓');
  });

  test('N4 picking another currency calls changeCurrency and closes the dropdown', async () => {
    const theme = renderNavbar();
    fireEvent.click(screen.getByLabelText('Select currency'));
    await screen.findByText('Select Currency');
    fireEvent.click(screen.getByText('EUR', { selector: '.currency-code' }));
    expect(globalThis.__tdThemeMock.changeCurrency).toHaveBeenCalledWith('EUR');
    expect(screen.queryByText('Select Currency')).not.toBeInTheDocument();
  });

  test('N5 picking another country calls changeCountry AND switches to its currency', async () => {
    renderNavbar();
    fireEvent.click(screen.getByLabelText('Select country'));
    await screen.findByText('Select Country');
    fireEvent.click(screen.getByText('US', { selector: '.country-code' }));
    expect(globalThis.__tdThemeMock.changeCountry).toHaveBeenCalledWith('US');
    expect(globalThis.__tdThemeMock.changeCurrency).toHaveBeenCalledWith('USD');
  });

  test('N6 an auto-selected currency outside the popular list still appears and is active', async () => {
    renderNavbar({ currency: 'SEK' });
    fireEvent.click(screen.getByLabelText('Select currency'));
    await screen.findByText('Select Currency');
    const active = screen.getByText('SEK', { selector: '.currency-code' }).closest('button');
    expect(active).toHaveClass('active');
    expect(active.textContent).toContain('✓');
  });

  test('N7 countries list API failure: dropdown still opens with the detected country present', async () => {
    api.get.mockRejectedValue(new Error('countries endpoint down'));
    renderNavbar();
    fireEvent.click(screen.getByLabelText('Select country'));
    const active = await screen.findByText('GB', { selector: '.country-code' });
    expect(active.closest('button')).toHaveClass('active');
  });

  test('N8 unknown country (detection failed): country control renders a neutral placeholder', async () => {
    renderNavbar({ country: null });
    await waitFor(() => expect(screen.getByLabelText('Select country')).toHaveTextContent('—'));
    expect(screen.getByLabelText('Select currency')).toHaveTextContent('USD');
  });
});
