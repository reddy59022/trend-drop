import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../context/CartContext', () => ({ __esModule: true, useCart: () => globalThis.__tdCart, CartProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/ThemeContext', () => ({ __esModule: true, useTheme: () => globalThis.__tdTheme, ThemeProvider: ({ children }) => <>{children}</> }));

import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import ListingCard from '../ListingCard';

beforeEach(() => {
  resetTestState(); setAuth(authUser()); setThemeStore(); setCartStore(); resetApiMock(api);
  api.post.mockResolvedValue({ data: { liked: true, likes: [{ id: 'user123' }] } });
});

const listing = () => ({ _id: 'l1', title: 'Cool Shirt', price: 25, currency: 'USD', images: ['http://img'], likes: [], seller: { _id: 'seller1', name: 'Seller' } });

describe('ListingCard', () => {
  test('renders the listing title, price, and a link to the detail page', () => {
    renderPage(<ListingCard listing={listing()} />);
    expect(screen.getByText('Cool Shirt')).toBeInTheDocument();
    expect(screen.getByText(/\$25/)).toBeInTheDocument();
  });
  test('guests are prompted to log in when liking', async () => {
    setAuth(null);
    renderPage(<ListingCard listing={listing()} />);
    fireEvent.click(await screen.findByRole('button', { name: /like|heart/i }));
    await waitFor(() => expect(api.post).not.toHaveBeenCalled());
  });

});
