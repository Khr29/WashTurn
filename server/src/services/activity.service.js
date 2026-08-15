const ActivityLog = require('../models/ActivityLog');

async function getActivity(householdId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    ActivityLog.find({ householdId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name')
      .lean(),
    ActivityLog.countDocuments({ householdId }),
  ]);

  return {
    entries: entries.map((e) => ({
      id: e._id.toString(),
      turnId: e.turnId.toString(),
      type: e.type,
      summary: e.summary,
      user: e.userId ? { id: e.userId._id.toString(), name: e.userId.name } : null,
      timestamp: e.timestamp,
    })),
    page,
    limit,
    total,
    hasMore: skip + entries.length < total,
  };
}

module.exports = { getActivity };
