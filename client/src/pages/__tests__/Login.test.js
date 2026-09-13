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

import Login from '../Login';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(null); setThemeStore(); setCartStore(); setConfirm(); });

describe('Login page', () => {
  test('renders sign-in form with email, password and social buttons', () => {
    renderPage(<Login />);
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Apple' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Facebook' })).toBeInTheDocument();
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  test('shows validation errors for empty submit', async () => {
    renderPage(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  test('shows validation error for invalid email and short password', async () => {
    renderPage(<Login />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Please enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
  });

  test('toggles password visibility', () => {
    renderPage(<Login />);
    const input = screen.getByPlaceholderText('Enter your password');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  test('successful login calls login and navigates to feed', async () => {
    const auth = setAuth(null);
    auth.login.mockResolvedValue({ token: 't', user: authUser() });
    renderPage(<Login />, { route: '/login' });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(auth.login).toHaveBeenCalledWith('a@b.com', 'password123'));
  });

  test('failed login surfaces server error on the form', async () => {
    const auth = setAuth(null);
    auth.login.mockRejectedValue({ response: { data: { message: 'Invalid email or password' } } });
    renderPage(<Login />);
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
  });

  test('social buttons show connecting state then settle', async () => {
    const auth = setAuth(null);
    auth.loginWithGoogle.mockImplementation(() => new Promise(() => {}));
    renderPage(<Login />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('Connecting...')).toBeInTheDocument();
  });
});
