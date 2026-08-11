// pushService.test.js — TD-2.3 Push notifications (service layer).
//
// Exercises the real pushService against the real DB with the transport
// layer mocked (server/jest.setup.js): device registry, master + per-category
// preference gating, FCM/APNs fan-out, and graceful degradation.

const mongoose = require('mongoose');
const User = require('../models/User');
const MobilePreferences = require('../models/MobilePreferences');
const PushDevice = require('../models/PushDevice');
const pushService = require('../services/pushService');
const transports = require('../services/pushTransports');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
const seedBase = `pushsrv_${Date.now()}_`;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }
  user = await User.create({
    name: 'Push User',
    email: `${seedBase}user@test.com`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
  });
});

beforeEach(async () => {
  jest.clearAllMocks();
  await PushDevice.deleteMany({ userId: user._id });
  await MobilePreferences.findOneAndDelete({ userId: user._id });
});

afterAll(async () => {
  if (user) {
    await PushDevice.deleteMany({ userId: user._id });
    await MobilePreferences.findOneAndDelete({ userId: user._id });
    await User.findByIdAndDelete(user._id);
  }
  await mongoose.connection.close();
});

describe('TD-2.3 pushService — device registry', () => {
  test('PN.1 - Registers a device token (Android)', async () => {
    const res = await pushService.registerDevice(user._id, {
      token: 'android-token-1',
      platform: 'Android',
      deviceId: 'dev-1',
      appVersion: '1.0.0',
    });
    expect(res.message).toContain('registered');

    const device = await PushDevice.findOne({ token: 'android-token-1' });
    expect(device).toBeTruthy();
    expect(device.userId.toString()).toBe(user._id.toString());
    expect(device.platform).toBe('Android');
    expect(device.appVersion).toBe('1.0.0');
  });

  test('PN.2 - Re-registering the same token upserts (single device doc)', async () => {
    await pushService.registerDevice(user._id, { token: 'dup-token', platform: 'Android', deviceId: 'dev-1' });
    await pushService.registerDevice(user._id, { token: 'dup-token', platform: 'iOS', deviceId: 'dev-1' });

    const devices = await PushDevice.find({ token: 'dup-token' });
    expect(devices).toHaveLength(1);
    expect(devices[0].platform).toBe('iOS');
  });

  test('PN.3 - Unregisters a device token', async () => {
    await pushService.registerDevice(user._id, { token: 'remove-token', platform: 'Android' });
    const res = await pushService.unregisterDevice(user._id, 'remove-token');
    expect(res.message).toContain('unregistered');
    expect(await PushDevice.findOne({ token: 'remove-token' })).toBeNull();
  });

  test('PN.4 - Register/unregister reject missing token', async () => {
    await expect(pushService.registerDevice(user._id, { platform: 'Android' })).rejects.toThrow();
    await expect(pushService.unregisterDevice(user._id, '')).rejects.toThrow();
  });
});

describe('TD-2.3 pushService — sendToUser gating', () => {
  test('PN.5 - Skips when user has no registered devices', async () => {
    const res = await pushService.sendToUser(user._id, {
      category: 'messages',
      title: 'Hi',
      body: 'There',
    });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no-devices');
    expect(transports.sendFcm).not.toHaveBeenCalled();
    expect(transports.sendApns).not.toHaveBeenCalled();
  });

  test('PN.6 - Skips when master pushNotifications.enabled is false', async () => {
    await PushDevice.create({ userId: user._id, token: 'tok-master-off', platform: 'Android' });
    await MobilePreferences.create({
      userId: user._id,
      pushNotifications: { enabled: false, messages: true, offers: true },
    });

    const res = await pushService.sendToUser(user._id, {
      category: 'messages',
      title: 'Hi',
      body: 'There',
    });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('push-disabled');
    expect(transports.sendFcm).not.toHaveBeenCalled();
  });

  test('PN.7 - Skips when the category toggle is off', async () => {
    await PushDevice.create({ userId: user._id, token: 'tok-offers-off', platform: 'Android' });
    await MobilePreferences.create({
      userId: user._id,
      pushNotifications: { enabled: true, messages: true, offers: false },
    });

    const res = await pushService.sendToUser(user._id, {
      category: 'offers',
      title: 'Offer accepted!',
      body: 'Your offer was accepted.',
    });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('category-disabled:offers');
    expect(transports.sendFcm).not.toHaveBeenCalled();
  });

  test('PN.8 - Disabled category does not block other categories', async () => {
    await PushDevice.create({ userId: user._id, token: 'tok-offers-off-2', platform: 'Android' });
    await MobilePreferences.create({
      userId: user._id,
      pushNotifications: { enabled: true, messages: true, offers: false },
    });

    const res = await pushService.sendToUser(user._id, {
      category: 'messages',
      title: 'New message',
      body: 'Hello!',
    });
    expect(res.skipped).toBe(false);
    expect(res.sent).toBe(1);
    expect(transports.sendFcm).toHaveBeenCalledTimes(1);
  });

  test('PN.9 - Defaults are permissive when no preferences exist', async () => {
    await PushDevice.create({ userId: user._id, token: 'tok-no-prefs', platform: 'Android' });
    const res = await pushService.sendToUser(user._id, {
      category: 'offers',
      title: 'Offer accepted!',
      body: 'Your offer was accepted.',
    });
    expect(res.skipped).toBe(false);
    expect(res.sent).toBe(1);
  });

  test('PN.10 - Skips when title or body is missing', async () => {
    await PushDevice.create({ userId: user._id, token: 'tok-no-title', platform: 'Android' });
    const res = await pushService.sendToUser(user._id, { category: 'offers', title: '', body: 'x' });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('missing-title-or-body');
  });

  test('PN.11 - Skips when the recipient user does not exist', async () => {
    const ghostId = new mongoose.Types.ObjectId();
    const res = await pushService.sendToUser(ghostId, { category: 'offers', title: 'T', body: 'B' });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe('no-user');
  });
});

