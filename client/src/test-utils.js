/**
 * Shared helpers for client-side tests.
 *
 * Every page/component test uses the same pattern:
 *   jest.mock('../../services/api');                       // manual mock above
 *   jest.mock('../../context/AuthContext', () => ({ ... useAuth: () => globalThis.__tdAuth ... }));
 *   ...then setAuth(userFixture) / setTheme() / setCart() in beforeEach...
 * This file centralises the fixtures + global stores so tests stay small.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export const authUser = (overrides = {}) => ({
  _id: 'user123',
  id: 'user123',
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  avatar: '',
  ...overrides,
});

export const adminUser = (overrides = {}) =>
  authUser({ name: 'Admin User', email: 'admin@example.com', role: 'admin', ...overrides });

export const sampleListing = (overrides = {}) => ({
  _id: 'listing123',
  title: 'Vintage Denim Jacket',
  price: 49.99,
  currency: 'USD',
  originalPrice: 79.99,
  condition: 'Good',
  brand: "Levi's",
  size: 'M',
  images: ['https://example.com/img.jpg'],
  likes: [],
  seller: { _id: 'seller1', name: 'Seller One', avatar: '', verified: true },
  available_quantity: 5,
  sold: false,
  boosted: false,
  ...overrides,
});

export const setAuth = (user) => {
  globalThis.__tdAuth = {
    user: user || null,
    loading: false,
    token: user ? 'test-token' : null,
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    updateProfile: jest.fn(),
    updateAvatar: jest.fn(),
    loginWithGoogle: jest.fn(),
    loginWithApple: jest.fn(),
    loginWithFacebook: jest.fn(),
    registerPushToken: jest.fn(),
  };
  return globalThis.__tdAuth;
};

export const setThemeStore = (overrides = {}) => {
  globalThis.__tdTheme = {
    theme: 'light',
    toggleTheme: jest.fn(),
    language: 'en',
    changeLanguage: jest.fn(),
    currency: 'USD',
    currencySource: 'auto',
    country: 'US',
    countrySource: 'auto',
    dir: 'ltr',
    changeCurrency: jest.fn(),
    changeCountry: jest.fn(),
    ...overrides,
  };
  return globalThis.__tdTheme;
};

export const setCartStore = (overrides = {}) => {
  globalThis.__tdCart = {
    cart: [],
    addToCart: jest.fn(),
    removeFromCart: jest.fn(),
    updateQuantity: jest.fn(),
    clearCart: jest.fn(),
    synced: true,
    ...overrides,
  };
  return globalThis.__tdCart;
};

export const setConfirm = (impl) => {
  globalThis.__tdConfirm = impl || (async () => true);
  return globalThis.__tdConfirm;
};

export const resetTestState = () => {
  delete globalThis.__tdAuth;
  delete globalThis.__tdTheme;
  delete globalThis.__tdCart;
  delete globalThis.__tdConfirm;
  delete globalThis.__tdSocket;
};

// Reset every jest.fn on the services/api manual mock (default + named).
export const resetApiMock = (apiModule) => {
  if (!apiModule) return;
  const seen = new Set();
  const wipe = (obj) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    Object.keys(obj).forEach((key) => {
      const fn = obj[key];
      if (fn && typeof fn.mockReset === 'function') fn.mockReset();
    });
  };
  wipe(apiModule);
  wipe(apiModule.default);
};

// Render any UI inside a MemoryRouter at the given route.
export const renderPage = (ui, { route = '/' } = {}) =>
  render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);

// Render a page that reads useParams() (e.g. /listing/:id) with a matching
// <Route path> so the params actually resolve. Without this, useParams()
// returns {} and the page fetches `/listings/undefined`.
// eslint-disable-next-line no-unused-vars
import { Routes as _Routes, Route as _Route } from 'react-router-dom';
export const renderPageWithRoute = (ui, { route = '/', path = '/' } = {}) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <_Routes>
        <_Route path={path} element={ui} />
      </_Routes>
    </MemoryRouter>
  );
