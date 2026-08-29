// Deep link verification endpoints (TD-2.4)
//
// Android App Links and iOS Universal Links require the platform to fetch
// a verification file from the site before treating https:// URLs as app
// deep links:
//
//   Android:  /.well-known/assetlinks.json
//             (package name + SHA-256 of the release signing cert)
//   iOS:      /.well-known/apple-app-site-association
//             (appID "TEAMID.com.trenddrop.app" + allowed paths)
//
// Both are key-gated on deployment env vars because the values depend on
// secrets that are not available in the repo (signing cert fingerprint,
// Apple team ID). When the env var is absent the endpoint returns 404 with
// a JSON explanation — verification simply stays inactive until Sunny
// supplies the values. Nothing here ever throws; this is a static,
// read-only, publicly cacheable pair of endpoints.
const express = require('express');
const router = express.Router();

const APP_ID = 'com.trenddrop.app';

function json404(res, what) {
  return res.status(404).type('application/json').send({
    status: 'not_configured',
    message: `${what} not configured. Set the deployment env vars to activate deep link verification.`,
  });
}

// Android App Links: https://developer.android.com/training/app-links/verify
// Env: ANDROID_SHA256_FINGERPRINTS = comma-separated SHA-256 cert
// fingerprints of the signing certificate (base64, no colons), e.g.
// "AB:CD:...:EF" or "ABCDEF..." — normalized on read.
router.get('/.well-known/assetlinks.json', (req, res) => {
  const raw = process.env.ANDROID_SHA256_FINGERPRINTS;
  if (!raw) return json404(res, 'Android assetlinks.json');

  const fingerprints = raw
    .split(',')
    .map((s) => s.trim().toUpperCase().replace(/:/g, ''))
    .filter(Boolean);

  if (fingerprints.length === 0) {
    return json404(res, 'Android assetlinks.json');
  }

  return res.status(200).type('application/json').json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: APP_ID,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
});

// iOS Universal Links: https://developer.apple.com/library/archive/documentation/General/Conceptual/AppSearch/UniversalLinks.html
// Env: IOS_TEAM_ID = Apple developer team identifier (e.g. "A1B2C3D4E5").
router.get('/.well-known/apple-app-site-association', (req, res) => {
  const teamId = process.env.IOS_TEAM_ID;
  if (!teamId || !/^[A-Z0-9]{8,12}$/i.test(teamId.trim())) {
    return json404(res, 'apple-app-site-association');
  }

  return res.status(200).type('application/json').json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId.trim().toUpperCase()}.${APP_ID}`,
          paths: ['/listing/*', '/orders/*', '/messages', '/profile/*', '/collections/*', '/auctions/*'],
        },
      ],
    },
  });
});

module.exports = router;
