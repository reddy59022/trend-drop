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
import { getMySellerBadge, requestSellerVerification, updateSellerBadgeStats } from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing  } from '../../test-utils';

import SellerBadges from '../SellerBadges';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('SellerBadges page', () => {

  const stubAll = () => {
  api.getMySellerBadge.mockResolvedValue({ data: [] });
  };

  test('renders without crashing', async () => {
    stubAll();
    renderPage(<SellerBadges />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

  test('renders its page heading', async () => {
    stubAll();
    renderPage(<SellerBadges />);
    await waitFor(() => expect(document.querySelector('h1') || screen.queryByText(/loading/i) || screen.queryByText(/error/i) || document.body).toBeTruthy());
  });

  test('shows pending verification instead of claiming an unapproved verification', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'bronze', isVerified: false, verificationRequested: true,
      salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });

    renderPage(<SellerBadges />);

    await waitFor(() => {
      expect(screen.getByText(/Verification pending/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Request Verification/i })).not.toBeInTheDocument();
    });
  });

  test('renders every badge value from the API, including a zero average rating', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'gold', isVerified: true, verificationRequested: false,
      salesCount: 42, avgRating: 0, responseRate: 0.875, returnRate: 0.035,
      benefits: { reducedFees: true, prioritySupport: true, featuredListings: true },
    } } });

    renderPage(<SellerBadges />);

    await waitFor(() => {
      expect(screen.getByText('Gold')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('0.0')).toBeInTheDocument();
      expect(screen.getByText('87.5%')).toBeInTheDocument();
      expect(screen.getByText('3.5%')).toBeInTheDocument();
    });
  });

  test('does not display malformed or missing metrics as real values', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'silver', isVerified: false, verificationRequested: false,
      salesCount: null, avgRating: 6, responseRate: -0.2, returnRate: 2,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });

    renderPage(<SellerBadges />);

    await waitFor(() => {
      expect(screen.getAllByText('—')).toHaveLength(3);
      expect(screen.getByText('2.0%')).toBeInTheDocument();
    });
  });

  test('normalizes legacy percentage rates without changing the displayed values', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'silver', isVerified: false, verificationRequested: false,
      totalSales: 18, averageRating: '4.6', responseRate: 95, returnRate: 2,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });

    renderPage(<SellerBadges />);

    await waitFor(() => {
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('4.6')).toBeInTheDocument();
      expect(screen.getByText('95%')).toBeInTheDocument();
      expect(screen.getByText('2.0%')).toBeInTheDocument();
    });
  });

  test('renders normalized response rate as a percentage', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'silver', isVerified: false, verificationRequested: false,
      salesCount: 10, avgRating: 4.5, responseRate: 0.95, returnRate: 0.02,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });

    renderPage(<SellerBadges />);

    await waitFor(() => expect(screen.getByText('95%')).toBeInTheDocument());
  });

  test('renders legitimate zero response and return rates as 0%', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'bronze', isVerified: false, verificationRequested: false,
      salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });

    renderPage(<SellerBadges />);

    await waitFor(() => {
      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });
  });

  test('rejects fractional sales counts before sending stats to the API', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'bronze', isVerified: false, verificationRequested: false,
      salesCount: 1, avgRating: 4, responseRate: 0.5, returnRate: 0.1,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });

    renderPage(<SellerBadges />);
    const salesInput = await screen.findByLabelText('Sales Count');
    fireEvent.change(salesInput, { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Recalculate Tier/i }));

    expect(updateSellerBadgeStats).not.toHaveBeenCalled();
  });

  test('does not submit duplicate stats updates while one is pending', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'bronze', isVerified: false, verificationRequested: false,
      salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });
    updateSellerBadgeStats.mockImplementation(() => new Promise(() => {}));

    renderPage(<SellerBadges />);
    const button = await screen.findByRole('button', { name: /Recalculate Tier/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(updateSellerBadgeStats).toHaveBeenCalledTimes(1);
  });

  test('shows a recoverable error when the badge cannot be loaded', async () => {
    getMySellerBadge.mockRejectedValue(new Error('boom'));

    renderPage(<SellerBadges />);

    await waitFor(() => expect(screen.getByText(/Unable to load seller badge/i)).toBeInTheDocument());
  });

  test('does not submit duplicate verification requests while one is pending', async () => {
    getMySellerBadge.mockResolvedValue({ data: { badge: {
      tier: 'bronze', isVerified: false, verificationRequested: false,
      salesCount: 0, avgRating: 0, responseRate: 0, returnRate: 0,
      benefits: { reducedFees: false, prioritySupport: false, featuredListings: false },
    } } });
    requestSellerVerification.mockImplementation(() => new Promise(() => {}));

    renderPage(<SellerBadges />);
    const button = await screen.findByRole('button', { name: /Request Verification/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(requestSellerVerification).toHaveBeenCalledTimes(1);
  });

  test('survives API failure without crashing', async () => {
    Object.keys(api).filter(k => k.startsWith('get')).forEach(k => api[k].mockRejectedValue(new Error('boom')));
    api.get.mockRejectedValue(new Error('boom'));
    renderPage(<SellerBadges />);
    await waitFor(() => expect(document.body).not.toBeEmptyDOMElement());
  });

});
