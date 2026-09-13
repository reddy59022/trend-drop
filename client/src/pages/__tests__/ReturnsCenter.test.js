import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { setAuth, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';

import ReturnsCenter from '../ReturnsCenter';

beforeEach(() => {
  resetTestState();
  setAuth(authUser());
  resetApiMock(api);
  api.get.mockImplementation((url) => {
    if (url === '/returns') return Promise.resolve({ data: [] });
    if (url === '/returns/eligible') {
      return Promise.resolve({ data: { eligible: [], ineligible: [], returnWindowDays: 3 } });
    }
    return Promise.resolve({ data: {} });
  });
});

describe('ReturnsCenter', () => {
  test('renders the returns center heading', async () => {
    renderPage(<ReturnsCenter />);
    expect(screen.getByText(/Returns Center/i)).toBeInTheDocument();
  });

  test('shows empty state when no eligible returns', async () => {
    renderPage(<ReturnsCenter />);
    const button = await screen.findByRole('button', { name: /New Return Request/i });
    fireEvent.click(button);
    expect(screen.getByText(/eligible for return/i)).toBeInTheDocument();
  });

  test('shows eligible transactions in the select dropdown', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') return Promise.resolve({ data: [] });
      if (url === '/returns/eligible') {
        return Promise.resolve({
          data: {
            eligible: [{ transactionId: 'txn1', title: 'Cool Shirt', price: 50, currency: 'USD', daysRemaining: 2 }],
            ineligible: [],
            returnWindowDays: 3,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage(<ReturnsCenter />);
    const button = await screen.findByRole('button', { name: /New Return Request/i });
    fireEvent.click(button);
    const selects = screen.getAllByRole('combobox');
    expect(selects[0].querySelector('option[value="txn1"]')).toBeTruthy();
  });

  test('opens the create return form when button clicked', async () => {
    renderPage(<ReturnsCenter />);
    const button = await screen.findByRole('button', { name: /New Return Request/i });
    fireEvent.click(button);
    expect(screen.getByText(/Select Purchase/i)).toBeInTheDocument();
  });

  test('requires at least 1 photo before submitting', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') return Promise.resolve({ data: [] });
      if (url === '/returns/eligible') {
        return Promise.resolve({
          data: {
            eligible: [{ transactionId: 'txn1', title: 'Cool Shirt', price: 50, currency: 'USD', daysRemaining: 2 }],
            ineligible: [],
            returnWindowDays: 3,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage(<ReturnsCenter />);
    const button = await screen.findByRole('button', { name: /New Return Request/i });
    fireEvent.click(button);

    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[0], { target: { value: 'txn1' } });
    fireEvent.change(comboboxes[1], { target: { value: 'Item not as described' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Return Request/i }));
    await waitFor(() => expect(api.post).not.toHaveBeenCalled());
    expect(screen.getByText(/at least 1 photo/i)).toBeInTheDocument();
  });
});

describe('ReturnsCenter - return card interaction', () => {
  test('return card expands when clicked and shows tracking', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/returns') {
        return Promise.resolve({
          data: [{
            _id: 'ret1', status: 'approved', reason: 'Defective',
            listing: { title: 'Cool Shirt', images: [] },
            buyer: { _id: authUser()._id, name: 'Buyer' },
            seller: { name: 'Seller' },
            returnLabel: 'https://example.com/label.pdf',
            returnTrackingNumber: '1ZRETURN',
            images: ['https://example.com/photo.jpg'],
          }],
        });
      }
      if (url === '/returns/eligible') {
        return Promise.resolve({ data: { eligible: [], ineligible: [], returnWindowDays: 3 } });
      }
      return Promise.resolve({ data: {} });
    });
    renderPage(<ReturnsCenter />);
    await waitFor(() => expect(screen.getByText(/Cool Shirt/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Cool Shirt/i));
    await waitFor(() => expect(screen.getByText(/1ZRETURN/i)).toBeInTheDocument());
  });
});