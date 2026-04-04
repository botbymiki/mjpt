// ============================================================
// MJPT — Utilities
// Shared helpers used across all pages.
// ============================================================

// ── TIMEZONE ──
// All timestamps stored as UTC in Firestore.
// Web display: WITA (UTC+8)
// Telegram: each user's local timezone handled per-user

export const DISPLAY_TZ = "Asia/Makassar"; // WITA UTC+8

export const USERS = {
  mike:  { name: "Mike",  color: "#c05a30", tz: "Australia/Melbourne" },
  jenna: { name: "Jenna", color: "#3d7a52", tz: "Asia/Makassar" }
};


// ── DATE FORMATTING ──

/**
 * Format a Firestore timestamp or JS Date to display string.
 * Always displays in WITA (UTC+8).
 */
export function formatTime(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleTimeString("en-AU", {
    timeZone: DISPLAY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export function formatDate(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-AU", {
    timeZone: DISPLAY_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

export function formatDateShort(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-AU", {
    timeZone: DISPLAY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function formatDateTime(date) {
  const d = date?.toDate ? date.toDate() : new Date(date);
  return `${formatTime(d)}, ${formatDateShort(d)}`;
}

/**
 * Returns "Today", "Yesterday", or formatted date string.
 */
export function relativeDate(date) {
  const d     = date?.toDate ? date.toDate() : new Date(date);
  const now   = new Date();

  const dWITA   = toWITA(d);
  const nowWITA = toWITA(now);

  const dDay   = dWITA.toDateString();
  const nowDay = nowWITA.toDateString();

  const yesterday = new Date(nowWITA);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dDay === nowDay) return "Today";
  if (dDay === yesterday.toDateString()) return "Yesterday";
  return formatDateShort(d);
}

function toWITA(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: DISPLAY_TZ }));
}

/**
 * Get current date range for a period.
 * Returns { start: Date, end: Date }
 */
export function getPeriodRange(period) {
  const now   = new Date();
  const start = new Date(now);
  const end   = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return { start, end };
}


// ── BRISTOL SCALE ──
// Fun names match CSV composition terms from Poopie app.
// Scientific info shown as tooltip/info only.

export const BRISTOL = {
  1: { label: "Pellet",  desc: "Separate hard little balls",     clinical: "Severe constipation — drink more water!", color: "#6B3A2A", scoreColor: "danger" },
  2: { label: "Rock",    desc: "Lumpy, hard, difficult to pass", clinical: "Mild constipation — add more fibre.",      color: "#7A4030", scoreColor: "warn"   },
  3: { label: "Crackle", desc: "Sausage-like with cracks",       clinical: "Slightly dry but mostly normal.",          color: "#8B5040", scoreColor: "good"   },
  4: { label: "Soft",    desc: "Smooth, easy to pass",           clinical: "Ideal! This is the gold standard.",        color: "#8B6355", scoreColor: "good"   },
  5: { label: "Blob",    desc: "Soft blobs with clear edges",    clinical: "Lacking fibre — eat more veggies.",        color: "#A07850", scoreColor: "warn"   },
  6: { label: "Mush",    desc: "Fluffy, mushy, ragged edges",    clinical: "Mild diarrhea — check hydration.",         color: "#B09060", scoreColor: "warn"   },
  7: { label: "Liquid",  desc: "Completely watery, no solids",   clinical: "Diarrhea — rest and hydrate urgently.",    color: "#C0A070", scoreColor: "danger" }
};

export function bristolClass(type) {
  if (type <= 2) return "danger";
  if (type === 3 || type === 4) return "good";
  if (type === 5 || type === 6) return "warn";
  return "danger";
}

export function bristolBadgeText(type) {
  return BRISTOL[type]?.label || "Unknown";
}


// ── STOOL COLORS ──

export const STOOL_COLORS = {
  brown:      { label: "Brown",       hex: "#8B4513", clinical: "Normal" },
  dark_brown: { label: "Dark brown",  hex: "#4A2010", clinical: "Normal/constipation" },
  yellow:     { label: "Yellow",      hex: "#DAA520", clinical: "Possible bile issue" },
  green:      { label: "Green",       hex: "#4A7A3A", clinical: "Fast transit" },
  red:        { label: "Red",         hex: "#C03020", clinical: "Possible bleeding" },
  black:      { label: "Black",       hex: "#1A1208", clinical: "Possible upper GI bleed" },
  pale:       { label: "Pale/clay",   hex: "#D2B48C", clinical: "Possible liver issue" }
};


// ── SYMPTOMS ──

export const SYMPTOMS = ["none", "bloating", "urgency", "cramps", "blood"];

export function formatSymptoms(symptoms) {
  if (!symptoms || symptoms.length === 0 || symptoms.includes("none")) {
    return "No symptoms";
  }
  return symptoms
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(", ");
}


// ── GUT SCORE ──

/**
 * Calculates a gut health score (0–100) from log data.
 * Factors: Bristol consistency, symptom rate, frequency regularity.
 */
export function calcGutScore(logs) {
  if (!logs || logs.length === 0) return null;

  // Bristol score: T4 = 100, T3/T5 = 80, T2/T6 = 50, T1/T7 = 20
  const bristolScores = { 1: 20, 2: 50, 3: 80, 4: 100, 5: 80, 6: 50, 7: 20 };
  const avgBristol = logs.reduce((acc, l) => acc + (bristolScores[l.bristolType] || 60), 0) / logs.length;

  // Symptom score: no symptoms = 100, any symptom reduces score
  const symptomRate = logs.filter(l => l.symptoms && !l.symptoms.includes("none") && l.symptoms.length > 0).length / logs.length;
  const symptomScore = Math.max(0, 100 - (symptomRate * 100));

  // Frequency score: 1-3 logs/day = ideal
  const days = Math.max(1, [...new Set(logs.map(l => relativeDate(l.timestamp)))].length);
  const avgPerDay = logs.length / days;
  const freqScore = avgPerDay >= 1 && avgPerDay <= 3 ? 100
    : avgPerDay > 3 && avgPerDay <= 5 ? 80
    : avgPerDay > 5 ? 60
    : 40; // < 1 per day

  // Weighted composite
  const score = Math.round((avgBristol * 0.5) + (symptomScore * 0.35) + (freqScore * 0.15));
  return Math.min(100, Math.max(0, score));
}

export function scoreLabel(score) {
  if (score === null) return { label: "No data", class: "warn" };
  if (score >= 80)  return { label: "Great",  class: "good" };
  if (score >= 60)  return { label: "Good",   class: "good" };
  if (score >= 40)  return { label: "Fair",   class: "warn" };
  return               { label: "Poor",   class: "danger" };
}

export function scoreRingOffset(score, r = 35) {
  const circumference = 2 * Math.PI * r;
  return circumference - (score / 100) * circumference;
}


// ── FUN TITLES ──

const TITLES_MIKE = [
  "Consistency King",
  "The Regular",
  "Smooth Operator",
  "Type 4 Champion",
  "Daily Achiever",
  "The Reliable One",
  "Gut Whisperer"
];

const TITLES_JENNA = [
  "Prolific Pooper",
  "High Frequency Queen",
  "The Overachiever",
  "Five-a-Day Champion",
  "Gut Powerhouse",
  "Unstoppable Force",
  "The Record Breaker"
];

const TITLES_COMBINED = [
  "Prolific Household",
  "Dynamic Gut Duo",
  "The Poop Power Couple",
  "Combined Force of Nature",
  "Unstoppable Together"
];

export function getFunTitle(user, logs) {
  const pool = user === "combined" ? TITLES_COMBINED
    : user === "mike" ? TITLES_MIKE
    : TITLES_JENNA;

  // Deterministic pick based on week number
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return pool[week % pool.length];
}


// ── DOM HELPERS ──

export function $(selector)  { return document.querySelector(selector); }
export function $$(selector) { return document.querySelectorAll(selector); }

export function showToast(msg, duration = 2500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), duration);
}

