// ============================================================
// MJPT — Admin Panel
// Gated by ?key=ADMIN_KEY env variable.
// Serves admin UI and handles admin actions.
// Access: /api/admin?key=your_admin_key
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


// ── HANDLER ──
module.exports = async (req, res) => {
  const key = req.query.key;

  // Gate
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(404).send("Not found");
  }

  const action = req.query.action;

  // POST actions
  if (req.method === "POST" && action) {
    return handleAction(req, res, action);
  }

  // GET — serve admin UI
  res.setHeader("Content-Type", "text/html");
  res.send(adminHTML(key));
};


// ── ACTIONS ──
async function handleAction(req, res, action) {
  try {
    switch (action) {

      case "trigger_reminder": {
        const { user, message } = req.body || {};
        const users   = user ? [user] : ["mike", "jenna"];
        const results = [];

        for (const u of users) {
          const snap   = await db.collection("users").doc(u).get();
          const chatId = snap.data()?.chatId;
          if (chatId) {
            // Use custom message or fallback to default
            const settingsSnap = await db.collection("config").doc("settings").get();
            const customMsgs   = settingsSnap.data()?.[u]?.manualReminderMessages;
            const defaultMsg   = `Hey! Manual reminder from admin. Don't forget to log today! /quick`;
            const msgs         = message ? [message] : (customMsgs?.length > 0 ? customMsgs : [defaultMsg]);
            const text         = msgs[Math.floor(Math.random() * msgs.length)];

            await fetch(`${API}/sendMessage`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({
                chat_id:      chatId,
                text,
                reply_markup: {
                  inline_keyboard: [[
                    { text: "Quick log", callback_data: "log:quick:quick" },
                    { text: "Full log",  callback_data: "log:full:full"   },
                    { text: "Skip",      callback_data: "log:skip:skip"   }
                  ]]
                }
              })
            });
            results.push({ user: u, sent: true, text });
          } else {
            results.push({ user: u, sent: false, reason: "No chat ID" });
          }
        }

        return res.json({ ok: true, results });
      }

      case "update_wording": {
        const { user, type, messages } = req.body || {};
        if (!user || !["mike", "jenna"].includes(user)) return res.status(400).json({ error: "Invalid user" });
        if (!type || !["auto", "manual"].includes(type))  return res.status(400).json({ error: "type must be auto or manual" });
        if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "messages must be non-empty array" });

        const field = type === "auto" ? "reminderMessages" : "manualReminderMessages";
        await db.collection("config").doc("settings").set(
          { [user]: { [field]: messages } },
          { merge: true }
        );
        return res.json({ ok: true, user, type, messages });
      }

      case "get_wording": {
        const snap = await db.collection("config").doc("settings").get();
        const data = snap.data() || {};
        return res.json({
          ok: true,
          mike:  { auto: data.mike?.reminderMessages || [], manual: data.mike?.manualReminderMessages || [] },
          jenna: { auto: data.jenna?.reminderMessages || [], manual: data.jenna?.manualReminderMessages || [] }
        });
      }

      case "raw_logs": {
        const limit = parseInt(req.query.limit) || 50;
        const snap  = await db.collection("logs")
          .orderBy("timestamp", "desc")
          .limit(limit)
          .get();
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate()?.toISOString() }));
        return res.json({ ok: true, count: logs.length, logs });
      }

      case "delete_entry": {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ error: "Missing id" });
        await db.collection("logs").doc(id).delete();
        return res.json({ ok: true, deleted: id });
      }

      case "reset_data": {
        const { confirm } = req.body || {};
        if (confirm !== "RESET_ALL_DATA") {
          return res.status(400).json({ error: "Must confirm with RESET_ALL_DATA" });
        }
        const snap  = await db.collection("logs").get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return res.json({ ok: true, deleted: snap.size });
      }

      case "stats": {
        const logsSnap  = await db.collection("logs").get();
        const usersSnap = await db.collection("users").get();
        const stats = {
          totalLogs:  logsSnap.size,
          totalUsers: usersSnap.size,
          users:      usersSnap.docs.map(d => ({ id: d.id, ...d.data(), chatId: d.data().chatId ? "✓ linked" : "✗ not linked" }))
        };
        return res.json({ ok: true, stats });
      }

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    console.error("Admin action failed:", err);
    return res.status(500).json({ error: err.message });
  }
}


