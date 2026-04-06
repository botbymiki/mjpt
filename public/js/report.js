// ============================================================
// MJPT — Report Card Generator
// ============================================================

import {
  calcGutScore, getFunTitle, formatDateShort, getPeriodRange, BRISTOL, USERS
} from "/js/utils.js";


export async function generateReport(user, period, logs) {
  const card = buildCard(user, period, logs);
  document.body.appendChild(card);

  try {
    if (!window.html2canvas) {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    }
    const canvas = await window.html2canvas(card, {
      scale: 2, backgroundColor: "#1a1208", useCORS: true, logging: false
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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function row(label, value) {
  return `
    <div style="flex:1;padding:0 12px;border-left:1px solid rgba(255,255,255,0.08)">
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:18px;color:white;font-weight:700;margin-bottom:4px">${value}</div>
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:8px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.3)">${label}</div>
    </div>`;
}

function buildCard(user, period, logs) {
  const userLogs = user === "both" ? logs : logs.filter(l => l.user === user);
  const { start, end } = getPeriodRange(period);
  const days     = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
  const total    = userLogs.length;
  const avg      = total > 0 ? (total / days).toFixed(1) : "0";
  const score    = calcGutScore(userLogs);
  const title    = getFunTitle(user === "both" ? "mike" : user, userLogs);

  // Top Bristol
  const counts = {};
  userLogs.forEach(l => { if (l.bristolType) counts[l.bristolType] = (counts[l.bristolType] || 0) + 1; });
  const topEntry  = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const topType   = topEntry ? parseInt(topEntry[0]) : null;
  const topLabel  = topType ? (BRISTOL[topType]?.label || `Type ${topType}`) : "—";

  // Bristol bars — all 7 types
  const allTypes = [1,2,3,4,5,6,7];
  const maxCount = Math.max(...allTypes.map(t => counts[t] || 0), 1);
  const bars = allTypes.map(t => {
    const h     = Math.round(((counts[t] || 0) / maxCount) * 28);
    const isTop = t === topType;
    const lbl   = BRISTOL[t]?.label || `T${t}`;
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="width:100%;border-radius:2px 2px 0 0;background:${isTop ? "#c05a30" : "rgba(255,255,255,0.15)"};height:${Math.max(h,2)}px"></div>
      <div style="font-size:7px;color:${isTop ? "#f0a882" : "rgba(255,255,255,0.2)"};font-family:'Helvetica Neue',sans-serif;text-align:center;font-weight:600;white-space:nowrap">${lbl}${isTop ? " ★" : ""}</div>
    </div>`;
  }).join("");

  const periodLabel = { week:"This Week", month:"This Month", today:"Today", year:"This Year" }[period] || "This Week";
  const dateRange   = `${formatDateShort(start)} – ${formatDateShort(end)}`;
  const userName    = user === "both" ? "Combined" : USERS[user]?.name || user;

  const card = document.createElement("div");
  card.style.cssText = "position:fixed;left:-9999px;top:0;width:360px;background:#1a1208;border-radius:24px;padding:28px 24px;font-family:Georgia,serif;color:white;overflow:hidden;";

  card.innerHTML = `
    <!-- decorative circles -->
    <div style="position:absolute;width:180px;height:180px;border-radius:50%;background:rgba(192,90,48,0.12);right:-50px;top:-50px;pointer-events:none"></div>
    <div style="position:absolute;width:80px;height:80px;border-radius:50%;background:rgba(192,90,48,0.07);left:-20px;bottom:-20px;pointer-events:none"></div>

    <div style="position:relative;z-index:1">

      <!-- header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
        <div style="font-size:14px;color:rgba(255,255,255,0.25);letter-spacing:-0.5px">mjpt</div>
        <div style="text-align:right">
          <div style="font-family:'Helvetica Neue',sans-serif;font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:2px">${periodLabel}</div>
          <div style="font-family:'Helvetica Neue',sans-serif;font-size:10px;color:rgba(255,255,255,0.4)">${dateRange}</div>
        </div>
      </div>

      <!-- name -->
      <div style="font-size:24px;color:white;letter-spacing:-0.5px;line-height:1.1;margin-bottom:2px">${userName}'s Report</div>
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:10px;color:rgba(255,255,255,0.25);margin-bottom:20px">mjpt · Mike &amp; Jenna Poop Tracker</div>

      <!-- big number — block layout, no flex -->
      <div style="margin-bottom:4px">
        <span style="font-size:52px;color:white;letter-spacing:-2px;line-height:1;vertical-align:middle">${total}</span>
        <span style="font-family:'Helvetica Neue',sans-serif;font-size:14px;color:rgba(255,255,255,0.4);font-weight:300;margin-left:6px;vertical-align:middle">logs</span>
      </div>
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:16px">Total this period</div>

      <!-- divider -->
      <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:14px"></div>

      <!-- stats row -->
      <div style="display:flex;margin-bottom:14px">
        <div style="flex:1;padding-right:12px">
          <div style="font-family:'Helvetica Neue',sans-serif;font-size:18px;color:white;font-weight:700;margin-bottom:4px">${avg}</div>
          <div style="font-family:'Helvetica Neue',sans-serif;font-size:8px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,0.3)">Daily avg</div>
        </div>
        ${row("Top type", topLabel)}
        ${row("Gut score", score ?? "—")}
      </div>

      <!-- divider -->
      <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:14px"></div>

      <!-- bristol bars -->
      <div style="font-family:'Helvetica Neue',sans-serif;font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:8px">Bristol Distribution</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:44px;margin-bottom:14px">${bars}</div>

      <!-- divider -->
      <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:14px"></div>

      <!-- title badge -->
      <div style="background:rgba(192,90,48,0.2);border:1px solid rgba(192,90,48,0.35);border-radius:100px;padding:10px 16px;margin-bottom:16px">
        <div style="font-family:'Helvetica Neue',sans-serif;font-size:8px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(240,168,130,0.6);margin-bottom:4px">This period's title</div>
        <div style="font-family:'Helvetica Neue',sans-serif;font-size:14px;font-weight:600;color:#f0a882">${title}</div>
      </div>

      <!-- footer -->
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-family:'Helvetica Neue',sans-serif;font-size:9px;color:rgba(255,255,255,0.18)">Generated ${new Date().toLocaleDateString("en-AU", { day:"numeric", month:"long", year:"numeric" })}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.18);letter-spacing:-0.3px">mjpt</div>
      </div>

    </div>
  `;

  return card;
}
