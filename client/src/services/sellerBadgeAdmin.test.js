jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() }, },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { reviewSellerBadge } from './api';

const api = axios.create.mock.results[0].value;

test('reviewSellerBadge sends the admin approval decision and reason', () => {
  reviewSellerBadge('seller-123', { decision: 'reject', reason: 'Unreadable document' });

  expect(api.put).toHaveBeenCalledWith(
    '/admin/seller-badges/seller-123/verification',
    { decision: 'reject', reason: 'Unreadable document' }
  );
});
