// ── Telegram Markdown Escaping ──
// Escapes special characters for Telegram's parse_mode="Markdown"
// See: https://core.telegram.org/bots/api#markdown-style

const MARKDOWN_SPECIAL = /[_*[\]~`]/g;

function escapeMarkdown(text) {
  if (!text) return text;
  return String(text).replace(MARKDOWN_SPECIAL, "\\$&");
}

module.exports = { escapeMarkdown };
