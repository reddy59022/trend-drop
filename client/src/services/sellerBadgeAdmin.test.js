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
  reviewSellerBadge('507f1f77bcf86cd799439011', { decision: 'reject', reason: 'Unreadable document' });

  expect(api.put).toHaveBeenCalledWith(
    '/admin/seller-badges/507f1f77bcf86cd799439011/verification',
    { decision: 'reject', reason: 'Unreadable document' }
  );
});
