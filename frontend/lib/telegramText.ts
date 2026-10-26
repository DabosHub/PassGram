/** Telegram HTML. User-written names are escaped before they are wrapped in tags. */

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

export function channelVerifiedText(title: string): string {
  const name = tgBold(cleanLabel(title, "your channel"));
  return telegramNote("Channel ready", [
    `PassGram verified ${name}.`,
    "Invite and ban rights are already on. Open PassGram to finish the community.",
  ]);
}

export function channelRightsNeededText(title: string): string {
  const name = tgBold(cleanLabel(title, "your channel"));
  return telegramNote("One step left", [
    `PassGram verified ownership of ${name}.`,
    "Add @PassGramBot as an admin and turn on only Invite users via link and Ban users. Leave the other permissions off.",
    "Then return to PassGram. Access updates when Telegram notifies the bot.",
  ]);
}

export function botRightsReadyText(title: string): string {
  const name = tgBold(cleanLabel(title, "your channel"));
  return telegramNote("Bot access is ready", [
    `@PassGramBot can invite and remove members in ${name}.`,
    "Open PassGram to finish creating the community.",
  ]);
}

