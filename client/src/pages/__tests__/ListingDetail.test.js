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
});
