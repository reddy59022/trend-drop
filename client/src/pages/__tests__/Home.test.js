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

import Home from '../Home';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(null); setThemeStore(); setCartStore(); setConfirm(); });

describe('Home page', () => {
  const okListings = (items) => ({ data: { listings: items } });
  test('renders hero, categories, stats and CTA sections', async () => {
    api.get.mockImplementation((url) => Promise.resolve(okListings(url.includes('popular') ? [sampleListing()] : [sampleListing({ _id: 'l2', title: 'New Silk Dress' })])));
    renderPage(<Home />);
    expect(screen.getByRole('main', { name: 'TrendDrop Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start shopping' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start selling' })).toBeInTheDocument();
    expect(document.querySelector('[aria-label=\'Browse Women fashion\']')).toBeInTheDocument();
    expect(screen.getByText(/Trending Now/)).toBeInTheDocument();
    expect(await screen.findByText('Vintage Denim Jacket')).toBeInTheDocument();
    expect(screen.getByText('New Silk Dress')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get started free' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse items' })).toBeInTheDocument();
  });
  test('renders empty states when no listings exist', async () => {
    api.get.mockResolvedValue(okListings([]));
    renderPage(<Home />);
    expect(await screen.findAllByText('No listings yet')).toHaveLength(2);
  });
  test('renders error state with retry when the API fails', async () => {
    api.get.mockRejectedValue(new Error('network down'));
    renderPage(<Home />);
    expect(await screen.findAllByText('Unable to load listings. Please check your connection and try again.')).toHaveLength(2);
    const retry = screen.getAllByRole('button', { name: 'Retry loading listings' });
    expect(retry).toHaveLength(2);
    api.get.mockResolvedValue(okListings([sampleListing()]));
    // user-event not needed; direct click retries fetch
    retry[0].click();
    expect(await screen.findAllByText('Vintage Denim Jacket')).toHaveLength(2);
  });
  test('shows real marketplace numbers instead of the old hard-coded marketing figures', async () => {
    api.get.mockImplementation((url) => {
      if (url.includes('marketplace-stats')) {
        return Promise.resolve({
          data: {
            totalListings: 273,
            totalSellers: 41,
            totalCountries: 33,
            categories: [{ name: 'Women', count: 88 }, { name: 'Men', count: 12 }],
          },
        });
      }
      return Promise.resolve(okListings([sampleListing()]));
    });

    renderPage(<Home />);

    expect(await screen.findByText('273')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('33')).toBeInTheDocument();
    expect(screen.getByText('Items live')).toBeInTheDocument();
    expect(screen.getByText('88 items')).toBeInTheDocument();
    expect(screen.queryByText('1M+')).not.toBeInTheDocument();
    expect(screen.queryByText('50K+')).not.toBeInTheDocument();
    expect(screen.queryByText('12.5K items')).not.toBeInTheDocument();
  });

  test('category cards link to filtered search', async () => {
    api.get.mockResolvedValue(okListings([]));
    renderPage(<Home />);
    await screen.findAllByText('No listings yet');
    expect(document.querySelector('[aria-label=\'Browse Women fashion\']')).toHaveAttribute('href', '/search?category=Women');
  });
});
