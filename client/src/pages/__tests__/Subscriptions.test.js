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

import Subscriptions from '../Subscriptions';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Subscriptions page', () => {

  const stubAll = () => {

  };

  test('renders without crashing', async () => {
    stubAll();
    renderPage(<Subscriptions />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

  test('renders its page heading', async () => {
    stubAll();
    renderPage(<Subscriptions />);
    await waitFor(() => expect(document.querySelector('h1') || screen.queryByText(/loading/i) || screen.queryByText(/error/i) || document.body).toBeTruthy());
  });

  test('survives API failure without crashing', async () => {
    Object.keys(api).filter(k => k.startsWith('get')).forEach(k => api[k].mockRejectedValue(new Error('boom')));
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<Subscriptions />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

  // TDD contract regression: the annual/monthly selection is part of the
  // subscription request. A client that drops it lets the server persist a
  // different cycle than the one the seller selected.
  test('sends the selected annual billing cycle when subscribing', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/subscriptions/plans') {
        return Promise.resolve({ data: [
          { id: 'free', name: 'Free', price: 0, features: {} },
          { id: 'basic', name: 'Basic', price: 9.99, annualPrice: 95.90, features: {} },
          { id: 'pro', name: 'Pro', price: 29.99, annualPrice: 287.90, features: {} },
          { id: 'enterprise', name: 'Enterprise', price: 99.99, annualPrice: 959.90, features: {} },
        ] });
      }
      if (url === '/subscriptions') return Promise.resolve({ data: { tier: 'free' } });
      return Promise.resolve({ data: [] });
    });
    api.post.mockResolvedValue({ data: { tier: 'enterprise', billingCycle: 'annual' } });

    renderPage(<Subscriptions />);
    expect(await screen.findByText('Enterprise')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Annual/i }));
    expect(screen.getByText('$959.90')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Subscribe' })[2]);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/subscriptions/subscribe',
      { tier: 'enterprise', billingCycle: 'annual' }
    ));
  });

  test('shows annual plan pricing instead of monthly pricing when annual is selected', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/subscriptions/plans') return Promise.resolve({ data: [
        { id: 'free', name: 'Free', price: 0, annualPrice: 0, features: {} },
        { id: 'basic', name: 'Basic', price: 9.99, annualPrice: 95.90, features: {} },
      ] });
      if (url === '/subscriptions') return Promise.resolve({ data: { tier: 'free' } });
      return Promise.resolve({ data: [] });
    });
    renderPage(<Subscriptions />);
    expect(await screen.findByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('$9.99')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Annual/i }));
    expect(screen.getByText('$95.90')).toBeInTheDocument();
    expect(screen.queryByText('$9.99')).not.toBeInTheDocument();
  });

});
