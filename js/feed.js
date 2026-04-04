// ============================================================
// MJPT — Feed Page
// Loads and renders chronological log history with filters.
// ============================================================

import { db } from "/js/firebase.js";
import {
  collection, query, orderBy, getDocs, deleteDoc, doc
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import {
  $, $$, showToast, relativeDate, formatTime,
  BRISTOL, STOOL_COLORS, formatSymptoms, USERS
} from "/js/utils.js";


// ── STATE ──
let allLogs     = [];
let activeFilter = "all";


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  initFilters();
  await loadLogs();
  renderFeed();
});


// ── FILTERS ──
function initFilters() {
  const row = document.querySelector(".filter-row");
  row.addEventListener("click", e => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    row.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    renderFeed();
  });
}


// ── LOAD ──
async function loadLogs() {
  try {
    const q    = query(collection(db, "logs"), orderBy("timestamp", "desc"));
    const snap = await getDocs(q);
    allLogs    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(err);
    showToast("Failed to load logs");
  }
}


// ── FILTER ──
function filterLogs() {
  switch (activeFilter) {
    case "mike":     return allLogs.filter(l => l.user === "mike");
    case "jenna":    return allLogs.filter(l => l.user === "jenna");
    case "symptoms": return allLogs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0);
    case "type4":    return allLogs.filter(l => l.bristolType === 4);
    default:         return allLogs;
  }
}


// ── RENDER ──
function renderFeed() {
  const container = $("#feedList");
  const logs      = filterLogs();

  $("#feedCount").textContent = `${logs.length} log${logs.length !== 1 ? "s" : ""}`;

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
        <p>No logs found. Start logging via the Telegram bot.</p>
      </div>`;
    return;
  }

  // Group by date
  const groups = {};
  logs.forEach(log => {
    const key = relativeDate(log.timestamp);
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  });

  container.innerHTML = "";

  Object.entries(groups).forEach(([date, dateLogs]) => {
    // Date divider
    const divider = document.createElement("div");
    divider.className = "date-divider";
    divider.textContent = date;
    container.appendChild(divider);

    // List
    const list = document.createElement("div");
    list.className = "history-list";

    dateLogs.forEach(log => {
      const item = buildLogItem(log);
      list.appendChild(item);
    });

    container.appendChild(list);
  });
}


// ── BUILD LOG ITEM ──
function buildLogItem(log) {
  const bristol = BRISTOL[log.bristolType] || BRISTOL[4];
  const color   = STOOL_COLORS[log.color]?.hex || "#8B4513";
  const time    = formatTime(log.timestamp);
  const user    = USERS[log.user] || USERS.mike;
  const symptoms = formatSymptoms(log.symptoms);

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <div class="hi-dot" style="background:${color}"></div>
    <div class="hi-body">
      <div class="hi-who ${log.user}">${user.name}</div>
      <div class="hi-desc">Type ${log.bristolType} · ${STOOL_COLORS[log.color]?.label || "Brown"} · ${symptoms}</div>
      <div class="hi-meta">${log.source === "telegram" ? "Via Telegram" : "Manual"} ${log.quick ? "· Quick log" : ""}</div>
    </div>
    <div class="hi-right">
      <div class="hi-time">${time}</div>
      <div class="hi-type">T${log.bristolType}</div>
    </div>
  `;

  // Long press to delete (own logs only — no auth, so allow delete of any)
  let pressTimer;
  item.addEventListener("pointerdown", () => {
    pressTimer = setTimeout(() => confirmDelete(log, item), 600);
  });
  item.addEventListener("pointerup",   () => clearTimeout(pressTimer));
  item.addEventListener("pointerleave",() => clearTimeout(pressTimer));

  return item;
}


// ── DELETE ──
async function confirmDelete(log, el) {
  const user = USERS[log.user]?.name || log.user;
  const confirmed = window.confirm(`Delete this log from ${user}?`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "logs", log.id));
    allLogs = allLogs.filter(l => l.id !== log.id);
    el.style.opacity = "0";
    el.style.transition = "opacity 0.2s";
    setTimeout(() => renderFeed(), 250);
    showToast("Log deleted");
  } catch (err) {
    console.error(err);
    showToast("Failed to delete");
  }
}
