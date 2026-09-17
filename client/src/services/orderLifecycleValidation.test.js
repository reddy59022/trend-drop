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
import { getOrderStatus, cancelOrder } from './api';

const api = axios.create.mock.results[0].value;

test('lifecycle helpers reject malformed transaction IDs without network requests', async () => {
  await expect(getOrderStatus('not-a-mongo-id')).rejects.toThrow(/invalid transaction id/i);
  await expect(cancelOrder('not-a-mongo-id', { reason: 'duplicate' })).rejects.toThrow(/invalid transaction id/i);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

test('lifecycle helpers preserve valid transaction requests', () => {
  const id = '507f1f77bcf86cd799439011';
  getOrderStatus(id);
  cancelOrder(id, { reason: 'changed mind' });
  expect(api.get).toHaveBeenCalledWith(`/orders/${id}/status`);
  expect(api.post).toHaveBeenCalledWith(`/orders/${id}/cancel`, { reason: 'changed mind' });
});
