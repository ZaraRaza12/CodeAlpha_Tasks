const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = (io) => {
  // Middleware for socket authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.name}`);

    // Join user to their personal room
    socket.join(`user-${socket.user._id}`);

    // Join project rooms
    socket.on('join-project', (projectId) => {
      socket.join(`project-${projectId}`);
      console.log(`${socket.user.name} joined project ${projectId}`);
    });

    // Leave project room
    socket.on('leave-project', (projectId) => {
      socket.leave(`project-${projectId}`);
      console.log(`${socket.user.name} left project ${projectId}`);
    });

    // Typing indicator
    socket.on('typing', ({ projectId, taskId, isTyping }) => {
      socket.to(`project-${projectId}`).emit('user-typing', {
        userId: socket.user._id,
        userName: socket.user.name,
        taskId,
        isTyping
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.name}`);
    });
  });

  return io;
};