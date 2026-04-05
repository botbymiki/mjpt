// ============================================================
// MJPT — Report Card Generator
// Builds report card HTML and exports as PNG via html2canvas.
// Called from insights.js share button.
// ============================================================

import { db } from "/public/js/firebase.js";
import {
  collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

import {
  calcGutScore, scoreLabel, calcBristolDist,
  getFunTitle, formatDateShort, getPeriodRange,
  BRISTOL, USERS
} from "/public/js/utils.js";


// ── GENERATE REPORT IMAGE ──
export async function generateReport(user, period, logs) {
  // Build card element
  const card = buildCard(user, period, logs);
  document.body.appendChild(card);

  try {
    // Dynamically load html2canvas from CDN
    if (!window.html2canvas) {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    }

    const canvas = await window.html2canvas(card, {
      scale:           2,
      backgroundColor: null,
      useCORS:         true,
      logging:         false
    });

    // Download
    const link    = document.createElement("a");
    link.download = `mjpt-report-${user}-${period}-${Date.now()}.png`;
    link.href     = canvas.toDataURL("image/png");
    link.click();

    return true;
  } catch (err) {
    console.error("Report generation failed:", err);
    return false;
  } finally {
    document.body.removeChild(card);
  }
}


// ── LOAD SCRIPT HELPER ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s   = document.createElement("script");
    s.src     = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}


// ── BUILD CARD HTML ──
function buildCard(user, period, logs) {
  const userLogs = user === "both" ? logs : logs.filter(l => l.user === user);
  const { start, end } = getPeriodRange(period);
  const days     = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  const total    = userLogs.length;
  const avg      = total > 0 ? (total / days).toFixed(1) : "0";
  const score    = calcGutScore(userLogs);
  const scoreInfo = scoreLabel(score);
  const dist     = calcBristolDist(userLogs);
  const title    = getFunTitle(user, userLogs);

  // Top Bristol
  const bristolCounts = {};
  userLogs.forEach(l => { bristolCounts[l.bristolType] = (bristolCounts[l.bristolType] || 0) + 1; });
  const topBristol = Object.entries(bristolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "4";

  // Symptom rate
  const withSym   = userLogs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length;
  const symRate   = total > 0 ? Math.round((withSym / total) * 100) : 0;

  // Period label
  const periodLabel = period === "week" ? "This Week" : period === "month" ? "This Month" : period === "today" ? "Today" : "This Year";
  const dateRange   = `${formatDateShort(start)} – ${formatDateShort(end)}`;
  const userName    = user === "both" ? "Combined" : user === "mike" ? USERS.mike.name : USERS.jenna.name;

  // Bristol bars
  const bristolKeys = ["1-2", "3", "4", "5", "6-7"];
  const maxDist     = Math.max(...bristolKeys.map(k => dist[k] || 0), 1);
  const bristolBars = bristolKeys.map(k => {
    const h = Math.round(((dist[k] || 0) / maxDist) * 32);
    return `<div style="flex:1;border-radius:3px 3px 0 0;background:${k === "4" ? "#c05a30" : "rgba(192,90,48,0.35)"};height:${Math.max(h, 3)}px;min-height:3px"></div>`;
  }).join("");

  const card = document.createElement("div");
  card.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 342px;
    background: #1a1208;
    border-radius: 24px;
    padding: 32px 28px;
    font-family: Georgia, serif;
    color: white;
    overflow: hidden;
  `;

  card.innerHTML = `
    <div style="position:absolute;width:260px;height:260px;border-radius:50%;background:rgba(192,90,48,0.12);right:-80px;top:-80px;pointer-events:none"></div>
    <div style="position:absolute;width:120px;height:120px;border-radius:50%;background:rgba(192,90,48,0.07);left:-30px;bottom:-30px;pointer-events:none"></div>

    <div style="position:relative;z-index:1">

      <!-- Top row -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px">
        <div style="font-size:18px;color:rgba(255,255,255,0.25);letter-spacing:-0.5px">mjpt</div>
        <div style="text-align:right">
          <div style="font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:3px">${periodLabel}</div>
          <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.4)">${dateRange}</div>
        </div>
      </div>

      <!-- Name -->
      <div style="font-size:30px;color:white;letter-spacing:-0.5px;line-height:1;margin-bottom:4px">${userName}'s Report</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:28px;font-family:'Helvetica Neue',sans-serif">mjpt · Mike &amp; Jenna Poop Tracker</div>

      <!-- Big number -->
      <div style="font-size:80px;color:white;line-height:1;letter-spacing:-4px">
        ${total}<span style="font-size:18px;color:rgba(255,255,255,0.35);font-family:'Helvetica Neue',sans-serif;margin-left:6px;letter-spacing:0">logs</span>
      </div>
      <div style="font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-top:4px;margin-bottom:24px;font-family:'Helvetica Neue',sans-serif">Total this period</div>

      <!-- Divider -->
      <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:24px"></div>

      <!-- Stats row -->
      <div style="display:flex;margin-bottom:24px">
        <div style="flex:1">
          <div style="font-size:24px;color:white;letter-spacing:-0.5px">${avg}</div>
          <div style="font-size:9px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-top:3px;font-family:'Helvetica Neue',sans-serif">Daily avg</div>
        </div>
        <div style="flex:1;border-left:1px solid rgba(255,255,255,0.08);padding-left:20px">
          <div style="font-size:24px;color:white;letter-spacing:-0.5px">T${topBristol}</div>
          <div style="font-size:9px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-top:3px;font-family:'Helvetica Neue',sans-serif">Top type</div>
        </div>
        <div style="flex:1;border-left:1px solid rgba(255,255,255,0.08);padding-left:20px">
          <div style="font-size:24px;color:white;letter-spacing:-0.5px">${score ?? "—"}</div>
          <div style="font-size:9px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-top:3px;font-family:'Helvetica Neue',sans-serif">Gut score</div>
        </div>
      </div>

      <!-- Bristol bars -->
      <div style="margin-bottom:24px">
        <div style="font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:10px;font-family:'Helvetica Neue',sans-serif">Bristol Distribution</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:36px">${bristolBars}</div>
        <div style="display:flex;gap:4px;margin-top:5px">
          ${bristolKeys.map(k => `<div style="flex:1;text-align:center;font-size:8px;color:${k === "4" ? "rgba(192,90,48,0.8)" : "rgba(255,255,255,0.2)"};font-weight:600;font-family:'Helvetica Neue',sans-serif">${k === "1-2" ? "T1–2" : k === "6-7" ? "T6–7" : "T" + k}${k === "4" ? " ★" : ""}</div>`).join("")}
        </div>
      </div>

      <!-- Title badge -->
      <div style="background:rgba(192,90,48,0.2);border:1px solid rgba(192,90,48,0.35);border-radius:100px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
        <div>
          <div style="font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(240,168,130,0.6);margin-bottom:3px;font-family:'Helvetica Neue',sans-serif">This period's title</div>
          <div style="font-size:14px;font-weight:600;color:#f0a882;font-family:'Helvetica Neue',sans-serif">${title}</div>
        </div>
      </div>

      <!-- Bottom -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06)">
        <div style="font-size:10px;color:rgba(255,255,255,0.18);font-family:'Helvetica Neue',sans-serif">Generated ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.18);letter-spacing:-0.3px">mjpt</div>
      </div>

    </div>
  `;

  return card;
}
