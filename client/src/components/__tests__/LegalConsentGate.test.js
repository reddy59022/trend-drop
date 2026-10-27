import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/api', () => ({
  getLegalConsentStatus: jest.fn(),
  acceptLegalDocuments: jest.fn(),
}));

import { useAuth } from '../../context/AuthContext';
import { getLegalConsentStatus, acceptLegalDocuments } from '../../services/api';
import LegalConsentGate from '../LegalConsentGate';

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <LegalConsentGate />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { _id: 'u1' } });
  getLegalConsentStatus.mockResolvedValue({
    data: { needsReconsent: true, versions: { terms: 't1', privacy: 'p1' } },
  });
});

test('shows an inline error when acceptance fails instead of failing silently', async () => {
  acceptLegalDocuments.mockRejectedValue(new Error('network down'));
  renderGate();

  const dialog = await screen.findByRole('dialog');
  expect(dialog).toBeInTheDocument();

  const checkboxes = screen.getAllByRole('checkbox');
  await userEvent.click(checkboxes[0]);
  await userEvent.click(checkboxes[1]);
  await userEvent.click(screen.getByRole('button', { name: /accept and continue/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/could not save your acceptance/i);
  // Dialog stays open so the user can retry.
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('closes the dialog after a successful acceptance', async () => {
  acceptLegalDocuments.mockResolvedValue({ data: { ok: true } });
  renderGate();

  await screen.findByRole('dialog');
  const checkboxes = screen.getAllByRole('checkbox');
  await userEvent.click(checkboxes[0]);
  await userEvent.click(checkboxes[1]);
  await userEvent.click(screen.getByRole('button', { name: /accept and continue/i }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(acceptLegalDocuments).toHaveBeenCalledWith({
    termsVersion: 't1',
    privacyVersion: 'p1',
    ageConfirmed: true,
  });
});
