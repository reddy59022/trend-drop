import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import RouteAnnouncer from '../RouteAnnouncer';

const Nav = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/messages')}>open messages</button>
      <button onClick={() => navigate('/no-such-page')}>open missing</button>
    </>
  );
};

const setup = (path = '/') => render(
  <MemoryRouter initialEntries={[path]}>
    <RouteAnnouncer />
    <main id="main-content" tabIndex={-1}>page content</main>
    <Nav />
  </MemoryRouter>,
);

const announcer = () => screen.getByTestId('route-announcer');

describe('RouteAnnouncer', () => {
  beforeEach(() => {
    window.scrollTo = jest.fn();
    document.title = 'TrendDrop';
  });

  test('sets the title on first load without stealing focus or announcing', async () => {
    setup('/inventory');

    expect(document.title).toBe('Inventory · TrendDrop');
    expect(document.activeElement).not.toBe(document.getElementById('main-content'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(announcer()).toHaveTextContent('');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  test('focuses the main landmark and announces the screen on a route change', async () => {
    setup('/');
    await userEvent.click(screen.getByRole('button', { name: 'open messages' }));

    expect(document.title).toBe('Messages · TrendDrop');
    expect(document.activeElement).toBe(document.getElementById('main-content'));
    await waitFor(() => expect(announcer()).toHaveTextContent('Navigated to Messages'));
  });

  test('announces the 404 screen for an unknown route', async () => {
    setup('/');
    await userEvent.click(screen.getByRole('button', { name: 'open missing' }));

    expect(document.title).toBe('Page not found · TrendDrop');
    await waitFor(() => expect(announcer()).toHaveTextContent('Navigated to Page not found'));
  });

  test('the live region is polite, atomic and present from the first render', () => {
    setup('/');
    expect(announcer()).toHaveAttribute('role', 'status');
    expect(announcer()).toHaveAttribute('aria-live', 'polite');
    expect(announcer()).toHaveAttribute('aria-atomic', 'true');
    expect(announcer()).toHaveClass('sr-only');
  });
});
