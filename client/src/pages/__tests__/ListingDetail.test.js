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

import ListingDetail from '../ListingDetail';

const listing = (overrides = {}) => ({
  _id: 'listing123', title: 'Vintage Denim Jacket', price: 49.99, currency: 'USD',
  condition: 'Good', brand: "Levi's", size: 'M', images: ['https://example.com/img.jpg'],
  likes: [], seller: { _id: 'seller1', name: 'Seller One', avatar: '', verified: true },
  available_quantity: 5, quantity: 5, sold: false,
  ...overrides,
});

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

const prime = (l = listing()) => {
  api.checkInWishlist.mockResolvedValue({ data: { inWishlist: false } });
  // The summary fetches an authoritative shipping quote on load; individual
  // tests override this when they assert a specific estimate.
  api.post.mockResolvedValue({ data: { cost: 0 } });
  api.get.mockImplementation((url) => {
    if (String(url).startsWith('/listings/')) return Promise.resolve({ data: { listing: l } });
    if (String(url).startsWith('/comments/')) return Promise.resolve({ data: [] });
    if (String(url).startsWith('/pricehistory/')) return Promise.resolve({ data: [] });
    if (String(url).startsWith('/offers/sent')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
};

describe('ListingDetail page', () => {
  test('renders the listing title, price and seller', async () => {
    prime();
    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText('Seller One')).toBeInTheDocument();
  });
  test('like button calls the like endpoint', async () => {
    prime();
    api.post.mockResolvedValue({ data: { liked: true, likes: ['user123'] } });
    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    await screen.findByText('Vintage Denim Jacket');
    const like = screen.getByRole('button', { name: /like/i });
    like.click();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/listings/listing123/like'));
  });
  test('sold listings show the sold state and no purchase CTA', async () => {
    prime(listing({ sold: true, available_quantity: 0 }));
    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    expect(await screen.findByText('Vintage Denim Jacket', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText('This item has been sold')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to Bag/ })).not.toBeInTheDocument();
  }, 10000);
  test('missing listing navigates home after the error', async () => {
    api.get.mockRejectedValue({ response: { status: 404 } });
    renderPageWithRoute(<ListingDetail />, { route: '/listing/missing', path: '/listing/:id' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/listings/missing'));
  });

  // "Get Estimate" posted { from, to, weight, dimensions } while
  // POST /api/shipping/calculate reads { fromCountry, toCountry, weightKg,
  // itemPrice } and 400s when fromCountry/toCountry are missing. The button
  // therefore ALWAYS failed (the user only ever saw "Could not calculate
  // shipping") and never rendered an estimate. Pin the wire contract here so a
  // rename on either side fails loudly instead of silently killing the feature.
  test('shipping estimate sends the server contract field names', async () => {
    prime(listing({ shipsFrom: 'US', weight: 2 }));
    api.post.mockResolvedValue({ data: { cost: 7.5 } });
    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    await screen.findByText('Vintage Denim Jacket');

    fireEvent.click(screen.getByRole('button', { name: /Get Estimate/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/shipping/calculate',
      expect.objectContaining({ fromCountry: 'US', toCountry: 'US', weightKg: 2 })
    ));
  });

  test('shipping estimate sends the item price so free-shipping rules apply', async () => {
    prime(listing({ price: 49.99 }));
    api.post.mockResolvedValue({ data: { cost: 0, freeShipping: true } });
    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    await screen.findByText('Vintage Denim Jacket');

    fireEvent.click(screen.getByRole('button', { name: /Get Estimate/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/shipping/calculate',
      expect.objectContaining({ itemPrice: 49.99 })
    ));
  });

  test('a successful estimate is rendered with the server cost', async () => {
    prime();
    api.post.mockResolvedValue({ data: { cost: 7.5 } });
    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    await screen.findByText('Vintage Denim Jacket');

    fireEvent.click(screen.getByRole('button', { name: /Get Estimate/i }));

    expect(await screen.findByText('Estimated Shipping')).toBeInTheDocument();
    expect(screen.getAllByText('$7.50').length).toBeGreaterThan(0);
  });

  test('owner earnings show the server postage deduction and reconciled net', async () => {
    setAuth(authUser({ _id: 'seller1', id: 'seller1' }));
    prime(listing({
      price: 48,
      quantity: 2,
      weight: 0.5,
      shipping: { freeShipping: false, shippingCost: 7.24 },
    }));
    api.post.mockImplementation((url) => {
      if (url === '/shipping/seller-estimate') {
        return Promise.resolve({
          data: {
            listingId: 'listing123', quantity: 1, currency: 'USD',
            seller: {
              itemSubtotal: 48, platformFee: 3.84, platformFeePercent: 8,
              boostFee: 0, sellerEarningsBeforePostage: 44.16,
              sellerPostageSubsidy: 2.08, sellerEarnings: 42.08,
            },
            postage: { labelCost: 7.03, buyerShipping: 4.95, sellerSubsidy: 2.08, estimated: true },
          },
        });
      }
      return Promise.resolve({ data: { cost: 4.95 } });
    });

    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    await screen.findByText('Vintage Denim Jacket');

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/shipping/seller-estimate',
      { listingId: 'listing123', toCountry: 'US', quantity: 1 },
    ));
    expect(await screen.findByText('Postage (seller-paid)')).toBeInTheDocument();
    expect(screen.getByText('-$3.84')).toBeInTheDocument();
    expect(screen.getByText('-$2.08')).toBeInTheDocument();
    expect(screen.getByText('$42.08')).toBeInTheDocument();
    expect(screen.getByText(/Carrier label \$7\.03/)).toBeInTheDocument();
  });

  test('owner earnings re-estimate by quantity and destination', async () => {
    setAuth(authUser({ _id: 'seller1', id: 'seller1' }));
    prime(listing({ price: 48, quantity: 5, weight: 0.5 }));
    const sellerCalls = [];
    api.post.mockImplementation((url, body) => {
      if (url === '/shipping/seller-estimate') {
        sellerCalls.push(body);
        return Promise.resolve({
          data: {
            listingId: 'listing123', quantity: body.quantity, currency: 'USD',
            seller: {
              itemSubtotal: 48 * body.quantity, platformFee: 3.84 * body.quantity,
              platformFeePercent: 8, boostFee: 0,
              sellerEarningsBeforePostage: 44.16 * body.quantity,
              sellerPostageSubsidy: 2, sellerEarnings: 42 * body.quantity,
            },
            postage: { labelCost: 7.03, buyerShipping: 4.95, sellerSubsidy: 2, estimated: true },
          },
        });
      }
      return Promise.resolve({ data: { cost: 4.95 } });
    });

    renderPageWithRoute(<ListingDetail />, { route: '/listing/listing123', path: '/listing/:id' });
    await screen.findByText('Vintage Denim Jacket');
    await waitFor(() => expect(sellerCalls).toContainEqual(
      { listingId: 'listing123', toCountry: 'US', quantity: 1 },
    ));

    fireEvent.change(screen.getByLabelText('Earnings estimate quantity'), { target: { value: '2' } });
    await waitFor(() => expect(sellerCalls).toContainEqual(
      { listingId: 'listing123', toCountry: 'US', quantity: 2 },
    ));

    fireEvent.change(screen.getByLabelText('Destination country'), { target: { value: 'CA' } });
    await waitFor(() => expect(sellerCalls).toContainEqual(
      { listingId: 'listing123', toCountry: 'CA', quantity: 2 },
    ));
  });
});
