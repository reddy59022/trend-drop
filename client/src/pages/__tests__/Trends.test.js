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
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, renderPageWithRoute, authUser, sampleListing } from '../../test-utils';

import Trends from '../Trends';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });



beforeEach(() => { api.get.mockResolvedValue({ data: [] }); api.post.mockResolvedValue({ data: {} }); });

describe('Trends page', () => {
  test('renders the Trending Now heading and Refresh button', async () => {
    renderPage(<Trends />);
    expect(screen.getByText(/Trending Now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
  });
  test('fetches trends with the default weekly timeframe', async () => {
    renderPage(<Trends />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/trends', expect.objectContaining({ params: { timeframe: 'week' } })));
  });
  test('switching to the Viral tab fetches viral trends', async () => {
    renderPage(<Trends />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Viral/i }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/trends/viral', expect.anything()));
  });
  test('changing the timeframe refetches with the new param', async () => {
    renderPage(<Trends />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Day/i }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ params: { timeframe: 'day' } })));
  });
  test('shows the empty state when there are no trends', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderPage(<Trends />);
    expect(await screen.findByText('No trends found')).toBeInTheDocument();
  });
  test('Refresh triggers a trends refresh POST and refetch', async () => {
    renderPage(<Trends />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    api.get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/trends/refresh'));
    await waitFor(() => expect(api.get).toHaveBeenCalled());
  });
  test('renders trending listing cards when data exists', async () => {
    api.get.mockResolvedValue({ data: [{ postId: 'p1', author: 'FashionFanatic', text: 'Y2K is back!', likes: 120, reposts: 30, replies: 8, isViral: true }] });
    renderPage(<Trends />);
    expect(await screen.findByText('FashionFanatic')).toBeInTheDocument();
    expect(screen.getByText('Y2K is back!')).toBeInTheDocument();
  });
  test('survives API failure without crashing', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<Trends />);
    expect(screen.getByText(/Trending Now/i)).toBeInTheDocument();
  });
});
