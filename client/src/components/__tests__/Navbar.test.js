/**
 * Navbar top-right preferences — IP auto-selection UI proof.
 *
 * The top-right must show the auto-detected country and currency (from the
 * server IP geo resolution) in ONE consolidated preferences control (audit
 * item: five utility targets competing with search), and manual changes must
 * flow through the context (and persist there). Country, currency, language
 * and theme live in a single panel so a visitor adjusts every locale pref
 * from one place instead of hunting across four tiny buttons.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { routerFuture } from '../../test-utils';

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
    <MemoryRouter future={routerFuture}>
      <Navbar />
    </MemoryRouter>
  );
};

const openPrefs = async () => {
  fireEvent.click(screen.getByLabelText('Region & language preferences'));
  await screen.findByText('Region & preferences');
};

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({
    data: [
      { code: 'US', name: 'United States', currency: 'USD', flag: '🇺🇸' },
      { code: 'GB', name: 'United Kingdom', currency: 'GBP', flag: '🇬🇧' },
      { code: 'DE', name: 'Germany', currency: 'EUR', flag: '🇪🇺' },
    ],
  });
});

afterEach(() => {
  delete globalThis.__tdThemeMock;
});

describe('Navbar top-right — auto-selected country + currency (IP geo)', () => {
  test('N1 displays the auto-detected country and currency in the top-right control', async () => {
    renderNavbar();
    await waitFor(() => expect(screen.getByLabelText('Region & language preferences')).toHaveTextContent('GB'));
    expect(screen.getByLabelText('Region & language preferences')).toHaveTextContent('GBP');
  });

  test('N2 the preferences panel shows the auto-selected currency as the active choice', async () => {
    renderNavbar();
    await openPrefs();
    expect(screen.getByLabelText('Select currency')).toHaveValue('GBP');
  });

  test('N3 the preferences panel shows the auto-detected country as the active choice', async () => {
    renderNavbar();
    await openPrefs();
    expect(screen.getByLabelText('Select country')).toHaveValue('GB');
  });

  test('N4 picking another currency calls changeCurrency', async () => {
    renderNavbar();
    await openPrefs();
    fireEvent.change(screen.getByLabelText('Select currency'), { target: { value: 'EUR' } });
    expect(globalThis.__tdThemeMock.changeCurrency).toHaveBeenCalledWith('EUR');
  });

  test('N5 picking another country calls changeCountry AND switches to its currency', async () => {
    renderNavbar();
    await openPrefs();
    fireEvent.change(screen.getByLabelText('Select country'), { target: { value: 'US' } });
    expect(globalThis.__tdThemeMock.changeCountry).toHaveBeenCalledWith('US');
    expect(globalThis.__tdThemeMock.changeCurrency).toHaveBeenCalledWith('USD');
  });

  test('N6 an auto-selected currency outside the popular list still appears and is active', async () => {
    renderNavbar({ currency: 'SEK' });
    await openPrefs();
    const select = screen.getByLabelText('Select currency');
    expect(select).toHaveValue('SEK');
    expect(Array.from(select.options).some((o) => o.value === 'SEK')).toBe(true);
  });

  test('N7 countries list API failure: panel still opens with the detected country present', async () => {
    api.get.mockRejectedValue(new Error('countries endpoint down'));
    renderNavbar();
    await openPrefs();
    const select = screen.getByLabelText('Select country');
    expect(Array.from(select.options).some((o) => o.value === 'GB')).toBe(true);
  });

  test('N8 unknown country (detection failed): the control renders a neutral placeholder', async () => {
    // ThemeContext falls back to USD exactly when the country is undetected
    // (savedPrefs.currency || 'USD'), so this models the real failed state.
    renderNavbar({ country: null, currency: 'USD' });
    await waitFor(() => expect(screen.getByLabelText('Region & language preferences')).toHaveTextContent('—'));
    expect(screen.getByLabelText('Region & language preferences')).toHaveTextContent('USD');
  });
});

describe('Navbar preferences panel — one place for every locale control', () => {
  test('C1 there are no separate country/currency/language trigger buttons — one control only', async () => {
    renderNavbar();
    // The old design shipped four competing utility buttons next to the
    // account menu. The consolidated design has exactly one preferences
    // trigger; the "Select …" labels belong to the fields inside the panel.
    expect(screen.queryAllByRole('button', { name: /select (country|currency|language)/i })).toHaveLength(0);
    expect(screen.getAllByLabelText('Region & language preferences')).toHaveLength(1);
  });

  test('C2 one click reveals country, currency, language and theme in a single panel', async () => {
    renderNavbar();
    await openPrefs();
    expect(screen.getByLabelText('Select country')).toBeInTheDocument();
    expect(screen.getByLabelText('Select currency')).toBeInTheDocument();
    expect(screen.getByLabelText('Select language')).toBeInTheDocument();
    expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
  });

  test('C3 the panel is keyboard-dismissable and the language select flows through', async () => {
    renderNavbar();
    await openPrefs();
    fireEvent.change(screen.getByLabelText('Select language'), { target: { value: 'fr' } });
    expect(globalThis.__tdThemeMock.changeLanguage).toHaveBeenCalledWith('fr');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Region & preferences')).not.toBeInTheDocument());
  });

  test('C4 the theme toggle inside the panel calls toggleTheme', async () => {
    renderNavbar();
    await openPrefs();
    fireEvent.click(screen.getByLabelText('Toggle theme'));
    expect(globalThis.__tdThemeMock.toggleTheme).toHaveBeenCalled();
  });
});

describe('Navbar Shop mega-menu — category navigation', () => {
  test('N9 opens with every category linking to a filtered search', async () => {
    renderNavbar();
    fireEvent.click(screen.getByLabelText('Shop categories'));

    expect(await screen.findByText('Shop by category')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Women/ })).toHaveAttribute('href', '/search?category=Women');
    expect(screen.getByRole('menuitem', { name: /Clothing/ })).toHaveAttribute('href', '/search?category=Clothing');
    expect(screen.getByRole('menuitem', { name: /Browse everything/ })).toHaveAttribute('href', '/search');
    // 8 categories + "Browse everything"
    expect(screen.getAllByRole('menuitem')).toHaveLength(9);
  });

  test('N10 choosing a category closes the menu', async () => {
    renderNavbar();
    fireEvent.click(screen.getByLabelText('Shop categories'));
    await screen.findByText('Shop by category');

    fireEvent.click(screen.getByRole('menuitem', { name: /Kids/ }));
    expect(screen.queryByText('Shop by category')).not.toBeInTheDocument();
  });
});