export function setActive(parent, activeEl) {
  parent.querySelectorAll(".active").forEach(el => el.classList.remove("active"));
  activeEl.classList.add("active");
}


// ── BRISTOL DISTRIBUTION ──

export function calcBristolDist(logs) {
  const dist = { "1-2": 0, "3": 0, "4": 0, "5": 0, "6-7": 0 };
  if (!logs.length) return dist;

  logs.forEach(l => {
    const t = l.bristolType;
    if (t <= 2)      dist["1-2"]++;
    else if (t === 3) dist["3"]++;
    else if (t === 4) dist["4"]++;
    else if (t === 5) dist["5"]++;
    else              dist["6-7"]++;
  });

  // Convert to percentages
  Object.keys(dist).forEach(k => {
    dist[k] = Math.round((dist[k] / logs.length) * 100);
  });

  return dist;
}


// ── SYMPTOM FREQUENCY ──

export function calcSymptomFreq(logs) {
  const freq = { none: 0, bloating: 0, urgency: 0, cramps: 0, blood: 0 };
  if (!logs.length) return freq;

  logs.forEach(l => {
    if (!l.symptoms || l.symptoms.includes("none") || l.symptoms.length === 0) {
      freq.none++;
    } else {
      l.symptoms.forEach(s => { if (freq[s] !== undefined) freq[s]++; });
    }
  });

  // Convert to percentages
  Object.keys(freq).forEach(k => {
    freq[k] = Math.round((freq[k] / logs.length) * 100);
  });

  return freq;
}


// ── PEAK TIMES ──

export function calcPeakTimes(logs) {
  const buckets = {
    "06:00–08:00": 0,
    "08:00–10:00": 0,
    "10:00–12:00": 0,
    "12:00–15:00": 0,
    "15:00–18:00": 0,
    "18:00–22:00": 0
  };

  logs.forEach(l => {
    const d    = l.timestamp?.toDate ? l.timestamp.toDate() : new Date(l.timestamp);
    const hour = parseInt(d.toLocaleString("en-US", { timeZone: DISPLAY_TZ, hour: "numeric", hour12: false }));

    if (hour >= 6  && hour < 8)  buckets["06:00–08:00"]++;
    else if (hour >= 8  && hour < 10) buckets["08:00–10:00"]++;
    else if (hour >= 10 && hour < 12) buckets["10:00–12:00"]++;
    else if (hour >= 12 && hour < 15) buckets["12:00–15:00"]++;
    else if (hour >= 15 && hour < 18) buckets["15:00–18:00"]++;
    else if (hour >= 18 && hour < 22) buckets["18:00–22:00"]++;
  });

  return buckets;
}


// ── DAILY FREQUENCY (for bar chart) ──

export function calcDailyFreq(logs, days = 7) {
  const result = [];
  const today  = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("en-AU", { timeZone: DISPLAY_TZ });

    const count = logs.filter(l => {
      const ld = l.timestamp?.toDate ? l.timestamp.toDate() : new Date(l.timestamp);
      return ld.toLocaleDateString("en-AU", { timeZone: DISPLAY_TZ }) === key;
    }).length;

    result.push({
      date:    d,
      label:   d.toLocaleDateString("en-AU", { timeZone: DISPLAY_TZ, weekday: "narrow" }),
      count,
      isToday: i === 0
    });
  }

  return result;
}
