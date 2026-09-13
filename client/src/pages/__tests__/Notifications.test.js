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
jest.mock('browser-image-compression', () => ({ __esModule: true, default: jest.fn(async (f) => f) }));

import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import Notifications from '../Notifications';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Notifications page', () => {
  test('guest users are asked to sign in', () => {
    setAuth(null);
    renderPage(<Notifications />);
    expect(screen.getByText('Sign in to view your notifications')).toBeInTheDocument();
  });
  test('renders the empty state when there are no notifications', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderPage(<Notifications />);
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });
  test('renders notifications with unread badge and marks all read', async () => {
    api.get.mockResolvedValue({ data: [{ _id: 'n1', type: 'like', message: 'Bob liked your jacket', read: false, createdAt: new Date().toISOString(), from: { _id: 'bob', avatar: '' } }] });
    api.put.mockResolvedValue({ data: {} });
    renderPage(<Notifications />);
    expect(await screen.findByText('Bob liked your jacket')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark All Read/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/users/user123/notifications/read'));
  });
});
