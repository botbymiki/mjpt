// ============================================================
// MJPT — Insights Page
// Fetches logs from Firestore and renders all dashboard data.
// ============================================================

import { db } from "/js/firebase.js";
import {
  collection, query, where, orderBy, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import {
  $, $$, showToast, formatDate,
  getPeriodRange, calcGutScore, scoreLabel, scoreRingOffset,
  calcBristolDist, calcSymptomFreq, calcPeakTimes, calcDailyFreq,
  getFunTitle, bristolClass, bristolBadgeText, BRISTOL, USERS
} from "/js/utils.js";


// ── STATE ──
let currentUser   = "both";
let currentPeriod = "week";
let allLogs       = [];


// ── INIT ──
document.addEventListener("DOMContentLoaded", async () => {
  initDateLabel();
  initUserToggle();
  initPeriodPills();
  await loadLogs();
  render();
});


function initDateLabel() {
  $("#dateLabel").textContent = new Date().toLocaleDateString("en-AU", {
    timeZone: "Asia/Makassar",
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}


// ── USER TOGGLE ──
function initUserToggle() {
  const toggle = $("#userToggle");
  toggle.addEventListener("click", e => {
    const btn = e.target.closest(".user-toggle-btn");
    if (!btn) return;
    toggle.querySelectorAll(".user-toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentUser = btn.dataset.user;
    render();
  });
}


// ── PERIOD PILLS ──
function initPeriodPills() {
  const row = $("#periodPills");
  row.addEventListener("click", e => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    row.querySelectorAll(".pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPeriod = btn.dataset.period;
    render();
  });
}


// ── LOAD LOGS ──
async function loadLogs() {
  try {
    const q = query(
      collection(db, "logs"),
      orderBy("timestamp", "desc")
    );
    const snap = await getDocs(q);
    allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to load logs:", err);
    showToast("Failed to load data");
  }
}


// ── FILTER LOGS ──
function filterLogs() {
  const { start, end } = getPeriodRange(currentPeriod);
  const startTs = Timestamp.fromDate(start);
  const endTs   = Timestamp.fromDate(end);

  return allLogs.filter(l => {
    const ts = l.timestamp;
    const inPeriod = ts && ts.seconds >= startTs.seconds && ts.seconds <= endTs.seconds;
    const inUser   = currentUser === "both" || l.user === currentUser;
    return inPeriod && inUser;
  });
}


// ── RENDER ALL ──
function render() {
  const logs = filterLogs();
  renderScore(logs);
  renderStats(logs);
  renderBarChart();
  renderBristolDist(logs);
  renderPeakTimes(logs);
  renderSymptoms(logs);
  renderInsights(logs);
}


// ── SCORE ──
function renderScore(logs) {
  const score = calcGutScore(logs);
  const info  = scoreLabel(score);

  const ring    = $("#scoreRing");
  const numEl   = $("#scoreNum");
  const labelEl = $("#scoreLabel");
  const badgeEl = $("#scoreBadge");

  if (score === null) {
    numEl.textContent   = "—";
    labelEl.textContent = "No data yet";
    badgeEl.textContent = "Log via Telegram to see score";
    return;
  }

  numEl.textContent   = score;
  labelEl.textContent = info.label;

  // Ring color
  ring.classList.remove("good", "warn", "danger");
  ring.classList.add(info.class);

  // Animate ring
  setTimeout(() => {
    ring.style.strokeDashoffset = scoreRingOffset(score);
  }, 100);

  // Badge: compare to previous period
  badgeEl.textContent = "Based on this period's logs";
}


// ── STATS ──
function renderStats(logs) {
  const total   = logs.length;
  const { start, end } = getPeriodRange(currentPeriod);
  const days    = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  const avg     = total > 0 ? (total / days).toFixed(1) : "—";

  // Top Bristol
  const bristolCounts = {};
  logs.forEach(l => {
    bristolCounts[l.bristolType] = (bristolCounts[l.bristolType] || 0) + 1;
  });
  const topBristol = Object.entries(bristolCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Symptom rate
  const withSymptoms = logs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length;
  const symptomRate  = total > 0 ? Math.round((withSymptoms / total) * 100) : 0;

  // Render
  $("#statTotal").textContent = total || "0";
  $("#statAvg").textContent   = avg;

  if (topBristol) {
    $("#statBristol").textContent    = `T${topBristol}`;
    $("#statBristolSub").textContent = BRISTOL[topBristol]?.clinical || "most frequent";
    const cls = bristolClass(parseInt(topBristol));
    const badgeEl = $("#statBristolBadge");
    badgeEl.textContent = bristolBadgeText(parseInt(topBristol));
    badgeEl.className   = `badge badge-${cls === "good" ? "good" : cls === "bad" ? "danger" : "warn"}`;
  }

  $("#statSymptom").textContent = `${symptomRate}%`;
  const symBadge = $("#statSymptomBadge");
  if (symptomRate === 0) {
    symBadge.textContent = "None";
    symBadge.className   = "badge badge-good";
  } else if (symptomRate < 20) {
    symBadge.textContent = "Low";
    symBadge.className   = "badge badge-good";
  } else if (symptomRate < 50) {
    symBadge.textContent = "Moderate";
    symBadge.className   = "badge badge-warn";
  } else {
    symBadge.textContent = "High";
    symBadge.className   = "badge badge-danger";
  }
}


// ── BAR CHART ──
function renderBarChart() {
  const container = $("#barChart");
  container.innerHTML = "";

  const { start, end } = getPeriodRange("week"); // Always show 7 days
  const mikeLogs  = allLogs.filter(l => l.user === "mike");
  const jennaLogs = allLogs.filter(l => l.user === "jenna");

  const mikeFreq  = calcDailyFreq(mikeLogs);
  const jennaFreq = calcDailyFreq(jennaLogs);

  const maxVal = Math.max(
    ...mikeFreq.map(d => d.count),
    ...jennaFreq.map(d => d.count),
    1
  );

  const showBoth  = currentUser === "both";
  const showMike  = currentUser === "mike"  || showBoth;
  const showJenna = currentUser === "jenna" || showBoth;

  mikeFreq.forEach((day, i) => {
    const mikeH  = showMike  ? Math.round((mikeFreq[i].count  / maxVal) * 72) : 0;
    const jennaH = showJenna ? Math.round((jennaFreq[i].count / maxVal) * 72) : 0;

    const col = document.createElement("div");
    col.className = "bar-col";
    col.innerHTML = `
      <div class="bar-pair">
        ${showMike  ? `<div class="bar-seg mike  ${day.isToday ? "today" : ""}" style="height:${mikeH}px"></div>`  : ""}
        ${showJenna ? `<div class="bar-seg jenna ${day.isToday ? "today" : ""}" style="height:${jennaH}px"></div>` : ""}
      </div>
      <div class="bar-day ${day.isToday ? "today" : ""}">${day.label}</div>
    `;
    container.appendChild(col);
  });

  // Update legend
  const legend = $("#chartLegend");
  legend.style.display = showBoth ? "flex" : "none";

  // Update sub label
  const sub = $("#chartSubLabel");
  const user = currentUser === "both" ? "Combined" : currentUser === "mike" ? "Mike" : "Jenna";
  sub.textContent = `${user} — past 7 days`;
}


// ── BRISTOL DIST ──
function renderBristolDist(logs) {
  const container = $("#bristolDist");
  container.innerHTML = "";

  const dist = calcBristolDist(logs);

  const rows = [
    { key: "1-2", label: "T1–2", cls: "bad",  tag: "Hard",  tagCls: "badge-danger" },
    { key: "3",   label: "T3",   cls: "ok",   tag: "OK",    tagCls: "badge-warn"   },
    { key: "4",   label: "T4",   cls: "good", tag: "Ideal", tagCls: "badge-good"   },
    { key: "5",   label: "T5",   cls: "ok",   tag: "Soft",  tagCls: "badge-warn"   },
    { key: "6-7", label: "T6–7", cls: "bad",  tag: "Loose", tagCls: "badge-danger" }
  ];

  rows.forEach(row => {
    const pct = dist[row.key] || 0;
    const el  = document.createElement("div");
    el.className = "bd-row";
    el.innerHTML = `
      <div class="bd-label" style="color:var(--color-ink-soft)">${row.label}</div>
      <div class="bd-track">
        <div class="bd-fill ${row.cls}" style="width:${pct}%"></div>
      </div>
      <div class="bd-pct">${pct}%</div>
      <div class="bd-tag badge ${row.tagCls}">${row.tag}</div>
    `;
    container.appendChild(el);
  });
}


// ── PEAK TIMES ──
function renderPeakTimes(logs) {
  const container = $("#timeGrid");
  container.innerHTML = "";

  const times = calcPeakTimes(logs);
  const maxVal = Math.max(...Object.values(times), 1);

  const buckets = [
    { key: "6-8",   label: "6–8" },
    { key: "8-10",  label: "8–10" },
    { key: "10-12", label: "10–12" },
    { key: "12-15", label: "12–15" },
    { key: "15-18", label: "15–18" },
    { key: "18-22", label: "18–22" }
  ];

  const peak = Object.entries(times).sort((a, b) => b[1] - a[1])[0]?.[0];

  buckets.forEach(({ key, label }) => {
    const h   = Math.round((times[key] / maxVal) * 44);
    const isPeak = key === peak && times[key] > 0;
    const col = document.createElement("div");
    col.className = "time-col";
    col.innerHTML = `
      <div class="time-bar-wrap">
        <div class="time-bar-fill" style="height:${Math.max(h, 3)}px"></div>
      </div>
      ${isPeak ? `<div class="time-peak">Peak</div>` : `<div style="height:14px"></div>`}
      <div class="time-label">${label}</div>
    `;
    container.appendChild(col);
  });
}


// ── SYMPTOMS ──
function renderSymptoms(logs) {
  const container = $("#symptomChart");
  container.innerHTML = "";

  const freq = calcSymptomFreq(logs);

  const rows = [
    { key: "none",     label: "None",     primary: true },
    { key: "bloating", label: "Bloating", primary: false },
    { key: "urgency",  label: "Urgency",  primary: false },
    { key: "cramps",   label: "Cramps",   primary: false },
    { key: "blood",    label: "Blood",    primary: false }
  ];

  rows.forEach(row => {
    const pct = freq[row.key] || 0;
    const el  = document.createElement("div");
    el.className = "symptom-row";
    el.innerHTML = `
      <div class="sy-name">${row.label}</div>
      <div class="sy-track">
        <div class="sy-fill ${row.primary ? "primary" : pct > 0 ? "active" : ""}" style="width:${pct}%"></div>
      </div>
      <div class="sy-val" style="${row.primary ? "color:var(--color-good)" : ""}">${pct}%</div>
    `;
    container.appendChild(el);
  });
}


// ── INSIGHTS ──
function renderInsights(logs) {
  const container = $("#insightsList");
  container.innerHTML = "";

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="insight-item">
        <div class="insight-pill info">Info</div>
        <div class="insight-text">No logs found for this period. Start logging via Telegram to see insights here.</div>
      </div>`;
    return;
  }

  const dist        = calcBristolDist(logs);
  const freq        = calcSymptomFreq(logs);
  const times       = calcPeakTimes(logs);
  const score       = calcGutScore(logs);
  const idealPct    = (dist["3"] || 0) + (dist["4"] || 0);
  const peakBucket  = Object.entries(times).sort((a, b) => b[1] - a[1])[0]?.[0];
  const insights    = [];

  // Bristol insight
  if (idealPct >= 60) {
    insights.push({ type: "good", text: `<strong>${idealPct}% of logs were Type 3–4</strong> — clinically healthy consistency range. Your gut is performing well.` });
  } else if (idealPct >= 40) {
    insights.push({ type: "note", text: `<strong>${idealPct}% of logs were Type 3–4.</strong> There's room to improve consistency. Hydration and fibre often help.` });
  } else {
    insights.push({ type: "note", text: `<strong>Consistency needs attention.</strong> Most logs were outside the ideal Type 3–4 range. Consider tracking diet or speaking to a GP.` });
  }

  // Bloating insight
  if (freq.bloating > 0) {
    insights.push({ type: "note", text: `<strong>Bloating flagged in ${freq.bloating}% of logs.</strong> Consider tracking meals to identify potential dietary triggers.` });
  }

  // Blood — always flag if present
  if (freq.blood > 0) {
    insights.push({ type: "note", text: `<strong>Blood noted in ${freq.blood}% of logs.</strong> While often benign (e.g. haemorrhoids), persistent blood warrants a GP visit.` });
  }

  // Peak time insight
  if (peakBucket && times[peakBucket] > 0) {
    const timeLabel = peakBucket.replace("-", "–") + " AM";
    insights.push({ type: "info", text: `<strong>Peak activity: ${peakBucket} AM.</strong> Morning bowel movements post-breakfast are a normal gastrocolic reflex response.` });
  }

  // Score trend
  if (score !== null) {
    insights.push({ type: score >= 60 ? "good" : "note", text: `<strong>Gut score: ${score}/100.</strong> ${score >= 80 ? "Excellent gut health this period." : score >= 60 ? "Good gut health, with minor areas to watch." : "Several factors are pulling your score down — consistency and symptoms are key."}` });
  }

  insights.forEach(({ type, text }) => {
    const el = document.createElement("div");
    el.className = "insight-item fade-in";
    el.innerHTML = `
      <div class="insight-pill ${type}">${type === "good" ? "Good" : type === "note" ? "Note" : "Pattern"}</div>
      <div class="insight-text">${text}</div>
    `;
    container.appendChild(el);
  });
}
