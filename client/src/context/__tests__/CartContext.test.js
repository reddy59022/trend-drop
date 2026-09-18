import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../services/api');
jest.mock('../AuthContext', () => ({ __esModule: true, useAuth: () => ({ user: { _id: 'buyer1' } }) }));

import api from '../../services/api';
import { CartProvider, useCart } from '../CartContext';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

const OfferProbe = () => {
  const { cart, addToCart } = useCart();
  const item = cart[0];
  return (
    <>
      <button onClick={() => addToCart({
        listingId: 'listing1',
        title: 'Offer item',
        price: 40,
        negotiatedPrice: 40,
        offerId: 'offer1',
        currency: 'USD',
        quantity: 1,
        available: 1,
      })}>buy at offer</button>
      <output data-testid="price">{item?.price ?? ''}</output>
      <output data-testid="negotiated">{item?.negotiatedPrice ?? ''}</output>
      <output data-testid="offer">{item?.offerId ?? ''}</output>
    </>
  );
};

test('sends the canonical resulting quantity when adding to an existing server cart item', async () => {
  localStorage.setItem('cart', JSON.stringify([{
    listingId: 'listing1', title: 'Existing item', price: 40, quantity: 1, available: 10,
  }]));
  let cartReads = 0;
  api.get.mockImplementation(async () => {
    cartReads += 1;
    if (cartReads <= 2) return { data: { cart: { items: [] } } };
    return { data: { cart: { items: [{
      listing: { _id: 'listing1', title: 'Existing item', price: 40, images: [], available: true, quantity: 10, seller: 'seller1' },
      quantity: 3,
    }] } } };
  });
  api.post.mockResolvedValue({ data: {} });

  const ExistingProbe = () => {
    const { cart, addToCart } = useCart();
    return <>
      <button onClick={() => addToCart({ listingId: 'listing1', title: 'Existing item', price: 40, quantity: 2, available: 10 })}>add two</button>
      <output data-testid="resulting-quantity">{cart[0]?.quantity ?? ''}</output>
    </>;
  };

  render(<CartProvider><ExistingProbe /></CartProvider>);
  await waitFor(() => expect(screen.getByTestId('resulting-quantity')).toHaveTextContent('1'));
  fireEvent.click(screen.getByRole('button', { name: 'add two' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/cart/items', {
    listingId: 'listing1', quantity: 3,
  }));
  await waitFor(() => expect(screen.getByTestId('resulting-quantity')).toHaveTextContent('3'));
});

test('preserves accepted offer price when the server cart syncs after add', async () => {
  let cartReads = 0;
  api.get.mockImplementation(async () => {
    cartReads += 1;
    return cartReads <= 2
      ? { data: { cart: { items: [] } } }
      : { data: { cart: { items: [{
        listing: {
          _id: 'listing1',
          title: 'Offer item',
          price: 100,
          images: [],
          available: true,
          quantity: 1,
          seller: 'seller1',
        },
        quantity: 1,
      }] } } };
  });
  api.post.mockResolvedValue({ data: {} });

  render(<CartProvider><OfferProbe /></CartProvider>);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/cart'));
  fireEvent.click(screen.getByRole('button', { name: /buy at offer/i }));

  await waitFor(() => {
    expect(screen.getByTestId('price')).toHaveTextContent('40');
    expect(screen.getByTestId('negotiated')).toHaveTextContent('40');
    expect(screen.getByTestId('offer')).toHaveTextContent('offer1');
  });
});
