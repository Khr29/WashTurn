const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const householdRoutes = require('./routes/household.routes');
const turnRoutes = require('./routes/turn.routes');
const dryingRoutes = require('./routes/drying.routes');
const notificationRoutes = require('./routes/notification.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { nodeEnv, corsOrigins } = require('./config/env');

const app = express();

// Rate limiting keys off req.ip. Behind a reverse proxy/load balancer (the
// normal production topology), that's the proxy's own address unless Express
// is told to read X-Forwarded-For — without this, every user behind the same
// proxy shares one rate-limit bucket. Not enabled outside production since a
// local/dev process has no proxy in front of it, and trusting
// X-Forwarded-For from an untrusted direct connection lets a client spoof
// its own IP.
if (nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// The Flutter app is a native HTTP client, not a browser — it never sends an
// Origin header, so this policy only affects browser-based callers. Origins
// must be explicitly allow-listed via CORS_ORIGIN; nothing is allowed by
// default in production. In development, no CORS_ORIGIN is required so
// local tooling (Postman, a local web client, etc.) isn't blocked.
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // non-browser clients send no Origin
    if (corsOrigins.includes(origin)) return callback(null, true);
    if (nodeEnv !== 'production') return callback(null, true);
    // CORS is a browser-side read restriction, not a server-side access
    // control — the right way to reject an origin is to omit the
    // Access-Control-Allow-Origin header (2nd arg `false`), which makes the
    // browser refuse to expose the response to page JS. Passing an Error
    // here instead would surface as a request-killing 500 for a mechanism
    // that was never meant to block the request itself.
    callback(null, false);
  },
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));
if (nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/households', householdRoutes);
app.use('/api/turns', turnRoutes);
app.use('/api/drying-requests', dryingRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
