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

import Collections from '../Collections';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Collections page', () => {
  const owner = () => setAuth(authUser({ _id: 'seller1', id: 'seller1' }));
  test('renders the empty collections state', async () => {
    owner();
    api.getSellerCollections.mockResolvedValue({ data: [] });
    renderPageWithRoute(<Collections />, { route: '/collections/seller1', path: '/collections/:sellerId' });
    expect(await screen.findByText('No collections yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New Collection/ }));
    expect(screen.getByPlaceholderText('Collection name')).toBeInTheDocument();
  });
  test('renders existing collections', async () => {
    owner();
    api.getSellerCollections.mockResolvedValue({ data: [{ _id: 'c1', name: 'Summer Fits', listings: [] }] });
    api.getCollection.mockResolvedValue({ data: { listings: [] } });
    renderPageWithRoute(<Collections />, { route: '/collections/seller1', path: '/collections/:sellerId' });
    expect((await screen.findAllByText('Summer Fits')).length).toBeGreaterThan(0);
  });
  test('creating a collection calls the API', async () => {
    owner();
    api.getSellerCollections.mockResolvedValue({ data: [] });
    api.createCollection.mockResolvedValue({ data: { _id: 'c2' } });
    renderPageWithRoute(<Collections />, { route: '/collections/seller1', path: '/collections/:sellerId' });
    await screen.findByText('No collections yet');
    fireEvent.click(screen.getByRole('button', { name: /New Collection/ }));
    fireEvent.change(screen.getByPlaceholderText('Collection name'), { target: { value: 'Winter' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(api.createCollection).toHaveBeenCalledWith({ name: 'Winter', description: '' }));
  });
});
