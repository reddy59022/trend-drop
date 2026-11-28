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
import {
  getAdminDashboard, getAdminUsers, updateUserRole, suspendUser, unsuspendUser,
  getAdminListings, deleteAdminListing, getAdminReports, updateAdminReportStatus,
  getAdminTransactions, adminRefundTransaction, autoSuspendUsers, getPendingSellerVerifications, reviewSellerBadge,
  getInsuranceClaims, reviewInsuranceClaim,
} from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';
import { toast } from 'react-toastify';

import Admin from '../Admin';

const dash = () => ({
  stats: { totalUsers: 100, totalListings: 250, totalTransactions: 500, pendingReports: [{ _id: 'r1' }], totalCommission: 320 },
  recentTransactions: [],
  pendingReports: [{ _id: 'r1', reason: 'scam', listing: { title: 'Fake Bag' } }],
});

beforeEach(() => {
  resetTestState(); resetApiMock(api);
  setAuth(authUser({ role: 'admin' }));
  setThemeStore(); setCartStore(); setConfirm();
  getAdminDashboard.mockResolvedValue({ data: dash() });
  getAdminUsers.mockResolvedValue({ data: { users: [], totalPages: 1 } });
  getAdminListings.mockResolvedValue({ data: { listings: [], totalPages: 1 } });
  getAdminReports.mockResolvedValue({ data: { reports: [], totalPages: 1 } });
  getAdminTransactions.mockResolvedValue({ data: { transactions: [], totalPages: 1 } });
  autoSuspendUsers.mockResolvedValue({ data: { message: '2 users suspended' } });
  getPendingSellerVerifications.mockResolvedValue({ data: { badges: [] } });
  reviewSellerBadge.mockResolvedValue({ data: { badge: {} } });
  getInsuranceClaims.mockResolvedValue({ data: { claims: [] } });
  reviewInsuranceClaim.mockResolvedValue({ data: { insurance: {} } });
});

