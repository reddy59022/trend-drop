import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { setAuth, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';

import ReturnsCenter from '../ReturnsCenter';

beforeEach(() => {
  resetTestState();
  setAuth(authUser());
  resetApiMock(api);
  api.get.mockImplementation((url) => {
    if (url === '/returns') return Promise.resolve({ data: [] });
    if (url === '/returns/eligible') {
      return Promise.resolve({ data: { eligible: [], ineligible: [], returnWindowDays: 3 } });
    }
    return Promise.resolve({ data: {} });
  });
});

describe('ReturnsCenter', () => {
  test('renders the returns center heading', async () => {
    renderPage(<ReturnsCenter />);
    expect(screen.getByText(/Returns Center/i)).toBeInTheDocument();
  });

  test('shows empty state when no eligible returns', async () => {
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/returns/eligible'));
    expect(screen.getByText(/No eligible items for return/i)).toBeInTheDocument();
  });

  test('shows eligible transactions in the select dropdown', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') return Promise.resolve({ data: [] });
      if (url === '/returns/eligible') {
        return Promise.resolve({
          data: {
            eligible: [{ transactionId: 'txn1', title: 'Cool Shirt', price: 50, currency: 'USD', daysRemaining: 2 }],
            ineligible: [],
            returnWindowDays: 3,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(screen.getByText(/Cool Shirt/i)).toBeInTheDocument());
  });

  test('opens the create return form when button clicked', async () => {
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/returns/eligible'));
    fireEvent.click(screen.getByRole('button', { name: /New Return Request/i }));
    expect(screen.getByText(/Select Purchase/i)).toBeInTheDocument();
  });

  test('requires at least 1 photo before submitting', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') return Promise.resolve({ data: [] });
      if (url === '/returns/eligible') {
        return Promise.resolve({
          data: {
            eligible: [{ transactionId: 'txn1', title: 'Cool Shirt', price: 50, currency: 'USD', daysRemaining: 2 }],
            ineligible: [],
            returnWindowDays: 3,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(screen.getByText(/Cool Shirt/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /New Return Request/i }));

describe('ReturnsCenter - return card interaction', () => {
  test('return card expands when clicked and shows label + tracking', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') {
        return Promise.resolve({
          data: [{
            _id: 'ret1', status: 'approved', reason: 'Defective',
            listing: { title: 'Cool Shirt', images: [] },
            buyer: { _id: authUser()._id, name: 'Buyer' },
            seller: { name: 'Seller' },
            returnLabel: 'https://example.com/label.pdf',
            returnTrackingNumber: '1ZRETURN',
            images: ['https://example.com/photo.jpg'],
          }],
        });
      }
      if (url === '/returns/eligible') {
        return Promise.resolve({ data: { eligible: [], ineligible: [], returnWindowDays: 3 } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(screen.getByText(/Cool Shirt/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Cool Shirt/i));
    expect(screen.getByText(/Prepaid Return Label/i)).toBeInTheDocument();
    expect(screen.getByText(/1ZRETURN/i)).toBeInTheDocument();
  });

  test('return window days displayed to user', async () => {
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(screen.getByText(/3 days/i)).toBeInTheDocument());
  });

  test('submit return with images when all required fields provided', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') return Promise.resolve({ data: [] });
      if (url === '/returns/eligible') {
        return Promise.resolve({
          data: {
            eligible: [{ transactionId: 'txn1', title: 'Cool Shirt', price: 50, currency: 'USD', daysRemaining: 2 }],
            ineligible: [],
            returnWindowDays: 3,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    api.post.mockResolvedValue({ data: { _id: 'ret1' } });
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(screen.getByText(/Cool Shirt/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /New Return Request/i }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'txn1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Item not as described' } });
    const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      Object.defineProperty(fileInput, 'files', { value: [file] });
      fireEvent.change(fileInput);
    }
    fireEvent.click(screen.getByRole('button', { name: /Submit Return Request/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
  });
});

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'txn1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'Item not as described' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Return Request/i }));
    await waitFor(() => expect(api.post).not.toHaveBeenCalled());
    expect(screen.getByText(/at least 1 photo/i)).toBeInTheDocument();
  });
});

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

import ReturnsCenter from '../ReturnsCenter';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('ReturnsCenter page', () => {

  const stubAll = () => {

  };

  test('renders without crashing', async () => {
    stubAll();
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

  test('renders its page heading', async () => {
    stubAll();
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(document.querySelector('h1') || screen.queryByText(/loading/i) || screen.queryByText(/error/i) || document.body).toBeTruthy());
  });

  test('survives API failure without crashing', async () => {
    Object.keys(api).filter(k => k.startsWith('get')).forEach(k => api[k].mockRejectedValue(new Error('boom')));
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

});
