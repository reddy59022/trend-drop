const express = require('express');
const router = express.Router();
const {
  getSupportedCountries,
  isCountrySupported,
  BLOCKED_REGION_MESSAGE,
} = require('../config/marketplace');

// GET /api/marketplace/countries - Supported markets (USA + Europe)
router.get('/countries', (req, res) => {
  try {
    res.json(getSupportedCountries());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/marketplace/status?country=XX - Region availability check.
// Always 200 so clients can render the appropriate screen themselves.
//
// Resolution: explicit ?country= hint is honoured ONLY when there is no IP
// evidence (CDN header / offline DB lookup) saying otherwise — IP wins on
// conflict (anti-spoof). Native iOS/Android apps just call this over HTTPS;
// they may optionally send X-Country-Code (SIM/locale) which is treated the
// same as ?country=. No device permissions, no native modules required.
router.get('/status', (req, res) => {
  try {
    const { detectCountry } = require('../config/geo');
    const detected = detectCountry(req);
    const hinted = req.query.country ? String(req.query.country).toUpperCase() : null;
    // IP evidence (header/db) outranks the explicit hint; the hint applies
    // only for client-hint / unresolved / unknown sources.
    const ipEvidence = detected && detected.country
      && ['client-hint', 'ip-unresolved', 'unknown', 'error'].indexOf(detected.source) === -1;
    const country = (ipEvidence ? detected.country : (hinted || detected.country || 'US'));
    const supported = isCountrySupported(country);
    res.json({
      country,
      supported,
      message: supported ? 'Available in your area' : BLOCKED_REGION_MESSAGE,
      code: supported ? 'REGION_SUPPORTED' : 'REGION_NOT_SUPPORTED',
      // Observability for ops/debugging (source = header|ip-*|client-hint|…).
      source: (ipEvidence ? detected.source : (hinted ? 'client-hint' : detected.source)) || 'unknown',
      ...(detected && detected.conflict ? { conflict: true, hint: detected.hint } : {}),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/marketplace/geo-status - Ops observability for the IP geo layer.
// Returns only non-sensitive aggregate counters (no IPs, no PII) so the
// geo-detection system can be monitored in production without exposing data.
router.get('/geo-status', (req, res) => {
  try {
    const { getGeoStats } = require('../config/geo');
    res.json(getGeoStats());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;