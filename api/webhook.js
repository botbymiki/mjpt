// ============================================================
// MJPT — Telegram Webhook
// Receives all messages from Telegram and processes them.
// Deployed as a Vercel serverless function.
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp }       = require("firebase-admin/firestore");

// ── FIREBASE ADMIN INIT ──
if (!getApps().length) {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf8")
  );
  initializeApp({ credential: cert(serviceAccount) });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

// ── BRISTOL INFO ──
const BRISTOL = {
  1: { label: "Pellet",  desc: "Separate hard lumps — severe constipation" },
  2: { label: "Rock",    desc: "Lumpy, hard, difficult to pass" },
  3: { label: "Crackle", desc: "Sausage with cracks — mostly normal" },
  4: { label: "Soft",    desc: "Smooth, easy to pass — ideal!" },
  5: { label: "Blob",    desc: "Soft blobs — lacking fibre" },
  6: { label: "Mush",    desc: "Fluffy, mushy — mild diarrhea" },
  7: { label: "Liquid",  desc: "Watery — severe diarrhea" }
};

const COLORS = ["brown", "dark_brown", "yellow", "green", "red", "black", "pale"];
const SYMPTOMS = ["none", "bloating", "urgency", "cramps", "blood"];

// ── CONVERSATION STATE (Firestore-backed — survives serverless cold starts) ──
const sessions = {}; // local cache within same invocation only

async function getSession(chatId) {
  // Check local cache first
  if (sessions[chatId]) return sessions[chatId];
  // Fall back to Firestore
  try {
    const snap = await db.collection("sessions").doc(String(chatId)).get();
    if (snap.exists) {
      const data = snap.data();
      // Expire sessions older than 30 minutes
      const age = Date.now() - (data.updatedAt || 0);
      if (age < 30 * 60 * 1000) {
        sessions[chatId] = data;
        return data;
      }
      // Expired — delete it
      await db.collection("sessions").doc(String(chatId)).delete();
    }
  } catch (err) {
    console.error("getSession error:", err);
  }
  return null;
}

async function setSession(chatId, session) {
  session.updatedAt = Date.now();
  sessions[chatId] = session;
  try {
    await db.collection("sessions").doc(String(chatId)).set(session);
  } catch (err) {
    console.error("setSession error:", err);
  }
}

async function deleteSession(chatId) {
  delete sessions[chatId];
  try {
    await db.collection("sessions").doc(String(chatId)).delete();
  } catch (err) {
    console.error("deleteSession error:", err);
  }
}


// ── MAIN HANDLER ──
module.exports = async (req, res) => {
  // GET test route
  if (req.method === "GET") {
    try {
      await db.collection("config").doc("settings").get();
      return res.status(200).json({ ok: true, firebase: "connected" });
    } catch (err) {
      return res.status(200).json({ ok: false, firebase: "failed", error: err.message });
    }
  }

  if (req.method !== "POST") return res.status(200).json({ ok: true });

  try {
    const update = req.body;

    // Handle callback queries (inline button taps)
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    // Handle messages
    if (update.message) {
      await handleMessage(update.message);
      return res.status(200).json({ ok: true });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
};


// ── MESSAGE HANDLER ──
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();

  console.log(`MSG from ${chatId}: ${text}`);

  // Identify user
  const user = await getUserByChatId(chatId);
  console.log(`User found:`, user ? user.id : "none");

  if (text.startsWith("/start")) {
    console.log("Handling /start");
    await handleStart(chatId, user);
    return;
  }

  if (!user) {
    await sendMsg(chatId, "I don't know who you are yet. Send /start to register.");
    return;
  }

  if (text.startsWith("/quick") || text === "q") {
    await handleQuickLog(chatId, user);
    return;
  }

  if (text.startsWith("/log") || text === "l") {
    await handleLogStart(chatId, user);
    return;
  }

  if (text.startsWith("/history") || text === "/h") {
    await handleHistory(chatId, user);
    return;
  }

  if (text.startsWith("/preset")) {
    await handlePreset(chatId, user);
    return;
  }

  if (text.startsWith("/help")) {
    await handleHelp(chatId, user);
    return;
  }

  if (text.startsWith("/check") || text === "c") {
    await handleCheck(chatId, user);
    return;
  }

  // Handle conversation state
  const session = await getSession(chatId);
  if (session) {
    await handleConversation(chatId, user, text, session);
    return;
  }

  await handleHelp(chatId, user);
}


// ── /start ──
async function handleStart(chatId, existingUser) {
  console.log("handleStart called, existingUser:", existingUser?.id);
  if (existingUser) {
    await sendMsg(chatId, `Welcome back, ${existingUser.name}! 👋\n\nUse /quick to log fast or /log for full entry.`);
    return;
  }

  console.log("Sending registration message to:", chatId);
  const result = await sendMsg(chatId, "Hey! Welcome to mjpt 💩\n\nWho are you?", [
    [
      { text: "Mike",  callback_data: "register:mike"  },
      { text: "Jenna", callback_data: "register:jenna" }
    ]
  ]);
  console.log("sendMsg result:", JSON.stringify(result));
}


// ── /quick ──
async function handleQuickLog(chatId, user) {
  const preset = await getUserPreset(user.id);

  const logEntry = {
    user:        user.id,
    bristolType: parseInt(preset.bristolType) || 4,
    color:       preset.color    || "brown",
    volume:      preset.volume   || "normal",
    symptoms:    preset.symptoms || ["none"],
    notes:       "",
    quick:       true,
    source:      "telegram",
    timestamp:   Timestamp.now()
  };

  await db.collection("logs").add(logEntry);

  const b   = BRISTOL[parseInt(preset.bristolType)] || BRISTOL[4];
  const vol = formatVolume(preset.volume || "normal");
  await sendMsg(chatId,
    `*Logged!* ${b.label}\n\n${vol} · ${preset.color?.replace(/_/g," ") || "brown"} · No symptoms\n\n_Use /log for a full entry_`,
    null, { parse_mode: "Markdown" }
  );
}


// ── /log — start guided flow ──
async function handleLogStart(chatId, user) {
  const session = { step: "bristol", data: { user: user.id, source: "telegram", quick: false } };
  await setSession(chatId, session);

  await sendMsg(chatId, `Full Log Entry\n\nWhat's the Bristol type?`, {
    inline_keyboard: [
      [
        { text: "1 — Hard lumps",     callback_data: "log:bristol:1" },
        { text: "2 — Lumpy sausage",  callback_data: "log:bristol:2" }
      ],
      [
        { text: "3 — Cracked sausage", callback_data: "log:bristol:3" },
        { text: "4 — Smooth (ideal)",  callback_data: "log:bristol:4" }
      ],
      [
        { text: "5 — Soft blobs",    callback_data: "log:bristol:5" },
        { text: "6 — Fluffy pieces", callback_data: "log:bristol:6" }
      ],
      [
        { text: "7 — Watery", callback_data: "log:bristol:7" }
      ]
    ]
  }, { parse_mode: "Markdown" });
}


// ── CALLBACK HANDLER ──
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const data   = cb.data;
  const msgId  = cb.message.message_id;
  const user   = await getUserByChatId(chatId);

  // Acknowledge callback
  await fetch(`${API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id })
  });

  // Registration
  if (data.startsWith("register:")) {
    const userId = data.split(":")[1];
    await registerUser(chatId, userId, cb.from);
    const name = userId === "mike" ? "Mike" : "Jenna";
    await editMsg(chatId, msgId, `You're all set, ${name}! 🎉\n\nCommands:\n/quick — instant log\n/log — full entry\n/history — recent logs\n/preset — update defaults`);
    return;
  }

  // Logging flow
  if (data.startsWith("log:")) {
    const parts = data.split(":");
    const field = parts[1];
    const value = parts[2];

    // Reminder button shortcuts
    if (field === "quick") {
      await handleQuickLog(chatId, user);
      return;
    }
    if (field === "full") {
      await handleLogStart(chatId, user);
      return;
    }
    if (field === "skip") {
      await editMsg(chatId, msgId, "No worries! Don't forget to log later. 👋");
      return;
    }

    await handleLogCallback(chatId, msgId, user, field, value);
    return;
  }

  // Preset flow
  if (data.startsWith("preset:")) {
    const parts = data.split(":");
    const field = parts[1];
    const value = parts[2];
    await handlePresetCallback(chatId, msgId, user, field, value);
    return;
  }
}


