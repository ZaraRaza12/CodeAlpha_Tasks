const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');
const auth = require('../middleware/auth');
const projectAccess = require('../middleware/projectAccess');

// Get all tasks for a project
router.get('/project/:projectId', auth, projectAccess, async (req, res) => {
  try {
    const tasks = await Task.find({ projectId: req.params.projectId })
      .populate('assignedTo', 'name email avatar')
      .populate('createdBy', 'name email avatar')
      .populate('attachments.uploadedBy', 'name')
      .sort('position');

    // Group tasks by board
    const boardTasks = {};
    req.project.boards.forEach(board => {
      boardTasks[board._id] = tasks.filter(task => 
        task.boardId.toString() === board._id.toString()
      );
    });

    res.json(boardTasks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new task
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, projectId, boardId, assignedTo, priority, dueDate, labels } = req.body;

    // Check project access
    const project = await Project.findById(projectId);
    const isMember = project.members.some(m => m.user.toString() === req.userId.toString());
    const isOwner = project.owner.toString() === req.userId.toString();

    if (!isMember && !isOwner) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Get position for new task
    const tasksInBoard = await Task.find({ projectId, boardId });
    const position = tasksInBoard.length;

    const task = new Task({
      title,
      description,
      projectId,
      boardId,
      assignedTo,
      createdBy: req.userId,
      priority,
      dueDate,
      labels,
      position
    });

    await task.save();
    
    // Add task to project board
    const board = project.boards.id(boardId);
    if (board) {
      board.tasks.push(task._id);
      await project.save();
    }

    await task.populate('assignedTo', 'name email avatar');
    await task.populate('createdBy', 'name email avatar');

    // Create notifications for assigned users
    if (assignedTo && assignedTo.length > 0) {
      assignedTo.forEach(async (userId) => {
        if (userId.toString() !== req.userId.toString()) {
          await User.findByIdAndUpdate(userId, {
            $push: {
              notifications: {
                type: 'task_assigned',
                message: `You have been assigned to task: ${task.title}`,
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
      io.to(`project-${projectId}`).emit('task-created', task);
    }

    res.status(201).json(task);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update task
router.put('/:taskId', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check project access
    const project = await Project.findById(task.projectId);
    const isMember = project.members.some(m => m.user.toString() === req.userId.toString());
    const isOwner = project.owner.toString() === req.userId.toString();

    if (!isMember && !isOwner) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updates = req.body;
    Object.keys(updates).forEach(key => {
      task[key] = updates[key];
    });

    await task.save();
    await task.populate('assignedTo', 'name email avatar');
    await task.populate('createdBy', 'name email avatar');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`project-${task.projectId}`).emit('task-updated', task);
    }

    res.json(task);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Move task between boards
router.patch('/:taskId/move', auth, async (req, res) => {
  try {
    const { boardId, newPosition } = req.body;
    const task = await Task.findById(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const oldBoardId = task.boardId;
    task.boardId = boardId;
    task.position = newPosition;
    
    await task.save();

    // Update board tasks arrays in project
    const project = await Project.findById(task.projectId);
    
    // Remove from old board
    const oldBoard = project.boards.id(oldBoardId);
    oldBoard.tasks = oldBoard.tasks.filter(t => t.toString() !== task._id.toString());
    
    // Add to new board
    const newBoard = project.boards.id(boardId);
    newBoard.tasks.push(task._id);
    
    await project.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`project-${task.projectId}`).emit('task-moved', {
        taskId: task._id,
        fromBoard: oldBoardId,
        toBoard: boardId,
        newPosition
      });
    }

    res.json(task);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete task
router.delete('/:taskId', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check project access
    const project = await Project.findById(task.projectId);
    const isMember = project.members.some(m => m.user.toString() === req.userId.toString());
    const isOwner = project.owner.toString() === req.userId.toString();

    if (!isMember && !isOwner) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Remove from project board
    const board = project.boards.id(task.boardId);
    if (board) {
      board.tasks = board.tasks.filter(t => t.toString() !== task._id.toString());
      await project.save();
    }

    await task.deleteOne();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`project-${task.projectId}`).emit('task-deleted', {
        taskId: req.params.taskId,
        boardId: task.boardId
      });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;