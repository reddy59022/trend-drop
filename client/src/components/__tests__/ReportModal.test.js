import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { setAuth, resetTestState, resetApiMock, authUser } from '../../test-utils';

import ReportModal from '../ReportModal';

beforeEach(() => { resetTestState(); setAuth(authUser()); resetApiMock(api); api.post.mockResolvedValue({ data: {} }); });

describe('ReportModal', () => {
  test('renders reason buttons and a submit button', () => {
    render(<ReportModal listing={{ _id: 'l1' }} isOpen onClose={jest.fn()} />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(2);
  });
  test('submitting without a reason is blocked', () => {
    render(<ReportModal listing={{ _id: 'l1' }} isOpen onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Submit Report/i }));
    expect(api.post).not.toHaveBeenCalled();
  });
  test('selecting a reason and submitting posts a report', async () => {
    const onReportSubmitted = jest.fn();
    render(<ReportModal listing={{ _id: 'l1' }} isOpen onClose={jest.fn()} onReportSubmitted={onReportSubmitted} />);
    fireEvent.click(screen.getByRole('button', { name: /Fraud|Scam|Prohibited/i }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Report/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reports', expect.objectContaining({ listingId: 'l1' })));
    expect(onReportSubmitted).toHaveBeenCalled();
  });
});