// ── LOG CALLBACK FLOW ──
async function handleLogCallback(chatId, msgId, user, field, value) {
  let session = await getSession(chatId);
  if (!session) {
    session = { step: field, data: { user: user?.id, source: "telegram", quick: false } };
  }
  await setSession(chatId, session);

  if (field === "bristol") {
    session.data.bristolType = parseInt(value);
    session.step = "color";

    await replyMsg(chatId, msgId, `Type ${value} selected.\n\nWhat color?`, {
      inline_keyboard: [
        [
          { text: "Brown",      callback_data: "log:color:brown"      },
          { text: "Dark brown", callback_data: "log:color:dark_brown" },
          { text: "Yellow",     callback_data: "log:color:yellow"     }
        ],
        [
          { text: "Green",     callback_data: "log:color:green" },
          { text: "Red",       callback_data: "log:color:red"   },
          { text: "Black",     callback_data: "log:color:black" },
          { text: "Pale/clay", callback_data: "log:color:pale"  }
        ]
      ]
    });
    await setSession(chatId, session);
    return;
  }

  if (field === "color") {
    session.data.color = value;
    session.step = "volume";

    await replyMsg(chatId, msgId, `${value} noted.\n\nWhat's the volume?`, {
      inline_keyboard: [
        [
          { text: "Child Size", callback_data: "log:volume:child_size" },
          { text: "Small",      callback_data: "log:volume:small"      }
        ],
        [
          { text: "Normal",  callback_data: "log:volume:normal"  },
          { text: "Huge",    callback_data: "log:volume:huge"    }
        ],
        [
          { text: "Gigantic", callback_data: "log:volume:gigantic" }
        ]
      ]
    });
    await setSession(chatId, session);
    return;
  }

  if (field === "volume") {
    session.data.volume = value;
    session.step = "symptoms";

    await replyMsg(chatId, msgId, `Got it.\n\nAny symptoms? (tap all that apply, then Done)`, {
      inline_keyboard: [
        [
          { text: "None",     callback_data: "log:symptoms:none"     },
          { text: "Bloating", callback_data: "log:symptoms:bloating" }
        ],
        [
          { text: "Urgency", callback_data: "log:symptoms:urgency" },
          { text: "Cramps",  callback_data: "log:symptoms:cramps"  }
        ],
        [
          { text: "Blood",   callback_data: "log:symptoms:blood" },
          { text: "Done",    callback_data: "log:done:done"       }
        ]
      ]
    });

    session.data.symptoms = [];
    await setSession(chatId, session);
    return;
  }

  if (field === "symptoms") {
    if (value === "none") {
      session.data.symptoms = ["none"];
    } else {
      session.data.symptoms = session.data.symptoms || [];
      if (!session.data.symptoms.includes(value)) {
        session.data.symptoms.push(value);
      }
      session.data.symptoms = session.data.symptoms.filter(s => s !== "none");
    }
    // Don't advance — let user tap Done
    await setSession(chatId, session);
    return;
  }

  if (field === "done") {
    if (!session.data.symptoms || session.data.symptoms.length === 0) {
      session.data.symptoms = ["none"];
    }
    session.step = "when";

    await replyMsg(chatId, msgId,
      `Got it! When was this?`, {
      inline_keyboard: [[
        { text: "Right now",  callback_data: "log:when:now"       },
        { text: "Yesterday",  callback_data: "log:when:yesterday" }
      ]]
    });
    await setSession(chatId, session);
    return;
  }

  if (field === "when") {
    if (value === "now") {
      session.data.backdated = false;
      session.step = "notes";
      await replyMsg(chatId, msgId,
        `Any notes? (Reply with text, or tap Skip)`, {
        inline_keyboard: [[{ text: "Skip", callback_data: "log:notes:skip" }]]
      });
    } else {
      // Yesterday — ask for time
      session.data.backdated = true;
      session.step = "time";
      await replyMsg(chatId, msgId,
        `What time yesterday? (HH:MM, 24hr — e.g. 08:30 or 21:00)`, {
        inline_keyboard: [[{ text: "Skip (use midnight)", callback_data: "log:time:00:00" }]]
      });
    }
    await setSession(chatId, session);
    return;
  }

  if (field === "time") {
    const timeParts = value.split(":");
    const hh = parseInt(timeParts[0]) || 0;
    const mm = parseInt(timeParts[1]) || 0;

    const tz        = session.data.user === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const nowLocal  = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const yesterday = new Date(nowLocal);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(hh, mm, 0, 0);

    const utcOffset = new Date().getTime() - new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getTime();
    const utcDate   = new Date(yesterday.getTime() + utcOffset);
    session.data.backdatedTimestamp = utcDate;
    session.step = "notes";

    const timeStr   = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
    const replyText = `Got it — logging for yesterday at ${timeStr}.\n\nAny notes? (Reply with text, or tap Skip)`;
    const keyboard  = [[{ text: "Skip", callback_data: "log:notes:skip" }]];

    if (msgId) {
      await replyMsg(chatId, msgId, replyText, keyboard);
    } else {
      await sendMsg(chatId, replyText, keyboard);
    }

    await setSession(chatId, session);
    return;
  }

  if (field === "notes") {
    session.data.notes = value === "skip" ? "" : value;
    await saveLog(chatId, session.data, msgId);
    await setSession(chatId, session);
    return;
  }
}


