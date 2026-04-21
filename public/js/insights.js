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
  initShareBtn();
  await loadLogs();
  render();
});


function initShareBtn() {
  const btn = $("#shareBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const { generateReport } = await import("/js/report.js");
    btn.innerHTML = "Generating...";
    btn.disabled  = true;
    const logs    = filterLogs();
    const ok      = await generateReport(currentUser, currentPeriod, allLogs);
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Share`;
    btn.disabled  = false;
    if (!ok) showToast("Failed to generate image");
  });
}


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

  // Reset ALL elements to avoid stale data from previous user/period
  $("#statTotal").textContent      = "—";
  $("#statAvg").textContent        = "—";
  $("#statBristol").textContent    = "—";
  $("#statBristolSub").textContent = "no logs yet";
  $("#statTopSymptom").textContent    = "—";
  $("#statTopSymptomSub").textContent = "this period";
  $("#scoreNum").textContent       = "—";
  $("#scoreLabel").textContent     = "—";
  $("#scoreBadge").textContent     = "";
  const ring = $("#scoreRing");
  if (ring) {
    ring.classList.remove("good", "warn", "danger");
    ring.style.strokeDashoffset = "251";
  }

  renderScore(logs);
  renderStats(logs);
  renderBarChart();
  renderBristolDist(logs);
  renderPeakTimes(logs);
  renderTopSymptoms(logs);
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
    // Reset ring to empty
    ring.classList.remove("good", "warn", "danger");
    ring.style.strokeDashoffset = "251"; // full circumference = empty ring
    return;
  }

  numEl.textContent   = score;
  labelEl.textContent = info.label;

  ring.classList.remove("good", "warn", "danger");
  ring.classList.add(info.class);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.strokeDashoffset = scoreRingOffset(score);
    });
  });

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
    if (!l.bristolType) return; // skip logs with no bristolType
    bristolCounts[l.bristolType] = (bristolCounts[l.bristolType] || 0) + 1;
  });
  const topBristolEntry = Object.entries(bristolCounts).sort((a, b) => b[1] - a[1])[0];
  const topBristol      = topBristolEntry ? parseInt(topBristolEntry[0]) : null;

  // Symptom rate
  const withSymptoms = logs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length;
  const symptomRate  = total > 0 ? Math.round((withSymptoms / total) * 100) : 0;

  // Render
  $("#statTotal").textContent = total || "0";
  $("#statAvg").textContent   = avg;

  if (topBristol) {
    const b    = BRISTOL[topBristol];
    $("#statBristol").textContent    = b?.label || `T${topBristol}`;
    $("#statBristolSub").textContent = b?.desc  || "most frequent";
    const cls     = bristolClass(topBristol);
    const badgeEl = $("#statBristolBadge");
    badgeEl.textContent = topBristol === 4 ? "The Dream" : b?.label || "—";
    badgeEl.className   = `badge badge-${cls}`;
  } else {
    // Clear — no data for this user/period
    $("#statBristol").textContent    = "—";
    $("#statBristolSub").textContent = "no logs yet";
    const badgeEl = $("#statBristolBadge");
    badgeEl.textContent = "—";
    badgeEl.className   = "badge badge-neutral";
  }

  // Top symptom stat tile
  const symptomFreq = {};
  logs.forEach(l => {
    if (!l.symptoms || l.symptoms.includes("none")) return;
    l.symptoms.forEach(s => { symptomFreq[s] = (symptomFreq[s] || 0) + 1; });
  });
  const topSymEntry = Object.entries(symptomFreq).sort((a, b) => b[1] - a[1])[0];

  const topSymEl    = $("#statTopSymptom");
  const topSymSub   = $("#statTopSymptomSub");
  const topSymBadge = $("#statTopSymptomBadge");

  if (topSymEntry) {
    const symName = topSymEntry[0].charAt(0).toUpperCase() + topSymEntry[0].slice(1);
    const symPct  = Math.round((topSymEntry[1] / total) * 100);
    topSymEl.textContent    = symName;
    topSymSub.textContent   = `${symPct}% of logs`;
    topSymBadge.textContent = topSymEntry[0] === "blood" ? "⚠ Blood" : symName;
    topSymBadge.className   = topSymEntry[0] === "blood" ? "badge badge-danger" : "badge badge-warn";
  } else {
    topSymEl.textContent    = "None";
    topSymSub.textContent   = "no symptoms logged";
    topSymBadge.textContent = "Clean";
    topSymBadge.className   = "badge badge-good";
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

  // Count each type individually
  const counts = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0 };
  logs.forEach(l => {
    const t = parseInt(l.bristolType);
    if (t >= 1 && t <= 7) counts[t]++;
  });
  const total = logs.length || 1;

  const rows = [
    { type: 1, cls: "bad",  tag: "Hard",    tagCls: "badge-danger" },
    { type: 2, cls: "bad",  tag: "Rock",     tagCls: "badge-danger" },
    { type: 3, cls: "ok",   tag: "OK",       tagCls: "badge-warn"   },
    { type: 4, cls: "good", tag: "Ideal",    tagCls: "badge-good"   },
    { type: 5, cls: "ok",   tag: "Soft",     tagCls: "badge-warn"   },
    { type: 6, cls: "bad",  tag: "Mushy",    tagCls: "badge-danger" },
    { type: 7, cls: "bad",  tag: "Liquid",   tagCls: "badge-danger" }
  ];

  rows.forEach(row => {
    const pct   = Math.round((counts[row.type] / total) * 100);
    const b     = BRISTOL[row.type];
    const el    = document.createElement("div");
    el.className = "bd-row";
    el.innerHTML = `
      <div class="bd-label" style="color:var(--color-ink-soft);width:56px">${b.label}</div>
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

  const times  = calcPeakTimes(logs);
  const maxVal = Math.max(...Object.values(times), 1);

  const buckets = [
    { key: "06:00–08:00", label: "06–08" },
    { key: "08:00–10:00", label: "08–10" },
    { key: "10:00–12:00", label: "10–12" },
    { key: "12:00–15:00", label: "12–15" },
    { key: "15:00–18:00", label: "15–18" },
    { key: "18:00–22:00", label: "18–22" }
  ];

  const peak = Object.entries(times).sort((a, b) => b[1] - a[1])[0]?.[0];

  buckets.forEach(({ key, label }) => {
    const h      = Math.round((times[key] / maxVal) * 44);
    const isPeak = key === peak && times[key] > 0;
    const col    = document.createElement("div");
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
function renderTopSymptoms(logs) {
  const container = $("#topSymptomsCard");
  if (!container) return;
  container.innerHTML = "";

  const total = logs.length;
  if (total === 0) {
    container.innerHTML = `<div style="font-size:var(--text-sm);color:var(--color-ink-soft)">No logs this period.</div>`;
    return;
  }

  // Count symptoms
  const freq = {};
  logs.forEach(l => {
    if (!l.symptoms || l.symptoms.includes("none")) return;
    l.symptoms.forEach(s => { freq[s] = (freq[s] || 0) + 1; });
  });

  const hasBlood = freq["blood"] > 0;
  const ranked   = Object.entries(freq)
    .filter(([k]) => k !== "blood")
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0 && !hasBlood) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
        <span class="badge badge-good" style="font-size:12px">✓ Clear</span>
        <span style="font-size:var(--text-sm);color:var(--color-ink-soft)">No symptoms logged this period</span>
      </div>`;
    return;
  }

  const maxCount = ranked[0]?.[1] || 1;

  ranked.slice(0, 5).forEach(([sym, count], i) => {
    const pct      = Math.round((count / total) * 100);
    const barWidth = Math.round((count / maxCount) * 100);
    const label    = sym.charAt(0).toUpperCase() + sym.slice(1);
    const el       = document.createElement("div");
    el.style.cssText = "display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--color-border)";
    el.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:var(--color-ink-faint);width:16px;text-align:center">${i+1}</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:var(--text-sm);font-weight:600;color:var(--color-ink)">${label}</span>
          <span style="font-size:var(--text-xs);color:var(--color-ink-soft)">${count}x · ${pct}%</span>
        </div>
        <div style="background:var(--color-border);border-radius:100px;height:4px;overflow:hidden">
          <div style="background:var(--color-accent);height:100%;width:${barWidth}%;border-radius:100px;transition:width 0.4s ease"></div>
        </div>
      </div>
    `;
    container.appendChild(el);
  });

  // Blood always shown separately at bottom if present
  if (hasBlood) {
    const bloodPct = Math.round((freq["blood"] / total) * 100);
    const el       = document.createElement("div");
    el.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 0;margin-top:4px";
    el.innerHTML = `
      <span class="badge badge-danger" style="font-size:11px">⚠ Blood</span>
      <span style="font-size:var(--text-sm);color:var(--color-ink)">${freq["blood"]}x logged (${bloodPct}%) — monitor closely</span>
    `;
    container.appendChild(el);
  }
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

  const dist       = calcBristolDist(logs);
  const freq       = calcSymptomFreq(logs);
  const times      = calcPeakTimes(logs);
  const score      = calcGutScore(logs);
  const idealPct   = (dist["3"] || 0) + (dist["4"] || 0);
  const peakBucket = Object.entries(times).sort((a, b) => b[1] - a[1])[0]?.[0];
  const insights   = [];

  // Bristol insight — use fun names
  if (idealPct >= 60) {
    insights.push({ type: "good", text: `<strong>${idealPct}% of your logs were Crackle or Soft</strong> — that's the sweet spot. Your gut is doing great!` });
  } else if (idealPct >= 40) {
    insights.push({ type: "note", text: `<strong>${idealPct}% were in the good range (Crackle/Soft).</strong> Still room to improve — try drinking more water and eating more fibre.` });
  } else {
    insights.push({ type: "note", text: `<strong>Consistency needs some work.</strong> Most logs were on the harder or mushier side. Diet and hydration are usually the first things to check.` });
  }

  // Bloating insight
  if (freq.bloating > 0) {
    insights.push({ type: "note", text: `<strong>Bloating showed up in ${freq.bloating}% of logs.</strong> Try tracking what you ate before these — dairy and gluten are common culprits.` });
  }

  // Cramps insight
  if (freq.cramps > 0) {
    insights.push({ type: "note", text: `<strong>Cramps in ${freq.cramps}% of logs.</strong> Could be stress, diet, or just a rough week. Worth noting if it keeps happening.` });
  }

  // Blood — always flag
  if (freq.blood > 0) {
    insights.push({ type: "note", text: `<strong>Blood noted in ${freq.blood}% of logs.</strong> Often harmless (like from straining), but if it keeps happening — see a doctor.` });
  }

  // Peak time — proper 24hr, no AM/PM confusion
  if (peakBucket && times[peakBucket] > 0) {
    const isMorning  = peakBucket.startsWith("06") || peakBucket.startsWith("08") || peakBucket.startsWith("10");
    const timeNote   = isMorning
      ? "Your gut loves mornings — totally normal after breakfast."
      : "You tend to go later in the day — nothing wrong with that!";
    insights.push({ type: "info", text: `<strong>Peak time: ${peakBucket}.</strong> ${timeNote}` });
  }

  // Score insight — plain language
  if (score !== null) {
    const scoreText = score >= 80 ? "Your gut is killing it this period."
      : score >= 60 ? "Doing well overall, with a few things to keep an eye on."
      : "A few things are dragging the score down — consistency and symptoms are the main factors.";
    insights.push({ type: score >= 60 ? "good" : "note", text: `<strong>Gut score: ${score}/100.</strong> ${scoreText}` });
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
