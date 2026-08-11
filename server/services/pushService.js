// pushService.js — push notification orchestration (TD-2.3).
//
// Responsibilities:
//   1. Device token registry (register/unregister) backed by PushDevice.
//   2. sendToUser(userId, { category, title, body, data }): the single entry
//      point for event-driven pushes (offer accepted, new message, order
//      update, price drop). It:
//        - loads the recipient + their MobilePreferences,
//        - honors the master `pushNotifications.enabled` toggle AND the
//          per-category toggles (messages / offers / orderUpdates / priceDrop),
//        - fans out to every registered device via the right transport
//          (APNs for iOS, FCM for Android + Web),
//        - never throws — push failures degrade to `{ ok:false, skipped }`
//          so request handlers are never broken by a push hiccup.

const PushDevice = require('../models/PushDevice');
const MobilePreferences = require('../models/MobilePreferences');
const User = require('../models/User');
const transports = require('./pushTransports');

// Event category → MobilePreferences.pushNotifications toggle name.
// Categories without a dedicated toggle (e.g. 'system') are only gated by
// the master `enabled` switch.
const CATEGORY_TOGGLES = {
  messages: 'messages',
  offers: 'offers',
  orderUpdates: 'orderUpdates',
  priceDrop: 'priceDrop',
};

async function registerDevice(userId, { token, platform, deviceId = '', appVersion = '' }) {
  if (!token || !platform) {
    const error = new Error('Token and platform are required');
    error.status = 400;
    throw error;
  }
  const normalizedPlatform = ['iOS', 'Android', 'Web'].includes(platform) ? platform : 'Android';
  await PushDevice.findOneAndUpdate(
    { token },
    {
      userId,
      token,
      platform: normalizedPlatform,
      deviceId,
      appVersion,
      lastSeenAt: new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return { message: 'Push token registered successfully' };
}

async function unregisterDevice(userId, token) {
  if (!token) {
    const error = new Error('Token is required');
    error.status = 400;
    throw error;
  }
  await PushDevice.findOneAndDelete({ token, userId });
  return { message: 'Push token unregistered' };
}

async function sendToUser(userId, { category = 'system', title, body, data = {} }) {
  try {
    if (!title || !body) {
      return { ok: false, skipped: true, reason: 'missing-title-or-body' };
    }

    const [user, prefs] = await Promise.all([
      User.findById(userId).select('_id').lean(),
      MobilePreferences.findOne({ userId }).lean(),
    ]);
    if (!user) {
      return { ok: false, skipped: true, reason: 'no-user' };
    }

    // Master toggle + per-category toggle.
    const pushPrefs = (prefs && prefs.pushNotifications) || {};
    if (pushPrefs.enabled === false) {
      return { ok: false, skipped: true, reason: 'push-disabled' };
    }
    const toggle = CATEGORY_TOGGLES[category];
    if (toggle && pushPrefs[toggle] === false) {
      return { ok: false, skipped: true, reason: `category-disabled:${category}` };
    }

    const devices = await PushDevice.find({ userId }).lean();
    if (!devices.length) {
      return { ok: false, skipped: true, reason: 'no-devices' };
    }

    const payload = { title, body, data: { ...data, category } };
    const results = await Promise.all(
      devices.map((device) =>
        device.platform === 'iOS'
          ? transports.sendApns(device.token, payload)
          : transports.sendFcm(device.token, payload)
      )
    );

    return { ok: true, skipped: false, sent: results.filter((r) => r && r.ok).length, results };
  } catch (error) {
    // Never propagate: a push failure must not break the request that
    // triggered it (message send, offer accept, order update, ...).
    return { ok: false, skipped: true, error: error.message };
  }
}

module.exports = { registerDevice, unregisterDevice, sendToUser, CATEGORY_TOGGLES };
