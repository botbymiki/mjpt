// ============================================================
// MJPT — Report Card Generator
// Builds report card HTML and exports as PNG via html2canvas.
// ============================================================

import {
  calcGutScore, scoreLabel, getFunTitle,
  formatDateShort, getPeriodRange, BRISTOL, USERS
} from "/js/utils.js";


// ── GENERATE REPORT IMAGE ──
export async function generateReport(user, period, logs) {
  const card = buildCard(user, period, logs);
  document.body.appendChild(card);

  try {
    if (!window.html2canvas) {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    }

    const canvas = await window.html2canvas(card, {
      scale:           2,
      backgroundColor: "#1a1208",
      useCORS:         true,
      logging:         false
    });

    const link    = document.createElement("a");
    link.download = `mjpt-${user}-${period}-${Date.now()}.png`;
    link.href     = canvas.toDataURL("image/png");
    link.click();

    return true;
  } catch (err) {
    console.error("Report generation failed:", err);
    return false;
  } finally {
    if (document.body.contains(card)) document.body.removeChild(card);
  }
}


// ── LOAD SCRIPT ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s   = document.createElement("script");
    s.src     = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}


// ── BUILD CARD ──
function buildCard(user, period, logs) {
  const userLogs  = user === "both" ? logs : logs.filter(l => l.user === user);
  const { start, end } = getPeriodRange(period);
  const days      = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  const total     = userLogs.length;
  const avg       = total > 0 ? (total / days).toFixed(1) : "0";
  const score     = calcGutScore(userLogs);
  const title     = getFunTitle(user === "both" ? "mike" : user, userLogs);

  // Top Bristol — filter undefined
  const bristolCounts = {};
  userLogs.forEach(l => {
    if (!l.bristolType) return;
    bristolCounts[l.bristolType] = (bristolCounts[l.bristolType] || 0) + 1;
  });
  const topBristolEntry = Object.entries(bristolCounts).sort((a, b) => b[1] - a[1])[0];
  const topBristol      = topBristolEntry ? parseInt(topBristolEntry[0]) : null;
  const topBristolLabel = topBristol ? (BRISTOL[topBristol]?.label || `Type ${topBristol}`) : "—";

  // All 7 Bristol types individually
  const allTypes  = [1, 2, 3, 4, 5, 6, 7];
  const maxCount  = Math.max(...allTypes.map(t => bristolCounts[t] || 0), 1);
  const bristolBars = allTypes.map(t => {
    const count  = bristolCounts[t] || 0;
    const h      = Math.round((count / maxCount) * 32);
    const isTop  = t === topBristol;
    const label  = BRISTOL[t]?.label || `T${t}`;
    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="width:100%;border-radius:3px 3px 0 0;background:${isTop ? "#c05a30" : "rgba(192,90,48,0.3)"};height:${Math.max(h, 3)}px;min-height:3px"></div>
        <div style="font-size:7px;color:${isTop ? "rgba(192,90,48,0.9)" : "rgba(255,255,255,0.2)"};font-weight:600;font-family:'Helvetica Neue',sans-serif;text-align:center">${label}${isTop ? " ★" : ""}</div>
      </div>`;
  }).join("");

  // Symptom rate
  const withSym  = userLogs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length;
  const symRate  = total > 0 ? Math.round((withSym / total) * 100) : 0;

  // Labels
  const periodLabel = period === "week" ? "This Week" : period === "month" ? "This Month" : period === "today" ? "Today" : "This Year";
  const dateRange   = `${formatDateShort(start)} – ${formatDateShort(end)}`;
  const userName    = user === "both" ? "Combined" : user === "mike" ? USERS.mike.name : USERS.jenna.name;

  const card = document.createElement("div");
  card.style.cssText = `
    position:fixed;left:-9999px;top:0;
    width:342px;
    background:#1a1208;
    border-radius:24px;
    padding:28px 24px;
    font-family:Georgia,serif;
    color:white;
    overflow:hidden;
  `;

  card.innerHTML = `
    <div style="position:absolute;width:220px;height:220px;border-radius:50%;background:rgba(192,90,48,0.12);right:-70px;top:-70px;pointer-events:none"></div>
    <div style="position:absolute;width:100px;height:100px;border-radius:50%;background:rgba(192,90,48,0.07);left:-25px;bottom:-25px;pointer-events:none"></div>

    <div style="position:relative;z-index:1">

      <!-- Top row -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        <div style="font-size:16px;color:rgba(255,255,255,0.25);letter-spacing:-0.5px">mjpt</div>
        <div style="text-align:right">
          <div style="font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:2px;font-family:'Helvetica Neue',sans-serif">${periodLabel}</div>
          <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.4);font-family:'Helvetica Neue',sans-serif">${dateRange}</div>
        </div>
      </div>

      <!-- Name -->
      <div style="font-size:26px;color:white;letter-spacing:-0.5px;line-height:1.1;margin-bottom:3px">${userName}'s Report</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-bottom:24px;font-family:'Helvetica Neue',sans-serif">mjpt · Mike & Jenna Poop Tracker</div>

      <!-- Big number -->
      <div style="margin-bottom:20px">
        <div style="line-height:1;margin-bottom:4px">
          <span style="font-size:56px;color:white;letter-spacing:-2px;font-family:Georgia,serif;vertical-align:baseline">${total}</span>
          <span style="font-size:15px;color:rgba(255,255,255,0.4);font-family:'Helvetica Neue',sans-serif;font-weight:300;margin-left:6px;vertical-align:baseline">logs</span>
        </div>
        <div style="font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);font-family:'Helvetica Neue',sans-serif">Total this period</div>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:20px"></div>

      <!-- Stats row — 3 columns -->
      <div style="display:flex;gap:0;margin-bottom:20px">
        <div style="flex:1">
          <div style="font-size:20px;color:white;letter-spacing:-0.5px;font-weight:bold">${avg}</div>
          <div style="font-size:8px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-top:3px;font-family:'Helvetica Neue',sans-serif">Daily avg</div>
        </div>
        <div style="flex:1;border-left:1px solid rgba(255,255,255,0.08);padding-left:16px">
          <div style="font-size:20px;color:white;letter-spacing:-0.5px;font-weight:bold">${topBristolLabel}</div>
          <div style="font-size:8px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-top:3px;font-family:'Helvetica Neue',sans-serif">Top type</div>
        </div>
        <div style="flex:1;border-left:1px solid rgba(255,255,255,0.08);padding-left:16px">
          <div style="font-size:20px;color:white;letter-spacing:-0.5px;font-weight:bold">${score ?? "—"}</div>
          <div style="font-size:8px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-top:3px;font-family:'Helvetica Neue',sans-serif">Gut score</div>
        </div>
      </div>

      <!-- Bristol bars — all 7 types -->
      <div style="margin-bottom:20px">
        <div style="font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:8px;font-family:'Helvetica Neue',sans-serif">Bristol Distribution</div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:40px">${bristolBars}</div>
      </div>

      <!-- Title badge -->
      <div style="background:rgba(192,90,48,0.2);border:1px solid rgba(192,90,48,0.35);border-radius:100px;padding:10px 16px;margin-bottom:20px">
        <div style="font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(240,168,130,0.6);margin-bottom:3px;font-family:'Helvetica Neue',sans-serif">This period's title</div>
        <div style="font-size:14px;font-weight:600;color:#f0a882;font-family:'Helvetica Neue',sans-serif">${title}</div>
      </div>

      <!-- Bottom -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06)">
        <div style="font-size:9px;color:rgba(255,255,255,0.18);font-family:'Helvetica Neue',sans-serif">Generated ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.18);letter-spacing:-0.3px">mjpt</div>
      </div>

    </div>
  `;

  return card;
}
