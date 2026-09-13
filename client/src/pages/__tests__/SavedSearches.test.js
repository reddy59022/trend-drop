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

import SavedSearches from '../SavedSearches';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(async () => true); });

describe('SavedSearches page', () => {
  test('renders saved searches', async () => {
    api.getSavedSearches.mockResolvedValue({ data: [{ _id: 's1', name: 'Nike under $100', query: 'nike' }] });
    api.getSavedSearchResults.mockResolvedValue({ data: { listings: [] } });
    renderPage(<SavedSearches />);
    expect((await screen.findAllByText('Nike under $100')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /New Search/ }));
    expect(screen.getByPlaceholderText("Search name (e.g., 'Nike Air Max under $100')")).toBeInTheDocument();
  });
  test('renders the empty state when none are saved', async () => {
    api.getSavedSearches.mockResolvedValue({ data: [] });
    renderPage(<SavedSearches />);
    expect(await screen.findByText('No saved searches')).toBeInTheDocument();
  });
});
