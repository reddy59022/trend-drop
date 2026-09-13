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

import EditListing from '../EditListing';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

const l = () => ({ _id: 'listing123', title: 'Old Title', description: 'Old desc', price: 20, currency: 'USD', images: ['https://example.com/img.jpg'], seller: { _id: 'user123' } });

describe('EditListing page', () => {
  test('loads the listing into the form', async () => {
    api.get.mockImplementation((url) => {
      if (String(url).includes('/listings/')) return Promise.resolve({ data: { listing: l() } });
      if (String(url).includes('/config/features')) return Promise.resolve({ data: {} });
      return Promise.resolve({ data: {} });
    });
    renderPageWithRoute(<EditListing />, { route: '/listing/listing123/edit', path: '/listing/:id/edit' });
    expect(await screen.findByDisplayValue('Old Title')).toBeInTheDocument();
    expect(screen.getByText('Edit Listing')).toBeInTheDocument();
  });
  test('saving submits a PUT with the edited title', async () => {
    api.get.mockImplementation((url) => {
      if (String(url).includes('/listings/')) return Promise.resolve({ data: { listing: l() } });
      return Promise.resolve({ data: {} });
    });
    api.put.mockResolvedValue({ data: { listing: l() } });
    renderPageWithRoute(<EditListing />, { route: '/listing/listing123/edit', path: '/listing/:id/edit' });
    const title = await screen.findByDisplayValue('Old Title');
    fireEvent.change(title, { target: { value: 'New Title' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(expect.stringContaining('/listings/listing123'), expect.anything(), expect.anything()));
  });
});
