const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const Task = require('../models/Task');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Get comments for a task
router.get('/task/:taskId', auth, async (req, res) => {
  try {
    const comments = await Comment.find({ taskId: req.params.taskId })
      .populate('userId', 'name email avatar')
      .populate('mentions', 'name email')
      .sort('-createdAt');

    res.json(comments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create comment
router.post('/', auth, async (req, res) => {
  try {
    const { content, taskId, mentions } = req.body;

    const comment = new Comment({
      content,
      taskId,
      userId: req.userId,
      mentions: mentions || []
    });

    await comment.save();
    await comment.populate('userId', 'name email avatar');
    await comment.populate('mentions', 'name email');

    // Get task to find project
    const task = await Task.findById(taskId);
    
    // Create notifications for mentioned users
    if (mentions && mentions.length > 0) {
      mentions.forEach(async (userId) => {
        if (userId.toString() !== req.userId.toString()) {
          await User.findByIdAndUpdate(userId, {
            $push: {
              notifications: {
                type: 'mention',
                message: `You were mentioned in a comment`,
                projectId: task.projectId,
                taskId: task._id
              }
            }
          });
        }
      });
    }

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`project-${task.projectId}`).emit('new-comment', {
        taskId,
        comment
      });
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update comment
router.put('/:commentId', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Only comment author can edit
    if (comment.userId.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    comment.content = req.body.content;
    comment.edited = true;
    comment.updatedAt = Date.now();
    
    await comment.save();
    await comment.populate('userId', 'name email avatar');

    res.json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete comment
router.delete('/:commentId', auth, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Only comment author or task/project owner can delete
    const task = await Task.findById(comment.taskId);
    const project = await Project.findById(task.projectId);
    
    const isCommentAuthor = comment.userId.toString() === req.userId.toString();
    const isProjectOwner = project.owner.toString() === req.userId.toString();
    
    if (!isCommentAuthor && !isProjectOwner) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await comment.deleteOne();

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;