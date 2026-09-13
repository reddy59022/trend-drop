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

import Register from '../Register';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(null); setThemeStore(); setCartStore(); setConfirm(); });

describe('Register page', () => {
  test('renders registration form fields', () => {
    renderPage(<Register />);
    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Min 8 characters')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Repeat your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  test('warns when passwords do not match', async () => {
    renderPage(<Register />);
    fireEvent.change(screen.getByPlaceholderText('Min 8 characters'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), { target: { value: 'different1' } });
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  test('shows password strength label as the user types', async () => {
    renderPage(<Register />);
    fireEvent.change(screen.getByPlaceholderText('Min 8 characters'), { target: { value: 'password123!' } });
    expect(await screen.findByText(/Weak|Fair|Good|Strong|Very Strong/)).toBeInTheDocument();
  });

  test('blocks submit with empty fields via toast', async () => {
    const { toast } = require('react-toastify');
    renderPage(<Register />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(toast.error).toHaveBeenCalledWith('Please fill in all fields');
  });

  test('blocks submit with short password via toast', async () => {
    const { toast } = require('react-toastify');
    renderPage(<Register />);
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('Min 8 characters'), { target: { value: 'short' } });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(toast.error).toHaveBeenCalledWith('Password must be at least 8 characters');
  });

  test('successful registration calls register with FormData', async () => {
    const auth = setAuth(null);
    auth.register.mockResolvedValue({ message: 'ok' });
    renderPage(<Register />);
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('Min 8 characters'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    await waitFor(() => expect(auth.register).toHaveBeenCalled());
    const fd = auth.register.mock.calls[0][0];
    expect(fd.get('name')).toBe('Test User');
    expect(fd.get('email')).toBe('a@b.com');
  });
});
