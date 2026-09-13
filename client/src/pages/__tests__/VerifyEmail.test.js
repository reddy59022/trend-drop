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

import VerifyEmail from '../VerifyEmail';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(null); setThemeStore(); setCartStore(); setConfirm(); jest.useRealTimers(); });

describe('VerifyEmail page', () => {
  test('shows verifying state then success when the token verifies', async () => {
    api.post.mockResolvedValue({ data: { token: 'tok', user: { email: 'a@b.com' } } });
    renderPage(<VerifyEmail />, { route: '/verify-email?token=abc' });
    expect(screen.getByText('Verifying Email')).toBeInTheDocument();
    expect(await screen.findByText('Verified!')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/verify-email', { token: 'abc' });
  });

  test('missing token shows verification-failed guidance', async () => {
    renderPage(<VerifyEmail />, { route: '/verify-email' });
    expect(await screen.findByText('Verification Failed')).toBeInTheDocument();
    expect(screen.getByText(/No verification token found/)).toBeInTheDocument();
  });

  test('rejected token shows the server message', async () => {
    api.post.mockRejectedValue({ response: { data: { message: 'Link expired' } } });
    renderPage(<VerifyEmail />, { route: '/verify-email?token=bad' });
    expect(await screen.findByText('Verification Failed')).toBeInTheDocument();
    expect(screen.getByText('Link expired')).toBeInTheDocument();
  });
});
