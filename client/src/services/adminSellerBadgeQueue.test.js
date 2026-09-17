jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { getPendingSellerVerifications } from './api';

const api = axios.create.mock.results[0].value;

test('getPendingSellerVerifications calls the admin queue endpoint', () => {
  getPendingSellerVerifications();
  expect(api.get).toHaveBeenCalledWith('/admin/seller-badges/pending');
});
