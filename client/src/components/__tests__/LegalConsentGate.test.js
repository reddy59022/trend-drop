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

test('moves focus into the dialog and keeps Tab inside it', async () => {
  acceptLegalDocuments.mockResolvedValue({ data: { ok: true } });
  renderGate();

  await screen.findByRole('dialog');
  const title = screen.getByRole('heading', { name: /review updated legal terms/i });
  expect(document.activeElement).toBe(title);

  // Enable the submit button so it is part of the trap, then Tab from it.
  const checkboxes = screen.getAllByRole('checkbox');
  await userEvent.click(checkboxes[0]);
  await userEvent.click(checkboxes[1]);
  const submit = screen.getByRole('button', { name: /accept and continue/i });
  submit.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('link', { name: /terms of service/i }));

  // Shift+Tab from the first stop wraps to the last.
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(submit);
});

test('hands focus to the main landmark when the dialog closes', async () => {
  acceptLegalDocuments.mockResolvedValue({ data: { ok: true } });
  render(
    <MemoryRouter initialEntries={['/home']}>
      <main>
        <LegalConsentGate />
      </main>
    </MemoryRouter>
  );

  await screen.findByRole('dialog');
  const checkboxes = screen.getAllByRole('checkbox');
  await userEvent.click(checkboxes[0]);
  await userEvent.click(checkboxes[1]);
  await userEvent.click(screen.getByRole('button', { name: /accept and continue/i }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.activeElement.tagName).toBe('MAIN');
});
