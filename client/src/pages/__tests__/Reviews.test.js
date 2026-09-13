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

import Reviews from '../Reviews';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Reviews page', () => {
  test('renders the empty reviews state', async () => {
    api.getRatingsBySeller.mockResolvedValue({ data: { ratings: [], averageRating: 0, count: 0 } });
    renderPageWithRoute(<Reviews />, { route: '/reviews/seller1', path: '/reviews/:sellerId' });
    expect(await screen.findByText('No reviews yet')).toBeInTheDocument();
  });
  test('renders existing reviews', async () => {
    api.getRatingsBySeller.mockResolvedValue({ data: { ratings: [{ _id: 'r1', rating: 5, review: 'Great seller!', user: { name: 'Buyer' } }], averageRating: 5, count: 1 } });
    renderPageWithRoute(<Reviews />, { route: '/reviews/seller1', path: '/reviews/:sellerId' });
    expect(await screen.findByText('Great seller!')).toBeInTheDocument();
  });
  test('submitting a review calls createRating', async () => {
    api.getRatingsBySeller.mockResolvedValue({ data: { ratings: [], averageRating: 0, count: 0 } });
    api.createRating.mockResolvedValue({ data: {} });
    renderPageWithRoute(<Reviews />, { route: '/reviews/seller1', path: '/reviews/:sellerId' });
    await screen.findByText('No reviews yet');
    fireEvent.click(screen.getByRole('button', { name: /Write a Review/ }));
    fireEvent.change(screen.getByPlaceholderText('Share your experience...'), { target: { value: 'Excellent!' } });
    fireEvent.change(screen.getByPlaceholderText('Paste listing ID'), { target: { value: 'listing123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }));
    await waitFor(() => expect(api.createRating).toHaveBeenCalled());
  });
});
