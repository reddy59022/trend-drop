const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const {
  removeNotificationsForTransactions,
  deleteTransactionsWithNotifications,
} = require('../utils/transactionNotifications');
const { createPurchaseRollback } = require('../utils/purchaseRollback');

const oid = () => new mongoose.Types.ObjectId();

describe('Transaction notification cleanup (database)', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    }
  });

  afterEach(async () => {
    await User.deleteMany({});
    await Transaction.deleteMany({});
  });

  const insertUser = async (notifications) => {
    const _id = oid();
    await User.collection.insertOne({
      _id,
      name: 'Transaction cleanup user',
      email: `txn-cleanup-${_id}@test.local`,
      password: 'x',
      notifications,
      createdAt: new Date(),
    });
    return _id;
  };

  test('removes every notification type referencing the deleted transactions', async () => {
    const first = oid();
    const second = oid();
    const unrelated = oid();
    const userId = await insertUser([
      { _id: oid(), type: 'sale', transaction: first, message: 'target sale' },
      { _id: oid(), type: 'refund', transaction: first, message: 'target refund' },
      { _id: oid(), type: 'purchase', transaction: second, message: 'target purchase' },
      { _id: oid(), type: 'sale', transaction: unrelated, message: 'unrelated sale' },
      { _id: oid(), type: 'sale', message: 'no transaction' },
    ]);

    const modified = await removeNotificationsForTransactions([first, second]);
    expect(modified).toBe(1);

    const after = await User.collection.findOne({ _id: userId });
    expect(after.notifications.map((n) => n.message).sort()).toEqual([
      'no transaction',
      'unrelated sale',
    ]);
    expect(after.notifications.some((n) => String(n.transaction) === String(first))).toBe(false);
    expect(after.notifications.some((n) => String(n.transaction) === String(second))).toBe(false);
    expect(String(after.notifications.find((n) => n.message === 'unrelated sale').transaction))
      .toBe(String(unrelated));
  });

  test('deletes notifications before transactions', async () => {
    const target = oid();
    const other = oid();
    await Transaction.collection.insertMany([{ _id: target }, { _id: other }]);
    const userId = await insertUser([
      { _id: oid(), type: 'sale', transaction: target, message: 'target' },
      { _id: oid(), type: 'sale', transaction: other, message: 'other' },
    ]);

    const order = [];
    const originalUpdateMany = User.updateMany.bind(User);
    const originalDeleteMany = Transaction.deleteMany.bind(Transaction);
    const updateSpy = jest.spyOn(User, 'updateMany').mockImplementationOnce(async (...args) => {
      order.push('notifications');
      return originalUpdateMany(...args);
    });
    const deleteSpy = jest.spyOn(Transaction, 'deleteMany').mockImplementationOnce(async (...args) => {
      order.push('transactions');
      return originalDeleteMany(...args);
    });

    let result;
    try {
      result = await deleteTransactionsWithNotifications([target]);
    } finally {
      updateSpy.mockRestore();
      deleteSpy.mockRestore();
    }

    expect(order).toEqual(['notifications', 'transactions']);
    expect(result).toEqual({ notificationsModified: 1, deleted: 1 });
    expect(await Transaction.collection.findOne({ _id: target })).toBeNull();
    expect(await Transaction.collection.findOne({ _id: other })).not.toBeNull();

    const after = await User.collection.findOne({ _id: userId });
    expect(after.notifications.map((n) => n.message)).toEqual(['other']);
  });

  test('does not delete a transaction when notification cleanup fails', async () => {
    const target = oid();
    await Transaction.collection.insertOne({ _id: target });
    const userId = await insertUser([
      { _id: oid(), type: 'sale', transaction: target, message: 'must remain' },
    ]);

    const updateSpy = jest.spyOn(User, 'updateMany')
      .mockRejectedValueOnce(new Error('notification store unavailable'));

    try {
      await expect(deleteTransactionsWithNotifications([target]))
        .rejects.toThrow('notification store unavailable');
    } finally {
      updateSpy.mockRestore();
    }

    expect(await Transaction.collection.findOne({ _id: target })).not.toBeNull();
    const after = await User.collection.findOne({ _id: userId });
    expect(after.notifications.map((n) => n.message)).toEqual(['must remain']);
  });

  test('purchase rollback removes notifications before deleting its transactions', async () => {
    const target = oid();
    await Transaction.collection.insertOne({ _id: target });
    const userId = await insertUser([
      { _id: oid(), type: 'sale', transaction: target, message: 'rollback sale' },
      { _id: oid(), type: 'refund', transaction: target, message: 'rollback refund' },
    ]);

    const rollback = createPurchaseRollback();
    rollback.track.addTransaction(target);
    await rollback.run();

    expect(await Transaction.collection.findOne({ _id: target })).toBeNull();
    const after = await User.collection.findOne({ _id: userId });
    expect(after.notifications).toEqual([]);
  });
});
