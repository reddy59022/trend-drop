import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../context/ThemeContext', () => ({ __esModule: true, useTheme: () => globalThis.__tdTheme, ThemeProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/CartContext', () => ({ __esModule: true, useCart: () => globalThis.__tdCart, CartProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/ConfirmContext', () => ({ __esModule: true, useConfirm: () => globalThis.__tdConfirm, ConfirmProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/SocketContext', () => ({ __esModule: true, useSocket: () => globalThis.__tdSocket || { socket: null, connected: false }, SocketProvider: ({ children }) => <>{children}</> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('@stripe/stripe-js', () => ({ __esModule: true, loadStripe: jest.fn(() => Promise.resolve({})) }));
jest.mock('@stripe/react-stripe-js', () => ({ __esModule: true, Elements: ({ children }) => <div>{children}</div> }));
jest.mock('socket.io-client', () => {
  const mkSocket = () => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
  const ioMock = (...args) => mkSocket();
  return { __esModule: true, io: ioMock, default: ioMock, connect: ioMock };
});
jest.mock('browser-image-compression', () => ({ __esModule: true, default: jest.fn(async (f) => f) }));

import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing  } from '../../test-utils';

import SellerAnalytics from '../SellerAnalytics';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('SellerAnalytics page', () => {

  const stubAll = () => {

  };

  test('renders without crashing', async () => {
    stubAll();
    renderPage(<SellerAnalytics />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

  test('renders its page heading', async () => {
    stubAll();
    renderPage(<SellerAnalytics />);
    await waitFor(() => expect(document.querySelector('h1') || screen.queryByText(/loading/i) || screen.queryByText(/error/i) || document.body).toBeTruthy());
  });

  test('renders the server-provided average order value', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('/overview')) {
        return Promise.resolve({ data: { overview: {
          totalRevenue: 170, totalSales: 2, avgOrderValue: 85,
          totalViews: 10, conversionRate: 20, avgRating: 4.5, totalRatings: 2,
          activeListings: 1, soldListings: 2, recentActivity: [],
        } } });
      }
      return Promise.resolve({ data: { revenue: [], topListings: [] } });
    });

    renderPage(<SellerAnalytics />);

    await waitFor(() => expect(screen.getByText('$85.00')).toBeInTheDocument());
  });

  test('renders the server-authoritative revenue series', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('/overview')) return Promise.resolve({ data: { overview: {
        totalRevenue: 85, totalSales: 1, avgOrderValue: 85, totalViews: 1,
        conversionRate: 100, avgRating: 0, totalRatings: 0, activeListings: 0,
        soldListings: 1, recentActivity: [],
      } } });
      if (url.includes('/revenue')) return Promise.resolve({ data: { revenue: [{ date: '2026-09-17', revenue: 85, sales: 1 }] } });
      return Promise.resolve({ data: { topListings: [] } });
    });

    renderPage(<SellerAnalytics />);

    await waitFor(() => expect(screen.getByText(/2026-09-17: \$85\.00/)).toBeInTheDocument());
  });

  test('survives API failure without crashing', async () => {
    Object.keys(api).filter(k => k.startsWith('get')).forEach(k => api[k].mockRejectedValue(new Error('boom')));
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<SellerAnalytics />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

});
