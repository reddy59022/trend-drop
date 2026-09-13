import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../services/api');
import { setAuth, resetTestState, authUser } from '../../test-utils';
import MobileTabBar from '../MobileTabBar';

beforeEach(() => { resetTestState(); setAuth(authUser()); });

describe('MobileTabBar', () => {
  test('authenticated users see Home, Feed, Sell, Trends, Messages, Profile', () => {
    render(<MemoryRouter><MobileTabBar /></MemoryRouter>);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.getByText('Trends')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    // Sell has no label text (highlight), but is rendered as a link
    expect(screen.getByLabelText('Sell')).toBeInTheDocument();
  });
  test('guest users see Home, Feed, Login aria-labels only', () => {
    setAuth(null);
    render(<MemoryRouter><MobileTabBar /></MemoryRouter>);
    expect(screen.getByLabelText('Home')).toBeInTheDocument();
    expect(screen.getByLabelText('Feed')).toBeInTheDocument();
    expect(screen.getByLabelText('Login')).toBeInTheDocument();
    expect(screen.queryByText('Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Messages')).not.toBeInTheDocument();
  });
  test('each tab is a link with an aria-label', () => {
    render(<MemoryRouter><MobileTabBar /></MemoryRouter>);
    expect(screen.getByLabelText('Home').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByLabelText('Feed').closest('a')).toHaveAttribute('href', '/feed');
  });
});
