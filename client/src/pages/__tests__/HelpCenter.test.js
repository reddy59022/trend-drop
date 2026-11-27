import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { routerFuture } from '../../test-utils';
import HelpCenter from '../HelpCenter';
import { CONTACT_EMAIL } from '../../utils/contact';

const renderPage = () => render(
  <MemoryRouter future={routerFuture}>
    <HelpCenter />
  </MemoryRouter>,
);

describe('HelpCenter page', () => {
  test('renders the Help Center heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Help Center' })).toBeInTheDocument();
  });

  test('offers the canonical support address as a mail draft', () => {
    renderPage();
    const supportLinks = screen
      .getAllByRole('link')
      .filter((link) => (link.getAttribute('href') || '').startsWith('mailto:'));
    expect(supportLinks.length).toBeGreaterThan(0);
    supportLinks.forEach((link) => {
      expect(link.getAttribute('href')).toContain(`mailto:${CONTACT_EMAIL}`);
    });
    screen.getAllByRole('link', { name: CONTACT_EMAIL }).forEach((link) => {
      expect(link.getAttribute('href')).toContain(`mailto:${CONTACT_EMAIL}`);
    });
  });

  test('links to account and legal self-service pages', () => {
    renderPage();
    screen.getAllByRole('link', { name: /Account settings/ }).forEach((link) => {
      expect(link.getAttribute('href')).toBe('/settings');
    });
    const quickLinks = screen.getByRole('heading', { name: 'Quick links' }).parentElement;
    const legalLinks = within(quickLinks).getAllByRole('link', { name: /Legal center/ });
    expect(legalLinks.length).toBeGreaterThan(0);
    legalLinks.forEach((link) => expect(link.getAttribute('href')).toBe('/legal'));
  });
});
