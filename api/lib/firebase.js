// ============================================================
// MJPT — Shared Firebase Initialization
// Single point of init for all serverless functions.
// Prevents boilerplate duplication across cron.js, webhook.js,
// admin.js, and import.js.
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore }                 = require("firebase-admin/firestore");

if (!getApps().length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || "";
  console.log(`[firebase debug] raw b64 length: ${raw.length}`); // TEMP — remove after debugging
  const serviceAccount = JSON.parse(
    Buffer.from(raw, "base64").toString("utf8")
  );
  console.log(`[firebase debug] client_email: ${serviceAccount.client_email}, key_id: ${serviceAccount.private_key_id}`); // TEMP — remove after debugging
  initializeApp({ credential: cert(serviceAccount) });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

module.exports = { db, BOT, API };
