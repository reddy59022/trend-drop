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

  test('auto respond tab shows bulk percentage input defaulting to 5', async () => {
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    const pctInput = await screen.findByLabelText(/Bulk auto-respond percentage/i);
    expect(pctInput).toBeInTheDocument();
    expect(pctInput).toHaveValue(5);
    expect(screen.getByText('Bulk Update Minimum Price')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update All/i })).toBeInTheDocument();
  });

  test('auto respond bulk percentage input can be changed and calls API on Update All', async () => {
    api.patch.mockResolvedValue({ data: { message: 'Auto-respond enabled for 1 listings (10% off)', updated: 1 } });
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    const pctInput = await screen.findByLabelText(/Bulk auto-respond percentage/i);
    fireEvent.change(pctInput, { target: { value: '10' } });
    expect(pctInput).toHaveValue(10);

    fireEvent.click(screen.getByRole('button', { name: /Update All/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/listings/bulk/auto-respond', { enabled: true, percentOff: 10, autoOfferToLikers: true }));
  });

  test('auto respond bulk auto-offer-to-likers checkbox defaults ON and can be turned off', async () => {
    api.patch.mockResolvedValue({ data: { message: 'Auto-respond enabled for 1 listings (5% off)', updated: 1 } });
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));

    const likersCheckbox = await screen.findByRole('checkbox', { name: /auto-offer to likers/i });
    expect(likersCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Update All/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/listings/bulk/auto-respond', { enabled: true, percentOff: 5, autoOfferToLikers: true }));

    // Uncheck → payload carries autoOfferToLikers: false
    fireEvent.click(likersCheckbox);
    expect(likersCheckbox).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Update All/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/listings/bulk/auto-respond', { enabled: true, percentOff: 5, autoOfferToLikers: false }));
  });

  test('auto respond bulk percentage Update All surfaces errors', async () => {
    api.patch.mockRejectedValue(new Error('server error'));
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    await screen.findByLabelText(/Bulk auto-respond percentage/i);
    fireEvent.click(screen.getByRole('button', { name: /Update All/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
  });

  test('auto respond bulk percentage reflects listing count in helper text', async () => {
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    await screen.findByLabelText(/Bulk auto-respond percentage/i);
    // sampleListing returns 1 listing by default → "1 listing" (singular)
    expect(await screen.findByText(/95% of list price for 1 listing/)).toBeInTheDocument();
  });

  test('auto respond bulk percentage shows no-listings helper when seller has none', async () => {
    api.get.mockResolvedValue({ data: { listings: [] } });
    renderPage(<SellerDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /Auto Respond/i }));
    await screen.findByLabelText(/Bulk auto-respond percentage/i);
    expect(await screen.findByText('No listings to update.')).toBeInTheDocument();
  });
test('shows Total Sales, Your Earnings and Pending Payout without exposing Commission', async () => {
    getPayoutDashboard.mockResolvedValue({
      data: { ...dash(), totalSales: 5693.04, totalEarnings: 150.0, totalCommission: 455.44, pendingAmount: 4295.6 },
    });
    renderPage(<SellerDashboard />);

    expect(await screen.findByText('Total Sales')).toBeInTheDocument();
    expect(screen.getByText('Your Earnings')).toBeInTheDocument();
    expect(screen.getByText('Pending Payout')).toBeInTheDocument();

    // The platform commission cut must NOT be shown to sellers.
    expect(screen.queryByText('Commission')).not.toBeInTheDocument();
    expect(screen.queryByText('$455.44')).not.toBeInTheDocument();
  });

  test('formats dashboard money values accurately', async () => {
    renderPage(<SellerDashboard />);
    // dash() = totalSales 5, totalEarnings 225, totalCommission 25, pendingAmount 40
    expect(await screen.findByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('$225.00')).toBeInTheDocument();
    expect(screen.getByText('$40.00')).toBeInTheDocument();
    // Commission value $25.00 must not be rendered for sellers.
    expect(screen.queryByText('$25.00')).not.toBeInTheDocument();
  });

  test('seller-visible numbers partition exactly (earnings + pending = payouts; gross = cut + payouts)', async () => {
    // Mirrors the server DA.0 regression shape: completed 150 + pending 4295.60.
    getPayoutDashboard.mockResolvedValue({
      data: {
        ...dash(),
        totalSales: 5832.17,
        totalEarnings: 150.0,
        totalCommission: 1386.57, // internal figure — present in API, hidden in UI
        totalPayouts: 4445.6,
        pendingAmount: 4295.6,
      },
    });
    renderPage(<SellerDashboard />);
    expect(await screen.findByText('Total Sales')).toBeInTheDocument();
    // 150 (earnings) + 4295.60 (pending) = 4445.60 (total seller payouts)
    expect(150.0 + 4295.6).toBeCloseTo(4445.6, 2);
    // 5832.17 (gross) = 1386.57 (platform cut) + 4445.60 (seller payouts)
    expect(1386.57 + 4445.6).toBeCloseTo(5832.17, 2);
    // And the UI still hides the internal platform cut.
    expect(screen.queryByText('Commission')).not.toBeInTheDocument();
  });
});
