import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Footer from '../Footer';

describe('Footer', () => {
  test('renders the AURAVEST branding', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(screen.getByText('AURAVEST')).toBeInTheDocument();
  });
  test('renders the footer navigation columns', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    expect(screen.getByText('Shop')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });
  test('renders external social links', () => {
    render(<MemoryRouter><Footer /></MemoryRouter>);
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
  });
});
