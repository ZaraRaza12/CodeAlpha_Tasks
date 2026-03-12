const Project = require('../models/Project');

module.exports = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.projectId || req.body.projectId);
    
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check if user is owner or member
    const isOwner = project.owner.toString() === req.userId.toString();
    const isMember = project.members.some(m => m.user.toString() === req.userId.toString());

    if (!isOwner && !isMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    req.project = project;
    req.isProjectOwner = isOwner;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};