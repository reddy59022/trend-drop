jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import {
  getAdminUser, updateUserRole, suspendUser, unsuspendUser,
  deleteAdminListing, updateAdminReportStatus, adminRefundTransaction,
  reviewSellerBadge, updateBundleRule, deleteBundleRule,
  getBulkOffers, shareOfferToLikers, updatePromo, deletePromo, usePromo,
  fileInsuranceClaim, refundShippingInsurance,
  getAuction, placeBid, endAuction, cancelAuction,
  getSellerCollections, getCollection, updateCollection,
  addToListingToCollection, removeListingFromCollection, deleteCollection,
} from './api';

const api = axios.create.mock.results[0].value;
const invalid = 'not-an-object-id';

const cases = [
  ['getAdminUser', () => getAdminUser(invalid)],
  ['updateUserRole', () => updateUserRole(invalid, 'user')],
  ['suspendUser', () => suspendUser(invalid)],
  ['unsuspendUser', () => unsuspendUser(invalid)],
  ['deleteAdminListing', () => deleteAdminListing(invalid)],
  ['updateAdminReportStatus', () => updateAdminReportStatus(invalid, 'resolved')],
  ['adminRefundTransaction', () => adminRefundTransaction(invalid)],
  ['reviewSellerBadge', () => reviewSellerBadge(invalid, { decision: 'approve' })],
  ['updateBundleRule', () => updateBundleRule(invalid, {})],
  ['deleteBundleRule', () => deleteBundleRule(invalid)],
  ['getBulkOffers', () => getBulkOffers(invalid)],
  ['shareOfferToLikers', () => shareOfferToLikers(invalid, {})],
  ['updatePromo', () => updatePromo(invalid, {})],
  ['deletePromo', () => deletePromo(invalid)],
  ['usePromo', () => usePromo(invalid)],
  ['fileInsuranceClaim', () => fileInsuranceClaim(invalid, {})],
  ['refundShippingInsurance', () => refundShippingInsurance(invalid)],
  ['getAuction', () => getAuction(invalid)],
  ['placeBid', () => placeBid(invalid, 10)],
  ['endAuction', () => endAuction(invalid)],
  ['cancelAuction', () => cancelAuction(invalid)],
  ['getSellerCollections', () => getSellerCollections(invalid)],
  ['getCollection', () => getCollection(invalid)],
  ['updateCollection', () => updateCollection(invalid, {})],
  ['addToListingToCollection', () => addToListingToCollection(invalid, {})],
  ['removeListingFromCollection', () => removeListingFromCollection(invalid, invalid)],
  ['deleteCollection', () => deleteCollection(invalid)],
];

describe('extended client resource ID validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(cases)('%s rejects invalid IDs without a network request', async (_name, invoke) => {
    await expect(invoke()).rejects.toThrow(/invalid .* id/i);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
