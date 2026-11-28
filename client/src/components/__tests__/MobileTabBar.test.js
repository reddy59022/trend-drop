import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../context/CartContext', () => ({ __esModule: true, useCart: () => globalThis.__tdCart || { cart: [] } }));
jest.mock('../../services/api');
import { setAuth, resetTestState, authUser, routerFuture } from '../../test-utils';
import MobileTabBar from '../MobileTabBar';

beforeEach(() => {
  resetTestState();
  setAuth(authUser());
  globalThis.__tdCart = { cart: [] };
});

afterEach(() => {
  delete globalThis.__tdCart;
});

const renderAt = (path) => render(
  <MemoryRouter future={routerFuture} initialEntries={[path]}>
    <MobileTabBar />
  </MemoryRouter>
);

describe('MobileTabBar', () => {
  test('authenticated users get exactly five destinations, including Cart', () => {
    const { container } = renderAt('/');
    const links = container.querySelectorAll('.mobile-tab-item');
    // Platform ceiling: iOS HIG and Material bottom navigation both cap at 5.
    expect(links).toHaveLength(5);
    ['Home', 'Search', 'Cart', 'Profile'].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    });
    // Sell is the raised centre action, labelled but intentionally unlabelled visually.
    expect(screen.getByLabelText('Sell')).toBeInTheDocument();
  });

  test('Cart is reachable from the persistent navigation and carries the item count', () => {
    globalThis.__tdCart = { cart: [{ quantity: 2 }, { quantity: 1 }] };
    renderAt('/search');
    const cart = screen.getByLabelText('Cart, 3 items');
    expect(cart).toHaveAttribute('href', '/cart');
    expect(cart).toHaveTextContent('3');
  });

  test('the active destination is announced with aria-current', () => {
    renderAt('/cart');
    expect(screen.getByLabelText('Cart')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Home')).not.toHaveAttribute('aria-current');
  });

  test('Profile stays active on a profile sub-route', () => {
    const user = authUser();
    renderAt(`/profile/${user.id || user._id}`);
    expect(screen.getByLabelText('Profile')).toHaveAttribute('aria-current', 'page');
  });

  test('guests only see public destinations', () => {
    setAuth(null);
    renderAt('/');
    expect(screen.getByLabelText('Home')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Sign in')).toBeInTheDocument();
    // Protected tabs would bounce to /login, so they are not rendered.
    expect(screen.queryByLabelText('Profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cart')).not.toBeInTheDocument();
  });

  test('tabs are real links to their routes', () => {
    renderAt('/');
    expect(screen.getByLabelText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByLabelText('Search').closest('a')).toHaveAttribute('href', '/search');
    expect(screen.getByLabelText('Sell').closest('a')).toHaveAttribute('href', '/sell');
  });
});
