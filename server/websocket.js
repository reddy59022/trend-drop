/**
 * WebSocket Server for Real-Time Notifications
 * Uses Socket.io for real-time updates on offers, messages, orders, and sales
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const { getJwtSecret } = require('./config/security');

let io = null;
let userSocketMap = new Map(); // userId -> socketId

/**
 * Initialize WebSocket server
 */
function initializeWebSocket(server) {
  // Mirror the Express CORS allow-list so real-time features work on
  // web, iOS (capacitor://localhost) and Android (http://localhost) apps.
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:8100',     // Capacitor dev server
    'http://localhost:5001',     // Local API (web fallback)
    'http://10.0.2.2:8100',      // Android emulator
    'http://127.0.0.1:8100',     // iOS simulator
    'capacitor://localhost',     // Native iOS WebView
    'https://trend-drop.onrender.com',
  ];
  if (process.env.CLIENT_URL) {
    allowedOrigins.push(process.env.CLIENT_URL);
  }

  io = new Server(server, {
    cors: {
      origin(origin, callback) {
        // Allow same-origin (no Origin header) and any listed origin.
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, getJwtSecret());
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    
    // Map user to socket
    userSocketMap.set(userId, socket.id);
    
    // Join user's personal room
    socket.join(`user:${userId}`);
    
    // Update user online status
    socket.broadcast.emit('user:online', { userId, online: true });

    console.log(`User connected: ${socket.user.email} (${userId})`);

    // Typing indicators
    socket.on('typing:start', ({ conversationId, recipientId }) => {
      socket.to(`user:${recipientId}`).emit('typing:start', {
        userId,
        conversationId,
        userName: socket.user.name,
      });
    });

    socket.on('typing:stop', ({ conversationId, recipientId }) => {
      socket.to(`user:${recipientId}`).emit('typing:stop', {
        userId,
        conversationId,
      });
    });

    // ============ AUCTION LIVE STREAM SIGNALING ============
    // WebRTC signaling relay for live stream
    // Join a stream room to exchange SDP offers/answers and ICE candidates

    socket.on('stream:join', ({ auctionId }, callback) => {
      try {
        // Leave any previous stream room for this user
        socket.rooms.forEach(room => {
          if (room.startsWith('stream:')) socket.leave(room);
        });
        
        socket.join(`stream:${auctionId}`);
        console.log(`User ${socket.user.email} joined stream room for auction ${auctionId}`);
        
        // Notify the seller that a viewer joined
        socket.to(`stream:${auctionId}`).emit('stream:viewer-joined', {
          auctionId,
          userId: socket.user._id,
          userName: socket.user.name,
        });
        
        if (callback) callback({ ok: true });
      } catch (error) {
        if (callback) callback({ ok: false, error: error.message });
      }
    });

    socket.on('stream:leave', ({ auctionId }) => {
      socket.leave(`stream:${auctionId}`);
      console.log(`User ${socket.user.email} left stream room for auction ${auctionId}`);
    });

    // Seller sends SDP offer to viewers in the stream room
    socket.on('stream:offer', ({ auctionId, offer }) => {
      socket.to(`stream:${auctionId}`).emit('stream:offer', {
        auctionId,
        offer,
        sellerId: socket.user._id,
        sellerName: socket.user.name,
      });
      console.log(`Stream offer relayed for auction ${auctionId} by ${socket.user.email}`);
    });

    // Viewer sends SDP answer back to seller
    socket.on('stream:answer', ({ auctionId, answer, toSellerId }) => {
      socket.to(`user:${toSellerId}`).emit('stream:answer', {
        auctionId,
        answer,
        viewerId: socket.user._id,
        viewerName: socket.user.name,
      });
      console.log(`Stream answer relayed for auction ${auctionId} by ${socket.user.email}`);
    });

    // ICE candidate exchange
    socket.on('stream:ice-candidate', ({ auctionId, candidate, toUserId }) => {
      // If toUserId provided, send to that specific user; otherwise broadcast to room
      if (toUserId) {
        socket.to(`user:${toUserId}`).emit('stream:ice-candidate', {
          auctionId,
          candidate,
          fromUserId: socket.user._id,
        });
      } else {
        socket.to(`stream:${auctionId}`).emit('stream:ice-candidate', {
          auctionId,
          candidate,
          fromUserId: socket.user._id,
        });
      }
    });

    // Seller announces stream is ending
    socket.on('stream:end', ({ auctionId }) => {
      socket.to(`stream:${auctionId}`).emit('stream:ended', {
        auctionId,
        sellerId: socket.user._id,
      });
      socket.leave(`stream:${auctionId}`);
      console.log(`Stream ended for auction ${auctionId} by ${socket.user.email}`);
    });

    // Mark notifications as read
    socket.on('notifications:mark-read', async (notificationIds) => {
      try {
        await User.findByIdAndUpdate(userId, {
          $set: {
            'notifications.$[elem].read': true,
          },
        }, {
          arrayFilters: [{ 'elem._id': { $in: notificationIds } }],
        });

        socket.emit('notifications:updated', { notificationIds });
      } catch (error) {
        socket.emit('error', { message: 'Failed to mark notifications as read' });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      userSocketMap.delete(userId);
      socket.leave(`user:${userId}`);
      
      // Broadcast offline status
      socket.broadcast.emit('user:offline', { userId, online: false });
      
      console.log(`User disconnected: ${socket.user.email} (${userId})`);
    });
  });

  return io;
}

/**
 * Get socket.io instance
 */
function getIO() {
  if (!io) {
    throw new Error('WebSocket server not initialized. Call initializeWebSocket first.');
  }
  return io;
}

/**
 * Send notification to specific user
 */
function sendNotificationToUser(userId, notification) {
  if (!io) return;

  io.to(`user:${userId}`).emit('notification:new', {
    ...notification,
    timestamp: new Date(),
  });

  // Also update unread count
  io.to(`user:${userId}`).emit('notifications:unread-count', {
    count: notification.unreadCount || 1,
  });
}

/**
 * Send notification to multiple users
 */
function sendNotificationToUsers(userIds, notification) {
  userIds.forEach(userId => {
    sendNotificationToUser(userId, notification);
  });
}

/**
 * Broadcast to all connected users
 */
function broadcastToAll(event, data) {
  if (!io) return;
  io.emit(event, data);
}

/**
 * Get online status for user
 */
function isUserOnline(userId) {
  return userSocketMap.has(userId);
}

/**
 * Get all online users
 */
function getOnlineUsers() {
  return Array.from(userSocketMap.keys());
}

/**
 * Send message notification to conversation participants
 */
function sendMessageNotification(conversationId, recipientId, messageData) {
  if (!io) return;

  io.to(`user:${recipientId}`).emit('message:new', {
    conversationId,
    message: messageData,
    senderId: messageData.senderId,
  });

  // Update unread message count
  io.to(`user:${recipientId}`).emit('messages:unread-count', {
    conversationId,
    count: 1,
  });
}

module.exports = {
  initializeWebSocket,
  getIO,
  sendNotificationToUser,
  sendNotificationToUsers,
  broadcastToAll,
  isUserOnline,
  getOnlineUsers,
  sendMessageNotification,
  userSocketMap,
};
