// pushTransports.js — key-gated push senders (TD-2.3).
//
// Two platform transports, both fully key-gated so the server runs fine
// without any push credentials:
//
//   * FCM (Android + Web): Firebase Cloud Messaging HTTP v1 API, authenticated
//     with a Firebase service account via google-auth-library.
//       Env: FCM_SERVICE_ACCOUNT (JSON string) or GOOGLE_APPLICATION_CREDENTIALS (path)
//   * APNs (iOS): Apple Push Notification service HTTP/2 endpoint, signed with
//     a .p8 APNs auth key (ES256).
//       Env: APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC
//           (APNS_SANDBOX=false for production APNs)
//
// When credentials are absent the senders resolve with
// `{ skipped: true, reason }` — the app degrades gracefully (in-app
// notifications still work; pushes just don't fire).
//
// Tests mock this module in server/jest.setup.js so suites never touch
// real push providers.

const axios = require('axios');
const http2 = require('http2');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config (key-gated)
// ---------------------------------------------------------------------------

function fcmConfig() {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.project_id && parsed.client_email) return parsed;
    } catch (e) {
      return null;
    }
  }
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      if (parsed && parsed.project_id && parsed.client_email) return parsed;
    } catch (e) {
      return null;
    }
  }
  return null;
}

function apnsConfig() {
  const keyPath = process.env.APNS_KEY_PATH;
  if (
    !keyPath ||
    !process.env.APNS_KEY_ID ||
    !process.env.APNS_TEAM_ID ||
    !process.env.APNS_TOPIC ||
    !fs.existsSync(keyPath)
  ) {
    return null;
  }
  return {
    keyPath,
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    topic: process.env.APNS_TOPIC,
    sandbox: process.env.APNS_SANDBOX !== 'false',
  };
}

// ---------------------------------------------------------------------------
// FCM (Android + Web)
// ---------------------------------------------------------------------------

async function sendFcm(token, { title, body, data = {} }) {
  const config = fcmConfig();
  if (!config) {
    return { skipped: true, provider: 'fcm', reason: 'no-fcm-credentials' };
  }
  try {
    // Loaded lazily so the module loads without google-auth-library in tests
    // (jest.setup.js mocks this entire module anyway).
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: config,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    });
    const accessToken = await auth.getAccessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${config.project_id}/messages:send`;

    const message = {
      message: {
        token,
        notification: { title, body },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: { priority: 'high' },
      },
    };

    const res = await axios.post(url, message, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10000,
    });
    return {
      ok: true,
      provider: 'fcm',
      messageId: res.data && res.data.name ? res.data.name : null,
    };
  } catch (error) {
    return { ok: false, provider: 'fcm', error: error.message };
  }
}

// ---------------------------------------------------------------------------
// APNs (iOS)
// ---------------------------------------------------------------------------

function makeApnsJwt(config) {
  const jwt = require('jsonwebtoken');
  const key = fs.readFileSync(config.keyPath, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: config.teamId, iat: now }, key, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: config.keyId },
  });
}

async function sendApns(token, { title, body, data = {} }) {
  const config = apnsConfig();
  if (!config) {
    return { skipped: true, provider: 'apns', reason: 'no-apns-credentials' };
  }
  return new Promise((resolve) => {
    try {
      const host = config.sandbox
        ? 'https://api.sandbox.push.apple.com'
        : 'https://api.push.apple.com';
      const client = http2.connect(host);
      const payload = JSON.stringify({
        aps: {
          alert: { title, body },
          sound: 'default',
          'content-available': 1,
        },
        ...data,
      });
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${makeApnsJwt(config)}`,
        'apns-topic': config.topic,
        'apns-push-type': 'alert',
      });
      let status = null;
      req.on('response', (headers) => {
        status = headers[':status'];
      });
      req.on('data', () => {});
      req.on('end', () => {
        client.close();
        if (status === 200) {
          resolve({ ok: true, provider: 'apns' });
        } else {
          resolve({ ok: false, provider: 'apns', status });
        }
      });
      req.on('error', (error) => {
        client.close();
        resolve({ ok: false, provider: 'apns', error: error.message });
      });
      req.end(payload);
    } catch (error) {
      resolve({ ok: false, provider: 'apns', error: error.message });
    }
  });
}

module.exports = { sendFcm, sendApns, fcmConfig, apnsConfig };
