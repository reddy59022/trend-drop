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

import Wishlist from '../Wishlist';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Wishlist page', () => {
  test('renders wishlist items with prices', async () => {
    api.getWishlist.mockResolvedValue({ data: [{ listing: sampleListing() }] });
    renderPage(<Wishlist />);
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from wishlist' })).toBeInTheDocument();
  });
  test('renders the empty state when nothing is saved', async () => {
    api.getWishlist.mockResolvedValue({ data: [] });
    renderPage(<Wishlist />);
    expect(await screen.findByText('Your wishlist is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse Items/ })).toHaveAttribute('href', '/search');
  });
  test('removing an item calls the API and removes the card', async () => {
    api.getWishlist.mockResolvedValue({ data: [{ listing: sampleListing() }] });
    api.removeFromWishlist.mockResolvedValue({ data: {} });
    renderPage(<Wishlist />);
    await screen.findByText('Vintage Denim Jacket');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from wishlist' }));
    await waitFor(() => expect(api.removeFromWishlist).toHaveBeenCalledWith('listing123'));
    expect(await screen.findByText('Your wishlist is empty')).toBeInTheDocument();
  });
});
