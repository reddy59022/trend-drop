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

import Sell from '../Sell';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Sell page', () => {
  const prime = () => {
    api.get.mockImplementation((url) => {
      if (String(url).includes('/boost/config')) return Promise.resolve({ data: {} });
      if (String(url).includes('/config/features')) return Promise.resolve({ data: {} });
      return Promise.resolve({ data: {} });
    });
  };
  const goToDetails = () => {
    // Stepper buttons jump directly to any step: Photos(0) Details(1) Shipping(2) Pricing(3) Boost(4)
    const btn = screen.getAllByRole('button').find((b) => b.textContent === 'Details');
    fireEvent.click(btn);
  };
  test('renders the photos step first with video input and a gated Next button', async () => {
    prime();
    renderPage(<Sell />);
    expect(screen.getByText('List an Item')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Photos' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://youtube.com/watch?v=... or Instagram/Facebook reel URL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next: Add Details/ })).toBeDisabled();
  });
  test('stepper navigates to the details form with all key fields', async () => {
    prime();
    renderPage(<Sell />);
    goToDetails();
    expect(screen.getByText('Item Details')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Nike Air Max 90')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Describe your item...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Nike')).toBeInTheDocument();
  });
  test('typing a title updates the form', async () => {
    prime();
    renderPage(<Sell />);
    goToDetails();
    const title = screen.getByPlaceholderText('e.g. Nike Air Max 90');
    fireEvent.change(title, { target: { value: 'Cool Jacket' } });
    expect(title.value).toBe('Cool Jacket');
  });
  test('a valid YouTube URL unlocks the Next button with a linked badge', async () => {
    prime();
    renderPage(<Sell />);
    fireEvent.change(
      screen.getByPlaceholderText('https://youtube.com/watch?v=... or Instagram/Facebook reel URL'),
      { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }
    );
    expect(await screen.findByText(/linked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next: Add Details/ })).not.toBeDisabled();
  });
  test('an invalid video URL keeps Next disabled (no linked badge)', async () => {
    prime();
    renderPage(<Sell />);
    fireEvent.change(
      screen.getByPlaceholderText('https://youtube.com/watch?v=... or Instagram/Facebook reel URL'),
      { target: { value: 'not-a-url' } }
    );
    expect(screen.queryByText(/linked/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next: Add Details/ })).toBeDisabled();
  });
  test('submit without media is blocked with a toast', async () => {
    const { toast } = require('react-toastify');
    prime();
    renderPage(<Sell />);
    goToDetails();
    fireEvent.change(screen.getByPlaceholderText('e.g. Nike Air Max 90'), { target: { value: 'Cool Jacket' } });
    fireEvent.change(screen.getByPlaceholderText('Describe your item...'), { target: { value: 'Great jacket' } });
    const form = document.querySelector('form.sell-form');
    fireEvent.submit(form);
    expect(toast.error).toHaveBeenCalledWith('Add at least one image or a video URL');
    expect(api.post).not.toHaveBeenCalled();
  });
});
