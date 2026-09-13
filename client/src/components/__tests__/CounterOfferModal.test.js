import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { setAuth, resetTestState, resetApiMock, authUser } from '../../test-utils';

import CounterOfferModal from '../CounterOfferModal';

beforeEach(() => { resetTestState(); setAuth(authUser()); resetApiMock(api); api.patch.mockResolvedValue({ data: { _id: 'o1' } }); });

const offer = () => ({ _id: 'o1', amount: 60, listing: 'listing123', buyer: 'user123', seller: 'seller1', status: 'countered', currency: 'USD' });

describe('CounterOfferModal', () => {
  test('renders with the counter offer heading', () => {
    render(<CounterOfferModal offer={offer()} type="sent" isOpen onClose={jest.fn()} />);
    expect(screen.getAllByText(/Counter Offer/i).length).toBeGreaterThan(0);
  });
  test('submitting a valid counter calls api.patch and notifies', async () => {
    const onCounterSubmitted = jest.fn();
    render(<CounterOfferModal offer={offer()} type="sent" isOpen onClose={jest.fn()} onCounterSubmitted={onCounterSubmitted} />);
    const spinbutton = screen.getByRole('spinbutton');
    fireEvent.change(spinbutton, { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: /Send|Counter/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(onCounterSubmitted).toHaveBeenCalled();
  });
});
