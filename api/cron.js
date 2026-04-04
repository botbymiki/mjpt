// ============================================================
// MJPT — Daily Reminder Cron
// Runs on schedule via Vercel Cron.
// Sends Telegram reminders at each user's configured local time.
//
// vercel.json schedule: "0 * * * *" (every hour)
// This function checks if it's reminder time for each user.
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp }       = require("firebase-admin/firestore");

// ── FIREBASE ADMIN INIT ──
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    })
  });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

const USERS_CONFIG = {
  mike:  { tz: "Australia/Melbourne" },
  jenna: { tz: "Asia/Makassar"       }
};

const REMINDER_MESSAGES = [
  "Hey! Don't forget to log today's business. 📋",
  "Daily check-in: how's the gut doing? Log via /quick or /log",
  "Time to log! Your gut health data awaits. /quick for fast entry.",
  "Reminder: log your latest poop! /quick makes it easy.",
  "mjpt daily check-in. Don't break the streak! /quick to log fast."
];


// ── HANDLER ──
module.exports = async (req, res) => {

  // Verify this is called from Vercel Cron (or admin)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = [];

  for (const [userId, config] of Object.entries(USERS_CONFIG)) {
    const result = await processUser(userId, config);
    results.push(result);
  }

  res.status(200).json({ ok: true, results });
};


async function processUser(userId, config) {
  try {
    // Get settings
    const settingsSnap = await db.collection("config").doc("settings").get();
    const settings     = settingsSnap.data()?.[userId];
    const reminderTime = settings?.reminderTime || "20:00";

    // Get current local time for this user
    const now       = new Date();
    const localTime = now.toLocaleString("en-US", { timeZone: config.tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const [localHour, localMin] = localTime.split(":").map(Number);
    const [remHour,   remMin]   = reminderTime.split(":").map(Number);

    // Only send if it's the reminder hour (cron runs every hour, check exact hour)
    if (localHour !== remHour) {
      return { user: userId, sent: false, reason: `Not reminder time (${localTime} vs ${reminderTime})` };
    }

    // Get user's Telegram chat ID
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return { user: userId, sent: false, reason: "User not registered" };
    }

    const chatId = userSnap.data().chatId;
    if (!chatId) {
      return { user: userId, sent: false, reason: "No chat ID" };
    }

    // Pick a random message
    const msg = REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
    const name = userId === "mike" ? "Mike" : "Jenna";

    await sendReminder(chatId, `${name}, ${msg}`);

    // Log that reminder was sent
    await db.collection("reminder_logs").add({
      user:      userId,
      sentAt:    Timestamp.now(),
      localTime: localTime
    });

    return { user: userId, sent: true };

  } catch (err) {
    console.error(`Cron failed for ${userId}:`, err);
    return { user: userId, sent: false, error: err.message };
  }
}


async function sendReminder(chatId, text) {
  const res = await fetch(`${API}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:      chatId,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: "Quick log ⚡",  callback_data: "log:quick:quick" },
          { text: "Full log 📋",   callback_data: "log:full:full"   }
        ]]
      }
    })
  });
  return res.json();
}