// ── SAVE LOG ──
async function saveLog(chatId, data, msgId) {
  if (data.backdatedTimestamp) {
    data.timestamp = Timestamp.fromDate(data.backdatedTimestamp);
    delete data.backdatedTimestamp;
    delete data.backdated;
  } else {
    data.timestamp = Timestamp.now();
  }

  data.notes       = data.notes    || "";
  data.symptoms    = data.symptoms || ["none"];
  data.color       = data.color    || "brown";
  data.volume      = data.volume   || "normal";
  data.bristolType = parseInt(data.bristolType) || 4;

  try {
    await db.collection("logs").add(data);

    // Gather context for rich message
    const tz         = data.user === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const localHour  = getLocalHour(new Date(), tz);
    const streak     = await getStreak(data.user, tz);
    const daysSince  = await getDaysSinceLastLog(data.user, tz);
    const partnerKey = data.user === "mike" ? "jenna" : "mike";
    const partnerLogged = await hasLoggedTodayKey(partnerKey, data.user === "mike" ? "Asia/Makassar" : "Australia/Melbourne");
    const partnerName   = partnerKey === "mike" ? "Mike" : "Jenna";

    const msg = buildConfirmationMsg({
      data, localHour, streak, daysSince, partnerLogged, partnerName
    });

    if (msgId) {
      await editMsg(chatId, msgId, msg, null, { parse_mode: "Markdown" });
    } else {
      await sendMsg(chatId, msg, null, { parse_mode: "Markdown" });
    }

    await notifyPartner(data.user, data.bristolType, data.volume, data.symptoms, localHour);

  } catch (err) {
    console.error(err);
    await sendMsg(chatId, "Failed to save log. Try again.");
  }

  await deleteSession(chatId);
}


