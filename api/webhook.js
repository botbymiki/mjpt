// ============================================================
// MJPT — Telegram Webhook
// Receives all messages from Telegram and processes them.
// Deployed as a Vercel serverless function.
// ============================================================

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp }       = require("firebase-admin/firestore");

// ── FIREBASE ADMIN INIT ──
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:    process.env.FIREBASE_PROJECT_ID,
      clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    })
  });
}

const db  = getFirestore();
const BOT = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT}`;

// ── BRISTOL INFO ──
const BRISTOL = {
  1: { emoji: "🪨", desc: "Separate hard lumps — severe constipation" },
  2: { emoji: "🌰", desc: "Lumpy sausage — mild constipation" },
  3: { emoji: "🌭", desc: "Sausage with cracks — normal" },
  4: { emoji: "💩", desc: "Smooth snake — ideal!" },
  5: { emoji: "☁️", desc: "Soft blobs — lacking fibre" },
  6: { emoji: "🌊", desc: "Fluffy pieces — mild diarrhea" },
  7: { emoji: "💧", desc: "Watery — severe diarrhea" }
};

const COLORS = ["brown", "dark_brown", "yellow", "green", "red", "black", "pale"];
const SYMPTOMS = ["none", "bloating", "urgency", "cramps", "blood"];

// ── CONVERSATION STATE (in-memory, resets on cold start) ──
// For production, store in Firestore if needed
const sessions = {};


// ── MAIN HANDLER ──
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

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
};


// ── MESSAGE HANDLER ──
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text   = (msg.text || "").trim();

  // Identify user
  const user = await getUserByChatId(chatId);

  if (text.startsWith("/start")) {
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

  // Handle conversation state
  const session = sessions[chatId];
  if (session) {
    await handleConversation(chatId, user, text, session);
    return;
  }

  await handleHelp(chatId, user);
}


// ── /start ──
async function handleStart(chatId, existingUser) {
  if (existingUser) {
    await sendMsg(chatId, `Welcome back, ${existingUser.name}! 👋\n\nUse /quick to log fast or /log for full entry.`);
    return;
  }

  await sendMsg(chatId, "Hey! Welcome to mjpt 💩\n\nWho are you?", {
    inline_keyboard: [[
      { text: "Mike",  callback_data: "register:mike"  },
      { text: "Jenna", callback_data: "register:jenna" }
    ]]
  });
}


// ── /quick ──
async function handleQuickLog(chatId, user) {
  const preset = await getUserPreset(user.id);

  const logEntry = {
    user:        user.id,
    bristolType: preset.bristolType,
    color:       preset.color,
    symptoms:    preset.symptoms,
    notes:       "",
    quick:       true,
    source:      "telegram",
    timestamp:   Timestamp.now()
  };

  await db.collection("logs").add(logEntry);

  const b = BRISTOL[preset.bristolType];
  await sendMsg(chatId,
    `${b.emoji} Logged! Quick log saved.\n\n` +
    `Type ${preset.bristolType} · ${preset.color} · No symptoms\n\n` +
    `_Use /log for a full entry_`,
    null, { parse_mode: "Markdown" }
  );
}


// ── /log — start guided flow ──
async function handleLogStart(chatId, user) {
  sessions[chatId] = { step: "bristol", data: { user: user.id, source: "telegram", quick: false } };

  await sendMsg(chatId, `📋 *Full Log Entry*\n\nWhat's the Bristol type?`, {
    inline_keyboard: [
      [
        { text: "1 🪨", callback_data: "log:bristol:1" },
        { text: "2 🌰", callback_data: "log:bristol:2" },
        { text: "3 🌭", callback_data: "log:bristol:3" },
        { text: "4 💩", callback_data: "log:bristol:4" }
      ],
      [
        { text: "5 ☁️", callback_data: "log:bristol:5" },
        { text: "6 🌊", callback_data: "log:bristol:6" },
        { text: "7 💧", callback_data: "log:bristol:7" }
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
  const session = sessions[chatId] || { step: field, data: { user: user?.id, source: "telegram", quick: false } };
  sessions[chatId] = session;

  if (field === "bristol") {
    session.data.bristolType = parseInt(value);
    session.step = "color";

    await editMsg(chatId, msgId, `Type ${value} selected.\n\nWhat color?`, {
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
    return;
  }

  if (field === "color") {
    session.data.color = value;
    session.step = "symptoms";

    await editMsg(chatId, msgId, `${value} noted.\n\nAny symptoms? (tap all that apply, then Done)`, {
      inline_keyboard: [
        [
          { text: "✅ None",     callback_data: "log:symptoms:none"     },
          { text: "🎈 Bloating", callback_data: "log:symptoms:bloating" }
        ],
        [
          { text: "⚡ Urgency", callback_data: "log:symptoms:urgency" },
          { text: "😣 Cramps",  callback_data: "log:symptoms:cramps"  }
        ],
        [
          { text: "🩸 Blood",    callback_data: "log:symptoms:blood" },
          { text: "Done ✓",      callback_data: "log:done:done"       }
        ]
      ]
    });

    session.data.symptoms = [];
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
    return;
  }

  if (field === "done") {
    if (!session.data.symptoms || session.data.symptoms.length === 0) {
      session.data.symptoms = ["none"];
    }
    session.step = "notes";

    await editMsg(chatId, msgId,
      `Almost done! Any notes? (Reply with text, or tap Skip)`, {
      inline_keyboard: [[
        { text: "Skip", callback_data: "log:notes:skip" }
      ]]
    });
    return;
  }

  if (field === "notes") {
    session.data.notes = value === "skip" ? "" : value;
    await saveLog(chatId, session.data, msgId);
    return;
  }
}


// ── SAVE LOG ──
async function saveLog(chatId, data, msgId) {
  data.timestamp = Timestamp.now();
  if (!data.notes) data.notes = "";

  try {
    await db.collection("logs").add(data);
    const b     = BRISTOL[data.bristolType];
    const syms  = data.symptoms.includes("none") ? "No symptoms" : data.symptoms.join(", ");

    await editMsg(chatId, msgId,
      `${b.emoji} *Logged!*\n\nType ${data.bristolType} · ${data.color} · ${syms}${data.notes ? `\n\n_"${data.notes}"_` : ""}`,
      null, { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error(err);
    await sendMsg(chatId, "Failed to save log. Try again.");
  }

  delete sessions[chatId];
}


// ── HANDLE CONVERSATION (text replies during session) ──
async function handleConversation(chatId, user, text, session) {
  if (session.step === "notes") {
    session.data.notes = text;
    await saveLog(chatId, session.data, null);
    await sendMsg(chatId, `Note added. Logged! ✅`);
    delete sessions[chatId];
    return;
  }
}


// ── /history ──
async function handleHistory(chatId, user) {
  try {
    const snap = await db.collection("logs")
      .where("user", "==", user.id)
      .orderBy("timestamp", "desc")
      .limit(5)
      .get();

    if (snap.empty) {
      await sendMsg(chatId, "No logs yet. Use /quick or /log to get started!");
      return;
    }

    const lines = snap.docs.map(d => {
      const l    = d.data();
      const b    = BRISTOL[l.bristolType];
      const date = l.timestamp.toDate().toLocaleString("en-AU", { timeZone: "Asia/Makassar", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      const syms = l.symptoms?.includes("none") ? "" : ` · ${l.symptoms.join(", ")}`;
      return `${b.emoji} *T${l.bristolType}* · ${l.color}${syms} — _${date}_`;
    });

    await sendMsg(chatId, `📋 *Last 5 logs:*\n\n${lines.join("\n")}`, null, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    await sendMsg(chatId, "Failed to load history.");
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


// ── /help ──
async function handleHelp(chatId, user) {
  const name = user?.name || "there";
  await sendMsg(chatId,
    `👋 Hey ${name}!\n\n` +
    `*Commands:*\n` +
    `/quick — instant log with your preset\n` +
    `/log — full guided log entry\n` +
    `/history — see your last 5 logs\n` +
    `/preset — update your quick log defaults\n` +
    `/help — show this message\n\n` +
    `_Shortcut: send "q" for quick log_`,
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
  return data?.[userId]?.preset || { bristolType: 4, color: "brown", symptoms: ["none"] };
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
    chat_id:    chatId,
    text,
    ...extra
  };

  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  const res = await fetch(`${API}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });

  return res.json();
}

async function editMsg(chatId, msgId, text, inlineKeyboard = null, extra = {}) {
  const body = {
    chat_id:    chatId,
    message_id: msgId,
    text,
    ...extra
  };

  if (inlineKeyboard) {
    body.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  const res = await fetch(`${API}/editMessageText`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body)
  });

  return res.json();
}
