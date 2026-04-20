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

// ── CONVERSATION STATE (in-memory, resets on cold start) ──
// For production, store in Firestore if needed
const sessions = {};


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
  const session = sessions[chatId];
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
  sessions[chatId] = { step: "bristol", data: { user: user.id, source: "telegram", quick: false } };

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
    session.step = "volume";

    await editMsg(chatId, msgId, `${value} noted.\n\nWhat's the volume?`, {
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
    return;
  }

  if (field === "volume") {
    session.data.volume = value;
    session.step = "symptoms";

    await editMsg(chatId, msgId, `Got it.\n\nAny symptoms? (tap all that apply, then Done)`, {
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
    session.step = "when";

    await editMsg(chatId, msgId,
      `Got it! When was this?`, {
      inline_keyboard: [[
        { text: "Right now",  callback_data: "log:when:now"       },
        { text: "Yesterday",  callback_data: "log:when:yesterday" }
      ]]
    });
    return;
  }

  if (field === "when") {
    if (value === "now") {
      session.data.backdated = false;
      session.step = "notes";
      await editMsg(chatId, msgId,
        `Any notes? (Reply with text, or tap Skip)`, {
        inline_keyboard: [[{ text: "Skip", callback_data: "log:notes:skip" }]]
      });
    } else {
      // Yesterday — ask for time
      session.data.backdated = true;
      session.step = "time";
      await editMsg(chatId, msgId,
        `What time yesterday? (HH:MM, 24hr — e.g. 08:30 or 21:00)`, {
        inline_keyboard: [[{ text: "Skip (use midnight)", callback_data: "log:time:00:00" }]]
      });
    }
    return;
  }

  if (field === "time") {
    // value is HH:MM or "00:00" from skip
    const timeParts = value.split(":");
    const hh = parseInt(timeParts[0]) || 0;
    const mm = parseInt(timeParts[1]) || 0;

    // Build yesterday's date in user's timezone
    const tz        = session.data.user === "mike" ? "Australia/Melbourne" : "Asia/Makassar";
    const nowLocal  = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const yesterday = new Date(nowLocal);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(hh, mm, 0, 0);

    // Convert back to UTC for Firestore
    const utcOffset  = new Date().getTime() - new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getTime();
    const utcDate    = new Date(yesterday.getTime() + utcOffset);
    session.data.backdatedTimestamp = utcDate;

    session.step = "notes";
    await editMsg(chatId, msgId,
      `Logging for yesterday at ${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}.\n\nAny notes? (Reply or tap Skip)`, {
      inline_keyboard: [[{ text: "Skip", callback_data: "log:notes:skip" }]]
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
  // Use backdated time if set, otherwise now
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

    const b     = BRISTOL[data.bristolType] || BRISTOL[4];
    const syms  = data.symptoms.includes("none") ? "No symptoms" : data.symptoms.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(", ");
    const vol   = formatVolume(data.volume);
    const color = data.color.replace(/_/g, " ");

    const msg = `*Logged!* ${b.label}\n\n${vol} · ${color} · ${syms}${data.notes ? `\n\n_"${data.notes}"_` : ""}`;

    if (msgId) {
      await editMsg(chatId, msgId, msg, null, { parse_mode: "Markdown" });
    } else {
      await sendMsg(chatId, msg, null, { parse_mode: "Markdown" });
    }

    // Cross notify partner
    await notifyPartner(data.user, data.bristolType, data.volume, data.symptoms);

  } catch (err) {
    console.error(err);
    await sendMsg(chatId, "Failed to save log. Try again.");
  }

  delete sessions[chatId];
}


// ── CROSS NOTIFICATION ──
async function notifyPartner(loggedBy, bristolType, volume, symptoms) {
  try {
    const partnerKey  = loggedBy === "mike" ? "jenna" : "mike";
    const loggerName  = loggedBy === "mike" ? "Mike" : "Jenna";
    const b           = BRISTOL[parseInt(bristolType)] || BRISTOL[4];
    const vol         = formatVolume(volume);
    const hasSymp     = symptoms && !symptoms.includes("none") && symptoms.length > 0;
    const sympList    = hasSymp ? symptoms.join(", ") : "";
    const hasBlood    = symptoms?.includes("blood");
    const hasCramps   = symptoms?.includes("cramps");
    const hasBloating = symptoms?.includes("bloating");
    const t           = parseInt(bristolType);
    const isHard      = t <= 2;
    const isSoft      = t === 4;
    const isLoose     = t >= 6;

    let pool;

    if (hasBlood) {
      pool = [
        `${loggerName} logged blood today 🩸 Please check in on them — worth paying attention to.`,
        `Heads up: ${loggerName} reported blood in their log. Make sure they're okay 🩸`
      ];
    } else if (isHard && hasCramps) {
      pool = [
        `${loggerName} is having a rough one — ${b.label} with cramps 😣 Maybe remind them to drink more water?`,
        `Ouch. ${loggerName} logged a ${b.label} with cramps. Suggest a warm drink ☕`,
        `${loggerName}'s gut is struggling. ${b.label} + cramps. They could use some support 💙`
      ];
    } else if (isHard) {
      pool = [
        `${loggerName} logged a ${b.label} — things seem backed up 🪨 Remind them to hydrate!`,
        `${b.label} alert from ${loggerName}. Tell them: more water, more fibre 💧`,
        `${loggerName}'s report: ${b.label}, ${vol}. Classic dehydration situation — nudge them!`
      ];
    } else if (isLoose && hasSymp) {
      pool = [
        `${loggerName} logged a ${b.label} with ${sympList} 😰 Not a great gut day for them`,
        `Gut SOS from ${loggerName} — ${b.label} + ${sympList}. Check in? 💙`,
        `${loggerName} is having a rough gut day. ${b.label}, ${sympList}. Hope they feel better 🌿`
      ];
    } else if (isLoose) {
      pool = [
        `${loggerName}'s gut is running loose — ${b.label} 💧 Hope they're staying hydrated`,
        `${loggerName} logged a ${b.label}. Make sure they're drinking enough 💧`,
        `Watery situation at ${loggerName}'s end. ${b.label}, ${vol}. Check in? 🌊`
      ];
    } else if (isSoft && !hasSymp) {
      pool = [
        `${loggerName} just dropped a perfect ${b.label} ✨ Gut goals honestly`,
        `Peak gut performance from ${loggerName} — ${b.label}, ${vol}. Absolutely thriving 🌟`,
        `${loggerName}'s gut is operating at full capacity. ${b.label} · ${vol} · No symptoms. Elite.`,
        `Perfect log from ${loggerName}! ${b.label}, smooth, no drama. Living well 💚`,
        `${loggerName} ate their fibre and it shows. ${b.label}, ${vol}. Proud of them 🥦`
      ];
    } else if (isSoft && hasSymp) {
      pool = [
        `${loggerName} had a ${b.label} today but with ${sympList}. Good consistency, watch those symptoms`,
        `Mixed report — ${b.label} which is great, but ${sympList} tagged along 🤔`,
        `${loggerName}'s consistency is on point (${b.label}) but ${sympList} showed up. Hope it passes!`
      ];
    } else if (hasBloating) {
      pool = [
        `${loggerName} logged with bloating 🫧 Might want to avoid dairy/gluten for a bit`,
        `${loggerName}'s gut is feeling gassy. ${b.label} + bloating. Check on them! 🫧`
      ];
    } else if (hasSymp) {
      pool = [
        `${loggerName} logged a ${b.label} with ${sympList}. Not their best gut day 🤍`,
        `Gut update: ${b.label}, ${vol}, with ${sympList}. Hope they feel better!`,
        `${loggerName}'s report: ${b.label} · ${vol} · ${sympList}. Keep an eye 👀`
      ];
    } else {
      pool = [
        `${loggerName} just logged — ${b.label}, ${vol}. All good 📊`,
        `${loggerName}'s gut has reported in. ${b.label} · ${vol} · No complaints`,
        `FYI: ${loggerName} just visited the throne. ${b.label}, ${vol}, nothing notable`,
        `Daily update: ${loggerName} logged a ${b.label}. The data doesn't lie 📈`,
        `${loggerName} is keeping up with the logs — ${b.label}, ${vol} today`
      ];
    }

    const msg = pool[Math.floor(Math.random() * pool.length)];
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
    // Re-use the callback handler logic
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