// ── BUILD CONFIRMATION MESSAGE ──
function buildConfirmationMsg({ data, localHour, streak, daysSince, partnerLogged, partnerName }) {
  const b       = BRISTOL[data.bristolType] || BRISTOL[4];
  const vol     = formatVolume(data.volume);
  const color   = data.color.replace(/_/g, " ");
  const t       = data.bristolType;
  const syms    = data.symptoms || ["none"];
  const hasSymp    = !syms.includes("none") && syms.length > 0;
  const hasCramps  = syms.includes("cramps");
  const hasBloat   = syms.includes("bloating");
  const hasUrgency = syms.includes("urgency");
  const hasBlood   = syms.includes("blood");
  const isHard     = t <= 2;
  const isSoft     = t === 4;
  const isLoose    = t >= 6;

  const lines = [];

  // ── OPENER: Gap or double-drop ──
  if (daysSince >= 5) {
    lines.push(pick([
      `Been ${daysSince} days — everything alright down there? Glad you're back 👋`,
      `${daysSince} days between logs. Hope everything came out okay. Welcome back.`,
      `Finally! ${daysSince} days of suspense. Your gut had a lot to think about apparently.`,
      `Back after ${daysSince} days. Better late than never — how are you feeling?`,
      `${daysSince} days is a long time. Your gut clearly needed some thinking space.`
    ]));
  } else if (daysSince >= 3) {
    lines.push(pick([
      `Back at it after ${daysSince} days ✓`,
      `${daysSince} days since last check-in — good to have you back.`,
      `Finally! Been ${daysSince} days. Your gut was clearly building up suspense.`,
      `A ${daysSince}-day break. Hope things are moving better now.`
    ]));
  } else if (daysSince === 0) {
    lines.push(pick([
      `Double drop today 💪 Your gut is very productive.`,
      `Going again? Respect the consistency.`,
      `Another one today — busy gut day!`,
      `Second log of the day. Your gut is vocal today.`,
      `Two in one day — your gut has a lot to say.`
    ]));
  }

  // ── TIME + DETAILS ──
  const timeOpener = getTimeOpener(localHour);
  lines.push(`${timeOpener} — ${b.label}, ${vol}, ${color}.`);

  // ── BRISTOL REACTION ──
  const bristolReact = getBristolReaction(t);
  if (bristolReact) lines.push(bristolReact);

  // ── VOLUME (only notable) ──
  if (data.volume === "gigantic") {
    lines.push(pick([
      `...that's a lot. How do you feel? 😅`,
      `Gigantic. Genuinely impressive. Your gut had a lot to get off its chest.`,
      `Big one. Your gut clearly had a lot to say today.`,
      `That was a statement. Gigantic volume noted.`,
      `Wow. Gigantic. Hope you feel lighter now 😌`
    ]));
  } else if (data.volume === "child_size") {
    lines.push(pick([
      `Small one today — quality over quantity.`,
      `Tiny but it counts. Small but mighty.`,
      `Little drop today. Your gut said what it needed to say.`,
      `Child size today — sometimes that's all there is.`
    ]));
  } else if (data.volume === "huge") {
    lines.push(pick([
      `Huge volume today. Your gut means business.`,
      `That was a big one. Hope you feel lighter now 😌`,
      `Huge drop — your gut clearly had a backlog.`
    ]));
  }

  // ── COLOR (non-brown) ──
  if (data.color === "red") {
    lines.push(`🔴 Red flagged. Could be harmless (beets? chilli?) but if it wasn't food, please see a doctor.`);
  } else if (data.color === "black") {
    lines.push(`⚫ Black stool — if it wasn't from iron supplements or dark food, get it checked. Take it seriously.`);
  } else if (data.color === "green") {
    lines.push(pick([
      `Green can mean things moved through fast. Anything unusual you ate lately?`,
      `Going green today. Usually diet-related — leafy greens or food dye. Keep an eye if it continues.`,
      `Green stool often just means things moved quickly. Worth noting if it keeps up.`
    ]));
  } else if (data.color === "yellow") {
    lines.push(pick([
      `Yellow might just be diet but worth noting if it keeps showing up.`,
      `Yellow today — could be diet or things moving fast. Monitor if it repeats.`
    ]));
  } else if (data.color === "pale") {
    lines.push(`Pale stool is worth monitoring. If it keeps happening, mention it to a doctor.`);
  } else if (data.color === "dark_brown") {
    // dark brown is fine, no comment needed
  }

  // ── SYMPTOMS ──
  if (hasBlood) {
    lines.push(pick([
      `🩸 Blood flagged. Don't ignore this — if it keeps happening, please see a doctor. Seriously.`,
      `🩸 You logged blood. That's worth paying attention to. See a doctor if it recurs.`,
      `🩸 Blood noted. Could be a small tear, could be more — don't brush it off.`
    ]));
  } else if (hasCramps && hasBloat) {
    lines.push(pick([
      `Cramps and bloating together — your gut is clearly not happy right now. Take it easy today.`,
      `Double symptom day — cramps + bloating. Peppermint tea, heating pad, rest. You've got this.`,
      `Rough combo. Cramps and bloating usually means your gut needs a break today.`,
      `That's a tough combination. Take it easy, stay warm, and maybe skip the heavy meals today.`,
      `Ouch — cramps and bloating together is no fun. Rest, warmth, and light food today.`
    ]));
  } else if (hasCramps) {
    lines.push(pick([
      `Cramps on top of it — that's no fun. Hope you're feeling better now.`,
      `Ouch, cramps. A warm compress or peppermint tea might help.`,
      `Cramps flagged. Take it easy and drink some warm water.`,
      `That sounds uncomfortable. Hope the cramps ease up soon.`,
      `Cramps today. A hot water bottle and some rest might be exactly what you need.`,
      `Crampy one. Your gut is working through something — be gentle with yourself today.`,
      `Cramps are your gut's way of saying it's working overtime. Rest up.`
    ]));
  } else if (hasBloat) {
    lines.push(pick([
      `Bloating flagged — might be worth skipping dairy today and see if it helps.`,
      `Bloated gut today. Ginger tea is your friend here.`,
      `Bloating noted. Could be something you ate — watch the dairy and legumes today.`,
      `Gassy times. Your gut might appreciate a lighter meal for the rest of the day.`,
      `Bloated today. Fennel tea or a gentle walk can help move things along.`,
      `That bloating is your gut saying something disagreed with it. Lighter food today.`,
      `Bloating can be rough. Peppermint or ginger tea, and avoid the gassy foods today.`
    ]));
  } else if (hasUrgency) {
    lines.push(pick([
      `Urgency flagged — when your gut says now, it means now 😅 Hope you made it in time.`,
      `Your gut had its own schedule today apparently. Urgency is no joke.`,
      `Urgency noted. Your gut clearly wasn't waiting for anyone today.`,
      `Emergency drop 😅 Your gut is in charge today, not you.`,
      `When it's urgent, it's urgent. No shame in that — hope you made it!`
    ]));
  }

  // ── STREAK ──
  if (streak >= 30) {
    lines.push(pick([
      `🏆 ${streak}-day streak. That's not a habit anymore, that's a lifestyle.`,
      `🏆 ${streak} days straight. Genuinely one of the most consistent loggers I've seen.`,
      `🏆 ${streak} days. You've turned gut logging into an art form.`
    ]));
  } else if (streak >= 14) {
    lines.push(pick([
      `🔥 ${streak}-day streak. Two weeks of logging — your gut data is beautiful right now.`,
      `🔥 ${streak} days in a row. That's serious dedication to your gut health.`,
      `🔥 ${streak} days straight. Your gut thanks you for the attention.`
    ]));
  } else if (streak >= 7) {
    lines.push(pick([
      `🔥 ${streak} days in a row. A full week of logging — gut health athlete behaviour.`,
      `🔥 ${streak}-day streak. One week and counting. Keep it going!`,
      `🔥 Week-long streak! ${streak} days. Your gut is getting properly tracked.`
    ]));
  } else if (streak >= 5) {
    lines.push(pick([
      `🔥 ${streak}-day streak — honestly impressive consistency right now.`,
      `🔥 ${streak} days in a row. You're building something real here.`,
      `🔥 ${streak}-day streak. Don't stop now — momentum is everything.`
    ]));
  } else if (streak >= 3) {
    lines.push(pick([
      `🔥 ${streak} days in a row. Your gut is getting into a rhythm.`,
      `🔥 ${streak}-day streak. Small but meaningful — keep it going.`,
      `🔥 ${streak} days straight. The habit is forming.`
    ]));
  }

  // ── PARTNER ──
  if (partnerLogged) {
    lines.push(pick([
      `${partnerName} already logged today btw 👀`,
      `${partnerName} beat you to it — they already checked in today.`,
      `For the record, ${partnerName} already logged today too.`,
      `${partnerName} was ahead of you today — they logged earlier 😄`,
      `Just so you know, ${partnerName} already did their check-in today.`
    ]));
  }

  // ── NOTES ──
  if (data.notes) lines.push(`_"${data.notes}"_`);

  return lines.join("\n\n");
}


