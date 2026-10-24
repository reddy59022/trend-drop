/**
 * Red tests proving unvalidated notification id parameters.
 *
 * `DELETE /api/notifications/:id` passes the raw route param straight into
 * Mongoose's DocumentArray#pull, which casts `_id` to ObjectId. A malformed id
 * ("abc") therefore throws a CastError and the endpoint answers 500 instead of
 * rejecting the request. `PUT /:id/read` has the same shape and currently
 * reports a missing notification for what is really an invalid id.
 *
 * This codebase's convention (assertObjectId + every other route) is 400 for a
 * malformed id. `/api/notifications/:id` is not covered by the global path
 * rules, so the routes must validate themselves.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../server.js');
const api = request(app);
const User = require('../models/User');

const secret = process.env.JWT_SECRET || 'fallback_secret_change_me';

let user;
let token;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/trend-drop-test');
  }
  user = await User.create({
    _id: new mongoose.Types.ObjectId(),
    name: 'Notified User',
    email: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`,
    password: 'password123',
    emailVerified: true,
    authProvider: 'email',
    country: 'US',
    currency: 'USD',
    notifications: [
      { type: 'system', message: 'Welcome' },
      { type: 'system', message: 'Second' },
    ],
  });
  token = jwt.sign({ id: user._id }, secret, { expiresIn: '1h' });
});

describe('DEFECT: malformed notification ids must be a 400, never a 500', () => {
  test('NT.1 DELETE with a non-ObjectId id is rejected and deletes nothing', async () => {
    const before = (await User.findById(user._id)).notifications.length;

    const res = await api
      .delete('/api/notifications/not-an-id')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    const after = (await User.findById(user._id)).notifications.length;
    expect(after).toBe(before);
  });

  test('NT.2 PUT read with a non-ObjectId id is rejected', async () => {
    const res = await api
      .put('/api/notifications/not-an-id/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  test('NT.3 REGRESSION GUARD: a real notification id is still marked read and deleted', async () => {
    const current = await User.findById(user._id);
    const id = String(current.notifications[0]._id);

    const read = await api
      .put(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect((await User.findById(user._id)).notifications[0].read).toBe(true);

    const del = await api
      .delete(`/api/notifications/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect((await User.findById(user._id)).notifications.length).toBe(1);
  });
});
