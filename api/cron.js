// ============================================================
// MJPT — Daily Reminder Cron
// Runs hourly via cron-job.org
// Respects frequency (daily/weekly/custom days) per user.
// Only sends if user hasn't logged today.
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp }       = require("firebase-admin/firestore");

if (!getApps().length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8")
  );
  initializeApp({ credential: cert(serviceAccount) });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

const USERS_CONFIG = {
  mike:  { tz: "Australia/Melbourne" },
  jenna: { tz: "Asia/Makassar" }
};

// Default reminder messages (overridden by admin settings)
const DEFAULT_MESSAGES = {
  mike:  [
    "Hey Mike! No logs yet today. How's the gut doing?",
    "Mike, you haven't logged today. Everything okay down there?",
    "Daily check-in — no logs recorded yet today, Mike!",
    "Mike! Your gut data is missing for today. Log now?"
  ],
  jenna: [
    "Hey Jenna! No logs yet today. How's the gut going?",
    "Jenna, you haven't logged today. Everything okay?",
    "Daily check-in — no logs yet today, Jenna!",
    "Jenna! Your gut data is missing for today. Log now?"
  ]
};


// ── HANDLER ──
module.exports = async (req, res) => {
  console.log(`[cron] Hit at ${new Date().toISOString()}, auth: ${req.headers.authorization ? "present" : "missing"}`);

  const authHeader = req.headers.authorization;
  const adminKey   = req.query.key;

  // Allow admin manual trigger via ?key= OR cron via Authorization header
  const validCron  = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validAdmin = adminKey === process.env.ADMIN_KEY;

  if (!validCron && !validAdmin) {
    console.log(`[cron] Unauthorized — header: ${authHeader}, key: ${adminKey}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.log(`[cron] Authorized via ${validAdmin ? "admin key" : "cron secret"}`);

  const results = [];
  for (const [userId, config] of Object.entries(USERS_CONFIG)) {
    const result = await processUser(userId, config);
    results.push(result);
    console.log(`[cron] ${userId}: ${JSON.stringify(result)}`);
  }

  res.status(200).json({ ok: true, results });
};


async function processUser(userId, config) {
  try {
    // Get settings
    const settingsSnap = await db.collection("config").doc("settings").get();
    const settings     = settingsSnap.data()?.[userId];
    const reminder     = settings?.reminder || { time: "20:00", frequency: "daily", days: [] };

    // Get current local time
    const now       = new Date();
    const localStr  = now.toLocaleString("en-US", { timeZone: config.tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const [localHour] = localStr.split(":").map(Number);
    const [remHour]   = (reminder.time || "20:00").split(":").map(Number);

    // Check if it's reminder hour
    console.log(`[${userId}] Local time: ${localStr}, reminder at: ${reminder.time}, localHour: ${localHour}, remHour: ${remHour}`);
    if (localHour !== remHour) {
      return { user: userId, sent: false, reason: `Not reminder time (${localStr} vs ${reminder.time})` };
    }

    // Check day of week for weekly/custom
    const localDay = getLocalDayOfWeek(now, config.tz);

    if (reminder.frequency === "weekly" && localDay !== 1) {
      return { user: userId, sent: false, reason: "Not weekly reminder day" };
    }

    if (reminder.frequency === "custom" && reminder.days?.length > 0) {
      if (!reminder.days.includes(localDay)) {
        return { user: userId, sent: false, reason: `Not a scheduled day (${localDay})` };
      }
    }

    // Get user Telegram chat ID
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return { user: userId, sent: false, reason: "User not registered" };
    const chatId = userSnap.data().chatId;
    if (!chatId) return { user: userId, sent: false, reason: "No chat ID" };

    // Check if already logged today
    const hasLogged = await hasLoggedToday(userId, config.tz);
    if (hasLogged) return { user: userId, sent: false, reason: "Already logged today" };

    // Get custom wording from admin settings, fallback to defaults
    const customMessages = settings?.reminderMessages;
    const messages       = (customMessages && customMessages.length > 0) ? customMessages : DEFAULT_MESSAGES[userId];
    const msg            = messages[Math.floor(Math.random() * messages.length)];

    await sendReminder(chatId, msg);

    await db.collection("reminder_logs").add({
      user: userId, sentAt: Timestamp.now(), localTime: localStr
    });

    return { user: userId, sent: true, msg };

  } catch (err) {
    console.error(`Cron failed for ${userId}:`, err);
    return { user: userId, sent: false, error: err.message };
  }
}


async function hasLoggedToday(userId, tz) {
  // Get start of today in user's local timezone correctly
  const now       = new Date();
  const localStr  = now.toLocaleDateString("en-CA", { timeZone: tz }); // "YYYY-MM-DD"
  const [y, m, d] = localStr.split("-").map(Number);

  // Build start of day in UTC by finding midnight in that timezone
  const startOfDayLocal = new Date(`${localStr}T00:00:00`);
  // Get the UTC offset for this timezone at this date
  const utcOffset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
  const startOfDayUTC = new Date(startOfDayLocal.getTime() + utcOffset);

  // Fetch all of user's recent logs and filter in JS — avoids composite index
  const snap = await db.collection("logs")
    .where("user", "==", userId)
    .limit(50)
    .get();

  if (snap.empty) return false;

  const startSeconds = startOfDayUTC.getTime() / 1000;

  return snap.docs.some(doc => {
    const ts = doc.data().timestamp;
    return ts && ts.seconds >= startSeconds;
  });
}


function getLocalDayOfWeek(now, tz) {
  // Returns 1=Mon, 2=Tue, ... 7=Sun
  const dayStr = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
  const map = {
    "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4,
    "Friday": 5, "Saturday": 6, "Sunday": 7
  };
  return map[dayStr] || 1;
}


async function sendReminder(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:      chatId,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: "Quick log",  callback_data: "log:quick:quick" },
          { text: "Full log",   callback_data: "log:full:full"   },
          { text: "Skip",       callback_data: "log:skip:skip"   }
        ]]
      }
    })
  });
}