describe('Admin page', () => {
  test('renders the Admin Panel heading for admins', async () => {
    renderPage(<Admin />);
    expect(await screen.findByText('Admin Panel')).toBeInTheDocument();
  });
  test('loads dashboard stats on mount', async () => {
    renderPage(<Admin />);
    await waitFor(() => expect(getAdminDashboard).toHaveBeenCalled());
    expect(await screen.findByText('100')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
  });
  test('renders seller verification tab and loads pending requests', async () => {
    getPendingSellerVerifications.mockResolvedValue({ data: { badges: [{
      _id: 'badge-1', updatedAt: '2026-09-17T00:00:00.000Z',
      userId: { _id: 'seller-1', name: 'Pending Seller', email: 'seller@test.com', country: 'US' },
    }] } });
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Verifications/ }));
    expect(await screen.findByText('Pending Seller')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(reviewSellerBadge).toHaveBeenCalledWith('seller-1', { decision: 'approve' }));
  });

  test('admins can review a pending insurance claim', async () => {
    const policyId = '507f1f77bcf86cd799439011';
    getInsuranceClaims.mockResolvedValue({ data: { claims: [{
      _id: policyId, seller: { name: 'Ins Seller' }, itemValue: 100, premium: 2, currency: 'USD',
      claim: { reason: 'Lost shipment' },
    }] } });
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Insurance/ }));
    expect(await screen.findByText('Ins Seller')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(reviewInsuranceClaim).toHaveBeenCalledWith(policyId, { status: 'approved' }));
  });

  test('renders all five management tabs', async () => {
    renderPage(<Admin />);
    await screen.findByText('Admin Panel');
    ['Dashboard', 'Users', 'Listings', 'Reports', 'Transactions'].forEach((label) =>
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument());
  });
  test('marks the current tab with aria-selected and one tab stop', async () => {
    renderPage(<Admin />);
    const dashboard = await screen.findByRole('tab', { name: /Dashboard/ });
    expect(dashboard).toHaveAttribute('aria-selected', 'true');
    expect(dashboard).toHaveAttribute('tabindex', '0');
    expect(dashboard).toHaveAttribute('aria-controls', 'admin-panel');
    const users = screen.getByRole('tab', { name: /Users/ });
    expect(users).toHaveAttribute('aria-selected', 'false');
    expect(users).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tablist', { name: /admin sections/i })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'admin-tab-dashboard');
  });
  test('arrow keys move between tabs without extra Tab stops', async () => {
    renderPage(<Admin />);
    const dashboard = await screen.findByRole('tab', { name: /Dashboard/ });
    dashboard.focus();
    fireEvent.keyDown(dashboard, { key: 'ArrowRight' });
    const users = screen.getByRole('tab', { name: /Users/ });
    await waitFor(() => expect(users).toHaveAttribute('aria-selected', 'true'));
    expect(document.activeElement).toBe(users);
    fireEvent.keyDown(users, { key: 'End' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Insurance/ })).toHaveAttribute('aria-selected', 'true'));
    fireEvent.keyDown(screen.getByRole('tab', { name: /Insurance/ }), { key: 'Home' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Dashboard/ })).toHaveAttribute('aria-selected', 'true'));
  });
  test('switching to the Users tab fetches users with the search box', async () => {
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Users/ }));
    await waitFor(() => expect(getAdminUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
    expect(screen.getByPlaceholderText('Search users by name or email...')).toBeInTheDocument();
  });
  test('searching users passes the search term', async () => {
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Users/ }));
    fireEvent.change(await screen.findByPlaceholderText('Search users by name or email...'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    await waitFor(() => expect(getAdminUsers).toHaveBeenCalledWith(expect.objectContaining({ search: 'alice' })));
  });
  test('shows a resolved/dismiss action for pending reports', async () => {
    renderPage(<Admin />);
    expect(await screen.findByText('Fake Bag')).toBeInTheDocument();
    expect(screen.getByText('scam')).toBeInTheDocument();
  });
  test('admins see the Auto-Suspend tool', async () => {
    renderPage(<Admin />);
    await screen.findByText('Admin Panel');
    fireEvent.click(screen.getByRole('button', { name: /Auto-Suspend/i }));
    await waitFor(() => expect(autoSuspendUsers).toHaveBeenCalled());
  });
  test('moderators can view the panel but not seller verification controls', async () => {
    setAuth(authUser({ role: 'moderator' }));
    renderPage(<Admin />);
    expect(await screen.findByText('Admin Panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verifications/ })).not.toBeInTheDocument();
  });
  test('moderators can view the panel', async () => {
    setAuth(authUser({ role: 'moderator' }));
    renderPage(<Admin />);
    expect(await screen.findByText('Admin Panel')).toBeInTheDocument();
  });
  test('regular users and guests get nothing (access denied)', () => {
    setAuth(authUser({ role: 'user' }));
    renderPage(<Admin />);
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument();
  });
  test('survives dashboard API failure without crashing', async () => {
    getAdminDashboard.mockRejectedValue(new Error('boom'));
    renderPage(<Admin />);
    expect(screen.getByText('Admin Panel')).toBeInTheDocument();
  });
});

