// ============================================================
// MJPT — Settings Page
// Reads and writes settings to Firestore.
// ============================================================

import { db } from "/public/js/firebase.js";
import {
  doc, getDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import { $, showToast, BRISTOL, STOOL_COLORS } from "/public/js/utils.js";


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
    const snap = await getDoc(doc(db, "config", "settings"));
    if (snap.exists()) {
      settings = { ...DEFAULTS, ...snap.data() };
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
  $("#mikeReminderDisplay").textContent  = `${settings.mike?.reminderTime  || "20:00"} · Melbourne (AEST)`;
  $("#jennaReminderDisplay").textContent = `${settings.jenna?.reminderTime || "20:00"} · WITA (UTC+8)`;

  // Presets
  const mp = settings.mike?.preset;
  const jp = settings.jenna?.preset;
  if (mp) $("#mikePresetDisplay").textContent  = formatPreset(mp);
  if (jp) $("#jennaPresetDisplay").textContent = formatPreset(jp);

  // Telegram status
  const mikeLinked  = settings.mike?.telegramId;
  const jennaLinked = settings.jenna?.telegramId;

  $("#mikeTelegramDisplay").textContent  = mikeLinked  ? `@${settings.mike.telegramUsername  || "linked"}` : "Not linked — use /start in bot";
  $("#jennaTelegramDisplay").textContent = jennaLinked ? `@${settings.jenna.telegramUsername || "linked"}` : "Not linked — use /start in bot";

  const mikeStatus  = $("#mikeTelegramStatus");
  const jennaStatus = $("#jennaTelegramStatus");
  mikeStatus.textContent  = mikeLinked  ? "Linked" : "—";
  jennaStatus.textContent = jennaLinked ? "Linked" : "—";
  mikeStatus.style.color  = mikeLinked  ? "var(--color-good)"     : "var(--color-ink-faint)";
  jennaStatus.style.color = jennaLinked ? "var(--color-good)"     : "var(--color-ink-faint)";
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
  const current = settings[user]?.reminderTime || "20:00";
  const time    = prompt(
    `Enter reminder time for ${settings[user]?.name || user} (HH:MM in their local time):`,
    current
  );
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    if (time) showToast("Invalid time format. Use HH:MM");
    return;
  }

  settings[user].reminderTime = time;
  await saveSettings();
  renderSettings();
  showToast("Reminder time updated");
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
