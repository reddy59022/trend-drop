/**
 * Red test: the Sell page's pricing hint misstates the platform fee.
 *
 * DEFECT: Sell.js renders two conflicting fee figures:
 *   - the pricing hint under the price input: "You'll earn ~price*0.9
 *     after 10% fee" (10% fee, earnings = 90% of price), and
 *   - the earnings summary: "Platform Fee (8%)" with earnings computed at
 *     the real 8% (calculatePlatformFee = price * 0.08).
 * The server charges 8% (config/payments.js countryCommissions). The hint
 * understates the seller's actual earnings by 2% of the price, and directly
 * contradicts the 8% summary rendered on the same page.
 *
 * Correct behavior: the hint must state the 8% fee and show the 8% earnings,
 * consistent with the summary and the server.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user: { _id: 'seller1', name: 'S' } }) }));
jest.mock('../../context/ThemeContext', () => ({ __esModule: true, useTheme: () => ({ currency: 'USD', theme: 'dark' }) }));
jest.mock('../../context/CartContext', () => ({ __esModule: true, useCart: () => ({ cart: [], addToCart: jest.fn() }) }));
jest.mock('../../context/ConfirmContext', () => ({ __esModule: true, useConfirm: () => ({ confirm: jest.fn().mockResolvedValue(true) }) }));
jest.mock('../../context/SocketContext', () => ({ __esModule: true, useSocket: () => ({ socket: null, connected: false }) }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('socket.io-client', () => {
  const mkSocket = () => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
  const ioMock = (...args) => mkSocket();
  return { __esModule: true, io: ioMock, default: ioMock, connect: ioMock };
});

import Sell from '../Sell';

const goToPricing = () => {
  const details = screen.getAllByRole('button').find((b) => b.textContent === 'Details');
  fireEvent.click(details);
  const pricing = screen.getAllByRole('button').find((b) => b.textContent === 'Pricing');
  fireEvent.click(pricing);
};

const typePrice = (value) => {
  const priceInput = document.querySelector('input[name="price"]');
  fireEvent.change(priceInput, { target: { value } });
};

describe('DEFECT: Sell page pricing hint must match the real (8%) platform fee', () => {
  test('the pricing hint states 8% and shows 8% earnings (never 10%/90%)', () => {
    render(<MemoryRouter><Sell /></MemoryRouter>);
    goToPricing();
    typePrice('100');

    expect(screen.getByText(/after 8% fee/i)).toBeInTheDocument();
    expect(screen.getByText(/You'll earn ~\$92\.00/i)).toBeInTheDocument();
    expect(screen.queryByText(/after 10% fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/You'll earn ~\$90\.00/i)).not.toBeInTheDocument();
  });

  test('the earnings summary (Boost step) stays at 8% (regression guard)', () => {
    render(<MemoryRouter><Sell /></MemoryRouter>);
    goToPricing();
    typePrice('100');
    const boost = screen.getAllByRole('button').find((b) => b.textContent === 'Boost');
    fireEvent.click(boost);

    // Earnings summary uses the real 8% fee: $100 - $8 (8%) = $92 gross of
    // boost. Never a 10% fee line, and never the hint's $90 figure.
    expect(screen.getByText(/Platform Fee \(8%\)/i)).toBeInTheDocument();
    expect(screen.getByText('-$8.00')).toBeInTheDocument();
    expect(screen.queryByText(/Platform Fee \(10%\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText('-$10.00')).not.toBeInTheDocument();
  });
});