// ── ADMIN HTML ──
function adminHTML(key) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mjpt admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: monospace; background: #1a1208; color: #e8d8c8; padding: 32px; min-height: 100vh; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .sub { color: #7a6a58; font-size: 12px; margin-bottom: 32px; }
    .section { margin-bottom: 28px; }
    .section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; color: #7a6a58; margin-bottom: 12px; }
    .btn { background: #c05a30; color: white; border: none; padding: 10px 18px; border-radius: 8px; font-family: monospace; font-size: 13px; cursor: pointer; margin-right: 8px; margin-bottom: 8px; }
    .btn:hover { opacity: 0.85; }
    .btn.danger { background: #8B2010; }
    .btn.ghost  { background: rgba(255,255,255,0.08); }
    #output { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 16px; font-size: 12px; line-height: 1.6; min-height: 80px; margin-top: 12px; white-space: pre-wrap; word-break: break-all; color: #b8a888; }
    input { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: white; padding: 8px 12px; font-family: monospace; font-size: 13px; width: 100%; margin-bottom: 8px; }
  </style>
</head>
<body>
  <h1>mjpt admin</h1>
  <div class="sub">Mike &amp; Jenna Poop Tracker — Admin Panel</div>

  <div class="section">
    <h2>Stats</h2>
    <button class="btn ghost" onclick="action('stats')">View stats</button>
  </div>

  <div class="section">
    <h2>Reminders — Manual Trigger</h2>
    <button class="btn" onclick="action('trigger_reminder', { user: 'mike' })">Remind Mike now</button>
    <button class="btn" onclick="action('trigger_reminder', { user: 'jenna' })">Remind Jenna now</button>
    <button class="btn" onclick="action('trigger_reminder', {})">Remind both now</button>
    <br><br>
    <input id="customMsg" placeholder="Custom one-off message (leave empty for random saved message)" />
    <button class="btn ghost" onclick="triggerWithMessage('mike')">Send custom → Mike</button>
    <button class="btn ghost" onclick="triggerWithMessage('jenna')">Send custom → Jenna</button>
  </div>

  <div class="section">
    <h2>Reminder Wording — Auto (scheduled)</h2>
    <button class="btn ghost" onclick="action('get_wording')">View current wording</button>
    <br><br>
    <p style="color:#7a6a58;font-size:11px;margin-bottom:8px">Enter messages one per line. Bot picks randomly each time.</p>
    <select id="wordingUser" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;padding:8px 12px;font-family:monospace;font-size:13px;width:100%;margin-bottom:8px">
      <option value="mike">Mike</option>
      <option value="jenna">Jenna</option>
    </select>
    <select id="wordingType" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;padding:8px 12px;font-family:monospace;font-size:13px;width:100%;margin-bottom:8px">
      <option value="auto">Auto (scheduled reminder)</option>
      <option value="manual">Manual (admin trigger)</option>
    </select>
    <textarea id="wordingMessages" rows="5" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;padding:12px;font-family:monospace;font-size:12px;width:100%;margin-bottom:8px;resize:vertical" placeholder="Enter one message per line..."></textarea>
    <button class="btn" onclick="saveWording()">Save wording</button>
  </div>

  <div class="section">
    <h2>Raw Logs</h2>
    <button class="btn ghost" onclick="action('raw_logs')">Last 50 logs</button>
  </div>

  <div class="section">
    <h2>Delete Entry</h2>
    <input id="deleteId" placeholder="Firestore document ID" />
    <button class="btn danger" onclick="deleteEntry()">Delete log</button>
  </div>

  <div class="section">
    <h2>Reset All Data</h2>
    <p style="color:#7a6a58;font-size:12px;margin-bottom:8px">⚠️ This permanently deletes all logs. Cannot be undone.</p>
    <button class="btn danger" onclick="resetData()">Reset all logs</button>
  </div>

  <div id="output">Output will appear here...</div>

  <script>
    const KEY = "${key}";

    async function action(act, body = {}) {
      const out = document.getElementById("output");
      out.textContent = "Loading...";
      try {
        const res  = await fetch("/api/admin?key=" + KEY + "&action=" + act, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body)
        });
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        out.textContent = "Error: " + err.message;
      }
    }

    async function deleteEntry() {
      const id = document.getElementById("deleteId").value.trim();
      if (!id) { alert("Enter a document ID"); return; }
      if (!confirm("Delete log " + id + "?")) return;
      await action("delete_entry", { id });
    }

    async function resetData() {
      const confirmed = prompt('Type RESET_ALL_DATA to confirm:');
      if (!confirmed) return;
      await action("reset_data", { confirm: confirmed });
    }

    async function triggerWithMessage(user) {
      const msg = document.getElementById("customMsg").value.trim();
      await action("trigger_reminder", { user, message: msg || undefined });
    }

    async function saveWording() {
      const user     = document.getElementById("wordingUser").value;
      const type     = document.getElementById("wordingType").value;
      const raw      = document.getElementById("wordingMessages").value;
      const messages = raw.split("\\n").map(m => m.trim()).filter(m => m.length > 0);
      if (messages.length === 0) { alert("Enter at least one message"); return; }
      await action("update_wording", { user, type, messages });
    }
  </script>
</body>
</html>`;
}
