const app = require('./app');
const { connectDb } = require('./config/db');
const { initFirebase } = require('./config/firebase');
const { startDailyScheduler } = require('./jobs/dailyScheduler');
const { port } = require('./config/env');

async function start() {
  await connectDb();
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
