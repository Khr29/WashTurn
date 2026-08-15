const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['ios', 'android'], required: true },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ userId: 1 });

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
