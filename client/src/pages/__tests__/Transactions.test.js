import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import api, { getTransactions } from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import Transactions from '../Transactions';

const emptyPagination = { total: 0, totalPages: 0, currentPage: 1, limit: 20, hasMore: false, hasNextPage: false, hasPrevPage: false, nextPage: null, prevPage: null };

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Transactions page', () => {
  test('renders the empty orders state', async () => {
    getTransactions.mockResolvedValue({ data: { transactions: [], pagination: emptyPagination } });
    renderPage(<Transactions />);
    expect(await screen.findByText('No orders found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse Items' })).toHaveAttribute('href', '/feed');
  });
  test('renders transactions and expands details on click', async () => {
    getTransactions.mockResolvedValue({ data: { transactions: [{ _id: 'txn1', status: 'paid', currency: 'USD', buyer: { _id: 'user123' }, seller: { _id: 'seller1' }, listing: { title: 'Jacket' }, shipping: {}, paymentBreakdown: { subtotal: 40, shippingCost: 5, buyerProtectionFee: 2, totalPaid: 47 } }], pagination: { ...emptyPagination, total: 1, totalPages: 1 } } });
    renderPage(<Transactions />);
    await waitFor(() => expect(getTransactions).toHaveBeenCalledWith({ type: 'all', page: 1, limit: 20 }));
    expect(await screen.findByText('Jacket')).toBeInTheDocument();
    const cards = document.querySelectorAll('.glass-card');
    expect(cards.length).toBeGreaterThan(0);
  });
  test('filter tabs refetch with the selected type and default status', async () => {
    getTransactions.mockResolvedValue({ data: { transactions: [], pagination: emptyPagination } });
    renderPage(<Transactions />);
    await screen.findByText('No orders found');
    fireEvent.click(screen.getByRole('button', { name: /Sold/ }));
    await waitFor(() => expect(getTransactions).toHaveBeenCalledWith({ type: 'sold', page: 1, limit: 20, status: 'paid,processing' }));
  });
  test('pagination controls appear when there are multiple pages', async () => {
    const txns = Array.from({ length: 20 }, (_, i) => ({ _id: `txn${i}`, status: 'paid', currency: 'USD', buyer: { _id: 'user123' }, seller: { _id: 'seller1' }, listing: { title: `Item ${i}` }, shipping: {}, paymentBreakdown: { subtotal: 40, shippingCost: 5, buyerProtectionFee: 2, totalPaid: 47 } }));
    getTransactions.mockResolvedValue({ data: { transactions: txns, pagination: { total: 45, totalPages: 3, currentPage: 1, limit: 20, hasMore: true, hasNextPage: true, hasPrevPage: false, nextPage: 2, prevPage: null } } });
    renderPage(<Transactions />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });
  test('status filter dropdown allows selecting a status', async () => {
    getTransactions.mockResolvedValue({ data: { transactions: [], pagination: emptyPagination } });
    renderPage(<Transactions />);
    await screen.findByText('No orders found');
    await userEvent.click(screen.getByRole('button', { name: /All Statuses/i }));
    expect(await screen.findByText('Shipped')).toBeInTheDocument();
  });
});

// ============================================================
// Sold tab money display: every deduction is shown and the column adds up.
// Production report: a boosted $30 sale showed "Platform Fee (10%)" (the
// record stores 8%), no boost row at all, and "Your Earnings $24.60" — the
// $3.00 boost fee behind that number was invisible.
// ============================================================
const round2 = (n) => Math.round(n * 100) / 100;

// Read the amount rendered on the same row as `label` (e.g. "-$2.40" -> -2.4).
const amountFor = (label) => {
  const row = screen.getByText(label).closest('div');
  const match = (row.textContent || '').match(/-?\$[0-9,]+\.[0-9]{2}/);
  return match ? Number(match[0].replace(/[$,]/g, '')) : null;
};

const boostedSellerSale = {
  _id: 'txn-boost-1', status: 'paid', currency: 'USD',
  buyer: { _id: 'buyer1', name: 'John Doe' },
  seller: { _id: 'user123', name: 'Test User' },
  listing: { _id: 'listing1', title: 'Boosted Jacket' },
  shipping: { carrier: 'USPS', trackingNumber: 'US1789610063648EZGJGO' },
  shippingAddress: { fullName: 'John Doe', street1: '11053 villita st', city: 'frisco', state: 'TX', postalCode: '75035' },
  viewerRole: 'seller',
  paymentBreakdown: {
    subtotal: 30, shippingCost: 4.59, buyerProtectionFee: 1.5, buyerProtectionPercent: 5,
    tax: 0, totalPaid: 36.09, platformFee: 2.4, platformFeePercent: 8,
    shippingPayout: 4.59, sellerEarnings: 24.6, boostFee: 3, boostTier: 'standard',
  },
  sellerBreakdown: {
    currency: 'USD', itemPrice: 30, platformFee: 2.4, platformFeePercent: 8,
    boostFee: 3, boostTier: 'standard', boostTierLabel: 'Standard Boost',
    shippingPayout: 4.59, shippingIncludedInEarnings: false,
    sellerEarnings: 24.6, expectedEarnings: 24.6, residual: 0, reconciled: true,
  },
};