describe('TD-2.3 pushService — transport fan-out', () => {
  test('PN.12 - Android device sends via FCM with payload + category', async () => {
    await PushDevice.create({ userId: user._id, token: 'android-tok', platform: 'Android' });
    const res = await pushService.sendToUser(user._id, {
      category: 'offers',
      title: 'Offer accepted!',
      body: 'Proceed to purchase.',
      data: { offerId: 'offer-123' },
    });

    expect(res.ok).toBe(true);
    expect(res.sent).toBe(1);
    expect(transports.sendFcm).toHaveBeenCalledTimes(1);
    expect(transports.sendApns).not.toHaveBeenCalled();
    const [token, payload] = transports.sendFcm.mock.calls[0];
    expect(token).toBe('android-tok');
    expect(payload.title).toBe('Offer accepted!');
    expect(payload.body).toBe('Proceed to purchase.');
    expect(payload.data.offerId).toBe('offer-123');
    expect(payload.data.category).toBe('offers');
  });

  test('PN.13 - iOS device sends via APNs', async () => {
    await PushDevice.create({ userId: user._id, token: 'ios-tok', platform: 'iOS' });
    const res = await pushService.sendToUser(user._id, {
      category: 'messages',
      title: 'New message',
      body: 'Hello!',
    });

    expect(res.sent).toBe(1);
    expect(transports.sendApns).toHaveBeenCalledTimes(1);
    expect(transports.sendFcm).not.toHaveBeenCalled();
    expect(transports.sendApns.mock.calls[0][0]).toBe('ios-tok');
  });

  test('PN.14 - Fans out to every device (Android + iOS together)', async () => {
    await PushDevice.create({ userId: user._id, token: 'both-android', platform: 'Android' });
    await PushDevice.create({ userId: user._id, token: 'both-ios', platform: 'iOS' });
    const res = await pushService.sendToUser(user._id, {
      category: 'orderUpdates',
      title: 'Order shipped',
      body: 'Your order is on the way.',
    });

    expect(res.sent).toBe(2);
    expect(transports.sendFcm).toHaveBeenCalledTimes(1);
    expect(transports.sendApns).toHaveBeenCalledTimes(1);
  });

  test('PN.15 - Transport failure does not throw and reports ok:false', async () => {
    await PushDevice.create({ userId: user._id, token: 'failing-tok', platform: 'Android' });
    transports.sendFcm.mockResolvedValueOnce({ ok: false, provider: 'fcm', error: 'boom' });

    const res = await pushService.sendToUser(user._id, {
      category: 'messages',
      title: 'Hi',
      body: 'There',
    });
    expect(res.ok).toBe(true);
    expect(res.sent).toBe(0);
    expect(res.results[0].ok).toBe(false);
  });

  test('PN.16 - sendToUser never rejects even with a broken preference lookup', async () => {
    // Simulate a DB error by pointing at a bogus model query — simplest is to
    // spy on MobilePreferences.findOne and reject. The service chains `.lean()`
    // on the result, so the mock must return a query-like object whose lean()
    // rejects (a bare rejected promise would throw a TypeError at .lean()).
    jest.spyOn(MobilePreferences, 'findOne').mockReturnValueOnce({
      lean: jest.fn().mockRejectedValueOnce(new Error('db down')),
    });
    const res = await pushService.sendToUser(user._id, { category: 'messages', title: 'T', body: 'B' });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.error).toBe('db down');
  });
});
