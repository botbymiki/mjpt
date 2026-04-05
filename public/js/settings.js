// ============================================================
// MJPT — Settings Page
// Reads and writes settings to Firestore.
// ============================================================

import { db } from "/js/firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, getDocs, collection
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import { $, showToast, BRISTOL, STOOL_COLORS } from "/js/utils.js";


// ── DEFAULTS ──
const DEFAULTS = {
  mike: {
    name:          "Mike",
    reminderTime:  "20:00",
    reminderTz:    "Australia/Melbourne",
    preset: { bristolType: 4, color: "brown", symptoms: ["none"] }
  },
  jenna: {
    name:          "Jenna",
    reminderTime:  "20:00",
    reminderTz:    "Asia/Makassar",
    preset: { bristolType: 4, color: "brown", symptoms: ["none"] }
  }
};


// ── STATE ──
let settings = structuredClone(DEFAULTS);


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  renderSettings();
  bindActions();
});


// ── LOAD ──
async function loadSettings() {
  try {
    // Load config settings
    const snap = await getDoc(doc(db, "config", "settings"));
    if (snap.exists()) {
      settings = { ...DEFAULTS, ...snap.data() };
    }

    // Load Telegram link status from users collection
    const mikeSnap  = await getDoc(doc(db, "users", "mike"));
    const jennaSnap = await getDoc(doc(db, "users", "jenna"));

    if (mikeSnap.exists()) {
      settings.mike.telegramLinked   = true;
      settings.mike.telegramUsername = mikeSnap.data().telegramUsername || null;
    }
    if (jennaSnap.exists()) {
      settings.jenna.telegramLinked   = true;
      settings.jenna.telegramUsername = jennaSnap.data().telegramUsername || null;
    }

  } catch (err) {
    console.error("Failed to load settings:", err);
  }
}


// ── RENDER ──
function renderSettings() {
  // Names
  $("#mikeNameDisplay").textContent  = settings.mike?.name  || "Mike";
  $("#jennaNameDisplay").textContent = settings.jenna?.name || "Jenna";

  // Reminders
  const mikeR  = settings.mike?.reminder  || { time: "20:00", frequency: "daily" };
  const jennaR = settings.jenna?.reminder || { time: "20:00", frequency: "daily" };
  const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const formatReminder = (r, tz) => {
    if (r.frequency === "custom" && r.days?.length) {
      return `${r.days.map(d => dayNames[d]).join("/")} · ${r.time} · ${tz}`;
    }
    if (r.frequency === "weekly") return `Weekly · ${r.time} · ${tz}`;
    return `Daily · ${r.time} · ${tz}`;
  };

  const mikeReminderEl  = document.getElementById("mikeReminderDisplay");
  const jennaReminderEl = document.getElementById("jennaReminderDisplay");
  if (mikeReminderEl)  mikeReminderEl.textContent  = formatReminder(mikeR,  "Melbourne");
  if (jennaReminderEl) jennaReminderEl.textContent = formatReminder(jennaR, "WITA");

  // Presets
  const mp = settings.mike?.preset;
  const jp = settings.jenna?.preset;
  if (mp) $("#mikePresetDisplay").textContent  = formatPreset(mp);
  if (jp) $("#jennaPresetDisplay").textContent = formatPreset(jp);

  // Telegram status
  const mikeLinked  = settings.mike?.telegramLinked;
  const jennaLinked = settings.jenna?.telegramLinked;

  $("#mikeTelegramDisplay").textContent  = mikeLinked  ? `@${settings.mike.telegramUsername  || "linked"}` : "Not linked — use /start in bot";
  $("#jennaTelegramDisplay").textContent = jennaLinked ? `@${settings.jenna.telegramUsername || "linked"}` : "Not linked — use /start in bot";

  const mikeStatus  = $("#mikeTelegramStatus");
  const jennaStatus = $("#jennaTelegramStatus");
  mikeStatus.textContent  = mikeLinked  ? "Linked" : "—";
  jennaStatus.textContent = jennaLinked ? "Linked" : "—";
  mikeStatus.style.color  = mikeLinked  ? "var(--color-good)" : "var(--color-ink-faint)";
  jennaStatus.style.color = jennaLinked ? "var(--color-good)" : "var(--color-ink-faint)";
}

