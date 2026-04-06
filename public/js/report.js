// ============================================================
// MJPT — Report Card Generator
// Draws directly to Canvas API — no html2canvas, no CSS issues.
// ============================================================

import {
  calcGutScore, getFunTitle, formatDateShort, getPeriodRange, BRISTOL, USERS
} from "/js/utils.js";


export async function generateReport(user, period, logs) {
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
  const topEntry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const topType  = topEntry ? parseInt(topEntry[0]) : null;
  const topLabel = topType ? (BRISTOL[topType]?.label || `Type ${topType}`) : "—";

  const periodLabel = { week:"This Week", month:"This Month", today:"Today", year:"This Year" }[period] || "This Week";
  const dateRange   = `${formatDateShort(start)} – ${formatDateShort(end)}`;
  const userName    = user === "both" ? "Combined" : USERS[user]?.name || user;

  // ── CANVAS SETUP ──
  const W = 720, H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // ── BACKGROUND ──
  ctx.fillStyle = "#1a1208";
  roundRect(ctx, 0, 0, W, H, 40);
  ctx.fill();

  // Decorative circles
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#c05a30";
  ctx.beginPath(); ctx.arc(W + 20, -20, 200, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-20, H + 20, 120, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // ── HELPER ──
  const PAD = 56;
  let y = 56;

  function text(str, x, yy, size, color, weight = "normal", align = "left") {
    ctx.font = `${weight} ${size}px ${weight === "bold" || weight === "600" ? "'Helvetica Neue', Arial" : "Georgia, serif"}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(str, x, yy);
    ctx.textAlign = "left";
  }

  function divider(yy) {
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(W - PAD, yy);
    ctx.stroke();
  }

  // ── HEADER ROW ──
  text("mjpt", PAD, y, 28, "rgba(255,255,255,0.25)", "normal");
  text(periodLabel.toUpperCase(), W - PAD, y - 14, 18, "rgba(255,255,255,0.25)", "600", "right");
  text(dateRange, W - PAD, y + 8, 20, "rgba(255,255,255,0.4)", "600", "right");
  y += 60;

  // ── NAME ──
  text(`${userName}'s Report`, PAD, y, 52, "#ffffff", "normal");
  y += 18;
  text("mjpt · Mike & Jenna Poop Tracker", PAD, y, 20, "rgba(255,255,255,0.25)", "600");
  y += 60;

  // ── BIG NUMBER ──
  ctx.font = "normal 120px Georgia, serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(String(total), PAD, y);
  const numW = ctx.measureText(String(total)).width;
  text("logs", PAD + numW + 16, y - 8, 28, "rgba(255,255,255,0.4)", "300");
  y += 16;
  text("TOTAL THIS PERIOD", PAD, y, 18, "rgba(255,255,255,0.25)", "600");
  y += 48;

  divider(y); y += 40;

  // ── STATS ROW ──
  const colW = (W - PAD * 2) / 3;
  const stats = [
    { label: "DAILY AVG",  val: avg       },
    { label: "TOP TYPE",   val: topLabel  },
    { label: "GUT SCORE",  val: score !== null ? String(score) : "—" }
  ];

  stats.forEach((s, i) => {
    const x = PAD + i * colW;
    if (i > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 60); ctx.stroke();
    }
    text(s.val,   x + (i > 0 ? 20 : 0), y + 36, 40, "#ffffff", "bold");
    text(s.label, x + (i > 0 ? 20 : 0), y + 60, 18, "rgba(255,255,255,0.3)", "600");
  });
  y += 100;

  divider(y); y += 40;

  // ── BRISTOL DISTRIBUTION ──
  text("BRISTOL DISTRIBUTION", PAD, y, 18, "rgba(255,255,255,0.25)", "600");
  y += 24;

  const allTypes = [1,2,3,4,5,6,7];
  const maxCount = Math.max(...allTypes.map(t => counts[t] || 0), 1);
  const barW     = Math.floor((W - PAD * 2 - 6 * 8) / 7);
  const barMaxH  = 80;

  allTypes.forEach((t, i) => {
    const count  = counts[t] || 0;
    const barH   = Math.max(Math.round((count / maxCount) * barMaxH), 4);
    const isTop  = t === topType;
    const x      = PAD + i * (barW + 8);
    const barY   = y + barMaxH - barH;
    const lbl    = BRISTOL[t]?.label || `T${t}`;

    ctx.fillStyle = isTop ? "#c05a30" : "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.roundRect(x, barY, barW, barH, [3, 3, 0, 0]);
    ctx.fill();

    ctx.font      = `600 ${isTop ? 17 : 16}px 'Helvetica Neue', Arial`;
    ctx.fillStyle = isTop ? "#f0a882" : "rgba(255,255,255,0.2)";
    ctx.textAlign = "center";
    ctx.fillText(lbl + (isTop ? " ★" : ""), x + barW / 2, y + barMaxH + 22);
    ctx.textAlign = "left";
  });

  y += barMaxH + 40;

  divider(y); y += 40;

  // ── TITLE BADGE ──
  const badgeH = 90;
  const badgeW = W - PAD * 2;

  // Badge background
  ctx.fillStyle   = "rgba(192,90,48,0.2)";
  ctx.strokeStyle = "rgba(192,90,48,0.35)";
  ctx.lineWidth   = 1.5;
  roundRect(ctx, PAD, y, badgeW, badgeH, 50);
  ctx.fill();
  roundRect(ctx, PAD, y, badgeW, badgeH, 50);
  ctx.stroke();

  text("THIS PERIOD'S TITLE", PAD + 28, y + 30, 18, "rgba(240,168,130,0.6)", "600");
  text(title,                 PAD + 28, y + 58, 30, "#f0a882", "600");
  y += badgeH + 48;

  // ── FOOTER ──
  const genDate = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  text(`Generated ${genDate}`, PAD, y, 18, "rgba(255,255,255,0.18)", "600");
  text("mjpt", W - PAD, y, 22, "rgba(255,255,255,0.18)", "normal", "right");

  // ── DOWNLOAD ──
  const link    = document.createElement("a");
  link.download = `mjpt-${user}-${period}-${Date.now()}.png`;
  link.href     = canvas.toDataURL("image/png");
  link.click();

  return true;
}


// ── HELPERS ──
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