const buyerSale = {
  _id: 'txn-buy-1', status: 'paid', currency: 'USD',
  buyer: { _id: 'user123', name: 'Test User' },
  seller: { _id: 'seller1', name: 'Seller One' },
  listing: { _id: 'listing1', title: 'Boosted Jacket' },
  shipping: {},
  viewerRole: 'buyer',
  paymentBreakdown: {
    subtotal: 30, shippingCost: 4.59, buyerProtectionFee: 1.5, buyerProtectionPercent: 5,
    tax: 0, totalPaid: 36.09, platformFee: 2.4, platformFeePercent: 8,
    shippingPayout: 4.59, sellerEarnings: 24.6,
  },
};

const renderSoldTab = async (txn) => {
  getTransactions.mockResolvedValue({ data: { transactions: [txn], pagination: { ...emptyPagination, total: 1, totalPages: 1 } } });
  renderPage(<Transactions />);
  await screen.findByText(txn.listing.title);
  fireEvent.click(document.querySelector('.glass-card > div'));
};

describe('Sold tab — seller earnings breakdown', () => {
  test('shows the boost fee row so the earnings column adds up', async () => {
    await renderSoldTab(boostedSellerSale);

    expect(await screen.findByText('What You Earned')).toBeInTheDocument();
    // The platform rate comes from the record (8%), never a hardcoded literal.
    expect(screen.getByText('Platform Fee (8%)')).toBeInTheDocument();
    // The row that was missing in production, labelled from the stored tier.
    expect(screen.getByText('Boost Fee (Standard Boost)')).toBeInTheDocument();

    const itemPrice = amountFor('Item Price');
    const platformFee = amountFor('Platform Fee (8%)');
    const boostFee = amountFor('Boost Fee (Standard Boost)');
    const earnings = amountFor('Your Earnings');

    expect(itemPrice).toBe(30);
    expect(platformFee).toBe(-2.4);
    expect(boostFee).toBe(-3);
    expect(earnings).toBe(24.6);
    // The displayed column closes exactly — this is the defect being fixed.
    expect(round2(itemPrice + platformFee + boostFee)).toBe(earnings);
  });

  test('keeps shipping out of the earnings total and labels it as such', async () => {
    await renderSoldTab(boostedSellerSale);
    expect(screen.getByText('Shipping label payout')).toBeInTheDocument();
    expect(amountFor('Shipping label payout')).toBe(4.59);
  });

  test('unreconciled legacy record shows an adjustment row so the column still closes', async () => {
    const drifted = {
      ...boostedSellerSale,
      paymentBreakdown: { ...boostedSellerSale.paymentBreakdown, sellerEarnings: 20 },
      sellerBreakdown: { ...boostedSellerSale.sellerBreakdown, sellerEarnings: 20, expectedEarnings: 24.6, residual: -4.6, reconciled: false },
    };
    await renderSoldTab(drifted);

    expect(screen.getByText('Adjustments & fees')).toBeInTheDocument();
    expect(amountFor('Adjustments & fees')).toBe(-4.6);
    const rows = amountFor('Item Price') + amountFor('Platform Fee (8%)') + amountFor('Boost Fee (Standard Boost)') + amountFor('Adjustments & fees');
    expect(round2(rows)).toBe(amountFor('Your Earnings'));
  });

  test('falls back to stored fields when the API omits the canonical breakdown', async () => {
    const legacyPayload = { ...boostedSellerSale };
    delete legacyPayload.sellerBreakdown;
    await renderSoldTab(legacyPayload);

    // Still tallies from paymentBreakdown alone (older API / cached payloads).
    expect(screen.getByText('Boost Fee (Standard Boost)')).toBeInTheDocument();
    expect(round2(amountFor('Item Price') + amountFor('Platform Fee (8%)') + amountFor('Boost Fee (Standard Boost)'))).toBe(amountFor('Your Earnings'));
  });

  test('a sale with no boost shows no boost row and never renders NaN', async () => {
    const noBoost = {
      ...boostedSellerSale,
      paymentBreakdown: { ...boostedSellerSale.paymentBreakdown, boostFee: 0, boostTier: '', sellerEarnings: 27.6 },
      sellerBreakdown: { ...boostedSellerSale.sellerBreakdown, boostFee: 0, boostTier: '', boostTierLabel: '', sellerEarnings: 27.6, expectedEarnings: 27.6, residual: 0, reconciled: true },
    };
    await renderSoldTab(noBoost);

    expect(screen.queryByText(/^Boost Fee/)).not.toBeInTheDocument();
    expect(round2(amountFor('Item Price') + amountFor('Platform Fee (8%)'))).toBe(amountFor('Your Earnings'));
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

describe('Buyer view — never exposed to the seller’s boost fee', () => {
  test('bought tab shows totals only: no boost row, no seller earnings column', async () => {
    await renderSoldTab(buyerSale);

    expect(await screen.findByText('What You Paid')).toBeInTheDocument();
    expect(screen.getByText('Buyer Protection (5%)')).toBeInTheDocument();
    expect(screen.queryByText(/Boost Fee/)).not.toBeInTheDocument();
    expect(screen.queryByText('What You Earned')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