function formatPreset(preset) {
  const b        = BRISTOL[preset.bristolType];
  const bristol  = b?.label || `Type ${preset.bristolType}`;
  const color    = STOOL_COLORS[preset.color]?.label || "Brown";
  const symptoms = preset.symptoms?.includes("none") ? "No symptoms" : preset.symptoms?.join(", ") || "No symptoms";
  return `${bristol} · ${color} · ${symptoms}`;
}


// ── BIND ACTIONS ──
function bindActions() {
  const safe = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };

  safe("editMikeName",     () => editName("mike"));
  safe("editJennaName",    () => editName("jenna"));
  safe("editMikeReminder", () => editReminder("mike"));
  safe("editJennaReminder",() => editReminder("jenna"));
  safe("editMikePreset",   () => editPreset("mike"));
  safe("editJennaPreset",  () => editPreset("jenna"));
}


// ── EDIT NAME ──
async function editName(user) {
  const current = settings[user]?.name || (user === "mike" ? "Mike" : "Jenna");
  const name    = prompt(`Enter ${current}'s display name:`, current);
  if (!name || name.trim() === current) return;

  settings[user].name = name.trim();
  await saveSettings();
  renderSettings();
  showToast("Name updated");
}


// ── EDIT REMINDER ──
async function editReminder(user) {
  const name    = settings[user]?.name || user;
  const current = settings[user]?.reminder || { time: "20:00", frequency: "daily", days: [] };

  // Step 1 — frequency
  const freqInput = prompt(
    `${name}'s reminder frequency:\nType: daily, weekly, or custom`,
    current.frequency || "daily"
  );
  if (!freqInput) return;
  const frequency = freqInput.trim().toLowerCase();
  if (!["daily", "weekly", "custom"].includes(frequency)) {
    showToast("Invalid. Use: daily, weekly, or custom");
    return;
  }

  // Step 2 — custom days
  let days = current.days || [];
  if (frequency === "custom") {
    const daysInput = prompt(
      `Which days? Enter numbers separated by commas:\n1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat 7=Sun\nExample: 1,3,5 for Mon/Wed/Fri`,
      days.join(",") || "1,2,3,4,5"
    );
    if (!daysInput) return;
    days = daysInput.split(",").map(d => parseInt(d.trim())).filter(d => d >= 1 && d <= 7);
  } else if (frequency === "weekly") {
    days = [1]; // Monday by default for weekly
  }

  // Step 3 — time
  const timeInput = prompt(
    `${name}'s reminder time (HH:MM in their local time):`,
    current.time || "20:00"
  );
  if (!timeInput || !/^\d{2}:\d{2}$/.test(timeInput)) {
    if (timeInput) showToast("Invalid time. Use HH:MM format");
    return;
  }

  settings[user].reminder = { time: timeInput, frequency, days };
  await saveSettings();
  renderSettings();
  showToast(`${name}'s reminder updated`);
}


// ── EDIT PRESET ──
async function editPreset(user) {
  const name    = settings[user]?.name || user;
  const current = settings[user]?.preset || { bristolType: 4, color: "brown", symptoms: ["none"] };

  // Bristol type
  const typeInput = prompt(
    `${name}'s default Bristol type (1–7):`,
    current.bristolType
  );
  if (!typeInput) return;
  const bristolType = parseInt(typeInput);
  if (bristolType < 1 || bristolType > 7 || isNaN(bristolType)) {
    showToast("Invalid Bristol type. Enter 1–7.");
    return;
  }

  // Color
  const colorOptions = Object.keys(STOOL_COLORS).join(", ");
  const color        = prompt(
    `${name}'s default color (${colorOptions}):`,
    current.color
  );
  if (!color || !STOOL_COLORS[color]) {
    if (color) showToast("Invalid color");
    return;
  }

  settings[user].preset = { bristolType, color, symptoms: ["none"] };
  await saveSettings();
  renderSettings();
  showToast("Preset updated");
}


// ── SAVE ──
async function saveSettings() {
  try {
    await setDoc(doc(db, "config", "settings"), settings, { merge: true });
  } catch (err) {
    console.error("Failed to save settings:", err);
    showToast("Failed to save — check connection");
  }
}
