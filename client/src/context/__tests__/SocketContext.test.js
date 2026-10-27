import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, act } from '@testing-library/react';

const mockSocket = { on: jest.fn(), disconnect: jest.fn() };
const mockIo = jest.fn(() => mockSocket);
jest.mock('socket.io-client', () => ({ io: (...args) => mockIo(...args) }));
jest.mock('../../services/native', () => ({
  getSocketBaseURL: () => 'http://localhost:5001',
}));
jest.mock('../AuthContext', () => ({ useAuth: jest.fn() }));

import { useAuth } from '../AuthContext';
import { SocketProvider, useSocket } from '../SocketContext';

const Probe = () => {
  const { connected } = useSocket();
  return <span data-testid="conn">{connected ? 'on' : 'off'}</span>;
};

// CRA runs jest with resetMocks: true — jest.fn implementations are wiped
// before each test, so re-arm the return value here.
beforeEach(() => {
  mockIo.mockImplementation(() => mockSocket);
});

test('socket survives user-object identity changes (profile updates)', () => {
  useAuth.mockReturnValue({ user: { _id: 'u1', name: 'Ada' }, token: 't1' });
  const { rerender } = render(
    <SocketProvider><Probe /></SocketProvider>
  );
  expect(mockIo).toHaveBeenCalledTimes(1);

  // Same id + token, fresh object identity (what updateProfile produces).
  useAuth.mockReturnValue({ user: { _id: 'u1', name: 'Ada Lovelace' }, token: 't1' });
  rerender(<SocketProvider><Probe /></SocketProvider>);
  expect(mockIo).toHaveBeenCalledTimes(1); // NOT rebuilt
  expect(mockSocket.disconnect).not.toHaveBeenCalled();

  // Identity change DOES rebuild the connection.
  useAuth.mockReturnValue({ user: { _id: 'u2', name: 'Grace' }, token: 't1' });
  rerender(<SocketProvider><Probe /></SocketProvider>);
  expect(mockIo).toHaveBeenCalledTimes(2);
  expect(mockSocket.disconnect).toHaveBeenCalled();
});

test('no socket connects while logged out', () => {
  mockSocket.disconnect.mockClear();
  useAuth.mockReturnValue({ user: null, token: null });
  render(<SocketProvider><Probe /></SocketProvider>);
  expect(mockIo).not.toHaveBeenCalled();
  expect(screen.getByTestId('conn')).toHaveTextContent('off');
});
