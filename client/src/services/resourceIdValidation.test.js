jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  })),
}));
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import axios from 'axios';
import {
  deleteRating, getRatingsBySeller, getRatingsByListing,
  getUserNotifications, markAllNotificationsRead,
  getConversation, getConversationWithUser, sendMessage, markAsRead,
  addToWishlist, removeFromWishlist, checkInWishlist,
  resolveReport, getPriceHistory, processPayout,
  boostListing, deactivateBoost, getSavedSearchResults,
  updateSavedSearch, deleteSavedSearch,
} from './api';

const api = axios.create.mock.results[0].value;
const invalid = 'not-an-object-id';

const cases = [
  ['deleteRating', () => deleteRating(invalid)],
  ['getRatingsBySeller', () => getRatingsBySeller(invalid)],
  ['getRatingsByListing', () => getRatingsByListing(invalid)],
  ['getUserNotifications', () => getUserNotifications(invalid)],
  ['markAllNotificationsRead', () => markAllNotificationsRead(invalid)],
  ['getConversation', () => getConversation(invalid, invalid)],
  ['getConversationWithUser', () => getConversationWithUser(invalid)],
  ['sendMessage', () => sendMessage(invalid, { body: 'hello' })],
  ['markAsRead', () => markAsRead(invalid)],
  ['addToWishlist', () => addToWishlist(invalid)],
  ['removeFromWishlist', () => removeFromWishlist(invalid)],
  ['checkInWishlist', () => checkInWishlist(invalid)],
  ['resolveReport', () => resolveReport(invalid, 'resolved')],
  ['getPriceHistory', () => getPriceHistory(invalid)],
  ['processPayout', () => processPayout(invalid)],
  ['boostListing', () => boostListing(invalid, {})],
  ['deactivateBoost', () => deactivateBoost(invalid)],
  ['getSavedSearchResults', () => getSavedSearchResults(invalid)],
  ['updateSavedSearch', () => updateSavedSearch(invalid, {})],
  ['deleteSavedSearch', () => deleteSavedSearch(invalid)],
];

describe('client resource ID validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each(cases)('%s rejects invalid IDs without a network request', async (_name, invoke) => {
    await expect(invoke()).rejects.toThrow(/invalid .* id/i);
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
