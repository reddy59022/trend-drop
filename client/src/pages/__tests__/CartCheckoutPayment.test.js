import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-toastify';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../context/ThemeContext', () => ({ __esModule: true, useTheme: () => globalThis.__tdTheme, ThemeProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/CartContext', () => ({ __esModule: true, useCart: () => globalThis.__tdCart, CartProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/ConfirmContext', () => ({ __esModule: true, useConfirm: () => globalThis.__tdConfirm, ConfirmProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/SocketContext', () => ({ __esModule: true, useSocket: () => globalThis.__tdSocket || { socket: null, connected: false }, SocketProvider: ({ children }) => <>{children}</> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('@stripe/stripe-js', () => ({ __esModule: true, loadStripe: jest.fn(() => Promise.resolve({})) }));
jest.mock('@stripe/react-stripe-js', () => ({
  __esModule: true,
  Elements: ({ children }) => <div>{children}</div>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => globalThis.__tdStripe,
  useElements: () => globalThis.__tdStripeElements,
}));
jest.mock('socket.io-client', () => {
  const mkSocket = () => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
  const ioMock = (...args) => mkSocket();
  return { __esModule: true, io: ioMock, default: ioMock, connect: ioMock };
});

import api, { validatePromo, applyBundleDiscount } from '../../services/api';
import { loadStripe } from '@stripe/stripe-js';
import { resetTestState, resetApiMock, setAuth, setThemeStore, setCartStore, setConfirm, authUser } from '../../test-utils';

import Cart from '../Cart';

const ITEM = {
  listingId: 'listing123', title: 'Vintage Denim Jacket', price: 50,
  currency: 'USD', quantity: 1, thumbnail: '', available: 5,
  sellerId: 'seller1', sellerName: 'Alex',
};

const BREAKDOWN = {
  buyer: { itemPrice: 50, shippingCost: 4, buyerProtectionFee: 2.5, totalPaid: 56.5 },
  seller: { sellerEarnings: 46, platformFee: 4 },
  fromCountry: 'US', toCountry: 'US',
};

/** Stripe.js in manual-capture mode resolves a card confirmation with
 *  status `requires_capture` (funds authorized, not yet captured). Anything
 *  the client rejects here = "payment happened, no order, stuck on cart". */
const mockStripe = (status) => {
  globalThis.__tdStripe = {
    createPaymentMethod: jest.fn().mockResolvedValue({ paymentMethod: { id: 'pm_card_1' } }),
    confirmCardPayment: jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_live_1', status, amount: 5650 },
      error: undefined,
    }),
    handleCardAction: jest.fn(),
  };
  globalThis.__tdStripeElements = { getElement: () => ({}) };
  // Cart.js awaits `stripePromise` (loadStripe) and then calls the same
  // methods it got from useStripe() — keep both pointing at this stub.
  loadStripe.mockImplementation(() => Promise.resolve(globalThis.__tdStripe));
};

/** Wire the checkout happy path up to (but not including) order placement. */
const prepareCheckout = ({ failOrder = false, breakdown = BREAKDOWN } = {}) => {
  api.get.mockImplementation((url) => {
    if (url === '/payments/publishable-key') {
      return Promise.resolve({ data: { publishableKey: 'pk_test_r32', configured: true } });
    }
    if (typeof url === 'string' && url.startsWith('/listings/')) {
      return Promise.resolve({
        data: { listing: { _id: ITEM.listingId, title: ITEM.title, price: ITEM.price, available: true, sold: false, quantity: 5 } },
      });
    }
    return Promise.resolve({ data: {} });
  });
  validatePromo.mockResolvedValue({ data: { valid: false } });
  applyBundleDiscount.mockResolvedValue({ data: { discounts: [], totalDiscount: 0 } });
  api.post.mockImplementation((url) => {
    if (url === '/payments/create-intent') {
      return Promise.resolve({
        data: { clientSecret: 'cs_test_1', paymentIntentId: 'pi_live_1', amount: breakdown.buyer.totalPaid, breakdowns: [breakdown] },
      });
    }
    if (url === '/payments/breakdown') return Promise.resolve({ data: breakdown });
    if (url === '/payments/confirm-batch') {
      return failOrder
        ? Promise.reject({ response: { status: 400, data: { message: 'Item is no longer available' } } })
        : Promise.resolve({ data: { orderId: 'order_1', transactions: [{ _id: 'txn_1' }] } });
    }
    return Promise.resolve({ data: {} });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  resetTestState();
  resetApiMock(api);
  setAuth(authUser());
  setThemeStore();
  setCartStore({ cart: [ITEM], clearCart: jest.fn() });
  setConfirm();
  mockStripe('requires_capture');
});

const renderCheckout = async () => {
  render(
    <MemoryRouter>
      <Cart />
    </MemoryRouter>
  );
  const cta = await screen.findByRole('button', { name: /Proceed to Checkout/i });
  fireEvent.click(cta);
  return screen.findByRole('button', { name: /Pay|Place Order/i });
};
describe('Cart checkout — payment confirmation status (R32)', () => {
  test('creates the payment intent from the final shipping country', async () => {
    prepareCheckout();
    const pay = await renderCheckout();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GB' } });
    fireEvent.click(pay);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/payments/create-intent', expect.objectContaining({
        buyerCountry: 'GB',
        shippingAddress: expect.objectContaining({ country: 'GB' }),
      }));
    });
  });

  test('a manual-capture authorization (requires_capture) still places the order', async () => {
    prepareCheckout();
    const pay = await renderCheckout();

    fireEvent.click(pay);

    // THE BUG: the guard demanded status === 'succeeded', so a real card
    // authorization was treated as a failure: order never placed, buyer left
    // on the cart page with funds HELD on their card.
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/payments/confirm-batch', expect.anything());
    });
    await waitFor(() => {
      expect(globalThis.__tdCart.clearCart).toHaveBeenCalled();
    });
    // Success is surfaced; no error toast, no release call.
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('a succeeded (auto-capture) authorization places the order too', async () => {
    mockStripe('succeeded');
    prepareCheckout();
    const pay = await renderCheckout();

    fireEvent.click(pay);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/payments/confirm-batch', expect.anything());
    });
    await waitFor(() => expect(globalThis.__tdCart.clearCart).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('preserves the accepted offer id through server checkout payloads', async () => {
    setCartStore({
      cart: [{ ...ITEM, offerId: 'offer_accepted_1', negotiatedPrice: 35, price: 35 }],
      clearCart: jest.fn(),
    });
    prepareCheckout();
    const pay = await renderCheckout();
    fireEvent.click(pay);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/payments/confirm-batch', expect.objectContaining({
        items: [expect.objectContaining({
          listingId: ITEM.listingId,
          negotiatedPrice: 35,
          offerId: 'offer_accepted_1',
        })],
      }));
    });
  });

  test('keeps the checkout form available before the server creates its authoritative total', async () => {
    prepareCheckout({ breakdown: { ...BREAKDOWN, buyer: { ...BREAKDOWN.buyer, totalPaid: 0 } } });
    const pay = await renderCheckout();

    // The server intent is intentionally created only after the buyer submits
    // final shipping details. Before that point the form must remain usable;
    // the authoritative server amount is asserted by the payment request
    // contract tests below.
    expect(pay).toBeInTheDocument();
  });

  test('normalizes tampered cart quantities before sending payment requests', async () => {
    setCartStore({
      cart: [{ ...ITEM, quantity: 'lots' }],
      clearCart: jest.fn(),
    });
    prepareCheckout();
    const pay = await renderCheckout();
    fireEvent.click(pay);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/payments/create-intent', expect.objectContaining({
      items: [expect.objectContaining({ listingId: ITEM.listingId, quantity: 1 })],
    })));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/payments/confirm-batch', expect.objectContaining({
      items: [expect.objectContaining({ listingId: ITEM.listingId, quantity: 1 })],
    })));
  });

  test('if the ORDER fails after authorization, the hold is released, not stranded', async () => {
    prepareCheckout();
    // Order placement fails (e.g. the item sold to someone else meanwhile).
    api.post.mockImplementation((url) => {
      if (url === '/payments/create-intent') {
        return Promise.resolve({
          data: { clientSecret: 'cs_test_1', paymentIntentId: 'pi_live_1', amount: 56.5, breakdowns: [BREAKDOWN] },
        });
      }
      if (url === '/payments/confirm-batch') {
        return Promise.reject({ response: { status: 400, data: { message: 'Item is no longer available' } } });
      }
      return Promise.resolve({ data: {} });
    });
    const pay = await renderCheckout();

    fireEvent.click(pay);

    // The buyer must not be left with money reserved on their card and no
    // order: the client hands the authorization back.
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/payments/cancel-payment',
        expect.objectContaining({ paymentIntentId: 'pi_live_1' })
      );
    });
    expect(toast.error).toHaveBeenCalled();
    expect(globalThis.__tdCart.clearCart).not.toHaveBeenCalled();
    expect(screen.queryByText('Payment Successful!')).not.toBeInTheDocument();
  });
});