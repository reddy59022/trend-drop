jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { getReturn, approveReturn, shipReturn } from './api';

const api = axios.create.mock.results[0].value;

test('return helpers reject malformed IDs without network requests', async () => {
  await expect(getReturn('not-a-mongo-id')).rejects.toThrow(/invalid return id/i);
  await expect(approveReturn('not-a-mongo-id')).rejects.toThrow(/invalid return id/i);
  await expect(shipReturn('not-a-mongo-id', 'TRACK123')).rejects.toThrow(/invalid return id/i);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
});

test('return helpers preserve valid request contracts', () => {
  const id = '507f1f77bcf86cd799439011';
  getReturn(id);
  approveReturn(id);
  shipReturn(id, 'TRACK123');
  expect(api.get).toHaveBeenCalledWith(`/returns/${id}`);
  expect(api.put).toHaveBeenNthCalledWith(1, `/returns/${id}/approve`);
  expect(api.put).toHaveBeenNthCalledWith(2, `/returns/${id}/ship`, { trackingNumber: 'TRACK123' });
});
