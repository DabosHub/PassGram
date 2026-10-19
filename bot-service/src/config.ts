export type BotServiceConfig = {
  databaseUrl: string;
  telegramBotToken: string;
  tonApiUrl: string;
  tonApiKey: string;
  registryAddress: string;
  pollIntervalMs: number;
  cronIntervalMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotServiceConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const registryAddress = env.PASSGRAM_REGISTRY_ADDRESS?.trim() || env.NEXT_PUBLIC_PASSGRAM_REGISTRY?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (!registryAddress) throw new Error("PASSGRAM_REGISTRY_ADDRESS is required");

  return {
    databaseUrl,
    telegramBotToken,
    tonApiUrl: (env.TON_API_URL || "https://toncenter.com/api/v2").replace(/\/$/, ""),
    tonApiKey: env.TONCENTER_API_KEY || env.TON_API_KEY || "",
    registryAddress,
    pollIntervalMs: Number(env.INDEXER_POLL_MS || 15_000),
    cronIntervalMs: Number(env.CRON_INTERVAL_MS || 60_000),
  };
}
