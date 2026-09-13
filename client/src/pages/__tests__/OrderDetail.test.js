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
    // ENTERPRISE GATING: cancel is valid pre-shipment; confirm-received is
    // only valid AFTER delivery — dead actions are never shown.
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    expect(await screen.findByText(/Cancel Order/i)).toBeInTheDocument();
    expect(screen.queryByText("I've Received the Item")).not.toBeInTheDocument();
  });
  test('confirming receipt posts confirm-received only after delivery', async () => {
    api.get.mockImplementation((url) => {
      const u = String(url);
      if (u === '/orders/order123') return Promise.resolve({ data: { order: order({ status: 'delivered' }) } });
      if (u.includes('/shipping-insurance/my')) return Promise.resolve({ data: { policies: [] } });
      return Promise.resolve({ data: {} });
    });
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    fireEvent.click(await screen.findByText("I've Received the Item"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(expect.stringContaining('confirm-received'), expect.anything()));
  });
  test('loading failure toasts and redirects to /transactions', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order123', path: '/orders/:id' });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load order details'));
  });
});

describe('OrderDetail — immediate cancellation (enterprise)', () => {
  // Consolidated Enterprise order fixture — the shape returned by
  // GET /api/orders/:id for a fresh single-item checkout.
  const consolidatedOrder = (o = {}) => ({
    _id: 'order456',
    orderNumber: 'TD-123456',
    status: 'confirmed',
    currency: 'USD',
    createdAt: new Date().toISOString(),
    buyer: { _id: 'user123', name: 'Test User' },
    sellers: [{ _id: 'seller1', name: 'Seller One' }],
    items: [{
      _id: 'it1',
      transaction: { _id: 'txn789', status: 'paid' },
      listing: { _id: 'listing123', title: 'Vintage Denim Jacket', images: ['http://img'] },
      seller: { _id: 'seller1', name: 'Seller One' },
      title: 'Vintage Denim Jacket',
      price: 49.99,
      quantity: 1,
    }],
    totals: { subtotal: 49.99, shipping: 6.5, protectionFees: 2.5, total: 58.99 },
    payment: { paymentIntentId: 'pi_1', status: 'captured', totalHeld: 58.99 },
    shipments: [{ _id: 's1', items: ['txn789'], status: 'pending', shippingCost: 6.5, seller: 'seller1' }],
    ...o,
  });

  const renderConsolidated = async (fixture = consolidatedOrder()) => {
    api.get.mockImplementation((url) => {
      const u = String(url);
      if (u === '/orders/order456') return Promise.resolve({ data: { order: fixture } });
      if (u.includes('/shipping-insurance/my')) return Promise.resolve({ data: { policies: [] } });
      return Promise.resolve({ data: {} });
    });
    renderPageWithRoute(<OrderDetail />, { route: '/orders/order456', path: '/orders/:id' });
    await screen.findByText('Order Details');
    return fixture;
  };

  test('freshly-placed consolidated order (confirmed) shows Cancel Order', async () => {
    await renderConsolidated();
    expect(screen.getByRole('button', { name: /Cancel Order/i })).toBeInTheDocument();
  });

  test('shipped orders never show the Cancel button (dead action removed)', async () => {
    await renderConsolidated(consolidatedOrder({ status: 'shipped', shipments: [{ _id: 's1', items: ['txn789'], status: 'shipped', shippingCost: 6.5, seller: 'seller1' }] }));
    expect(screen.queryByRole('button', { name: /Cancel Order/i })).not.toBeInTheDocument();
    expect(screen.queryByText("I've Received the Item")).not.toBeInTheDocument();
  });

  test('refunded order shows Refund Summary instead of any action buttons', async () => {
    await renderConsolidated(consolidatedOrder({
      status: 'refunded',
      payment: { paymentIntentId: 'pi_1', status: 'refunded', totalHeld: 58.99 },
      items: [],
      shipments: [{ _id: 's1', items: [], status: 'cancelled', shippingCost: 6.5, seller: 'seller1' }],
      cancellation: { cancelledBy: 'buyer', reason: 'Changed my mind', cancelledAt: new Date().toISOString(), refundAmount: 58.99, currency: 'USD' },
    }));
    expect(screen.getByText('Refund Summary')).toBeInTheDocument();
    expect(screen.getByText('Fully Refunded')).toBeInTheDocument();
    expect(screen.getAllByText(/\$58\.99/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Cancel Order/i })).not.toBeInTheDocument();
  });

  test('cancelling posts /orders/:txnId/cancel with the reason and refreshes into the refunded state', async () => {
    let getCalls = 0;
    api.get.mockImplementation((url) => {
      const u = String(url);
      if (u === '/orders/order456') {
        getCalls += 1;
        if (getCalls > 1) {
          // After the cancel, the refreshed order is fully refunded.
          return Promise.resolve({ data: { order: consolidatedOrder({
            status: 'refunded',
            payment: { paymentIntentId: 'pi_1', status: 'refunded', totalHeld: 58.99 },
            items: [],
            shipments: [{ _id: 's1', items: [], status: 'cancelled', shippingCost: 6.5, seller: 'seller1' }],
            cancellation: { cancelledBy: 'buyer', reason: 'Changed my mind', cancelledAt: new Date().toISOString(), refundAmount: 58.99, currency: 'USD' },
          }) } });
        }
        return Promise.resolve({ data: { order: consolidatedOrder() } });
      }
      if (u.includes('/shipping-insurance/my')) return Promise.resolve({ data: { policies: [] } });
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValue({ data: { message: 'Order cancelled. Full refund...', refundAmount: 58.99, refundType: 'full' } });

    renderPageWithRoute(<OrderDetail />, { route: '/orders/order456', path: '/orders/:id' });
    fireEvent.click(await screen.findByRole('button', { name: /Cancel Order/i }));

    const input = await screen.findByPlaceholderText('e.g. Changed my mind');
    fireEvent.change(input, { target: { value: 'Ordered by mistake' } });
    const confirmButtons = screen.getAllByRole('button', { name: 'Cancel Order' });
    fireEvent.click(confirmButtons[0]);

    // Targets the FIRST item's transaction, carries the typed reason
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orders/txn789/cancel', expect.objectContaining({ reason: 'Ordered by mistake' })));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Full refund'));
    // The refreshed order re-renders as fully refunded
    expect(await screen.findByText('Refund Summary')).toBeInTheDocument();
  });

  test('cancel failure surfaces the server message and keeps the order actionable', async () => {
    await renderConsolidated();
    api.post.mockRejectedValue({ response: { data: { message: 'Cannot cancel after shipment' } } });

    fireEvent.click(screen.getByRole('button', { name: /Cancel Order/i }));
    const input = await screen.findByPlaceholderText('e.g. Changed my mind');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel Order' })[0]);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot cancel after shipment'));
    // Order still shows the Cancel Order action (still paid/confirmed)
    expect(screen.getByRole('button', { name: /Cancel Order/i })).toBeInTheDocument();
  });
});
