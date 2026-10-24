export type BotServiceConfig = {
  databaseUrl: string;
  telegramBotToken: string;
  tonApiUrl: string;
  tonApiKey: string;
  registryAddress: string;
  registryCodeHash: string;
  pollIntervalMs: number;
  cronIntervalMs: number;
};

const MAINNET_API = "https://toncenter.com/api/v2";
const TESTNET_API = "https://testnet.toncenter.com/api/v2";

function parseMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000 ? Math.trunc(parsed) : fallback;
}

/** A mainnet registry must not be read through a testnet API, and the reverse. */
export function registryApiUrl(address: string, configured: string | undefined): string {
  const cleaned = (configured || MAINNET_API).trim().replace(/\/$/, "").replace(/\/jsonRPC$/, "");
  const onTestnetHost = cleaned.includes("testnet");
  if (address.startsWith("EQ") || address.startsWith("UQ")) return onTestnetHost ? MAINNET_API : cleaned;
  if (address.startsWith("kQ") || address.startsWith("0Q")) return onTestnetHost ? cleaned : TESTNET_API;
  return cleaned;
}

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
    tonApiUrl: registryApiUrl(registryAddress, env.TON_API_URL),
    tonApiKey: env.TONCENTER_API_KEY || env.TON_API_KEY || "",
    registryAddress,
    registryCodeHash: (env.PASSGRAM_REGISTRY_CODE_HASH || "").trim().toLowerCase(),
    pollIntervalMs: parseMs(env.INDEXER_POLL_MS, 15_000),
    cronIntervalMs: parseMs(env.CRON_INTERVAL_MS, 60_000),
  };
}
