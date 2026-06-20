// ============================================================
// MJPT — Shared Firebase Initialization
// Single point of init for all serverless functions.
// Prevents boilerplate duplication across cron.js, webhook.js,
// admin.js, and import.js.
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore }                 = require("firebase-admin/firestore");

if (!getApps().length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8")
  );
  initializeApp({ credential: cert(serviceAccount) });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

module.exports = { db, BOT, API };