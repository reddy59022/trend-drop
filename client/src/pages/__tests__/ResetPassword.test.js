import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { routerFuture } from '../../test-utils';

jest.mock('../../services/api');

import api from '../../services/api';
import ResetPassword from '../ResetPassword';

const renderResetPassword = () => render(
  <MemoryRouter future={routerFuture} initialEntries={['/reset-password?token=reset-token']}>
    <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  </MemoryRouter>
);

describe('ResetPassword', () => {
  beforeEach(() => jest.clearAllMocks());

  test('submits the token from the email link and returns to login', async () => {
    api.post.mockResolvedValue({ data: { message: 'Password reset successful.' } });
    renderResetPassword();

    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'NewPassword123!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'NewPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/auth/reset-password', {
        token: 'reset-token',
        password: 'NewPassword123!',
      });
    });
    expect(await screen.findByRole('heading', { name: /password reset successful/i })).toBeInTheDocument();
  });
});