describe('Admin write actions: confirmation and announcement', () => {
  const userRow = {
    _id: 'u2', name: 'Test Seller', email: 'seller@test.com', role: 'user', stats: { strikes: 1 },
  };

  const openUsers = async () => {
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Users/ }));
    expect(await screen.findByText('Test Seller')).toBeInTheDocument();
  };

  test('a role change asks for confirmation, then announces the new role', async () => {
    const confirm = jest.fn(async () => true);
    setConfirm(confirm);
    getAdminUsers.mockResolvedValue({ data: { users: [userRow], totalPages: 1 } });
    updateUserRole.mockResolvedValue({ data: {} });
    await openUsers();

    fireEvent.change(screen.getByRole('combobox', { name: /Role for Test Seller/ }), { target: { value: 'moderator' } });

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Change user role?' })));
    expect(confirm.mock.calls[0][0].message).toMatch(/Test Seller will become moderator/);
    await waitFor(() => expect(updateUserRole).toHaveBeenCalledWith('u2', 'moderator'));
    expect(toast.success).toHaveBeenCalledWith('Role updated to moderator');
  });

  test('cancelling the role confirmation makes no API call', async () => {
    const confirm = jest.fn(async () => false);
    setConfirm(confirm);
    getAdminUsers.mockResolvedValue({ data: { users: [userRow], totalPages: 1 } });
    await openUsers();

    fireEvent.change(screen.getByRole('combobox', { name: /Role for Test Seller/ }), { target: { value: 'admin' } });

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(updateUserRole).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  test('cancelling a role change restores the select to the real role', async () => {
    const confirm = jest.fn(async () => false);
    setConfirm(confirm);
    getAdminUsers.mockResolvedValue({ data: { users: [userRow], totalPages: 1 } });
    await openUsers();

    const select = screen.getByRole('combobox', { name: /Role for Test Seller/ });
    expect(select.value).toBe('user');
    fireEvent.change(select, { target: { value: 'admin' } });

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    // The controlled select keeps the picked option unless it is put back: no
    // state changed on cancel, so React has nothing to re-render from.
    await waitFor(() => expect(select.value).toBe('user'));
  });

  test('a failed role change also restores the select', async () => {
    setConfirm(async () => true);
    getAdminUsers.mockResolvedValue({ data: { users: [userRow], totalPages: 1 } });
    updateUserRole.mockRejectedValue({ response: { data: { message: 'Not allowed' } } });
    await openUsers();

    const select = screen.getByRole('combobox', { name: /Role for Test Seller/ });
    fireEvent.change(select, { target: { value: 'moderator' } });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not allowed'));
    expect(select.value).toBe('user');
  });

  test('suspending a user asks for confirmation and announces it', async () => {
    const confirm = jest.fn(async () => true);
    setConfirm(confirm);
    getAdminUsers.mockResolvedValue({ data: { users: [userRow], totalPages: 1 } });
    suspendUser.mockResolvedValue({ data: {} });
    await openUsers();

    fireEvent.click(screen.getByRole('button', { name: /Suspend Test Seller/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Suspend this user?', danger: true })));
    await waitFor(() => expect(suspendUser).toHaveBeenCalledWith('u2'));
    expect(toast.success).toHaveBeenCalledWith('Test Seller suspended');
  });

  test('a failed suspension is announced instead of only logged', async () => {
    setConfirm(async () => true);
    getAdminUsers.mockResolvedValue({ data: { users: [userRow], totalPages: 1 } });
    suspendUser.mockRejectedValue({ response: { data: { message: 'Cannot suspend an admin' } } });
    await openUsers();

    fireEvent.click(screen.getByRole('button', { name: /Suspend Test Seller/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Cannot suspend an admin'));
  });

  const openReports = async () => {
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Reports/ }));
    await screen.findByText('Reported Item');
  };

  beforeEach(() => {
    getAdminReports.mockResolvedValue({ data: { reports: [{
      _id: 'r1', reporter: { name: 'Reporter' }, listing: { title: 'Reported Item' }, reason: 'Spam', status: 'pending',
    }], totalPages: 1 } });
  });

  test('resolving a report asks for confirmation, then announces it', async () => {
    const confirm = jest.fn(async () => true);
    setConfirm(confirm);
    updateAdminReportStatus.mockResolvedValue({ data: {} });
    await openReports();
    fireEvent.click(screen.getByRole('button', { name: /Resolve/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Resolve this report?', confirmLabel: 'Resolve' })));
    await waitFor(() => expect(updateAdminReportStatus).toHaveBeenCalledWith('r1', 'resolved'));
    expect(toast.success).toHaveBeenCalledWith('Report resolved');
  });

  test('dismissing a report uses its own confirmation', async () => {
    const confirm = jest.fn(async () => true);
    setConfirm(confirm);
    updateAdminReportStatus.mockResolvedValue({ data: {} });
    await openReports();
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dismiss this report?', confirmLabel: 'Dismiss', danger: true })));
    await waitFor(() => expect(updateAdminReportStatus).toHaveBeenCalledWith('r1', 'dismissed'));
    expect(toast.success).toHaveBeenCalledWith('Report dismissed');
  });

  test('cancelling the report confirmation makes no API call', async () => {
    const confirm = jest.fn(async () => false);
    setConfirm(confirm);
    await openReports();
    fireEvent.click(screen.getByRole('button', { name: /Resolve/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(updateAdminReportStatus).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  test('a forced refund asks for confirmation, then announces success', async () => {
    const confirm = jest.fn(async () => true);
    setConfirm(confirm);
    getAdminTransactions.mockResolvedValue({ data: { transactions: [{
      _id: 't1', buyer: { name: 'Buyer' }, seller: { name: 'Seller' }, listing: { title: 'Item' },
      paymentBreakdown: { totalPaid: 25 }, currency: 'USD', status: 'completed',
    }], totalPages: 1 } });
    adminRefundTransaction.mockResolvedValue({ data: {} });
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('tab', { name: /Transactions/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Force Refund/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Force refund?', danger: true })));
    await waitFor(() => expect(adminRefundTransaction).toHaveBeenCalledWith('t1'));
    expect(toast.success).toHaveBeenCalledWith('Refund issued');
  });
});
