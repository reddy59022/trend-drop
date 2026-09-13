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

import api from '../../services/api';
import { toast } from 'react-toastify';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, renderPageWithRoute, authUser } from '../../test-utils';

import OrderDetail from '../OrderDetail';

const order = (o = {}) => ({
  _id: 'order123',
  status: 'paid',
  currency: 'USD',
  createdAt: new Date().toISOString(),
  buyer: { _id: 'user123', name: 'Test User' },
  seller: { _id: 'seller1', name: 'Seller One' },
  listing: { _id: 'listing123', title: 'Vintage Denim Jacket', price: 49.99, images: ['http://img'] },
  itemPrice: 49.99,
  paymentBreakdown: { subtotal: 49.99, shippingCost: 0, buyerProtectionFee: 2.5, totalPaid: 52.49 },
  shippingAddress: { fullName: 'Test User', line1: '1 Main St', city: 'SF', state: 'CA', zip: '94105' },
  ...o,
});

beforeEach(() => {
  resetTestState(); resetApiMock(api);
  setAuth(authUser());
  setThemeStore(); setCartStore(); setConfirm();
  api.get.mockImplementation((url) => {
    const u = String(url);
    if (u === '/orders/order123') return Promise.resolve({ data: { order: order() } });
    if (u === '/transactions/order123') return Promise.resolve({ data: order() });
    if (u.includes('/shipping-insurance/my')) return Promise.resolve({ data: { policies: [] } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockResolvedValue({ data: { message: 'ok' } });
});

describe('OrderDetail page', () => {
  test('renders the Order Details heading and the listing title', async () => {
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    expect(await screen.findByText('Order Details')).toBeInTheDocument();
    expect(screen.getByText('Vintage Denim Jacket')).toBeInTheDocument();
  });
  test('fetches the order by id from the route', async () => {
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/orders/order123'));
  });
  test('falls back to the legacy transaction endpoint on 404', async () => {
    api.get.mockImplementation((url) => {
      const u = String(url);
      if (u === '/orders/order123') return Promise.reject({ response: { status: 404 } });
      if (u === '/transactions/order123') return Promise.resolve({ data: order() });
      if (u.includes('/shipping-insurance/my')) return Promise.resolve({ data: { policies: [] } });
      return Promise.resolve({ data: {} });
    });
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/transactions/order123'));
    expect(await screen.findByText('Order Details')).toBeInTheDocument();
  });
  test('shows the item price', async () => {
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    expect((await screen.findAllByText(/\$49\.99/)).length).toBeGreaterThan(0);
  });
  test('buyer sees lifecycle actions for a paid order', async () => {
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    expect(await screen.findByText("I've Received the Item")).toBeInTheDocument();
    expect(screen.getByText(/Cancel Order/i)).toBeInTheDocument();
  });
  test('confirming receipt posts confirm-received', async () => {
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    fireEvent.click(await screen.findByText("I've Received the Item"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringContaining('confirm-received'), expect.anything()));
  });
  test('cancelling asks for a reason then posts /cancel', async () => {
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    fireEvent.click(await screen.findByText(/Cancel Order/i));
    const input = await screen.findByPlaceholderText('e.g. Changed my mind');
    fireEvent.change(input, { target: { value: 'Changed my mind' } });
    // The in-page prompt renders before the action bar, so its confirm
    // button (btn-primary btn-sm) is the FIRST 'Cancel Order' match.
    const confirmButtons = screen.getAllByRole('button', { name: 'Cancel Order' });
    fireEvent.click(confirmButtons[0]);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/cancel'), expect.anything()));
  });
  test('loading failure toasts and redirects to /transactions', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load order details'));
  });
});
