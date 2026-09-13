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
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import Search from '../Search';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(null); setThemeStore(); setCartStore(); setConfirm(); });

const primeSearch = () => {
  api.get.mockImplementation((url) => {
    if (String(url).includes('/listings')) return Promise.resolve({ data: { listings: [sampleListing()], pagination: { total: 1 } } });
    return Promise.resolve({ data: [] });
  });
  api.getSearchBrands.mockResolvedValue({ data: ['Nike', 'Adidas'] });
  api.getSearchColors.mockResolvedValue({ data: ['Red'] });
  api.getSearchSizes.mockResolvedValue({ data: [{ size: 'M' }] });
};

describe('Search page', () => {
  test('renders results, sort control and filter toggle', async () => {
    primeSearch();
    renderPage(<Search />, { route: '/search?q=jacket' });
    expect(await screen.findByText(/Results for/)).toBeInTheDocument();
    expect(screen.getByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Filters/ })[0]).toBeInTheDocument();
  });
  test('changing sort triggers a refetch with the new sort value', async () => {
    primeSearch();
    renderPage(<Search />);
    await screen.findByText('Vintage Denim Jacket');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'price_low' } });
    await waitFor(() => {
      const calls = api.get.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('sort=price_low'))).toBe(true);
    });
  });
  test('clear-all resets active filter chips', async () => {
    primeSearch();
    renderPage(<Search />, { route: '/search?category=Women' });
    await screen.findByText('Vintage Denim Jacket');
    expect(screen.getAllByRole('button', { name: /Filters/ })[0]).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Clear All/ })[0]);
    await waitFor(() => {
      const calls = api.get.mock.calls.map((c) => String(c[0]));
      expect(calls[calls.length - 1]).not.toContain('category=Women');
    });
  });
});
