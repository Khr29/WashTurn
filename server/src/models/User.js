const mongoose = require('mongoose');

const notificationPreferencesSchema = new mongoose.Schema(
  {
    turnToday: { type: Boolean, default: true },
    turnTomorrow: { type: Boolean, default: true },
    machineStarted: { type: Boolean, default: true },
    machineFinished: { type: Boolean, default: true },
    emergencyActivity: { type: Boolean, default: true },
    turnRequests: { type: Boolean, default: true },
    dryingRequests: { type: Boolean, default: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    notificationPreferences: { type: notificationPreferencesSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
