import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ErrorBoundary from '../ErrorBoundary';

const Working = () => <div data-testid="ok">ok</div>;

class Throwing extends React.Component {
  render() { throw new Error('boom'); }
}

const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('ErrorBoundary', () => {
  test('renders children when nothing throws', () => {
    render(<MemoryRouter><ErrorBoundary><Working /></ErrorBoundary></MemoryRouter>);
    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });
  test('renders a fallback UI when a child throws', () => {
    render(<MemoryRouter><ErrorBoundary><Throwing /></ErrorBoundary></MemoryRouter>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go Home' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
