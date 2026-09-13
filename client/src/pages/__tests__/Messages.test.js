import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../services/api');
jest.mock('../../context/AuthContext', () => ({ __esModule: true, useAuth: () => globalThis.__tdAuth }));
jest.mock('../../context/ThemeContext', () => ({ __esModule: true, useTheme: () => globalThis.__tdTheme, ThemeProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/CartContext', () => ({ __esModule: true, useCart: () => globalThis.__tdCart, CartProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/ConfirmContext', () => ({ __esModule: true, useConfirm: () => globalThis.__tdConfirm, ConfirmProvider: ({ children }) => <>{children}</> }));
jest.mock('../../context/SocketContext', () => ({ __esModule: true, useSocket: () => globalThis.__tdSocket || { socket: null, connected: false }, SocketProvider: ({ children }) => <>{children}</> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('@stripe/stripe-js', () => ({ __esModule: true, loadStripe: jest.fn(() => Promise.resolve({})) }));
jest.mock('@stripe/react-stripe-js', () => ({ __esModule: true, Elements: ({ children }) => <div>{children}</div> }));
jest.mock('socket.io-client', () => {
  const mkSocket = () => ({ on: jest.fn(), emit: jest.fn(), disconnect: jest.fn() });
  const ioMock = (...args) => mkSocket();
  return { __esModule: true, io: ioMock, default: ioMock, connect: ioMock };
});
jest.mock('browser-image-compression', () => ({ __esModule: true, default: jest.fn(async (f) => f) }));

import api from '../../services/api';
import { setAuth, setThemeStore, setCartStore, setConfirm, resetTestState, resetApiMock, renderPage, authUser, sampleListing } from '../../test-utils';

import Messages from '../Messages';

beforeEach(() => { resetTestState(); resetApiMock(api); setAuth(authUser()); setThemeStore(); setCartStore(); setConfirm(); });

describe('Messages page', () => {
  test('renders conversation list (search appears with 4+ conversations)', async () => {
    const conv = (name, text) => ({ _id: `c-${name}`, listing: { _id: 'listing123', title: 'Jacket', images: [] }, otherUser: { _id: `u-${name}`, name }, lastMessage: { text } });
    api.getConversations.mockResolvedValue({ data: [conv('Bob', 'Hi Bob!'), conv('Alice', 'Hi Alice!'), conv('Cara', 'Hi Cara!'), conv('Dan', 'Hi Dan!')] });
    renderPage(<Messages />);
    expect(await screen.findByText('Hi Bob!')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search conversations...')).toBeInTheDocument();
  });
  test('search box is hidden for 3 or fewer conversations', async () => {
    api.getConversations.mockResolvedValue({ data: [{ _id: 'c1', listing: { _id: 'listing123', title: 'Jacket' }, otherUser: { _id: 'u1', name: 'Bob' }, lastMessage: { text: 'Hi!' } }] });
    renderPage(<Messages />);
    expect(await screen.findByText('Hi!')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search conversations...')).not.toBeInTheDocument();
  });
  test('renders the empty conversations state', async () => {
    api.getConversations.mockResolvedValue({ data: [] });
    renderPage(<Messages />);
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
    expect(screen.getByText('Start chatting by messaging a seller on their listing.')).toBeInTheDocument();
  });
  test('search filters the visible conversations', async () => {
    const conv = (name, text, title) => ({ _id: `c-${name}`, listing: { title }, otherUser: { _id: `u-${name}`, name }, lastMessage: { text } });
    api.getConversations.mockResolvedValue({ data: [conv('Alice', 'hello there', 'Jacket'), conv('Bob', 'hey there', 'Shoes'), conv('Cara', 'yo', 'Hat'), conv('Dan', 'sup', 'Coat')] });
    renderPage(<Messages />);
    await screen.findByText('hello there');
    fireEvent.change(screen.getByPlaceholderText('Search conversations...'), { target: { value: 'bob' } });
    expect(screen.queryByText('hello there')).not.toBeInTheDocument();
    expect(screen.getByText('hey there')).toBeInTheDocument();
  });
});
