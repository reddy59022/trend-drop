jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import { getUserNotifications, markAllNotificationsRead } from './api';

const api = axios.create.mock.results[0].value;
const userId = '507f1f77bcf86cd799439011';

describe('notification API contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('uses current-user notification collection rather than nonexistent user subroutes', async () => {
    await getUserNotifications(userId);
    expect(api.get).toHaveBeenCalledWith('/notifications');
  });

  test('marks notifications read through the mounted notification route', async () => {
    await markAllNotificationsRead(userId);
    expect(api.put).toHaveBeenCalledWith('/notifications/read');
  });
});
