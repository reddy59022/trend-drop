import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { setAuth, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';

import OfferModal from '../OfferModal';

beforeEach(() => {
  resetTestState(); setAuth(authUser()); resetApiMock(api);
  api.get.mockResolvedValue({ data: null });
  api.post.mockResolvedValue({ data: { _id: 'o1' } });
});

const listing = () => ({ _id: 'listing123', title: 'Cool Shirt', price: 50, currency: 'USD' });

describe('OfferModal', () => {
  test('renders nothing when closed', () => {
    render(<OfferModal listing={listing()} isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByText(/Make an Offer/i)).not.toBeInTheDocument();
  });
  test('renders the modal header when open', () => {
    renderPage(<OfferModal listing={listing()} isOpen onClose={jest.fn()} />);
    expect(screen.getByText('Cool Shirt')).toBeInTheDocument();
  });
  test('submitting a valid offer calls the API and notifies the parent', async () => {
    const onOfferSubmitted = jest.fn();
    renderPage(<OfferModal listing={listing()} isOpen onClose={jest.fn()} onOfferSubmitted={onOfferSubmitted} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Offer/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/offers', expect.objectContaining({ listingId: 'listing123', amount: 40 })));
    expect(onOfferSubmitted).toHaveBeenCalled();
  });
  test('offers above the listing price are rejected', async () => {
    renderPage(<OfferModal listing={listing()} isOpen onClose={jest.fn()} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Offer/i }));
    await waitFor(() => expect(api.post).not.toHaveBeenCalled());
  });
});
