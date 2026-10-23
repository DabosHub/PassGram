import { loadConfig } from "./config.ts";
import { miniAppCommunityUrl } from "./miniAppName.ts";
import { createPool, listDueRenewalReminders, listExpiredSubscriptions, markAccessRemoved, markRenewalReminded } from "./db.ts";
import { createShutdown, sleep } from "./lifecycle.ts";
import { sanitizeError } from "./log.ts";
import { createTelegramClient } from "./telegram.ts";
import type { Pool } from "pg";

const DAY_MS = 24 * 60 * 60 * 1000;

export function renewalReminderText(title: string): string {
  const name = title.replace(/\s+/g, " ").trim().slice(0, 80) || "your community";
  return `1 day left on your subscription to ${name}. Renew before it ends, or your access to the channel will be removed.`;
}

export function renewalMiniAppUrl(communityId: number, env: NodeJS.ProcessEnv = process.env): string {
  return miniAppCommunityUrl(communityId, env);
}

export async function runExpirationCronOnce(nowMs = Date.now(), sharedPool?: Pool): Promise<number> {
  const config = loadConfig();
  const pool = sharedPool ?? createPool(config.databaseUrl);
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
      console.error("renewal reminder failed", sanitizeError(error));
    }
    const expired = await listExpiredSubscriptions(pool, nowMs);
    let removed = 0;
    for (const row of expired) {
      if (!row.telegramChatId || !row.telegramUserId) continue;
      try {
        const ok = await telegram.kickThenUnban(row.telegramChatId, row.telegramUserId);
        if (!ok) continue;
        await markAccessRemoved(pool, row.communityId, row.telegramUserId, row.expiresAtMs);
        removed += 1;
      } catch (error) {
        console.error("channel removal will be retried", sanitizeError(error));
      }
    }
    return removed;
  } finally {
    if (!sharedPool) await pool.end();
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const shutdown = createShutdown();
  console.log("PassGram expiration cron started");
  try {
    while (!shutdown.signal.aborted) {
      try {
        const n = await runExpirationCronOnce(Date.now(), pool);
        if (n > 0) console.log("removed access for", n, "expired subscriptions");
      } catch (error) {
        console.error("cron tick failed", sanitizeError(error));
      }
      await sleep(config.cronIntervalMs, shutdown.signal);
    }
  } finally {
    await pool.end();
  }
}

const isDirect = process.argv[1]?.includes("cron");
if (isDirect) {
  void main();
}
