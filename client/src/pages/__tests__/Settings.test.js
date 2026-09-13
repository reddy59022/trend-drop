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

import Settings from '../Settings';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(async () => true); });

describe('Settings page', () => {
  const goAccount = () => {
    fireEvent.click(screen.getByRole('button', { name: /Account/ }));
  };
  test('renders settings tabs and profile form', () => {
    renderPage(<Settings />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save Changes/ })).toBeInTheDocument();
  });
  test('account tab shows the danger zone with delete account and log out', () => {
    renderPage(<Settings />);
    goAccount();
    expect(screen.getByText('Danger Zone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete Account/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log Out/ })).toBeInTheDocument();
  });
  test('delete account asks for confirmation then calls the API', async () => {
    api.delete.mockResolvedValue({ data: {} });
    renderPage(<Settings />);
    goAccount();
    fireEvent.click(screen.getByRole('button', { name: /Delete Account/ }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/auth/account'));
  });
  test('log out clears auth and navigates home', () => {
    const auth = setAuth(authUser());
    renderPage(<Settings />);
    goAccount();
    fireEvent.click(screen.getByRole('button', { name: /Log Out/ }));
    expect(auth.logout).toHaveBeenCalled();
  });
});
