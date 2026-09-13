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

import Profile from '../Profile';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Profile page', () => {
  const prime = (isOwn = false) => {
    api.get.mockImplementation((url) => {
      if (String(url).startsWith('/users/'))
        return Promise.resolve({ data: { user: { _id: isOwn ? 'user123' : 'seller1', name: isOwn ? 'Test User' : 'Seller One', followers: [] }, listingsCount: 3 } });
      if (String(url).startsWith('/listings/user/')) return Promise.resolve({ data: { listings: [sampleListing()] } });
      return Promise.resolve({ data: {} });
    });
  };
  test("renders another seller profile with a follow button", async () => {
    prime(false);
    renderPageWithRoute(<Profile />, { route: '/profile/seller1', path: '/profile/:id' });
    expect((await screen.findAllByText('Seller One')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Follow/ })).toBeInTheDocument();
  });
  test('follow button calls the follow endpoint', async () => {
    prime(false);
    api.post.mockResolvedValue({ data: { following: true } });
    renderPageWithRoute(<Profile />, { route: '/profile/seller1', path: '/profile/:id' });
    const btn = await screen.findByRole('button', { name: /Follow/ });
    fireEvent.click(btn);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });
  test('renders the seller listings grid', async () => {
    prime(false);
    renderPageWithRoute(<Profile />, { route: '/profile/seller1', path: '/profile/:id' });
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
  });
});
