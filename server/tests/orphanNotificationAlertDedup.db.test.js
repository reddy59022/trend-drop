const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const NotificationAuditState = require('../models/NotificationAuditState');
const { auditNotificationIntegrity } = require('../config/cron');
const {
  STATE_KEY,
  fingerprintMissingTransactionIds,
} = require('../utils/orphanNotificationAlerts');
const { sendOperationalAlert } = require('../config/email');
const { render, reset } = require('../utils/metrics');

const oid = () => new mongoose.Types.ObjectId();

describe('Orphan notification alert deduplication', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    }
  });

  afterEach(async () => {
    await User.deleteMany({});
    await Transaction.deleteMany({});
    await NotificationAuditState.deleteMany({});
  });

  const insertOrphanUser = async (missingTransactionId) => User.create({
    name: 'Orphan alert user',
    email: `orphan-alert-${missingTransactionId}-${Math.random().toString(36).slice(2)}@test.local`,
    password: 'password123',
    country: 'US',
    currency: 'USD',
    emailVerified: true,
    authProvider: 'email',
    notifications: [{
      type: 'sale',
      transaction: missingTransactionId,
      message: 'orphan notification',
    }],
  });

  test('fingerprints sorted missing transaction references independently of order', () => {
    expect(fingerprintMissingTransactionIds(['b', 'a', 'a']))
      .toBe(fingerprintMissingTransactionIds(['a', 'b']));
    expect(fingerprintMissingTransactionIds(['a', 'b']))
      .not.toBe(fingerprintMissingTransactionIds(['a', 'c']));
    expect(fingerprintMissingTransactionIds([])).toBeNull();
  });

  test('suppresses an unchanged fingerprint even on a later daily run, then alerts when the ID set changes', async () => {
    const firstMissing = oid();
    await insertOrphanUser(firstMissing);

    reset();
    sendOperationalAlert.mockClear();
    const firstReport = await auditNotificationIntegrity();
    expect(firstReport.total).toBe(1);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);

    const initialState = await NotificationAuditState.findOne({ key: STATE_KEY }).lean();
    expect(initialState.fingerprint).toBe(fingerprintMissingTransactionIds([firstMissing]));

    // Simulate the next day's run: the same missing reference must not re-alert.
    await NotificationAuditState.updateOne(
      { key: STATE_KEY },
      { $set: { lastAlertedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
    );
    const duplicateReport = await auditNotificationIntegrity();
    expect(duplicateReport.total).toBe(1);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
    expect(render()).toMatch(/trenddrop_orphan_notification_alerts_total\{[^}]*result="suppressed"[^}]*source="cron"[^}]*\} 1/);

    // A new missing transaction changes the fingerprint and must alert again.
    const secondMissing = oid();
    await insertOrphanUser(secondMissing);
    const changedReport = await auditNotificationIntegrity();
    expect(changedReport.total).toBe(2);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);

    const changedState = await NotificationAuditState.findOne({ key: STATE_KEY }).lean();
    expect(changedState.fingerprint)
      .toBe(fingerprintMissingTransactionIds([firstMissing, secondMissing]));
  });

  test('sends a weekly reminder for an unchanged unresolved finding', async () => {
    const missing = oid();
    await insertOrphanUser(missing);

    reset();
    sendOperationalAlert.mockClear();
    await auditNotificationIntegrity();
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);

    await NotificationAuditState.updateOne(
      { key: STATE_KEY },
      { $set: { lastAlertedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } },
    );
    await auditNotificationIntegrity();
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);
    expect(sendOperationalAlert.mock.calls[1][0].subject).toContain('REMINDER');
  });

  test('re-alerts when the orphan count grows for the same missing transaction set', async () => {
    const missing = oid();
    await insertOrphanUser(missing);

    reset();
    sendOperationalAlert.mockClear();
    await auditNotificationIntegrity();
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);

    // Same missing transaction id, but a second notification now points at it.
    await insertOrphanUser(missing);
    const changed = await auditNotificationIntegrity();
    expect(changed.total).toBe(2);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);
    expect(sendOperationalAlert.mock.calls[1][0].subject).not.toContain('REMINDER');
  });

  test('overlapping audits claim delivery atomically and send only once', async () => {
    const missing = oid();
    await insertOrphanUser(missing);

    reset();
    sendOperationalAlert.mockClear();
    const [first, second] = await Promise.all([
      auditNotificationIntegrity(),
      auditNotificationIntegrity(),
    ]);

    expect(first?.total).toBe(1);
    expect(second?.total).toBe(1);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
  });

  test('retries an alert on the next run when delivery fails', async () => {
    const missing = oid();
    await insertOrphanUser(missing);

    reset();
    sendOperationalAlert.mockClear();
    sendOperationalAlert.mockRejectedValueOnce(new Error('brevo unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await auditNotificationIntegrity();
      const failedState = await NotificationAuditState.findOne({ key: STATE_KEY }).lean();
      expect(failedState.fingerprint).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }

    await auditNotificationIntegrity();
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);
    const deliveredState = await NotificationAuditState.findOne({ key: STATE_KEY }).lean();
    expect(deliveredState.fingerprint).toBe(fingerprintMissingTransactionIds([missing]));
  });

  test('deduplicates an identical audit failure and sends only one page', async () => {
    reset();
    sendOperationalAlert.mockClear();
    const audit = jest.fn().mockRejectedValue(new Error('audit database unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await auditNotificationIntegrity({ audit });
      await auditNotificationIntegrity({ audit });
    } finally {
      errorSpy.mockRestore();
    }

    expect(audit).toHaveBeenCalledTimes(2);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
    expect(render()).toMatch(/trenddrop_orphan_notification_alerts_total\{[^}]*result="suppressed"[^}]*source="cron"[^}]*\} 1/);
  });

  test('sends a single recovery notice when the audit returns to zero', async () => {
    const missing = oid();
    await insertOrphanUser(missing);

    reset();
    sendOperationalAlert.mockClear();
    await auditNotificationIntegrity();
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);

    await User.deleteMany({});
    const recoveryReport = await auditNotificationIntegrity();
    expect(recoveryReport.total).toBe(0);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);

    const recoveryAlert = sendOperationalAlert.mock.calls[1][0];
    expect(recoveryAlert.subject).toContain('RECOVERY');
    expect(recoveryAlert.text).toContain('clean again');
    expect(recoveryAlert.text).toContain(missing.toString());

    const recoveredState = await NotificationAuditState.findOne({ key: STATE_KEY }).lean();
    expect(recoveredState.fingerprint).toBeNull();
    expect(recoveredState.orphanCount).toBe(0);
    expect(recoveredState.lastRecoveredAt).toBeTruthy();
    expect(render()).toMatch(/trenddrop_orphan_notification_alerts_total\{[^}]*result="recovery"[^}]*source="cron"[^}]*\} 1/);

    // A second clean run must not send another recovery notice.
    await auditNotificationIntegrity();
    expect(sendOperationalAlert).toHaveBeenCalledTimes(2);
  });
});
