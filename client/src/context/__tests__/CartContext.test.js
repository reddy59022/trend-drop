import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../services/api');
jest.mock('../AuthContext', () => ({ __esModule: true, useAuth: () => ({ user: { _id: 'buyer1' } }) }));

import api from '../../services/api';
import { CartProvider, useCart } from '../CartContext';

const Probe = () => {
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

test('preserves accepted offer price when the server cart syncs after add', async () => {
  let cartReads = 0;
  api.get.mockImplementation(async () => {
    cartReads += 1;
    return cartReads === 1
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

  render(<CartProvider><Probe /></CartProvider>);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/cart'));

  fireEvent.click(screen.getByRole('button', { name: /buy at offer/i }));

  await waitFor(() => {
    expect(screen.getByTestId('price')).toHaveTextContent('40');
    expect(screen.getByTestId('negotiated')).toHaveTextContent('40');
    expect(screen.getByTestId('offer')).toHaveTextContent('offer1');
  });
});