// ── BRISTOL REACTIONS ──
function getBristolReaction(t) {
  const pools = {
    4: [
      "Soft is the gold standard. Nailed it.",
      "Clean Soft drop. That's exactly what a happy gut looks like.",
      "Smooth and easy — that's the dream right there.",
      "Soft drop. Your gut is operating in peak condition.",
      "Perfect. Soft is what we're always aiming for.",
      "That's the one. Textbook healthy gut behaviour.",
      "Soft and smooth — your gut is very happy with you right now.",
      "Honestly perfect. Soft is what every log should look like.",
      "That's a 10/10 gut moment. Soft and clean.",
      "Your gut is thriving. Soft is exactly where you want to be."
    ],
    3: [
      "Crackle — a little on the firm side but nothing to worry about.",
      "Solid Crackle. Drink a bit more water today and you'll be perfect.",
      "Crackle is respectable. Slightly firm but you're in good shape.",
      "Not quite Soft but Crackle is a solid result. Hydrate a little more.",
      "Crackle today. You're close to perfect — just needs a bit more water.",
      "A Crackle is fine. One more glass of water today would take you to the next level.",
      "Crackle means your gut is doing okay but could use more hydration."
    ],
    5: [
      "Soft Blob — slightly mushy but you're still in the safe zone.",
      "Blobby one today. Keep an eye on what you ate in the last 12 hours.",
      "Blob is okay — a little on the soft side. Watch the dairy and processed food.",
      "Slightly mushy today. Your gut might appreciate some fibre.",
      "Blob territory. You're fine but something might not be sitting right.",
      "A Blob day. Nothing alarming but keep an eye on your food today.",
      "Soft Blob — your gut is a little unsettled but managing okay."
    ],
    2: [
      "Rock solid — and not in a good way. Time to hydrate properly.",
      "A Rock. Your gut is clearly asking for more water and fibre today.",
      "Ouch, Rock. That's your gut crying out for hydration. Drink up.",
      "Rock stool means your gut is working too hard. More water, more movement.",
      "That sounds uncomfortable. Water, fruit, a walk — your gut needs all three.",
      "Rock today. Classic sign of dehydration. Drink a full glass right now.",
      "Your gut is rock-hard and not happy about it. Water and fibre, please.",
      "A Rock means things are moving too slowly. Help it along — water and movement."
    ],
    1: [
      "Pellets. Your gut is really struggling — drink water, eat fruit, move around.",
      "Full Pellet situation. That's your gut begging for hydration.",
      "Ouch. Pellets mean severe constipation. Lots of water and fibre today.",
      "Pellets aren't fun. Your gut needs water, fibre, and movement urgently.",
      "That one probably wasn't easy. Drink water and take a walk — your gut needs it.",
      "Pellets are your gut's SOS signal. Water, fibre, movement — all of them, today.",
      "Full Pellet day. Your body is extremely dehydrated right now. Please drink water.",
      "Pellets mean your gut is really struggling. Be kind to it today — hydrate and rest."
    ],
    6: [
      "Mush today — something you ate might not have agreed with you.",
      "Going Mushy. Watch what you had in the last 12 hours.",
      "Mushy one. Your gut is moving a bit fast — could be stress or diet.",
      "Mush is a sign your gut is a bit unsettled. Take it easy today.",
      "Soft and mushy — your gut might appreciate some bland food today.",
      "Mush today. Avoid spicy or heavy food for the rest of the day.",
      "Your gut is acting up a little. Mush usually means something irritated it.",
      "Mushy day. Bland food, light portions, and plenty of water will help."
    ],
    7: [
      "Full Liquid. Rest, hydrate with electrolytes, and take it easy.",
      "Liquid situation — sounds rough. Your body needs rest and water today.",
      "That's a rough one. Electrolytes, rest, and plain food for now.",
      "Liquid means your gut is in full emergency mode. Listen to it and rest.",
      "Hope you're okay. Liquid stools mean hydration is critical right now — drink up.",
      "Full Liquid day. Your gut needs gentle, plain food and lots of fluids.",
      "Liquid — your gut is telling you it needs a break. Rest, water, electrolytes.",
      "That sounds really uncomfortable. Take it easy today, eat bland, and drink constantly.",
      "Liquid situation. Your gut is not well right now — rest is the priority."
    ]
  };
  const pool = pools[t];
  return pool ? pick(pool) : null;
}


// ── TIME OPENER ──
function getTimeOpener(hour) {
  if (hour >= 5 && hour < 11) return pick([
    "Morning drop ☀️",
    "Starting the day right",
    "Good morning to your gut",
    "Early morning drop",
    "First thing in the morning",
    "Rise and log ☀️",
    "Morning gut check done"
  ]);
  if (hour >= 11 && hour < 16) return pick([
    "Midday visit",
    "Post-lunch gut check",
    "Afternoon movement",
    "Lunchtime drop",
    "Midday gut moment",
    "Afternoon check-in",
    "Post-meal drop"
  ]);
  if (hour >= 16 && hour < 21) return pick([
    "Evening drop 🌆",
    "End of day release",
    "Wrapping up the day properly",
    "Late afternoon drop",
    "Evening gut check",
    "Post-dinner drop 🌆",
    "Day-end gut moment"
  ]);
  return pick([
    "Late night movement 🌙",
    "Night owl gut check",
    "Your gut doesn't care about bedtime 🌙",
    "Middle of the night drop — respect",
    "Midnight gut visit 🌙",
    "Late night drop — your gut has no curfew",
    "Up at this hour? Your gut says yes 🌙"
  ]);
}


// ── GET LOCAL HOUR ──
function getLocalHour(now, tz) {
  const timeStr = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const hour = parseInt(timeStr.split(":")[0]);
  return isNaN(hour) ? 12 : hour;
}


// ── STREAK CALCULATOR ──
async function getStreak(userId, tz) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(60)
      .get();

    const logDays = new Set(snap.docs.map(d => {
      const ts = d.data().timestamp?.toDate();
      return ts ? ts.toLocaleDateString("en-CA", { timeZone: tz }) : null;
    }).filter(Boolean));

    let streak = 0;
    const check = new Date();
    while (true) {
      const key = check.toLocaleDateString("en-CA", { timeZone: tz });
      if (!logDays.has(key)) break;
      streak++;
      check.setDate(check.getDate() - 1);
    }
    return streak;
  } catch (err) {
    console.error("getStreak error:", err);
    return 0;
  }
}


// ── DAYS SINCE LAST LOG ──
async function getDaysSinceLastLog(userId, tz) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(2)
      .get();

    if (snap.size < 2) return 0;

    const dates = snap.docs.map(d =>
      d.data().timestamp?.toDate()?.toLocaleDateString("en-CA", { timeZone: tz })
    ).filter(Boolean);

    if (dates.length < 2) return 0;

    const today    = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    const prevDate = dates[1];

    if (prevDate === today) return 0; // same day

    const diff = (new Date(today) - new Date(prevDate)) / (1000 * 60 * 60 * 24);
    return Math.round(diff);
  } catch (err) {
    console.error("getDaysSinceLastLog error:", err);
    return 0;
  }
}


// ── HAS PARTNER LOGGED TODAY ──
async function hasLoggedTodayKey(userId, tz) {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    const snap  = await db.collection("logs")
      .where("user", "==", userId)
      .limit(20)
      .get();

    return snap.docs.some(d => {
      const ts = d.data().timestamp?.toDate();
      return ts && ts.toLocaleDateString("en-CA", { timeZone: tz }) === today;
    });
  } catch (err) {
    return false;
  }
}


// ── RANDOM PICK ──
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}


