const {
  collectOrphanNotifications,
  summarizeOrphanNotifications,
} = require('../utils/notificationAudit');

describe('orphan notification audit', () => {
  test('reports every notification whose transaction is missing', () => {
    const users = [
      {
        _id: 'u1',
        notifications: [
          { _id: 'n1', type: 'dispute', transaction: 'missing-1', message: 'a', createdAt: '2026-01-02T00:00:00Z' },
          { _id: 'n2', type: 'sale', transaction: 'existing-1', message: 'keep', createdAt: '2026-01-01T00:00:00Z' },
          { _id: 'n3', type: 'support', transaction: 'missing-2', message: 'b', createdAt: '2026-01-03T00:00:00Z' },
          { _id: 'n4', type: 'sale', transaction: null, message: 'no ref' },
        ],
      },
      {
        _id: 'u2',
        notifications: [
          { _id: 'n5', type: 'sale', transaction: 'missing-1', message: 'c', createdAt: '2025-12-31T00:00:00Z' },
        ],
      },
      { _id: 'u3' },
    ];

    const rows = collectOrphanNotifications(users, ['existing-1']);
    const summary = summarizeOrphanNotifications(rows);

    expect(rows.map((row) => row.notificationId)).toEqual(['n3', 'n1', 'n5']);
    expect(summary.total).toBe(3);
    expect(summary.byType).toEqual({ dispute: 1, sale: 1, support: 1 });
    expect(summary.affectedUsers).toBe(2);
    expect(summary.missingTransactionIds).toEqual(['missing-1', 'missing-2']);
    expect(summary.notifications).toHaveLength(3);
  });

  test('returns an empty report when every reference exists', () => {
    const users = [{
      _id: 'u1',
      notifications: [{ _id: 'n1', type: 'sale', transaction: 'existing-1' }],
    }];

    const summary = summarizeOrphanNotifications(
      collectOrphanNotifications(users, ['existing-1']),
    );

    expect(summary).toEqual({
      total: 0,
      byType: {},
      affectedUsers: 0,
      missingTransactionIds: [],
      notifications: [],
    });
  });
});
