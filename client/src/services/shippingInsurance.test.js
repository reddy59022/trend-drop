jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import {
  getShippingInsuranceSettings,
  calculateShippingInsurance,
  purchaseShippingInsurance,
  getMyInsurancePolicies,
  fileInsuranceClaim,
  refundShippingInsurance,
} from './api';

const api = axios.create.mock.results[0].value;

describe('shipping insurance API contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('exposes every server shipping-insurance route with its exact method and path', () => {
    getShippingInsuranceSettings();
    calculateShippingInsurance({ itemValue: 100, coverageType: 'standard' });
    purchaseShippingInsurance({ transactionId: 'txn-1', coverageType: 'standard' });
    getMyInsurancePolicies();
    fileInsuranceClaim('policy-1', { reason: 'lost' });
    refundShippingInsurance('policy-1');

    expect(api.get).toHaveBeenNthCalledWith(1, '/shipping-insurance/settings');
    expect(api.post).toHaveBeenNthCalledWith(1, '/shipping-insurance/calculate', {
      itemValue: 100,
      coverageType: 'standard',
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/shipping-insurance/purchase', {
      transactionId: 'txn-1',
      coverageType: 'standard',
    });
    expect(api.get).toHaveBeenNthCalledWith(2, '/shipping-insurance/my');
    expect(api.post).toHaveBeenNthCalledWith(3, '/shipping-insurance/policy-1/claim', { reason: 'lost' });
    expect(api.post).toHaveBeenNthCalledWith(4, '/shipping-insurance/policy-1/refund');
  });
});
