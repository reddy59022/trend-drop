import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { renderPage, resetApiMock, resetTestState, setAuth, authUser } from '../../test-utils';
import VideoShopping from '../VideoShopping';

beforeEach(() => {
  resetTestState();
  resetApiMock(api);
  setAuth(authUser());
  api.get.mockImplementation((url) => {
    if (url === '/video-shopping') return Promise.resolve({ data: [] });
    if (url === '/users/me/listings') {
      return Promise.resolve({ data: { listings: [{ _id: 'listing123', title: 'Vintage Denim Jacket' }] } });
    }
    return Promise.resolve({ data: {} });
  });
});

test('Video Shopping renders its page after loading data', async () => {
  renderPage(<VideoShopping />);
  expect(await screen.findByRole('heading', { name: /Video Shopping/i })).toBeInTheDocument();
});

test('Video Shopping recovers from an API failure without crashing', async () => {
  api.get.mockRejectedValue(new Error('boom'));
  renderPage(<VideoShopping />);
  await waitFor(() => expect(screen.getByText('No videos yet')).toBeInTheDocument());
});

test('Video Shopping accepts the server listings response when opening upload', async () => {
  renderPage(<VideoShopping />);

  expect(await screen.findByText('No videos yet')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Upload New Video/i }));

  expect(await screen.findByRole('option', { name: 'Vintage Denim Jacket' })).toBeInTheDocument();
});
