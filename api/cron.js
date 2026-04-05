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
    const reminder     = settings?.reminder || { time: "20:00", frequency: "daily", days: [] };

    // Get current local time
    const now       = new Date();
    const localStr  = now.toLocaleString("en-US", { timeZone: config.tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const [localHour] = localStr.split(":").map(Number);
    const [remHour]   = (reminder.time || "20:00").split(":").map(Number);

    // Check if it's reminder hour
    if (localHour !== remHour) {
      return { user: userId, sent: false, reason: `Not reminder time (${localStr} vs ${reminder.time})` };
    }

    // Check day of week for weekly/custom
    const localDay = parseInt(now.toLocaleString("en-US", { timeZone: config.tz, weekday: "short" })
      .replace("Mon",1).replace("Tue",2).replace("Wed",3).replace("Thu",4)
      .replace("Fri",5).replace("Sat",6).replace("Sun",7));

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
  const now        = new Date();
  const startOfDay = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  startOfDay.setHours(0, 0, 0, 0);

  const snap = await db.collection("logs")
    .where("user", "==", userId)
    .where("timestamp", ">=", Timestamp.fromDate(startOfDay))
    .limit(1)
    .get();

  return !snap.empty;
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
