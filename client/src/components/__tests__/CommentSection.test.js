import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../context/ConfirmContext', () => ({ __esModule: true, useConfirm: () => globalThis.__tdConfirm, ConfirmProvider: ({ children }) => <>{children}</> }));

import api from '../../services/api';
import { setAuth, setConfirm, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';

import CommentSection from '../CommentSection';

beforeEach(() => {
  resetTestState(); setAuth(authUser()); setConfirm(); resetApiMock(api);
  api.post.mockResolvedValue({ data: { _id: 'c1', text: 'Hi!', userId: { name: 'Me' }, createdAt: new Date().toISOString() } });
});

const seed = [{ _id: 's1', text: 'Existing', userId: { name: 'Bob' }, createdAt: new Date().toISOString() }];

describe('CommentSection', () => {
  test('renders seeded comments and a comment form', () => {
    render(<MemoryRouter><CommentSection listingId="lid1" comments={seed} onCommentsUpdate={() => {}} /></MemoryRouter>);
    expect(screen.getByText('Existing')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument();
  });
  test('submitting a comment posts the text and calls onCommentsUpdate', async () => {
    const onCommentsUpdate = jest.fn();
    render(<MemoryRouter><CommentSection listingId="lid1" comments={[]} onCommentsUpdate={onCommentsUpdate} /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Add a comment...'), { target: { value: 'Hi!' } });
    fireEvent.submit(screen.getByTestId('comment-form'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/comments/lid1', { text: 'Hi!' }));
    await waitFor(() => expect(onCommentsUpdate).toHaveBeenCalled());
  });
});
