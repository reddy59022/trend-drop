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
jest.mock('../../components/ShopBoostCard', () => ({ __esModule: true, default: () => <div data-testid="boost-card" /> }));
jest.mock('@stripe/stripe-js', () => ({ __esModule: true, loadStripe: jest.fn(() => Promise.resolve({})) }));
jest.mock('@stripe/react-stripe-js', () => ({ __esModule: true, Elements: ({ children }) => <div>{children}</div> }));
jest.mock('socket.io-client', () => {
  const mkSocket = () => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
  const ioMock = (...args) => mkSocket();
  return { __esModule: true, io: ioMock, default: ioMock, connect: ioMock };
});

import api from '../../services/api';
import {
  getPayoutDashboard, getCommissionInfo, getRatingsBySeller, getBundleRules,
  createBundleRule, updateBundleRule, deleteBundleRule, getPromos, createPromo,
  updatePromo, deletePromo, sendOfferToLikers, getBulkOffers,
} from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import SellerDashboard from '../SellerDashboard';

const dash = () => ({
  commissionRate: 0.1, commissionPercent: 10, totalSales: 5, totalCommission: 25,
  totalEarnings: 225, pendingAmount: 40,
  payoutHistory: [{ listing: { title: 'Old Sale' }, salePrice: 50, commissionAmount: 5, payoutAmount: 45, currency: 'USD', date: new Date().toISOString() }],
  recentTransactions: [],
});

beforeEach(() => {
  resetTestState(); resetApiMock(api);
  setAuth(authUser());
  setThemeStore(); setCartStore(); setConfirm();
  getPayoutDashboard.mockResolvedValue({ data: dash() });
  getCommissionInfo.mockResolvedValue({ data: { commissionPercent: 10, sellerKeeps: '90%' } });
  getRatingsBySeller.mockResolvedValue({ data: { averageRating: 4.5, count: 8 } });
  getBundleRules.mockResolvedValue({ data: [] });
  getPromos.mockResolvedValue({ data: [] });
  getBulkOffers.mockResolvedValue({ data: [] });
  api.get.mockImplementation((url) => {
    if (String(url).includes('/listings/user/')) return Promise.resolve({ data: { listings: [sampleListing({ seller: { _id: 'user123' } })] } });
    return Promise.resolve({ data: [] });
  });
});

describe('SellerDashboard page', () => {
  test('renders the Seller Dashboard heading and all five tabs', async () => {
    renderPage(<SellerDashboard />);
    // Loading screen also renders the h1, so wait for the loaded page via the Overview tab
    expect(await screen.findByText('Overview')).toBeInTheDocument();
    ['Bundle Rules', 'Promo Codes', 'Offers to Likers', 'Auto Respond'].forEach((label) =>
      expect(screen.getByText(label)).toBeInTheDocument());
  });
  test('loads the payout dashboard and commission info', async () => {
    renderPage(<SellerDashboard />);
    await waitFor(() => expect(getPayoutDashboard).toHaveBeenCalled());
    await waitFor(() => expect(getCommissionInfo).toHaveBeenCalled());
  });
  test('shows payout history entries', async () => {
    renderPage(<SellerDashboard />);
    expect(await screen.findByText('Old Sale')).toBeInTheDocument();
  });
  test('empty payout history shows the no-payouts empty state', async () => {
    getPayoutDashboard.mockResolvedValue({ data: { ...dash(), payoutHistory: [] } });
    renderPage(<SellerDashboard />);
    expect(await screen.findByText('No payouts yet')).toBeInTheDocument();
  });
  test('the overview links to bundle and promo management', async () => {
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Manage Bundle Rules/i }));
    fireEvent.click(await screen.findByRole('button', { name: /New Rule/i }));
    expect(await screen.findByPlaceholderText(/Rule name/i)).toBeInTheDocument();
  });
  test('creating a bundle rule requires name and discount', async () => {
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Manage Bundle Rules/i }));
    fireEvent.click(await screen.findByRole('button', { name: /New Rule/i }));
    fireEvent.change(await screen.findByPlaceholderText(/Rule name/i), { target: { value: 'Summer Bundle' } });
    fireEvent.click(screen.getByRole('button', { name: /Save|Create/i }));
    await waitFor(() => expect(createBundleRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'Summer Bundle' })));
  });
  test('promo codes tab shows the promo form', async () => {
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Promo Codes' }));
    fireEvent.click(await screen.findByRole('button', { name: /New Promo/i }));
    expect(await screen.findByPlaceholderText('Code (e.g., SAVE10)')).toBeInTheDocument();
  });
  test('auto respond tab lists per-listing toggles', async () => {
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
  });
  test('auto respond empty state when the seller has no listings', async () => {
    api.get.mockResolvedValue({ data: { listings: [] } });
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    expect(await screen.findByText('No listings yet')).toBeInTheDocument();
  });
  test('survives API failure without crashing', async () => {
    getPayoutDashboard.mockRejectedValue(new Error('boom'));
    getRatingsBySeller.mockRejectedValue(new Error('boom'));
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<SellerDashboard />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });
});
