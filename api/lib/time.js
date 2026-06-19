// ============================================================
// MJPT — Time helpers
// Shared between api/cron.js and api/webhook.js.
// Prevents copy-paste drift and timezone bugs.
// ============================================================

const LOCALE = "en-CA"; // "YYYY-MM-DD" format, safe for string comparison

/**
 * Format a Date as a local date string in the given timezone.
 * Uses "en-CA" (YYYY-MM-DD) for safe string comparison.
 */
function formatLocalDate(date, tz) {
  return date.toLocaleDateString(LOCALE, { timeZone: tz });
}

/**
 * Get today's date string in the given timezone.
 */
function getTodayStr(tz) {
  return formatLocalDate(new Date(), tz);
}

/**
 * Check if two dates fall on the same local day in the given timezone.
 */
function isSameLocalDay(a, b, tz) {
  return formatLocalDate(a, tz) === formatLocalDate(b, tz);
}

/**
 * Convert a Firestore Timestamp to a local date string.
 */
function timestampToLocalDate(ts, tz) {
  if (!ts || !ts.toDate) return null;
  return formatLocalDate(ts.toDate(), tz);
}

module.exports = {
  formatLocalDate,
  getTodayStr,
  isSameLocalDay,
  timestampToLocalDate,
};
