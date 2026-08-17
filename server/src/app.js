const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const householdRoutes = require('./routes/household.routes');
const turnRoutes = require('./routes/turn.routes');
const dryingRoutes = require('./routes/drying.routes');
const notificationRoutes = require('./routes/notification.routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { nodeEnv } = require('./config/env');

const app = express();

app.use(cors());
app.use(express.json());
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
