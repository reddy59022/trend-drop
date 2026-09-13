import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';



import ShopBoostCard from '../ShopBoostCard';

beforeEach(() => { resetTestState(); setAuth(authUser()); resetApiMock(api); api.get.mockResolvedValue({ data: { shopBoost: null } }); api.post.mockResolvedValue({ data: { shopBoost: { active: true }, boostedListings: 2 } }); api.patch.mockResolvedValue({ data: { shopBoost: { active: false } } }); });

describe('ShopBoostCard', () => {
  test('renders the Boost Whole Shop title and toggle', async () => {
    render(<ShopBoostCard />);
    expect(await screen.findByText('Boost Whole Shop')).toBeInTheDocument();
    expect(screen.getByText('Boost every listing automatically — appear at the top of feeds with maximum visibility.')).toBeInTheDocument();
  });
  test('toggling the boost on posts to /shop-boost', async () => {
    render(<ShopBoostCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Boost|Turn On/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/shop-boost'));
  });
  test('active boost shows the Active label and toggles off', async () => {
    api.get.mockResolvedValue({ data: { shopBoost: { active: true, endDate: new Date(Date.now()+864e5).toISOString() } } });
    render(<ShopBoostCard />);
    expect(await screen.findByText('Active')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Turn Off/i }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/shop-boost/deactivate'));
  });
});
