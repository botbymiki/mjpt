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
  BRISTOL, STOOL_COLORS, formatSymptoms, formatVolume, USERS
} from "/js/utils.js";// ============================================================
// MJPT — Feed Page
// Loads and renders chronological log history with filters.
// ============================================================

import { db } from "/js/firebase.js";
import {
  collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import {
  $, showToast, relativeDate, formatTime,
  BRISTOL, STOOL_COLORS, formatSymptoms, formatVolume, USERS
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


// ── BUILD LOG ITEM — compact card ──
function buildLogItem(log) {
  const bristol = BRISTOL[log.bristolType] || BRISTOL[4];
  const colorHex = STOOL_COLORS[log.color]?.hex || "#8B4513";
  const time    = formatTime(log.timestamp);
  const user    = USERS[log.user] || USERS.mike;
  const vol     = formatVolume(log.volume);
  const hasSymp = log.symptoms && !log.symptoms.includes("none") && log.symptoms.length > 0;

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <div class="hi-dot" style="background:${colorHex}"></div>
    <div class="hi-body">
      <div class="hi-who ${log.user}">${user.name}</div>
      <div class="hi-desc">${bristol.label} · ${vol}${hasSymp ? " · " + log.symptoms.map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(", ") : ""}</div>
      ${log.notes ? `<div class="hi-meta" style="font-style:italic;color:var(--color-ink-soft)">"${log.notes}"</div>` : ""}
    </div>
    <div class="hi-right">
      <div class="hi-time">${time}</div>
      <div class="hi-type" style="color:${colorHex}">${STOOL_COLORS[log.color]?.label || "Brown"}</div>
    </div>
  `;

  item.addEventListener("click", () => showLogDetail(log));
  return item;
}


// ── LOG DETAIL MODAL ──
function showLogDetail(log) {
  const existing = document.getElementById("logDetailModal");
  if (existing) existing.remove();

  const bristol  = BRISTOL[log.bristolType] || BRISTOL[4];
  const colorObj = STOOL_COLORS[log.color]  || STOOL_COLORS.brown;
  const user     = USERS[log.user]          || USERS.mike;
  const symptoms = formatSymptoms(log.symptoms);
  const vol      = formatVolume(log.volume);
  const time     = formatTime(log.timestamp);
  const date     = relativeDate(log.timestamp);

  const overlay = document.createElement("div");
  overlay.id    = "logDetailModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:300;display:flex;align-items:flex-end;backdrop-filter:blur(4px)";

  overlay.innerHTML = `
    <div style="background:var(--color-bg);border-radius:24px 24px 0 0;width:100%;padding:16px 20px 48px;max-height:80vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--color-border);border-radius:2px;margin:0 auto 20px"></div>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div>
          <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:3px">${date} · ${time}</div>
          <div style="font-family:var(--font-display);font-size:24px;letter-spacing:-0.5px;color:var(--color-ink)">${user.name}'s log</div>
        </div>
        <div style="width:36px;height:36px;border-radius:50%;background:${colorObj.hex};flex-shrink:0;border:2px solid var(--color-border)"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Consistency</div>
          <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${bristol.label}</div>
          <div style="font-size:11px;color:var(--color-ink-soft);margin-top:2px;line-height:1.4">${bristol.desc}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Volume</div>
          <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${vol}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Color</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:10px;height:10px;border-radius:50%;background:${colorObj.hex};flex-shrink:0"></div>
            <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${colorObj.label}</div>
          </div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px">
          <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Symptoms</div>
          <div style="font-size:15px;font-weight:600;color:var(--color-ink)">${symptoms}</div>
        </div>
      </div>

      ${log.notes ? `<div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px;margin-bottom:10px">
        <div style="font-size:9px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">Notes</div>
        <div style="font-size:13px;color:var(--color-ink);font-style:italic;line-height:1.5">"${log.notes}"</div>
      </div>` : ""}

      <div style="background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:12px;padding:12px">
        <div style="font-size:11px;color:var(--color-ink-soft);line-height:1.5">
          <strong style="font-weight:600;color:var(--color-ink)">${bristol.label}</strong> — ${bristol.clinical}
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// Delete is admin-only. See /api/admin?key=YOUR_KEY

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
  const bristol  = BRISTOL[log.bristolType] || BRISTOL[4];
  const color    = STOOL_COLORS[log.color]?.hex || "#8B4513";
  const time     = formatTime(log.timestamp);
  const user     = USERS[log.user] || USERS.mike;
  const symptoms = formatSymptoms(log.symptoms);
  const vol      = formatVolume(log.volume);

  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <div class="hi-dot" style="background:${color}"></div>
    <div class="hi-body">
      <div class="hi-who ${log.user}">${user.name}</div>
      <div class="hi-desc">${bristol.label} · ${vol} · ${symptoms}</div>
      ${log.notes ? `<div class="hi-meta" style="color:var(--color-ink-soft);font-style:italic">"${log.notes}"</div>` : `<div class="hi-meta">${log.source === "import" ? "Imported" : "Via Telegram"} ${log.quick ? "· Quick log" : ""}</div>`}
    </div>
    <div class="hi-right">
      <div class="hi-time">${time}</div>
      <div class="hi-type">${bristol.label}</div>
    </div>
  `;

  item.addEventListener("click", () => showLogDetail(log));
  return item;
}


// ── LOG DETAIL MODAL ──
function showLogDetail(log) {
  const existing = document.getElementById("logDetailModal");
  if (existing) existing.remove();

  const bristol  = BRISTOL[log.bristolType] || BRISTOL[4];
  const color    = STOOL_COLORS[log.color]  || STOOL_COLORS.brown;
  const user     = USERS[log.user]          || USERS.mike;
  const symptoms = formatSymptoms(log.symptoms);
  const time     = formatTime(log.timestamp);
  const date     = relativeDate(log.timestamp);

  const overlay = document.createElement("div");
  overlay.id    = "logDetailModal";
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.5);
    z-index:300;display:flex;align-items:flex-end;
    backdrop-filter:blur(4px);
  `;

  overlay.innerHTML = `
    <div style="
      background:var(--color-bg);border-radius:24px 24px 0 0;
      width:100%;padding:16px 20px 40px;
      max-height:80vh;overflow-y:auto;
      animation:slideUp 0.25s ease;
    ">
      <div style="width:40px;height:4px;background:var(--color-border);border-radius:2px;margin:0 auto 20px"></div>
      <div style="font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:4px">${date} · ${time}</div>
      <div style="font-family:var(--font-display);font-size:22px;letter-spacing:-0.5px;margin-bottom:20px">${bristol.label}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:6px">Logged by</div>
          <div style="font-size:14px;font-weight:600;color:${user.color}">${user.name}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:6px">Volume</div>
          <div style="font-size:14px;font-weight:600">${formatVolume(log.volume)}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:6px">Color</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:12px;height:12px;border-radius:50%;background:${color.hex}"></div>
            <div style="font-size:14px;font-weight:600">${color.label}</div>
          </div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:6px">Consistency</div>
          <div style="font-size:14px;font-weight:600">${bristol.label}</div>
          <div style="font-size:11px;color:var(--color-ink-soft);margin-top:2px">${bristol.desc}</div>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:6px">Symptoms</div>
          <div style="font-size:14px;font-weight:600">${symptoms}</div>
        </div>
      </div>

      ${log.notes ? `
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:14px;margin-bottom:16px">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:var(--color-ink-faint);margin-bottom:6px">Notes</div>
          <div style="font-size:14px;color:var(--color-ink);font-style:italic">"${log.notes}"</div>
        </div>
      ` : ""}

      <div style="background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:12px;padding:12px 14px">
        <div style="font-size:11px;color:var(--color-ink-soft)">
          <strong>What does ${bristol.label} mean?</strong><br>
          ${bristol.clinical}
        </div>
      </div>
    </div>
  `;

  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

// Delete is admin-only. See /api/admin?key=YOUR_KEY
