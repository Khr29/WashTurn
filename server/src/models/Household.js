const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const householdSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    inviteCode: { type: String, required: true, unique: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    timezone: { type: String, required: true },
    members: { type: [memberSchema], default: [] },
  },
  { timestamps: true }
);

householdSchema.methods.isMember = function isMember(userId) {
  return this.members.some((m) => m.userId.toString() === userId.toString());
};

module.exports = mongoose.model('Household', householdSchema);
