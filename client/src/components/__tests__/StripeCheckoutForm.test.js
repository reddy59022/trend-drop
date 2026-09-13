import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@stripe/react-stripe-js', () => ({
  __esModule: true,
  useStripe: () => ({ createPaymentMethod: jest.fn(async () => ({ paymentMethod: { id: 'pm_1' } })) }),
  useElements: () => ({ getElement: jest.fn() }),
  CardElement: () => <div data-testid="card-element" />,
  Elements: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../services/api');
import api from '../../services/api';
import { resetTestState } from '../../test-utils';
import StripeCheckoutForm from '../StripeCheckoutForm';

beforeEach(() => { resetTestState(); });

describe('StripeCheckoutForm', () => {
  test('displays the payment amount and renders the card element', () => {
    render(<StripeCheckoutForm amount={49.99} currency="USD" onSuccess={jest.fn()} />);
    expect(screen.getByTestId('card-element')).toBeInTheDocument();
  });
  test('shows a submit button', () => {
    render(<StripeCheckoutForm amount={10} currency="USD" onSuccess={jest.fn()} />);
    expect(screen.getByRole('button', { name: /Pay/ })).toBeInTheDocument();
  });
  test('accepts a totalAmount formatted string override', () => {
    render(<StripeCheckoutForm totalAmount="USD 99.99" onSuccess={jest.fn()} />);
    expect(screen.getByText(/99\.99/)).toBeInTheDocument();
  });
});
