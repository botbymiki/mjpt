// ── Weekly Recap Logic ──
// Determines if a weekly recap should be sent based on local time and dedup.

/**
 * Check if the weekly recap is due.
 * @param {number} localDay - Day of week (1=Monday ... 7=Sunday)
 * @param {number} localHour - Hour (0-23)
 * @param {boolean} alreadySentThisWeek - Whether recap already sent this week
 * @param {boolean} [force=false] - Override all checks
 * @returns {boolean}
 */
function isRecapDue(localDay, localHour, alreadySentThisWeek, force = false) {
  if (force) return true;
  if (alreadySentThisWeek) return false;
  // Send on Sunday (day 7) between 6am and 12pm (hours 6-11)
  return localDay === 7 && localHour >= 6 && localHour <= 11;
}

module.exports = { isRecapDue };