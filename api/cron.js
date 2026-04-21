// ============================================================
// MJPT — Cron
// Runs hourly via cron-job.org
// Handles:
//   1. Daily reminder (if user hasn't logged today)
//   2. Health alerts (no log in 3 days, pattern-based)
//   3. Weekly recap (Sunday 8am local time)
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp }       = require("firebase-admin/firestore");

if (!getApps().length) {
  const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8"));
  initializeApp({ credential: cert(sa) });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

const USERS_CONFIG = {
  mike:  { tz: "Australia/Melbourne", name: "Mike"  },
  jenna: { tz: "Asia/Makassar",       name: "Jenna" }
};

const BRISTOL = {
  1: "Pellet", 2: "Rock", 3: "Crackle", 4: "Soft",
  5: "Blob",   6: "Mush", 7: "Liquid"
};

const DEFAULT_REMINDERS = {
  mike:  [
    "Hey Mike! No logs yet today. How's the gut doing?",
    "Mike — daily check-in. Nothing logged yet today!",
    "Your gut data is missing for today, Mike. Log now?",
    "Mike, how's the gut? No logs recorded yet today 👀"
  ],
  jenna: [
    "Hey Jenna! No logs yet today. How's the gut going?",
    "Jenna — daily check-in. Nothing logged yet today!",
    "Your gut data is missing for today, Jenna. Log now?",
    "Jenna, how's the gut? No logs recorded yet today 👀"
  ]
};


// ── HANDLER ──
module.exports = async (req, res) => {
  console.log(`[cron] Hit at ${new Date().toISOString()}, auth: ${req.headers.authorization ? "present" : "missing"}`);

  const authHeader = req.headers.authorization;
  const adminKey   = req.query.key;
  const validCron  = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validAdmin = adminKey   === process.env.ADMIN_KEY;

  if (!validCron && !validAdmin) {
    console.log(`[cron] Unauthorized`);
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


// ── PROCESS USER ──
async function processUser(userId, config) {
  try {
    const now       = new Date();
    const localHour = getLocalHour(now, config.tz);
    const localDay  = getLocalDayOfWeek(now, config.tz); // 1=Mon ... 7=Sun

    console.log(`[${userId}] Local hour: ${localHour}, day: ${localDay}`);

    // Get settings
    const settingsSnap = await db.collection("config").doc("settings").get();
    const settings     = settingsSnap.data()?.[userId] || {};
    const reminder     = settings.reminder || { time: "20:00", frequency: "daily", days: [] };
    const [remHour]    = (reminder.time || "20:00").split(":").map(Number);

    const actions = [];

    // ── 1. WEEKLY RECAP (Sunday = day 7, 8am) ──
    if (localDay === 7 && localHour === 8) {
      const sent = await sendWeeklyRecap(userId, config);
      actions.push({ type: "recap", sent });
    }

    // ── 2. HEALTH ALERTS (check every hour, avoid duplicates) ──
    const alertSent = await checkHealthAlerts(userId, config, now);
    if (alertSent) actions.push({ type: "health_alert", sent: true });

    // ── 3. DAILY REMINDER (at configured hour) ──
    console.log(`[${userId}] Local time: ${localHour}:xx, reminder at: ${remHour}:00`);

    if (localHour === remHour) {
      // Check frequency
      if (reminder.frequency === "weekly" && localDay !== 1) {
        actions.push({ type: "reminder", sent: false, reason: "Not weekly day" });
      } else if (reminder.frequency === "custom" && reminder.days?.length > 0 && !reminder.days.includes(localDay)) {
        actions.push({ type: "reminder", sent: false, reason: `Not a scheduled day (${localDay})` });
      } else {
        const hasLogged = await hasLoggedToday(userId, config.tz);
        if (hasLogged) {
          actions.push({ type: "reminder", sent: false, reason: "Already logged today" });
        } else {
          const userSnap = await db.collection("users").doc(userId).get();
          if (!userSnap.exists) return { user: userId, sent: false, reason: "User not registered" };
          const chatId = userSnap.data()?.chatId;
          if (!chatId)   return { user: userId, sent: false, reason: "No chat ID" };

          const customMsgs = settings.reminderMessages;
          const pool       = (customMsgs?.length > 0) ? customMsgs : DEFAULT_REMINDERS[userId];
          const msg        = pool[Math.floor(Math.random() * pool.length)];

          await sendReminderMsg(chatId, msg);
          await db.collection("reminder_logs").add({ user: userId, sentAt: Timestamp.now(), type: "daily" });
          actions.push({ type: "reminder", sent: true, msg });
        }
      }
    } else {
      actions.push({ type: "reminder", sent: false, reason: `Not reminder time (${localHour} vs ${remHour})` });
    }

    return { user: userId, actions };

  } catch (err) {
    console.error(`[cron] Error for ${userId}:`, err);
    return { user: userId, error: err.message };
  }
}


// ── WEEKLY RECAP ──
async function sendWeeklyRecap(userId, config) {
  try {
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return false;
    const chatId = userSnap.data()?.chatId;
    if (!chatId) return false;

    const now         = new Date();
    const weekAgoDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeekDate= new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Fetch this week's logs
    const snap = await db.collection("logs")
      .where("user", "==", userId)
      .limit(200)
      .get();

    const allLogs  = snap.docs.map(d => d.data());
    const thisWeek = allLogs.filter(l => l.timestamp?.toDate() >= weekAgoDate);
    const lastWeek = allLogs.filter(l => l.timestamp?.toDate() >= prevWeekDate && l.timestamp?.toDate() < weekAgoDate);

    if (thisWeek.length === 0) {
      await sendMsg(chatId, `📊 *${config.name}'s Weekly Recap*\n\nNo logs this week. Start logging to see your gut health data! /quick`);
      return true;
    }

    // ── ANALYSIS ──
    const total       = thisWeek.length;
    const avgPerDay   = (total / 7).toFixed(1);

    // Bristol distribution
    const bristolCounts = {};
    thisWeek.forEach(l => {
      const t = parseInt(l.bristolType) || 4;
      bristolCounts[t] = (bristolCounts[t] || 0) + 1;
    });
    const topBristolEntry = Object.entries(bristolCounts).sort((a,b) => b[1]-a[1])[0];
    const topBristol      = parseInt(topBristolEntry[0]);
    const topBristolLabel = BRISTOL[topBristol] || "Soft";
    const topBristolPct   = Math.round((topBristolEntry[1] / total) * 100);

    // Consistency score (T3-T5 = healthy)
    const healthyLogs    = thisWeek.filter(l => [3,4,5].includes(parseInt(l.bristolType)));
    const consistencyPct = Math.round((healthyLogs.length / total) * 100);

    // Hard/loose counts
    const hardCount   = thisWeek.filter(l => parseInt(l.bristolType) <= 2).length;
    const looseCount  = thisWeek.filter(l => parseInt(l.bristolType) >= 6).length;

    // Symptoms
    const withSymps   = thisWeek.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0);
    const symptomPct  = Math.round((withSymps.length / total) * 100);
    const hasBlood    = thisWeek.some(l => l.symptoms?.includes("blood"));

    // Symptom frequency
    const symptomFreq = {};
    withSymps.forEach(l => l.symptoms.forEach(s => { if (s !== "none") symptomFreq[s] = (symptomFreq[s]||0)+1; }));
    const topSymptom  = Object.entries(symptomFreq).sort((a,b) => b[1]-a[1])[0];

    // Days logged
    const uniqueDays  = new Set(thisWeek.map(l => {
      const d = l.timestamp?.toDate();
      return d ? d.toLocaleDateString("en-CA", { timeZone: config.tz }) : null;
    }).filter(Boolean)).size;

    // Gut score (simple)
    const bristolScores = { 1:20, 2:50, 3:80, 4:100, 5:80, 6:50, 7:20 };
    const avgBristol    = thisWeek.reduce((a,l) => a + (bristolScores[parseInt(l.bristolType)] || 60), 0) / total;
    const symScore      = Math.max(0, 100 - symptomPct);
    const gutScore      = Math.round(avgBristol * 0.6 + symScore * 0.4);

    // Trend vs last week
    let trendLine = "";
    if (lastWeek.length > 0) {
      const lastConsistency = Math.round((lastWeek.filter(l => [3,4,5].includes(parseInt(l.bristolType))).length / lastWeek.length) * 100);
      const lastSymPct      = Math.round((lastWeek.filter(l => l.symptoms && !l.symptoms.includes("none")).length / lastWeek.length) * 100);
      const consistDiff     = consistencyPct - lastConsistency;
      const symDiff         = symptomPct - lastSymPct;
      const trends          = [];
      if (consistDiff >= 10)       trends.push("↑ more consistent stools than last week");
      else if (consistDiff <= -10) trends.push("↓ less consistent than last week");
      if (symDiff >= 10)           trends.push("↑ more symptoms than last week");
      else if (symDiff <= -10)     trends.push("↓ fewer symptoms than last week");
      if (total > lastWeek.length + 2) trends.push("↑ logging more frequently");
      if (trends.length) trendLine = `\n📈 *Trend:* ${trends.join(", ")}`;
    }

    // ── CONTEXTUAL TIP ──
    let tip = "";
    if (hasBlood) {
      tip = "\n🩸 *Alert:* Blood was detected in a log this week. If this continues, please consult a doctor.";
    } else if (hardCount >= 3) {
      tip = "\n💡 *Tip:* You had several hard stools this week. Increase water intake to at least 2L/day and add more fibre-rich foods (oats, legumes, vegetables).";
    } else if (looseCount >= 3) {
      tip = "\n💡 *Tip:* Multiple loose stools this week. Consider reducing caffeine, checking for lactose triggers, and staying well hydrated with electrolytes.";
    } else if (symptomPct >= 50) {
      tip = "\n💡 *Tip:* Symptoms appeared in more than half your logs. Common triggers: stress, processed foods, dairy, gluten. Try an elimination approach if symptoms persist.";
    } else if (consistencyPct >= 80) {
      tip = "\n💡 *Keep it up:* Your gut consistency is excellent this week. Whatever you're eating and doing — stick with it.";
    } else if (avgPerDay < 0.7) {
      tip = "\n💡 *Tip:* Fewer than 1 log per day on average. Low frequency can indicate constipation. Try more movement and water.";
    } else {
      tip = "\n💡 *Tip:* Stay consistent with hydration and fibre intake to maintain your gut health.";
    }

    // ── BUILD MESSAGE ──
    const dateRange = `${weekAgoDate.toLocaleDateString("en-AU", { day:"numeric", month:"short" })} – ${now.toLocaleDateString("en-AU", { day:"numeric", month:"short" })}`;

    const scoreLabel = gutScore >= 80 ? "Excellent 🟢" : gutScore >= 60 ? "Good 🟡" : gutScore >= 40 ? "Fair 🟠" : "Needs attention 🔴";

    let msg = `📊 *${config.name}'s Weekly Gut Report*\n_${dateRange}_\n\n`;
    msg += `*Overview*\n`;
    msg += `• ${total} logs across ${uniqueDays}/7 days (avg ${avgPerDay}/day)\n`;
    msg += `• Gut score: *${gutScore}/100* — ${scoreLabel}\n`;
    msg += `• Consistency: *${consistencyPct}%* healthy range (T3–T5)\n\n`;
    msg += `*Stool Profile*\n`;
    msg += `• Most common: *${topBristolLabel}* (${topBristolPct}% of logs)\n`;
    if (hardCount > 0) msg += `• Hard stools (T1–T2): ${hardCount} log${hardCount>1?"s":""}\n`;
    if (looseCount > 0) msg += `• Loose stools (T6–T7): ${looseCount} log${looseCount>1?"s":""}\n`;
    msg += `\n*Symptoms*\n`;
    if (withSymps.length === 0) {
      msg += `• No symptoms this week 🎉\n`;
    } else {
      msg += `• Appeared in ${symptomPct}% of logs\n`;
      if (topSymptom) msg += `• Most common: *${topSymptom[0]}* (${topSymptom[1]}x)\n`;
    }
    if (trendLine) msg += `\n${trendLine}\n`;
    msg += tip;

    await sendMsg(chatId, msg, null, { parse_mode: "Markdown" });
    await db.collection("reminder_logs").add({ user: userId, sentAt: Timestamp.now(), type: "weekly_recap" });
    return true;
  } catch (err) {
    console.error(`[recap] Error for ${userId}:`, err);
    return false;
  }
}


// ── HEALTH ALERTS ──
async function checkHealthAlerts(userId, config, now) {
  try {
    // Only check health alerts once per day (at noon local time) to avoid spam
    const localHour = getLocalHour(now, config.tz);
    if (localHour !== 12) return false;

    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) return false;
    const chatId = userSnap.data()?.chatId;
    if (!chatId) return false;

    const name = config.name;

    // Fetch recent logs (last 14 days)
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const snap = await db.collection("logs")
      .where("user", "==", userId)
      .limit(100)
      .get();

    const allLogs   = snap.docs.map(d => d.data());
    const recent    = allLogs.filter(l => l.timestamp?.toDate() >= twoWeeksAgo)
                             .sort((a,b) => (b.timestamp?.seconds||0) - (a.timestamp?.seconds||0));

    if (recent.length === 0) return false;

    const lastLog     = recent[0];
    const lastLogDate = lastLog.timestamp?.toDate();
    const daysSince   = Math.floor((now - lastLogDate) / (1000 * 60 * 60 * 24));

    // Check if we already sent an alert today
    const alertTodaySnap = await db.collection("reminder_logs")
      .where("user", "==", userId)
      .where("type", "==", "health_alert")
      .limit(5)
      .get();

    const todayStr = now.toLocaleDateString("en-CA", { timeZone: config.tz });
    const alreadySentToday = alertTodaySnap.docs.some(d => {
      const sentDate = d.data().sentAt?.toDate()?.toLocaleDateString("en-CA", { timeZone: config.tz });
      return sentDate === todayStr;
    });
    if (alreadySentToday) return false;

    let alertMsg = null;

    // Alert: no log in 3+ days
    if (daysSince >= 3) {
      const options = [
        `Hey ${name}, you haven't logged in ${daysSince} days 👀 Everything okay down there?`,
        `${name} — ${daysSince} days without a log. Your gut data misses you! How are things?`,
        `Checking in: it's been ${daysSince} days since your last log, ${name}. All good? /quick to log now`
      ];
      alertMsg = options[Math.floor(Math.random() * options.length)];
    }

    // Alert: 3+ hard stools this week
    const thisWeek  = recent.filter(l => l.timestamp?.toDate() >= new Date(now.getTime() - 7*24*60*60*1000));
    const hardCount = thisWeek.filter(l => parseInt(l.bristolType) <= 2).length;
    if (!alertMsg && hardCount >= 3) {
      alertMsg = `${name}, you've had ${hardCount} hard stools this week 🪨 Your gut might need more water and fibre. Try aiming for 2L of water today!`;
    }

    // Alert: 3+ loose stools this week
    const looseCount = thisWeek.filter(l => parseInt(l.bristolType) >= 6).length;
    if (!alertMsg && looseCount >= 3) {
      alertMsg = `${name}, ${looseCount} loose stools this week 💧 Consider cutting caffeine and checking for food triggers. Stay hydrated with electrolytes!`;
    }

    // Alert: logging streak milestone
    const streak = calcStreak(allLogs, config.tz, now);
    if (!alertMsg && [3, 7, 14, 30].includes(streak)) {
      alertMsg = `🔥 ${streak}-day logging streak, ${name}! Your gut data is looking great. Keep it up!`;
    }

    if (!alertMsg) return false;

    await sendMsg(chatId, alertMsg);
    await db.collection("reminder_logs").add({ user: userId, sentAt: Timestamp.now(), type: "health_alert", alert: alertMsg });
    return true;

  } catch (err) {
    console.error(`[health_alert] Error for ${userId}:`, err);
    return false;
  }
}


// ── STREAK CALCULATOR ──
function calcStreak(logs, tz, now) {
  const logDays = new Set(logs.map(l => {
    const d = l.timestamp?.toDate();
    return d ? d.toLocaleDateString("en-CA", { timeZone: tz }) : null;
  }).filter(Boolean));

  let streak = 0;
  const check = new Date(now);
  while (true) {
    const dateStr = check.toLocaleDateString("en-CA", { timeZone: tz });
    if (!logDays.has(dateStr)) break;
    streak++;
    check.setDate(check.getDate() - 1);
  }
  return streak;
}


// ── HAS LOGGED TODAY ──
async function hasLoggedToday(userId, tz) {
  const now       = new Date();
  const localStr  = now.toLocaleDateString("en-CA", { timeZone: tz });
  const startOfDayLocal = new Date(`${localStr}T00:00:00`);
  const utcOffset = now.getTime() - new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime();
  const startOfDayUTC   = new Date(startOfDayLocal.getTime() + utcOffset);

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


// ── HELPERS ──
function getLocalHour(now, tz) {
  return parseInt(now.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false }));
}

function getLocalDayOfWeek(now, tz) {
  const map = { Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6, Sunday:7 };
  return map[now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" })] || 1;
}

async function sendMsg(chatId, text, keyboard, opts = {}) {
  await fetch(`${API}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:      chatId,
      text,
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
      ...opts
    })
  });
}

async function sendReminderMsg(chatId, text) {
  await sendMsg(chatId, text, [
    [
      { text: "Quick log",  callback_data: "log:quick:quick" },
      { text: "Full log",   callback_data: "log:full:full"   },
      { text: "Skip",       callback_data: "log:skip:skip"   }
    ]
  ]);
}
