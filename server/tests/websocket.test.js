/**
 * WebSocket Tests (Real-Time Notifications)
 * Tests Socket.io events for real-time updates
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { initializeWebSocket, getIO, sendNotificationToUser, sendMessageNotification, isUserOnline, getOnlineUsers, broadcastToAll } = require('../websocket');
const { io: ioClient } = require('socket.io-client');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

let server, user1Token, user2Token, user1Id, user2Id;
let socket1, socket2;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/trenddrop_test');
  }

  const user1 = await User.create({
    name: 'WS User 1', email: `ws1_${Date.now()}@test.com`, password: 'password123',
    country: 'US', currency: 'USD', emailVerified: true, authProvider: 'email',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'USD' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  user1Id = user1._id;
  user1Token = jwt.sign({ id: user1._id }, JWT_SECRET, { expiresIn: '30d' });

  const user2 = await User.create({
    name: 'WS User 2', email: `ws2_${Date.now()}@test.com`, password: 'password123',
    country: 'GB', currency: 'GBP', emailVerified: true, authProvider: 'email',
    balance: { available: 0, pending: 0, totalEarned: 0, totalPaidOut: 0, currency: 'GBP' },
    stats: { totalSales: 0, totalPurchases: 0, strikes: 0 },
  });
  user2Id = user2._id;
  user2Token = jwt.sign({ id: user2._id }, JWT_SECRET, { expiresIn: '30d' });

  await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${user1Token}`)
    .field('title', 'WS Test Listing')
    .field('description', 'For WebSocket tests')
    .field('price', '50')
    .field('category', 'Men')
    .field('condition', 'New with tags')
    .field('brand', 'Test')
    .field('size', 'M')
    .field('color', 'Black')
    .field('weight', 0.5)
    .field('quantity', 5);
});

afterAll(async () => {
  await User.deleteMany({ email: /ws[12]_/ });
  if (server) server.close();
  await mongoose.connection.close();
});

describe('WebSocket Real-Time Notifications', () => {
  const connectSocket = (token, which = 'other') => new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${server.address().port}`, {
      auth: { token },
      transports: ['websocket'],
    });
    s.on('connect', () => {
      if (which === '1') socket1 = s; else if (which === '2') socket2 = s;
      resolve(s);
    });
    s.on('connect_error', (err) => reject(new Error(err.message)));
    return s;
  });

  beforeEach((done) => {
    server = http.createServer(app);
    server.listen(() => {
      initializeWebSocket(server);
      setTimeout(done, 200);
    });
  });

  afterEach(async () => {
    try { if (socket1) socket1.disconnect(); } catch (e) {}
    try { if (socket2) socket2.disconnect(); } catch (e) {}
    try { if (server) server.close(); } catch (e) {}
    socket1 = socket2 = null;
  });

  test('WS.1 User connects with valid token', async () => {
    socket1 = await connectSocket(user1Token);
    expect(socket1.connected).toBe(true);
  });

  test('WS.2 User rejected with invalid token', async () => {
    socket1 = await connectSocket(user1Token);
    await expect(connectSocket('invalid')).rejects.toThrow();
  });

  test('WS.3 Online status broadcast', async () => {
    socket1 = await connectSocket(user1Token, '1');
    socket2 = await connectSocket(user2Token, '2');
    expect(socket2.connected).toBe(true);
  });

  test('WS.4 Typing indicator event', async () => {
    socket1 = await connectSocket(user1Token);
    socket2 = await connectSocket(user2Token);
    const typing = await new Promise((resolve) => {
      socket2.on('typing:start', resolve);
      socket1.emit('typing:start', { conversationId: 'c1', recipientId: user2Id.toString() });
    });
    expect(typing.userId).toBe(user1Id.toString());
    expect(typing.conversationId).toBe('c1');
    expect(typing.userName).toBe('WS User 1');
  });

  test('WS.5 Typing stop event', async () => {
    socket1 = await connectSocket(user1Token);
    socket2 = await connectSocket(user2Token);
    const typing = await new Promise((resolve) => {
      socket2.on('typing:stop', resolve);
      socket1.emit('typing:stop', { conversationId: 'c1', recipientId: user2Id.toString() });
    });
    expect(typing.userId).toBe(user1Id.toString());
    expect(typing.conversationId).toBe('c1');
  });

  test('WS.6 Notification event received', async () => {
    socket1 = await connectSocket(user1Token);
    socket2 = await connectSocket(user2Token);
    const notif = await new Promise((resolve) => {
      socket2.on('notification:new', resolve);
      sendNotificationToUser(user2Id, { type: 'offer', message: 'New offer', from: user1Id });
    });
    expect(notif.message).toBe('New offer');
    expect(notif.timestamp).toBeDefined();
  });

  test('WS.7 Message notification event', async () => {
    socket1 = await connectSocket(user1Token);
    socket2 = await connectSocket(user2Token);
    const msgNotif = await new Promise((resolve) => {
      socket2.on('message:new', resolve);
      sendMessageNotification('c1', user2Id, { senderId: user1Id.toString(), text: 'Hi' });
    });
    expect(msgNotif.conversationId).toBe('c1');
    expect(msgNotif.senderId).toBe(user1Id.toString());
  });

  test('WS.8 Offline status on disconnect', async () => {
    socket1 = await connectSocket(user1Token);
    socket2 = await connectSocket(user2Token);
    const offline = await new Promise((resolve) => {
      socket2.on('user:offline', resolve);
      socket1.disconnect();
    });
    expect(offline.userId).toBe(user1Id.toString());
    expect(offline.online).toBe(false);
  });

  test('WS.9 Get online users', async () => {
    socket1 = await connectSocket(user1Token);
    socket2 = await connectSocket(user2Token);
    expect(getOnlineUsers()).toContain(user1Id.toString());
    expect(getOnlineUsers()).toContain(user2Id.toString());
  });

  test('WS.10 Check user online status', async () => {
    await connectSocket(user1Token);
    await connectSocket(user2Token);
    expect(isUserOnline(user1Id.toString())).toBe(true);
    expect(isUserOnline(user2Id.toString())).toBe(true);
    expect(isUserOnline('nonexistent')).toBe(false);
  });

  test('WS.11 Broadcast to all users', async () => {
    socket1 = await connectSocket(user1Token);
    const broadcast = await new Promise((resolve) => {
      socket1.on('broadcast:test', resolve);
      broadcastToAll('broadcast:test', { message: 'hello' });
    });
    expect(broadcast.message).toBe('hello');
  });
});