/** BotFather short name. TELEGRAM_* is the server copy; NEXT_PUBLIC_* is the Mini App copy. */
export function miniAppShortName(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TELEGRAM_MINI_APP_SHORT_NAME || env.NEXT_PUBLIC_TELEGRAM_MINI_APP_SHORT_NAME || "passgram").trim().replace(/^@/, "") || "passgram";
}

export function telegramBotUsername(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TELEGRAM_BOT_USERNAME || env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "PassGramBot").trim().replace(/^@/, "") || "PassGramBot";
}

export function miniAppCommunityUrl(communityId: number, env: NodeJS.ProcessEnv = process.env): string {
  return `https://t.me/${telegramBotUsername(env)}/${miniAppShortName(env)}?startapp=c_${communityId}`;
}
