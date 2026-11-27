import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { routerFuture } from '../../test-utils';
import Footer from '../Footer';
import { CONTACT_EMAIL } from '../../utils/contact';

describe('Footer', () => {
  test('renders the TrendDrop branding', () => {
    render(<MemoryRouter future={routerFuture}><Footer /></MemoryRouter>);
    expect(screen.getByText('TrendDrop')).toBeInTheDocument();
  });
  test('renders the footer navigation columns', () => {
    render(<MemoryRouter future={routerFuture}><Footer /></MemoryRouter>);
    expect(screen.getByText('Shop')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });
  test('renders external social links', () => {
    render(<MemoryRouter future={routerFuture}><Footer /></MemoryRouter>);
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
  });
  test('exposes the public contact email everywhere in the footer', () => {
    render(<MemoryRouter future={routerFuture}><Footer /></MemoryRouter>);
    expect(screen.getByRole('link', { name: CONTACT_EMAIL })).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
    expect(screen.getByRole('link', { name: 'Contact Support' })).toHaveAttribute(
      'href',
      expect.stringContaining(`mailto:${CONTACT_EMAIL}`),
    );
  });
});