// ── CROSS NOTIFICATION ──
async function notifyPartner(loggedBy, bristolType, volume, symptoms, localHour) {
  try {
    const partnerKey  = loggedBy === "mike" ? "jenna" : "mike";
    const loggerName  = loggedBy === "mike" ? "Mike" : "Jenna";
    const b           = BRISTOL[parseInt(bristolType)] || BRISTOL[4];
    const vol         = formatVolume(volume);
    const t           = parseInt(bristolType);
    const hasSymp     = symptoms && !symptoms.includes("none") && symptoms.length > 0;
    const sympList    = hasSymp ? symptoms.map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(" + ") : "";
    const hasBlood    = symptoms?.includes("blood");
    const hasCramps   = symptoms?.includes("cramps");
    const hasBloating = symptoms?.includes("bloating");
    const hasUrgency  = symptoms?.includes("urgency");
    const isHard      = t <= 2;
    const isSoft      = t === 4;
    const isCrackle   = t === 3;
    const isBlob      = t === 5;
    const isLoose     = t >= 6;
    const hour        = localHour || 12;

    // ── TIME-AWARE OPENER ──
    let timeOpener;
    if (hour >= 5 && hour < 11) {
      timeOpener = pick([
        `${loggerName} kicked off the day with a ${b.label} ☀️`,
        `Morning gut report from ${loggerName}:`,
        `${loggerName}'s first drop of the day:`,
        `Early bird update from ${loggerName}:`,
        `${loggerName} started the morning right — ${b.label} logged ☀️`,
        `Rise and shine update: ${loggerName} just logged`,
        `${loggerName}'s morning gut check is in:`
      ]);
    } else if (hour >= 11 && hour < 16) {
      timeOpener = pick([
        `Midday update from ${loggerName} —`,
        `${loggerName} just made an afternoon visit`,
        `Post-lunch gut check from ${loggerName}:`,
        `${loggerName} checked in midday:`,
        `${loggerName}'s afternoon gut report:`,
        `Lunchtime drop from ${loggerName} —`,
        `${loggerName} just logged their midday check-in:`
      ]);
    } else if (hour >= 16 && hour < 21) {
      timeOpener = pick([
        `${loggerName} just wrapped up the day with a ${b.label} 🌆`,
        `Evening gut report from ${loggerName}:`,
        `End of day drop from ${loggerName} —`,
        `${loggerName}'s evening check-in:`,
        `${loggerName} logged their evening report 🌆`,
        `Day-end gut update from ${loggerName}:`,
        `${loggerName} signing off the day with a ${b.label} 🌆`
      ]);
    } else {
      timeOpener = pick([
        `Late night movement from ${loggerName} 🌙`,
        `${loggerName} had a midnight gut moment —`,
        `Your ${loggerName} is up logging at this hour 🌙`,
        `Night owl update from ${loggerName}:`,
        `${loggerName} is up late — and logging 🌙`,
        `Middle of the night report from ${loggerName}:`,
        `${loggerName}'s gut doesn't care about bedtime 🌙`
      ]);
    }

    // ── CONTEXT BODY ──
    let body;

    if (hasBlood) {
      body = pick([
        `They logged blood today 🩸 Make sure they know to take it seriously if it keeps happening.`,
        `Blood was flagged in their log. Worth checking in on them 🩸`,
        `${loggerName} flagged blood. Please check on them — don't let them ignore this.`,
        `🩸 Blood in ${loggerName}'s log today. Might be nothing but worth keeping an eye on.`
      ]);
    } else if (isHard && hasCramps) {
      body = pick([
        `${b.label} with cramps 😣 Sounds rough — remind them to drink more water and take it easy.`,
        `Hard stool with cramps. They're having a tough one. Maybe send some sympathy their way.`,
        `Ouch — ${b.label} + cramps. Check on them? That combo is no fun.`,
        `${b.label} and cramps today. Your gut partner is struggling — they could use some support.`,
        `${b.label} with cramps. That's uncomfortable. A warm message might go a long way right now.`,
        `Rough combo — ${b.label} + cramps. Tell them to drink water and maybe use a hot water bottle.`
      ]);
    } else if (isHard && hasBloating) {
      body = pick([
        `${b.label} with bloating — double trouble. Remind them to hydrate and skip the dairy today.`,
        `Hard and bloated. Their gut needs more water and fibre today.`,
        `${b.label} + bloating. Not a fun combination — remind them to drink up.`
      ]);
    } else if (isHard) {
      body = pick([
        `${b.label} today — things seem a bit backed up 🪨 Nudge them to drink more water.`,
        `Hard stool situation over there. Remind them: water, fibre, movement.`,
        `${b.label} logged. Their gut is clearly asking for more hydration.`,
        `A ${b.label} — that's their gut crying out for water. Maybe mention it gently.`,
        `Backed up today. They need water and a walk — pass it on if you can.`,
        `${b.label} situation. Classic dehydration sign — remind them to drink up.`,
        `${loggerName}'s gut is a bit stuck. ${b.label} means more water and fibre needed ASAP.`,
        `Their gut is working overtime today — ${b.label}. Encourage them to stay hydrated.`
      ]);
    } else if (isLoose && hasBlood) {
      body = pick([
        `Liquid + blood. Please make sure they take this seriously 🩸`,
        `${b.label} with blood flagged — check on them, this one's worth attention.`
      ]);
    } else if (isLoose && hasCramps) {
      body = pick([
        `${b.label} with cramps 😰 Rough gut day over there. Check in on them.`,
        `Loose and crampy — that's a rough combination. Hope they're okay.`,
        `${b.label} + cramps today. Their gut is not happy. Send good vibes.`,
        `Ouch — ${b.label} with cramps. They could use some support right now.`,
        `${b.label} and cramps is a tough day. Ask how they're doing.`
      ]);
    } else if (isLoose) {
      body = pick([
        `${b.label} today 💧 Hope they're staying hydrated.`,
        `Running a bit loose over there. Make sure they're drinking enough.`,
        `${b.label} logged. Electrolytes and rest are their best friends right now.`,
        `Watery situation. Their gut is moving fast today — check in if you can.`,
        `${b.label} day for ${loggerName}. Remind them to sip water slowly and rest.`,
        `Things are running loose over there. Bland food and lots of fluids will help.`,
        `Their gut is not having a great time — ${b.label}. Hope they're resting up.`
      ]);
    } else if (isSoft && !hasSymp) {
      body = pick([
        `Perfect ${b.label} drop. ${vol}, smooth, no symptoms. Absolutely thriving 🌟`,
        `Textbook healthy log. ${b.label}, ${vol}, clean. Gut goals.`,
        `${b.label} and clean — that's the gold standard. Everything's great over there 💚`,
        `Peak gut performance. ${b.label}, ${vol}, no complaints whatsoever.`,
        `${loggerName} ate their fibre and it shows. ${b.label}, ${vol}. Proud of them 🥦`,
        `Nothing to report except a perfect log. ${b.label}, ${vol}. Living well.`,
        `Their gut is just vibing today. ${b.label}, smooth, no drama 💚`,
        `${b.label} logged — that's the dream. ${loggerName}'s gut is in great shape today.`,
        `Flawless log from ${loggerName}. ${b.label}, ${vol}. Nothing to worry about here.`,
        `${loggerName}'s gut is happy today. ${b.label}, ${vol}, squeaky clean.`,
        `Healthy gut alert 🌟 ${b.label}, ${vol}, no issues. ${loggerName} is winning at gut health.`
      ]);
    } else if (isSoft && hasCramps) {
      body = pick([
        `Good consistency (${b.label}) but cramps tagged along. Worth asking how they're feeling.`,
        `${b.label} is great but they had cramps. Soft stool + cramps could be stress — check in.`,
        `Soft drop but flagged cramps. Maybe see how their day's going.`,
        `${b.label} with cramps — the consistency is good but something's still bothering their gut.`
      ]);
    } else if (isSoft && hasBloating) {
      body = pick([
        `${b.label} consistency which is great, but bloating showed up too 🫧 Check in on them.`,
        `Good drop but a bit bloated. Might be something they ate — worth a check-in.`,
        `${b.label} which is perfect, but they're feeling bloated. Ask how they're doing.`
      ]);
    } else if (isSoft && hasSymp) {
      body = pick([
        `${b.label} which is great, but ${sympList} flagged. Keep an eye on how they're doing.`,
        `Solid drop but ${sympList} came along for the ride. Ask how they're feeling.`,
        `${b.label} consistency — awesome. But ${sympList} tagged along. Worth checking in.`
      ]);
    } else if (isCrackle && !hasSymp) {
      body = pick([
        `${b.label} today — a little firm but solid result overall. Nothing to worry about.`,
        `Crackle logged. Slightly firm but totally fine. Tell them to drink a bit more water.`,
        `${b.label} — close to perfect. One more glass of water a day and they'd be golden.`
      ]);
    } else if (isBlob && !hasSymp) {
      body = pick([
        `${b.label} today — a little on the soft side but in the safe zone.`,
        `Soft Blob logged. Nothing alarming, just a slightly mushy day.`,
        `${b.label} — slightly soft but nothing serious. All good over there.`
      ]);
    } else if (hasBloating) {
      body = pick([
        `${b.label} with bloating 🫧 Might want to avoid dairy today.`,
        `Bloated gut today. Ginger tea and lighter meals might help.`,
        `${b.label} + bloating. Their gut is a bit gassy — check in?`
      ]);
    } else if (hasUrgency) {
      body = pick([
        `${b.label} with urgency — their gut had its own schedule today 😅`,
        `Urgency flagged. When the gut says NOW it means NOW. Hope they made it in time.`,
        `${loggerName}'s gut was in charge today — urgency + ${b.label}. Hope they're okay 😅`
      ]);
    } else if (hasSymp) {
      body = pick([
        `${b.label} with ${sympList}. Not their best gut day — check in if you can 🤍`,
        `${b.label} logged, ${sympList} flagged. Hope they feel better soon.`,
        `${sympList} came up in their log today. Worth a check-in.`,
        `${loggerName} logged ${b.label} with ${sympList}. Their gut is a little off today.`
      ]);
    } else {
      body = pick([
        `${b.label}, ${vol}. All good over there 📊`,
        `${b.label} logged, ${vol}. Nothing notable — all clear.`,
        `Just checking in: ${b.label}, ${vol}, no complaints. Routine stuff.`,
        `${b.label} and ${vol}. Their gut has nothing dramatic to report today.`,
        `Quick update: ${b.label}, ${vol}. Everything's fine over there.`,
        `${b.label}, ${vol}. Gut is doing its thing. Nothing to report.`,
        `Routine log from ${loggerName} — ${b.label}, ${vol}. Normal day for their gut.`
      ]);
    }

    // ── VOLUME EXTRAS ──
    let volumeExtra = "";
    if (volume === "gigantic") {
      volumeExtra = pick([
        ` Also — gigantic volume apparently 😅 Respect.`,
        ` That was a gigantic one, by the way. Their gut had a lot to say.`,
        ` Gigantic volume noted. That's... a lot.`
      ]);
    } else if (volume === "child_size") {
      volumeExtra = pick([
        ` Small one today — but they still logged it.`,
        ` Tiny drop but it counts.`,
        ` Small volume, but effort is effort.`
      ]);
    }

    const msg = `${timeOpener}

${body}${volumeExtra}`;

    const partnerSnap = await db.collection("users").doc(partnerKey).get();
    if (!partnerSnap.exists) return;
    const partnerChatId = partnerSnap.data()?.chatId;
    if (!partnerChatId) return;
    await sendMsg(partnerChatId, msg);
  } catch (err) {
    console.error("Cross notification failed:", err);
  }
}

