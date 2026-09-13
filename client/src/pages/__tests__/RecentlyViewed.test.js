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

import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import RecentlyViewed from '../RecentlyViewed';

beforeEach(() => {
  resetTestState(); resetApiMock(api);
  setAuth(authUser());
  setThemeStore(); setCartStore(); setConfirm();
  api.get.mockResolvedValue({ data: { items: [] } });
  api.delete.mockResolvedValue({ data: {} });
});

describe('RecentlyViewed page', () => {
  test('fetches recently viewed items on mount', async () => {
    renderPage(<RecentlyViewed />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/recently-viewed'));
  });
  test('shows the empty state with a Browse Items link when nothing viewed', async () => {
    renderPage(<RecentlyViewed />);
    expect(await screen.findByText('No recently viewed items')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse Items/i })).toBeInTheDocument();
  });
  test('renders viewed items with title, price and View Item link', async () => {
    api.get.mockResolvedValue({ data: { items: [sampleListing()] } });
    renderPage(<RecentlyViewed />);
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText(/View Item/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Item/i })).toHaveAttribute('href', '/listing/listing123');
  });
  test('clearing history removes all items', async () => {
    api.get.mockResolvedValue({ data: { items: [sampleListing()] } });
    renderPage(<RecentlyViewed />);
    fireEvent.click(await screen.findByRole('button', { name: /Clear History/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/recently-viewed/clear'));
    expect(await screen.findByText('No recently viewed items')).toBeInTheDocument();
  });
  test('survives API failure and shows the empty state', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<RecentlyViewed />);
    expect(await screen.findByText('No recently viewed items')).toBeInTheDocument();
  });
});
