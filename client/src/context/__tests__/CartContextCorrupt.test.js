/**
 * Red tests: CartContext must survive a CORRUPT (non-array) localStorage cart.
 *
 * DEFECT: the initializer guards JSON.parse *throwing* but not parsing to a
 * non-array value. localStorage.setItem('cart', 'null') (extensions, partial
 * writes, legacy data) parses to null — and then EVERY cart operation
 * (prev.find / prev.filter / prev.map / [...prev]) throws a TypeError.
 * CartProvider wraps the whole app, so every page crashes until the user
 * manually clears storage.
 *
 * Correct behavior: a non-array stored value is treated as an empty cart —
 * the same degradation the JSON.parse try/catch already applies to
 * *malformed JSON*.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

jest.mock('../../services/api');
jest.mock('../AuthContext', () => ({ __esModule: true, useAuth: () => ({ user: { _id: 'buyer1' } }) }));

import api from '../../services/api';
import { CartProvider, useCart } from '../CartContext';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  api.get.mockResolvedValue({ data: { cart: { items: [] } } });
  api.post.mockResolvedValue({ data: {} });
});

const Probe = () => {
  const { cart, addToCart } = useCart();
  return (
    <div>
      <output data-testid="cart-length">{Array.isArray(cart) ? cart.length : 'NOT-ARRAY'}</output>
      <button onClick={() => addToCart({ listingId: 'l1', price: 10, title: 'T', quantity: 1, available: 5 })}>add</button>
    </div>
  );
};

const renderWithStorage = (storedValue) => {
  localStorage.clear();
  if (storedValue !== undefined) localStorage.setItem('cart', storedValue);
  return render(
    <CartProvider>
      <Probe />
    </CartProvider>
  );
};

describe.each([
  ['null', 'null'],
  ['a JSON number', '5'],
  ['a JSON object', '{"a":1}'],
  ['a JSON string', '"cart"'],
])('DEFECT: stored cart is %s', (_label, stored) => {
  test('renders as an empty cart, never NOT-ARRAY', () => {
    const utils = renderWithStorage(stored);
    expect(utils.getByTestId('cart-length')).toHaveTextContent('0');
  });

  test('addToCart works (prev.find / spread do not throw)', async () => {
    const utils = renderWithStorage(stored);
    fireEvent.click(utils.getByText('add'));
    await waitFor(() => {
      expect(utils.getByTestId('cart-length')).toHaveTextContent('1');
    });
  });
});

describe('sanity: valid stored carts still load', () => {
  test('a stored JSON array is honored', () => {
    const utils = renderWithStorage('[{"listingId":"x","price":1,"quantity":1}]');
    expect(utils.getByTestId('cart-length')).toHaveTextContent('1');
  });

  test('malformed JSON degrades to an empty cart (existing behavior)', () => {
    const utils = renderWithStorage('{not json');
    expect(utils.getByTestId('cart-length')).toHaveTextContent('0');
  });
});
