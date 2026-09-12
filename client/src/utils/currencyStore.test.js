/**
 * currencyStore — the reactive binding for the preferred-currency store.
 *
 * usePreferredCurrency() re-renders a component whenever the user selects a
 * different currency (or IP auto-detection updates it), so money display can
 * stay live even in components rendered outside the routed subtree.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { setPreferredCurrency } from './helpers';
import { usePreferredCurrency, getPreferredCurrency } from './currencyStore';

const Probe = () => {
  const preferred = usePreferredCurrency();
  return <span data-testid="preferred">{preferred}</span>;
};

beforeEach(() => {
  setPreferredCurrency('USD');
});

describe('usePreferredCurrency — live preferred-currency display', () => {
  test('reads the current preferred currency', () => {
    render(<Probe />);
    expect(screen.getByTestId('preferred')).toHaveTextContent('USD');
  });

  test('re-renders the component when the currency changes', () => {
    render(<Probe />);
    act(() => { setPreferredCurrency('GBP'); });
    expect(screen.getByTestId('preferred')).toHaveTextContent('GBP');
    act(() => { setPreferredCurrency('USD'); });
    expect(screen.getByTestId('preferred')).toHaveTextContent('USD');
  });

  test('no-op changes (same currency) do not disrupt the display', () => {
    render(<Probe />);
    act(() => { setPreferredCurrency('USD'); });
    expect(screen.getByTestId('preferred')).toHaveTextContent('USD');
  });

  test('getPreferredCurrency reflects the latest selection', () => {
    expect(getPreferredCurrency()).toBe('USD');
    setPreferredCurrency('INR');
    expect(getPreferredCurrency()).toBe('INR');
  });
});