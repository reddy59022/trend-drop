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
  const { loading, user } = useAuth();
  return <div data-testid="auth-state">{loading ? 'loading' : user ? 'signed-in' : 'signed-out'}</div>;
};

test('restricted localStorage falls back to signed-out state instead of crashing', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('SecurityError');
  });
  api.get.mockResolvedValue({ data: {} });

  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

  await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out'));
});
