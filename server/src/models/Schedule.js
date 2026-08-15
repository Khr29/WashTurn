const mongoose = require('mongoose');

const dayEntrySchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 }, // 0=Sun...6=Sat
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startTime: { type: String, default: null }, // "HH:mm", optional
    endTime: { type: String, default: null },
  },
  { _id: false }
);

const scheduleSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, unique: true },
    days: {
      type: [dayEntrySchema],
      validate: {
        validator: (days) => days.length === 7 && new Set(days.map((d) => d.dayOfWeek)).size === 7,
        message: 'Schedule must contain exactly one entry per day of the week (0-6).',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Schedule', scheduleSchema);
