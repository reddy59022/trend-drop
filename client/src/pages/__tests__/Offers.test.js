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

import Offers from '../Offers';

const offer = (overrides = {}) => ({
  _id: 'offer1',
  amount: 40,
  currency: 'USD',
  status: 'pending',
  updatedAt: new Date().toISOString(),
  listing: { _id: 'listing123', title: 'Vintage Denim Jacket', images: [] },
  buyer: { name: 'Buyer Bob' },
  seller: { name: 'Seller Sue' },
  ...overrides,
});

beforeEach(() => {
  resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm();
  localStorage.setItem('token', 't');
  api.get.mockImplementation((url) => {
    if (String(url).includes('/received')) return Promise.resolve({ data: [offer()] });
    if (String(url).includes('/sent')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

afterEach(() => localStorage.removeItem('token'));

describe('Offers page', () => {
  test('renders received offers with amount and pending status', async () => {
    renderPage(<Offers />);
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText(/Pending/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/offers/received');
    expect(api.get).toHaveBeenCalledWith('/offers/sent');
  });
  test('guest users are asked to sign in', () => {
    setAuth(null);
    renderPage(<Offers />);
    expect(screen.getByText('Sign in to manage your offers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
  });
  test('accepting an offer calls the accept endpoint', async () => {
    api.patch.mockResolvedValue({ data: {} });
    renderPage(<Offers />);
    const accept = await screen.findByRole('button', { name: /accept/i });
    fireEvent.click(accept);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/offers/offer1/accept'));
  });
  test('tabs switch between received and sent offers', async () => {
    api.get.mockImplementation((url) => {
      if (String(url).includes('/received')) return Promise.resolve({ data: [] });
      if (String(url).includes('/sent')) return Promise.resolve({ data: [offer({ _id: 'sent1' })] });
      return Promise.resolve({ data: [] });
    });
    renderPage(<Offers />);
    fireEvent.click(await screen.findByRole('button', { name: /Sent \(1\)/ }));
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
  });
});
