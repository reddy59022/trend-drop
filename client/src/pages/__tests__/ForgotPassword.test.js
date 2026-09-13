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

import ForgotPassword from '../ForgotPassword';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(null); setThemeStore(); setCartStore(); setConfirm(); });

describe('ForgotPassword page', () => {
  test('renders the request form', () => {
    renderPage(<ForgotPassword />);
    expect(screen.getByText('Forgot Password?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  test('warns when email is empty', () => {
    const { toast } = require('react-toastify');
    renderPage(<ForgotPassword />);
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(toast.error).toHaveBeenCalledWith('Please enter your email');
  });

  test('successful submit shows check-email state with the address', async () => {
    api.post.mockResolvedValue({ data: {} });
    renderPage(<ForgotPassword />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText('Check Your Email')).toBeInTheDocument();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'a@b.com' });
  });

  test('failed submit keeps the form and toasts', async () => {
    const { toast } = require('react-toastify');
    api.post.mockRejectedValue(new Error('down'));
    renderPage(<ForgotPassword />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to send reset email'));
    expect(screen.getByText('Forgot Password?')).toBeInTheDocument();
  });
});
