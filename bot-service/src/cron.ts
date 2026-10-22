import { loadConfig } from "./config.ts";
import { createPool, listDueRenewalReminders, listExpiredSubscriptions, markRenewalReminded } from "./db.ts";
import { createTelegramClient } from "./telegram.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export function renewalReminderText(title: string): string {
  const name = title.replace(/\s+/g, " ").trim().slice(0, 80) || "your community";
  return `1 day left on your subscription to ${name}. Renew before it ends, or your access to the channel will be removed.`;
}

export function renewalMiniAppUrl(communityId: number, env: NodeJS.ProcessEnv = process.env): string {
  const bot = (env.TELEGRAM_BOT_USERNAME || env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "PassGramBot").trim().replace(/^@/, "");
  const app = (env.NEXT_PUBLIC_TELEGRAM_MINI_APP_SHORT_NAME || "passgram").trim().replace(/^@/, "") || "passgram";
  return `https://t.me/${bot}/${app}?startapp=c_${communityId}`;
}

export async function runExpirationCronOnce(nowMs = Date.now()): Promise<number> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const telegram = createTelegramClient(config.telegramBotToken);
  try {
    try {
      const due = await listDueRenewalReminders(pool, nowMs, nowMs + DAY_MS);
      for (const row of due) {
        const sent = await telegram.sendDirectMessage(row.telegramUserId, renewalReminderText(row.title), {
          text: "Renew subscription",
          url: renewalMiniAppUrl(row.communityId),
        });
        if (sent.ok || sent.permanent) {
          await markRenewalReminded(pool, row.communityId, row.telegramUserId, row.expiresAtMs);
        }
      }
    } catch (error) {
      console.error("renewal reminder failed", error);
    }
    const expired = await listExpiredSubscriptions(pool, nowMs);
    let removed = 0;
    for (const row of expired) {
      if (!row.telegramChatId || !row.telegramUserId) continue;
      const ok = await telegram.kickThenUnban(row.telegramChatId, row.telegramUserId);
      if (ok) removed += 1;
    }
    return removed;
  } finally {
    await pool.end();
  }
}

async function main() {
  const config = loadConfig();
  console.log("PassGram expiration cron started");
  for (;;) {
    try {
      const n = await runExpirationCronOnce();
      if (n > 0) console.log("removed access for", n, "expired subscriptions");
    } catch (error) {
      console.error("cron tick failed", error);
    }
    await new Promise((r) => setTimeout(r, config.cronIntervalMs));
  }
}

const isDirect = process.argv[1]?.includes("cron");
if (isDirect) {
  void main();
}
