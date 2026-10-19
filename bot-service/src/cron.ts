import { loadConfig } from "./config.ts";
import { createPool, listExpiredSubscriptions } from "./db.ts";
import { createTelegramClient } from "./telegram.ts";

export async function runExpirationCronOnce(nowMs = Date.now()): Promise<number> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const telegram = createTelegramClient(config.telegramBotToken);
  try {
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
