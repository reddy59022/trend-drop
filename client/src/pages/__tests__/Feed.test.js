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

import Feed from '../Feed';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Feed page', () => {
  test('loads personalized feed for signed-in users and renders sort + cards', async () => {
    api.get.mockResolvedValue({ data: { listings: [sampleListing()], total: 1, totalPages: 1, currentPage: 1 } });
    renderPage(<Feed />);
    expect(screen.getByText('Your Feed')).toBeInTheDocument();
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/users/feed'));
    const sort = screen.getByRole('combobox');
    expect(sort).toHaveValue('popular');
  });
  test('changing sort refetches with the new sort param', async () => {
    api.get.mockResolvedValue({ data: { listings: [], total: 0, totalPages: 1, currentPage: 1 } });
    renderPage(<Feed />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'price_low' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('sort=price_low')));
    expect(screen.getByText('Your feed is empty')).toBeInTheDocument();
  });
  test('guest users see trending items and a sign-in nudge', async () => {
    setAuth(null);
    api.get.mockResolvedValue({ data: { listings: [], total: 0, totalPages: 1, currentPage: 1 } });
    renderPage(<Feed />);
    expect(await screen.findByText('Trending Items')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/listings?'));
  });
});
