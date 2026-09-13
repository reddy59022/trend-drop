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

import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, renderPageWithRoute, authUser, sampleListing } from '../../test-utils';

import Closet from '../Closet';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Closet page', () => {
  test('renders closet items with count and sort control', async () => {
    api.get.mockResolvedValue({ data: { listings: [sampleListing()], total: 1, totalPages: 1 } });
    renderPageWithRoute(<Closet />, { route: '/closet/seller1', path: '/closet/:id' });
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/users/seller1/closet'));
  });
  test('renders the empty closet state', async () => {
    api.get.mockResolvedValue({ data: { listings: [], total: 0, totalPages: 1 } });
    renderPageWithRoute(<Closet />, { route: '/closet/seller1', path: '/closet/:id' });
    expect(await screen.findByText('No items in this closet yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start Selling' })).toHaveAttribute('href', '/sell');
  });
  test('changing sort refetches the closet', async () => {
    api.get.mockResolvedValue({ data: { listings: [], total: 0, totalPages: 1 } });
    renderPageWithRoute(<Closet />, { route: '/closet/seller1', path: '/closet/:id' });
    await screen.findByText('No items in this closet yet');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'popular' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('sort=popular')));
  });
});
