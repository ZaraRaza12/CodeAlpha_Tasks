const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const User = require('../models/User');
const auth = require('../middleware/auth');
const projectAccess = require('../middleware/projectAccess');

// Get all projects for current user
router.get('/', auth, async (req, res) => {
  try {
    const projects = await Project.find({
      $or: [
        { owner: req.userId },
        { 'members.user': req.userId }
      ]
    })
    .populate('owner', 'name email avatar')
    .populate('members.user', 'name email avatar')
    .sort('-updatedAt');

    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a new project
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, settings } = req.body;

    const project = new Project({
      name,
      description,
      owner: req.userId,
      members: [{
        user: req.userId,
        role: 'admin'
      }],
      boards: [
        { name: 'To Do', position: 0, tasks: [] },
        { name: 'In Progress', position: 1, tasks: [] },
        { name: 'Review', position: 2, tasks: [] },
        { name: 'Done', position: 3, tasks: [] }
      ],
      settings: settings || {}
    });

    await project.save();
    
    await project.populate('owner', 'name email avatar');
    res.status(201).json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get project by ID
router.get('/:projectId', auth, projectAccess, async (req, res) => {
  try {
    await req.project.populate('owner', 'name email avatar');
    await req.project.populate('members.user', 'name email avatar');
    await req.project.populate('boards.tasks');
    
    res.json(req.project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update project
router.put('/:projectId', auth, projectAccess, async (req, res) => {
  try {
    const { name, description, settings } = req.body;
    
    req.project.name = name || req.project.name;
    req.project.description = description || req.project.description;
    req.project.settings = settings || req.project.settings;
    
    await req.project.save();
    res.json(req.project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete project
router.delete('/:projectId', auth, projectAccess, async (req, res) => {
  try {
    // Only owner can delete
    if (!req.isProjectOwner) {
      return res.status(403).json({ message: 'Only project owner can delete' });
    }

    await req.project.deleteOne();
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add member to project
router.post('/:projectId/members', auth, projectAccess, async (req, res) => {
  try {
    const { email, role } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is already a member
    const existingMember = req.project.members.find(
      m => m.user.toString() === user._id.toString()
    );

    if (existingMember) {
      return res.status(400).json({ message: 'User is already a member' });
    }

    req.project.members.push({
      user: user._id,
      role: role || 'member'
    });

    await req.project.save();
    await req.project.populate('members.user', 'name email avatar');
    
    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`project-${req.project._id}`).emit('member-added', {
        projectId: req.project._id,
        member: req.project.members[req.project.members.length - 1]
      });
    }

    res.json(req.project.members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove member from project
router.delete('/:projectId/members/:userId', auth, projectAccess, async (req, res) => {
  try {
    const { userId } = req.params;

    // Cannot remove owner
    if (userId === req.project.owner.toString()) {
      return res.status(400).json({ message: 'Cannot remove project owner' });
    }

    req.project.members = req.project.members.filter(
      m => m.user.toString() !== userId
    );

    await req.project.save();
    
    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`project-${req.project._id}`).emit('member-removed', {
        projectId: req.project._id,
        userId
      });
    }

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;