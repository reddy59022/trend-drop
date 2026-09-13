import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));

import api from '../../services/api';
import { setAuth, resetTestState, resetApiMock, renderPage, authUser } from '../../test-utils';

import Comments from '../Comments';

beforeEach(() => {
  resetTestState(); setAuth(authUser()); resetApiMock(api);
  api.get.mockResolvedValue({ data: { comments: [] } });
  api.post.mockResolvedValue({ data: {} });
});

describe('Comments', () => {
  test('fetches comments for the listing', async () => {
    renderPage(<Comments listingId="lid1" />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/comments/lid1'));
  });
  test('shows "Comments (0)" when there are no comments', async () => {
    renderPage(<Comments listingId="lid1" />);
    expect(await screen.findByText('Comments (0)')).toBeInTheDocument();
  });
  test('renders existing comments with userId name', async () => {
    api.get.mockResolvedValue({ data: { comments: [{ _id: 'c1', text: 'Great fit!', userId: { name: 'Alice', avatar: null }, likes: [] }] } });
    renderPage(<Comments listingId="lid1" />);
    expect(await screen.findByText('Great fit!')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
  test('comment form is shown for authenticated users', async () => {
    renderPage(<Comments listingId="lid1" />);
    expect(await screen.findByPlaceholderText(/Add a comment/i)).toBeInTheDocument();
  });
  test('submitting a comment posts to the API', async () => {
    api.post.mockResolvedValue({ data: { _id: 'c2', text: 'Nice!', userId: { name: 'Me' }, likes: [] } });
    renderPage(<Comments listingId="lid1" />);
    const input = await screen.findByPlaceholderText(/Add a comment/i);
    fireEvent.change(input, { target: { value: 'Nice!' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/comments/lid1', expect.objectContaining({ text: 'Nice!' })));
  });
});
