const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const { applyBalanceAdjustment } = require('../utils/balanceAdjustment');

describe('applyBalanceAdjustment', () => {
  let seller;

  beforeAll(async () => {
    await connectDB();
    seller = await User.create({
      name: 'QA Balance Seller',
      email: 'qa-balance@test.local',
      password: 'Password123!',
      role: 'user',
    });
  });

  const balanceOf = async () => {
    const fresh = await User.findById(seller._id).select('balance').lean();
    return {
      pending: Number(fresh.balance.pending || 0),
      totalEarned: Number(fresh.balance.totalEarned || 0),
    };
  };

  test('a dry run reports the planned balance but writes nothing', async () => {
    const result = await applyBalanceAdjustment({
      userId: seller._id,
      amount: 11.35,
      key: 'dry-run-key',
    });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.planned).toEqual({ pending: 11.35, totalEarned: 11.35 });
    expect(await balanceOf()).toEqual({ pending: 0, totalEarned: 0 });
  });

  test('apply credits pending and totalEarned exactly once', async () => {
    const first = await applyBalanceAdjustment({
      userId: seller._id,
      amount: 11.35,
      key: 'restore-11.35',
      reason: 'test restore',
      apply: true,
    });
    expect(first.applied).toBe(true);
    expect(first.after).toEqual({ pending: 11.35, totalEarned: 11.35 });

    const replay = await applyBalanceAdjustment({
      userId: seller._id,
      amount: 11.35,
      key: 'restore-11.35',
      reason: 'test restore',
      apply: true,
    });
    expect(replay.alreadyApplied).toBe(true);
    expect(replay.applied).toBe(false);
    expect(await balanceOf()).toEqual({ pending: 11.35, totalEarned: 11.35 });
  });

  test('a negative adjustment debits the same fields', async () => {
    const result = await applyBalanceAdjustment({
      userId: seller._id,
      amount: -11.35,
      key: 'reverse-credit',
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(await balanceOf()).toEqual({ pending: 0, totalEarned: 0 });
  });

  test('rejects a missing user and a zero amount', async () => {
    await expect(applyBalanceAdjustment({
      userId: new mongoose.Types.ObjectId(),
      amount: 1,
      key: 'missing-user',
      apply: true,
    })).rejects.toThrow('not found');

    await expect(applyBalanceAdjustment({
      userId: seller._id,
      amount: 0,
      key: 'zero',
      apply: true,
    })).rejects.toThrow('non-zero');
  });
});
