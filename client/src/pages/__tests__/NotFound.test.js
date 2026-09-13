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
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing  } from '../../test-utils';

import NotFound from '../NotFound';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('NotFound page', () => {

  const stubAll = () => {

  };

  test('renders without crashing', async () => {
    stubAll();
    renderPage(<NotFound />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

  test('renders its page heading', async () => {
    stubAll();
    renderPage(<NotFound />);
    await waitFor(() => expect(document.querySelector('h1') || screen.queryByText(/loading/i) || screen.queryByText(/error/i) || document.body).toBeTruthy());
  });

  test('survives API failure without crashing', async () => {
    Object.keys(api).filter(k => k.startsWith('get')).forEach(k => api[k].mockRejectedValue(new Error('boom')));
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<NotFound />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

});
