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

import Transactions from '../Transactions';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Transactions page', () => {
  test('renders the empty orders state', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderPage(<Transactions />);
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse Items' })).toHaveAttribute('href', '/feed');
  });
  test('renders transactions and expands details on click', async () => {
    api.get.mockResolvedValue({ data: [{ _id: 'txn1', status: 'paid', currency: 'USD', buyer: { _id: 'user123' }, seller: { _id: 'seller1' }, listing: { title: 'Jacket' }, shipping: {}, paymentBreakdown: { subtotal: 40, shippingCost: 5, buyerProtectionFee: 2, totalPaid: 47 } }] });
    renderPage(<Transactions />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/transactions'));
    expect(await screen.findByText('Jacket')).toBeInTheDocument();
    const cards = document.querySelectorAll('.glass-card');
    expect(cards.length).toBeGreaterThan(0);
  });
  test('filter tabs refetch with the selected type', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderPage(<Transactions />);
    await screen.findByText('No orders yet');
    fireEvent.click(screen.getByRole('button', { name: /Sold/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/transactions?type=sold'));
  });
});
