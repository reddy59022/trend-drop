import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
jest.mock('../../services/native', () => ({
  isNative: () => false,
  platform: () => 'web',
}));

import api from '../../services/api';
import { AuthProvider, useAuth } from '../AuthContext';

const Probe = () => {
  const { loginWithGoogle } = useAuth();
  return <button onClick={() => loginWithGoogle().catch(() => {})}>Google</button>;
};

test('OAuth response without token does not persist or authenticate a session', async () => {
  // Browser GIS is loaded synchronously in this hermetic test.
  document.head.innerHTML = '<script id="gsi-client"></script>';
  window.google = {
    accounts: {
      id: {
        initialize: ({ callback }) => callback({ credential: 'a.b.c' }),
        prompt: jest.fn(),
      },
    },
  };
  process.env.REACT_APP_GOOGLE_CLIENT_ID = 'google-client';
  api.post.mockResolvedValue({ data: { user: { _id: 'u1' } } });
  const setItem = jest.spyOn(Storage.prototype, 'setItem');

  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => screen.getByRole('button', { name: 'Google' }));
  screen.getByRole('button', { name: 'Google' }).click();

  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect(setItem).not.toHaveBeenCalledWith('token', undefined);
});
