const { firebaseServiceAccountPath } = require('./env');

let messaging = null;

function initFirebase() {
  if (!firebaseServiceAccountPath) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled');
    return null;
  }
  const admin = require('firebase-admin');
  const serviceAccount = require(firebaseServiceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  messaging = admin.messaging();
  return messaging;
}

function getMessaging() {
  return messaging;
}

module.exports = { initFirebase, getMessaging };
