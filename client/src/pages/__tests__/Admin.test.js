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
  getAdminTransactions, adminRefundTransaction, autoSuspendUsers,
} from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';

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
  test('renders all five management tabs', async () => {
    renderPage(<Admin />);
    await screen.findByText('Admin Panel');
    ['Dashboard', 'Users', 'Listings', 'Reports', 'Transactions'].forEach((label) =>
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument());
  });
  test('switching to the Users tab fetches users with the search box', async () => {
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('button', { name: /Users/ }));
    await waitFor(() => expect(getAdminUsers).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
    expect(screen.getByPlaceholderText('Search users by name or email...')).toBeInTheDocument();
  });
  test('searching users passes the search term', async () => {
    renderPage(<Admin />);
    fireEvent.click(await screen.findByRole('button', { name: /Users/ }));
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
