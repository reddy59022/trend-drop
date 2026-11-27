const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const NotificationAuditState = require('../models/NotificationAuditState');
const {
  planQaCommerce,
  buildNotificationRemovalFilter,
} = require('../utils/qaCommerceCleanup');
const { auditOrphanNotifications } = require('../utils/notificationAudit');
const { auditNotificationIntegrity } = require('../config/cron');
const { render, reset } = require('../utils/metrics');
const { sendOperationalAlert } = require('../config/email');

const oid = () => new mongoose.Types.ObjectId();

describe('QA notification integrity (database)', () => {
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

  afterAll(async () => {
    await mongoose.disconnect();
  });

  const insertUser = async (notifications) => {
    const _id = oid();
    await User.collection.insertOne({
      _id,
      name: 'QA integrity user',
      email: `qa-integrity-${_id}@test.local`,
      password: 'x',
      notifications,
      createdAt: new Date(),
    });
    return _id;
  };

  test('removes every notification type for the deleted QA transaction', async () => {
    const listingId = oid();
    const qaTransactionId = oid();
    const realTransactionId = oid();

    const userId = await insertUser([
      { _id: oid(), type: 'dispute', transaction: qaTransactionId, message: 'QA dispute' },
      { _id: oid(), type: 'sale', transaction: qaTransactionId, message: 'QA sale' },
      { _id: oid(), type: 'sale', transaction: realTransactionId, message: 'real sale' },
      { _id: oid(), type: 'refund', transaction: qaTransactionId, message: 'QA refund' },
      { _id: oid(), type: 'sale', message: 'no transaction' },
    ]);

    const user = await User.collection.findOne({ _id: userId });
    const plan = planQaCommerce({
      listings: [{ _id: listingId, title: 'QA webhook flow database test' }],
      transactions: [{
        _id: qaTransactionId,
        listing: listingId,
        seller: userId,
        status: 'refunded',
        paymentBreakdown: { sellerEarnings: 11.35 },
      }],
      users: [user],
    });

    expect(plan.notificationCounts).toEqual({
      total: 3,
      byType: { dispute: 1, sale: 1, refund: 1 },
    });
    expect(plan.notificationRemovals).toHaveLength(1);

    const removal = plan.notificationRemovals[0];
    await User.updateOne(
      { _id: userId },
      {
        $pull: {
          notifications: buildNotificationRemovalFilter(
            removal.notificationIds,
            [qaTransactionId],
          ),
        },
      },
    );

    const after = await User.collection.findOne({ _id: userId });
    expect(after.notifications.map((n) => n.message).sort()).toEqual([
      'no transaction',
      'real sale',
    ]);
    expect(after.notifications.map((n) => n.type).sort()).toEqual(['sale', 'sale']);
    expect(after.notifications.some((n) =>
      String(n.transaction) === String(qaTransactionId))).toBe(false);
    expect(after.notifications.find((n) => n.message === 'real sale').transaction.toString())
      .toBe(realTransactionId.toString());
  });

  test('audits ObjectId references and ignores notifications without a transaction', async () => {
    const existingTransactionId = oid();
    const missingOne = oid();
    const missingTwo = oid();
    await Transaction.collection.insertOne({ _id: existingTransactionId });

    await insertUser([
      { _id: oid(), type: 'dispute', transaction: missingOne, message: 'missing dispute' },
      { _id: oid(), type: 'sale', transaction: existingTransactionId, message: 'existing sale' },
      { _id: oid(), type: 'sale', message: 'no transaction' },
    ]);
    await insertUser([
      { _id: oid(), type: 'refund', transaction: missingTwo, message: 'missing refund' },
      { _id: oid(), type: 'sale', transaction: existingTransactionId, message: 'existing sale 2' },
    ]);
    // A user whose notifications all lack a transaction is not part of the scan.
    await insertUser([
      { _id: oid(), type: 'sale', message: 'only no-ref' },
    ]);

    const report = await auditOrphanNotifications();

    expect(report.usersScanned).toBe(2);
    expect(report.notificationsScanned).toBe(5);
    expect(report.referencedTransactions).toBe(3);
    expect(report.existingTransactions).toBe(1);
    expect(report.total).toBe(2);
    expect(report.byType).toEqual({ dispute: 1, refund: 1 });
    expect(report.affectedUsers).toBe(2);
    expect(report.missingTransactionIds.sort()).toEqual([
      missingOne.toString(),
      missingTwo.toString(),
    ].sort());
    expect(report.notifications.map((n) => n.transactionId).sort()).toEqual([
      missingOne.toString(),
      missingTwo.toString(),
    ].sort());
  });

  test('scheduled audit runs read-only and emits a clean metric', async () => {
    reset();
    sendOperationalAlert.mockClear();
    const report = await auditNotificationIntegrity();
    expect(report).not.toBeNull();
    expect(report.total).toBe(0);
    expect(render()).toMatch(/trenddrop_orphan_notification_audits_total\{[^}]*result="clean"[^}]*source="cron"[^}]*\} 1/);
    expect(render()).toContain('trenddrop_orphan_notifications{source="cron"} 0');
    expect(render()).toMatch(/trenddrop_orphan_notification_audit_last_success_timestamp\{source="cron"\} \d+/);
    expect(sendOperationalAlert).not.toHaveBeenCalled();
  });

  test('scheduled audit found path emits a found metric and sends an actionable alert', async () => {
    const missingTransactionId = oid();
    await insertUser([
      {
        _id: oid(),
        type: 'dispute',
        transaction: missingTransactionId,
        message: 'missing transaction',
      },
    ]);

    reset();
    sendOperationalAlert.mockClear();
    const report = await auditNotificationIntegrity();

    expect(report).not.toBeNull();
    expect(report.total).toBe(1);
    expect(report.affectedUsers).toBe(1);
    expect(report.missingTransactionIds).toEqual([missingTransactionId.toString()]);
    expect(render()).toMatch(/trenddrop_orphan_notifications_total\{[^}]*result="found"[^}]*source="cron"[^}]*\} 1/);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);

    const alert = sendOperationalAlert.mock.calls[0][0];
    expect(alert.subject).toContain('orphan notification');
    expect(alert.text).toContain('1 notification(s)');
    expect(alert.text).toContain(missingTransactionId.toString());
  });

  test('scheduled audit preserves its report and metric when alert delivery fails', async () => {
    const missingTransactionId = oid();
    await insertUser([
      {
        _id: oid(),
        type: 'sale',
        transaction: missingTransactionId,
        message: 'missing transaction during alert failure',
      },
    ]);

    reset();
    sendOperationalAlert.mockClear();
    sendOperationalAlert.mockRejectedValueOnce(new Error('brevo unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let report;
    let errorCalls;
    try {
      report = await auditNotificationIntegrity();
    } finally {
      errorCalls = errorSpy.mock.calls;
      errorSpy.mockRestore();
    }

    expect(report).not.toBeNull();
    expect(report.total).toBe(1);
    expect(report.missingTransactionIds).toEqual([missingTransactionId.toString()]);
    expect(render()).toMatch(/trenddrop_orphan_notifications_total\{[^}]*result="found"[^}]*source="cron"[^}]*\} 1/);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
    expect(errorCalls).toContainEqual([
      '[CRON] Orphan audit alert delivery failed:',
      'brevo unavailable',
    ]);
  });

  test('scheduled audit failure emits failed metric and alerts operators', async () => {
    reset();
    sendOperationalAlert.mockClear();
    const audit = jest.fn().mockRejectedValue(new Error('audit database unavailable'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let report;
    let errorCalls;
    try {
      report = await auditNotificationIntegrity({ audit });
    } finally {
      errorCalls = errorSpy.mock.calls;
      errorSpy.mockRestore();
    }

    expect(report).toBeNull();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(render()).toMatch(/trenddrop_orphan_notification_audits_total\{[^}]*result="failed"[^}]*source="cron"[^}]*\} 1/);
    expect(sendOperationalAlert).toHaveBeenCalledTimes(1);
    const alert = sendOperationalAlert.mock.calls[0][0];
    expect(alert.subject).toContain('Orphan notification audit failed');
    expect(alert.text).toContain('audit database unavailable');
    expect(alert.text).toContain('Orphan detection is degraded');
    expect(errorCalls).toContainEqual([
      '[CRON] Orphan notification audit failed:',
      'audit database unavailable',
    ]);
  });
});
