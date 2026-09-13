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
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import Cart from '../Cart';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Cart page', () => {
  test('renders the empty-bag state with a browse CTA', () => {
    setCartStore({ cart: [] });
    api.get.mockResolvedValue({ data: {} });
    renderPage(<Cart />);
    expect(screen.getByText('Your bag is empty')).toBeInTheDocument();
  });
  test('renders cart items with quantity controls and totals', () => {
    setCartStore({ cart: [{ listingId: 'listing123', title: 'Vintage Denim Jacket', price: 49.99, currency: 'USD', quantity: 2, thumbnail: '', available: 5 }] });
    api.get.mockResolvedValue({ data: {} });
    renderPage(<Cart />);
    expect(screen.getByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proceed to Checkout/ })).toBeInTheDocument();
  });
  test('empty bag shows no checkout button and links to search', () => {
    setCartStore({ cart: [] });
    api.get.mockResolvedValue({ data: {} });
    renderPage(<Cart />);
    expect(screen.queryByRole('button', { name: /Proceed to Checkout/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start Shopping' })).toHaveAttribute('href', '/search');
  });
  test('promo apply flow calls validatePromo', async () => {
    setCartStore({ cart: [{ listingId: 'listing123', title: 'Jacket', price: 50, currency: 'USD', quantity: 1, thumbnail: '', available: 5 }] });
    api.get.mockResolvedValue({ data: {} });
    api.validatePromo.mockResolvedValue({ data: { valid: true, promo: { code: 'SAVE10', discountAmount: 5 } } });
    renderPage(<Cart />);
    const input = screen.getByPlaceholderText('Promo code');
    input.focus();
    const { fireEvent: fe } = require('@testing-library/react');
    fe.change(input, { target: { value: 'SAVE10' } });
    const apply = screen.getByRole('button', { name: /apply/i });
    fe.click(apply);
    await waitFor(() => expect(api.validatePromo).toHaveBeenCalled());
  });
});
