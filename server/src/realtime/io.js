const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { jwtSecret, nodeEnv, corsOrigins } = require('../config/env');
const Household = require('../models/Household');

let io = null;

// Mirrors app.js's CORS policy: the Flutter app is a native client and never
// sends an Origin, so this only fences off browser-based socket.io callers.
// Socket.IO's cors option expects the same (origin, callback) shape as the
// `cors` package used for REST.
function corsOptions() {
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      if (nodeEnv !== 'production') return callback(null, true);
      callback(null, false);
    },
  };
}

// Same verification as middleware/authenticate.js (HS256 pinned, same
// secret) so a socket connection can never be authenticated by anything the
// REST API itself wouldn't accept.
function authenticateSocket(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Missing authentication token.'));
  }
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    socket.data.userId = payload.sub;
    next();
  } catch (err) {
    next(new Error('Invalid or expired token.'));
  }
}

function userRoom(userId) {
  return `user:${userId}`;
}

function householdRoom(householdId) {
  return `household:${householdId}`;
}

// A connected client asks to join the household room it cares about — the
// membership check happens here, server-side, exactly like
// requireHouseholdMember does for REST, so a socket can never be made to
// listen in on a household it doesn't belong to just by supplying its id.
async function handleHouseholdJoin(socket, householdId, ack) {
  try {
    if (typeof householdId !== 'string' || !householdId) {
      return ack?.({ ok: false, error: 'householdId is required.' });
    }
    const household = await Household.findById(householdId).select('members');
    if (!household || !household.isMember(socket.data.userId)) {
      return ack?.({ ok: false, error: 'Not a member of this household.' });
    }

    if (socket.data.householdId && socket.data.householdId !== householdId) {
      socket.leave(householdRoom(socket.data.householdId));
    }
    socket.data.householdId = householdId;
    socket.join(householdRoom(householdId));
    ack?.({ ok: true });
  } catch (err) {
    ack?.({ ok: false, error: 'Could not join household.' });
  }
}

function initIo(httpServer) {
  io = new Server(httpServer, {
    cors: corsOptions(),
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.userId));

    socket.on('household:join', (householdId, ack) => {
      handleHouseholdJoin(socket, householdId, ack);
    });

    socket.on('household:leave', () => {
      if (socket.data.householdId) {
        socket.leave(householdRoom(socket.data.householdId));
        socket.data.householdId = null;
      }
    });
  });

  return io;
}

function getIo() {
  return io;
}

// Forces every socket belonging to `userId` out of a household's room —
// used when a member is removed from a household, so they stop receiving
// further broadcasts for it even though their own socket never called
// household:leave.
async function evictUserFromHousehold(userId, householdId) {
  if (!io) return;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  for (const socket of sockets) {
    socket.leave(householdRoom(householdId));
    if (socket.data.householdId === householdId) {
      socket.data.householdId = null;
    }
  }
}

module.exports = { initIo, getIo, userRoom, householdRoom, evictUserFromHousehold };
