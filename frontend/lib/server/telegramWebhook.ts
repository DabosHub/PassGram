import type { TelegramClient } from "./telegramClient";

const RECOVERY_GAP_MS = 15_000;
let recoveredAt = 0;

export function resetWebhookRecovery(): void {
  recoveredAt = 0;
}

/** The secret Telegram must send, without a wrapping quote from the host env. */
export function webhookSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TELEGRAM_WEBHOOK_SECRET || "").trim().replace(/^["']|["']$/g, "");
}

/** Production hosts that serve this Mini App. Preview hosts must not take the bot webhook. */
export function webhookOrigin(requestUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.PASSGRAM_PUBLIC_URL || "").trim().replace(/\/$/, "");
  const allowed = new Set(["https://passgram.io", "https://pass-gram.vercel.app"]);
  try {
    if (configured) allowed.add(new URL(configured).origin);
  } catch {
    /* PASSGRAM_PUBLIC_URL is not a URL. */
  }
  try {
    const origin = new URL(requestUrl).origin;
    if (allowed.has(origin)) return origin;
  } catch {
    /* The request URL is not absolute. */
  }
  if (configured.startsWith("https://")) return configured;
  return "https://passgram.io";
}

/**
 * Telegram only delivers the selected channel to the bot webhook.
 * If that webhook answers 401, the update stays queued and the Mini App waits forever.
 * Pull the queue, then register the secret this server actually checks.
 */
export async function recoverUndeliveredUpdates(
  deps: {
    telegram: TelegramClient;
    ingest: (update: unknown) => Promise<void>;
  },
  options: { secret: string; webhookUrl: string; now?: number; force?: boolean },
): Promise<"healthy" | "recovered" | "skipped"> {
  const secret = options.secret.trim();
  const webhookUrl = options.webhookUrl.replace(/\/$/, "");
  if (!secret || !webhookUrl.startsWith("https://") || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) return "skipped";
  const now = options.now ?? Date.now();
  if (!options.force && now - recoveredAt < RECOVERY_GAP_MS) return "skipped";
  recoveredAt = now;

  const info = (await deps.telegram.call("getWebhookInfo")) as {
    url?: string;
    pending_update_count?: number;
  };
  const pending = Number(info?.pending_update_count || 0);
  const currentUrl = typeof info?.url === "string" ? info.url : "";
  if (currentUrl === webhookUrl && pending === 0) return "healthy";

  await deps.telegram.call("deleteWebhook", { drop_pending_updates: false });
  const updates = await deps.telegram.call("getUpdates", {
    timeout: 0,
    allowed_updates: ["message", "my_chat_member"],
  });
  const list = Array.isArray(updates) ? updates : [];
  let maxId = 0;
  for (const update of list) {
    const id = update && typeof update === "object" ? (update as { update_id?: unknown }).update_id : 0;
    if (typeof id === "number" && id > maxId) maxId = id;
    await deps.ingest(update);
  }
  if (maxId > 0) {
    await deps.telegram.call("getUpdates", {
      offset: maxId + 1,
      timeout: 0,
      allowed_updates: ["message", "my_chat_member"],
    });
  }
  await deps.telegram.call("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: false,
  });
  console.error("telegram webhook recovered", { pending, host: new URL(webhookUrl).host, delivered: list.length });
  return "recovered";
}
