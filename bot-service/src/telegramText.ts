export function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function tgBold(value: string): string {
  return `<b>${escapeTelegramHtml(value)}</b>`;
}

export function telegramNote(title: string, paragraphs: string[]): string {
  return [`<b>${escapeTelegramHtml(title)}</b>`, ...paragraphs.filter(Boolean)].join("\n\n");
}

export function cleanLabel(value: string, fallback: string, max = 80): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max) || fallback;
}
