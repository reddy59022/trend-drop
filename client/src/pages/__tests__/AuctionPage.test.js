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
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import AuctionPage from '../AuctionPage';

const auction = (o = {}) => ({
  _id: 'a1',
  listing: sampleListing(),
  seller: { _id: 'someone-else', name: 'Other Seller' },
  currentBid: 60,
  startingPrice: 50,
  status: 'active',
  bids: [{ _id: 'b1', amount: 60 }],
  endTime: new Date(Date.now() + 864e5).toISOString(),
  ...o,
});

beforeEach(() => {
  resetTestState(); resetApiMock(api);
  setAuth(authUser());
  setThemeStore(); setCartStore(); setConfirm();
  api.get.mockResolvedValue({ data: { auctions: [auction()] } });
  api.post.mockResolvedValue({ data: { auction: auction({ currentBid: 65 }) } });
});

describe('AuctionPage', () => {
  test('renders the auctions heading with Live/Upcoming/Ended tabs', async () => {
    renderPage(<AuctionPage />);
    expect(await screen.findByText('Auctions')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Ended')).toBeInTheDocument();
  });
  test('fetches auctions with the active tab status', async () => {
    renderPage(<AuctionPage />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auctions', { params: { status: 'active' } }));
  });
  test('renders auction cards with the listing title and bid info', async () => {
    renderPage(<AuctionPage />);
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText('Current Bid:')).toBeInTheDocument();
  });
  test('switching to the Ended tab refetches with closed status', async () => {
    renderPage(<AuctionPage />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Ended'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auctions', { params: { status: 'closed' } }));
  });
  test('shows the empty state when there are no auctions', async () => {
    api.get.mockResolvedValue({ data: { auctions: [] } });
    renderPage(<AuctionPage />);
    expect(await screen.findByText(/no.*auction/i)).toBeInTheDocument();
  });
  test('bidding on an auction posts the parsed amount', async () => {
    renderPage(<AuctionPage />);
    const input = await screen.findByPlaceholderText(/Min: \$61/);
    fireEvent.change(input, { target: { value: '65.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Place Bid/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auctions/a1/bids', { amount: 65.5 }));
  });
  test('seller auction section renders when the user owns an auction', async () => {
    api.get.mockResolvedValue({ data: { auctions: [auction({ seller: { _id: 'user123' } })] } });
    renderPage(<AuctionPage />);
    expect(await screen.findByText('My Auctions')).toBeInTheDocument();
    expect(screen.getByText('Your Auction')).toBeInTheDocument();
  });
  test('survives API failure without crashing', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<AuctionPage />);
    expect(await screen.findByText('Auctions')).toBeInTheDocument();
  });
});