function formatVolume(v) {
  const map = {
    child_size: "Child Size",
    small:      "Small",
    normal:     "Normal",
    huge:       "Huge",
    gigantic:   "Gigantic"
  };
  return map[v] || "Normal";
}



// ── HANDLE CONVERSATION (text replies during session) ──
async function handleConversation(chatId, user, text, session) {
  // Time entry for backdated log
  if (session.step === "time") {
    const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(text.trim())) {
      await sendMsg(chatId, "Please use HH:MM format (e.g. 08:30 or 21:00)");
      return;
    }
    await handleLogCallback(chatId, null, user, "time", text.trim());
    return;
  }

  if (session.step === "notes") {
    session.data.notes = text;
    await saveLog(chatId, session.data, null);
    return;
  }
}


// ── /history ──
async function handleHistory(chatId, user) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", user.id)
      .limit(20)
      .get();

    if (snap.empty) {
      await sendMsg(chatId, "No logs yet. Use /quick or /log to get started!");
      return;
    }

    // Sort by timestamp desc in JS — avoids composite index requirement
    const docs = snap.docs
      .map(d => ({ ...d.data() }))
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0))
      .slice(0, 5);

    const lines = docs.map(l => {
      const b    = BRISTOL[parseInt(l.bristolType)] || BRISTOL[4];
      const date = l.timestamp.toDate().toLocaleString("en-AU", { timeZone: "Asia/Makassar", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      const syms = l.symptoms?.includes("none") ? "" : ` · ${l.symptoms.join(", ")}`;
      const vol  = formatVolume(l.volume);
      return `*${b.label}* · ${vol} · ${l.color?.replace(/_/g," ") || "brown"}${syms} — _${date}_`;
    });

    await sendMsg(chatId, `*Last 5 logs:*\n\n${lines.join("\n")}`, null, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("History error:", err);
    await sendMsg(chatId, "Failed to load history. Try again.");
  }
}


// ── /preset ──
async function handlePreset(chatId, user) {
  const preset = await getUserPreset(user.id);
  await sendMsg(chatId,
    `⚙️ *Your Quick Log Preset*\n\nType ${preset.bristolType} · ${preset.color} · ${preset.symptoms.includes("none") ? "No symptoms" : preset.symptoms.join(", ")}\n\nWhat would you like to change?`, {
    inline_keyboard: [[
      { text: "Bristol type", callback_data: "preset:step:bristol" },
      { text: "Color",        callback_data: "preset:step:color"   }
    ]]
  }, { parse_mode: "Markdown" });
}


// ── PRESET CALLBACK ──
async function handlePresetCallback(chatId, msgId, user, field, value) {
  if (field === "step" && value === "bristol") {
    await editMsg(chatId, msgId, "Choose your default Bristol type:", {
      inline_keyboard: [
        [
          { text: "1 🪨", callback_data: "preset:bristol:1" },
          { text: "2 🌰", callback_data: "preset:bristol:2" },
          { text: "3 🌭", callback_data: "preset:bristol:3" },
          { text: "4 💩", callback_data: "preset:bristol:4" }
        ],
        [
          { text: "5 ☁️", callback_data: "preset:bristol:5" },
          { text: "6 🌊", callback_data: "preset:bristol:6" },
          { text: "7 💧", callback_data: "preset:bristol:7" }
        ]
      ]
    });
    return;
  }

  if (field === "bristol") {
    await savePreset(user.id, { bristolType: parseInt(value) });
    await editMsg(chatId, msgId, `Default type set to T${value} ✅`);
    return;
  }

  if (field === "step" && value === "color") {
    await editMsg(chatId, msgId, "Choose your default color:", {
      inline_keyboard: [
        [
          { text: "Brown",      callback_data: "preset:color:brown"      },
          { text: "Dark brown", callback_data: "preset:color:dark_brown" }
        ],
        [
          { text: "Yellow", callback_data: "preset:color:yellow" },
          { text: "Green",  callback_data: "preset:color:green"  }
        ]
      ]
    });
    return;
  }

  if (field === "color") {
    await savePreset(user.id, { color: value });
    await editMsg(chatId, msgId, `Default color set to ${value} ✅`);
    return;
  }
}


// ── /check ──
async function handleCheck(chatId, user) {
  const tz       = user.id === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
  const now      = new Date();
  const startOfDay = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  startOfDay.setHours(0, 0, 0, 0);

  const snap = await db.collection("logs")
    .where("user", "==", user.id)
    .where("timestamp", ">=", Timestamp.fromDate(startOfDay))
    .get();

  const count = snap.size;

  if (count === 0) {
    await sendMsg(chatId,
      `No logs yet today, ${user.name}. Want to log now?`, {
      inline_keyboard: [[
        { text: "⚡ Quick Log", callback_data: "log:quick:quick" },
        { text: "📋 Full Log",  callback_data: "log:full:full"   }
      ]]
    });
  } else {
    const logs  = snap.docs.map(d => d.data());
    const types = logs.map(l => `T${l.bristolType}`).join(", ");
    await sendMsg(chatId,
      `You've logged *${count}x* today. Nice work! 💩\n\n_Types: ${types}_\n\nWant to add another?`, {
      inline_keyboard: [[
        { text: "⚡ Quick Log", callback_data: "log:quick:quick" },
        { text: "📋 Full Log",  callback_data: "log:full:full"   },
        { text: "Nope, I'm good", callback_data: "log:skip:skip" }
      ]]
    }, { parse_mode: "Markdown" });
  }
}


// ── /help ──
async function handleHelp(chatId, user) {
  const name = user?.name || "there";
  await sendMsg(chatId,
    `👋 Hey ${name}!\n\n` +
    `*Commands:*\n` +
    `/quick — instant log with your preset\n` +
    `/log — full guided log entry\n` +
    `/check — see today's logs + quick log offer\n` +
    `/history — see your last 5 logs\n` +
    `/preset — update your quick log defaults\n` +
    `/help — show this message\n\n` +
    `_Shortcuts: "q" for quick log, "c" for check_`,
    null, { parse_mode: "Markdown" }
  );
}


// ── USER HELPERS ──
async function getUserByChatId(chatId) {
  const snap = await db.collection("users")
    .where("chatId", "==", chatId)
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function registerUser(chatId, userId, from) {
  await db.collection("users").doc(userId).set({
    chatId,
    name:             userId === "mike" ? "Mike" : "Jenna",
    telegramUsername: from.username || null,
    registeredAt:     Timestamp.now()
  }, { merge: true });
}

async function getUserPreset(userId) {
  const snap = await db.collection("config").doc("settings").get();
  const data = snap.data();
  return data?.[userId]?.preset || { bristolType: 4, color: "brown", volume: "normal", symptoms: ["none"] };
}

async function savePreset(userId, updates) {
  const current = await getUserPreset(userId);
  const updated  = { ...current, ...updates };
  await db.collection("config").doc("settings").set(
    { [userId]: { preset: updated } },
    { merge: true }
  );
}


// ── TELEGRAM API HELPERS ──
async function sendMsg(chatId, text, inlineKeyboard = null, extra = {}) {
  const body = {
    chat_id: chatId,
    text,
    ...extra
  };

  if (inlineKeyboard) {
    // Accept both array format [[...]] and object format { inline_keyboard: [[...]] }
    const kb = Array.isArray(inlineKeyboard) ? inlineKeyboard : inlineKeyboard.inline_keyboard;
    body.reply_markup = { inline_keyboard: kb };
  }

  const res = await fetch(`${API}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });

  return res.json();
}


// ── REPLY HELPER — uses editMsg if msgId present, sendMsg otherwise ──
async function replyMsg(chatId, msgId, text, keyboard = null, extra = {}) {
  if (msgId) {
    return editMsg(chatId, msgId, text, keyboard, extra);
  } else {
    return sendMsg(chatId, text, keyboard, extra);
  }
}

async function editMsg(chatId, msgId, text, inlineKeyboard = null, extra = {}) {
  const body = {
    chat_id:    chatId,
    message_id: msgId,
    text,
    ...extra
  };

  if (inlineKeyboard) {
    // Accept both array format [[...]] and object format { inline_keyboard: [[...]] }
    const kb = Array.isArray(inlineKeyboard) ? inlineKeyboard : inlineKeyboard.inline_keyboard;
    body.reply_markup = { inline_keyboard: kb };
  }

  const res = await fetch(`${API}/editMessageText`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });

  return res.json();
}
