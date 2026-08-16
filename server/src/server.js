const app = require('./app');
const { connectDb } = require('./config/db');
const { initFirebase } = require('./config/firebase');
const { startDailyScheduler } = require('./jobs/dailyScheduler');
const { port } = require('./config/env');
const Turn = require('./models/Turn');

async function start() {
  await connectDb();
  // Turn's unique index changed from "one per (household, date)" to a
  // partial index scoped to open turns only (see models/Turn.js) — existing
  // databases created under the old schema still have the old index on disk,
  // so it needs to be reconciled with the current schema definition. This is
  // a no-op once the index already matches.
  await Turn.syncIndexes();
  initFirebase();
  startDailyScheduler();

  app.listen(port, () => {
    console.log(`WashTurn API listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
