export class TelegramApiError extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(sanitizeTelegramText(message));
    this.name = "TelegramApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function sanitizeTelegramText(value: string): string {
  return value.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]").slice(0, 300);
}

export type TelegramCallOptions = {
  /** Skip the short member cache and store this reply for later reads. */
  fresh?: boolean;
};

export type TelegramClient = {
  call: (method: string, body?: Record<string, unknown>, options?: TelegramCallOptions) => Promise<any>;
};

const MEMBER_CACHE_MS = 30_000;
const memberCache = new Map<string, { at: number; value: unknown }>();

function memberCacheKey(token: string, method: string, body: Record<string, unknown> | undefined): string {
  const chat = body?.chat_id ?? "";
  const user = body?.user_id ?? "";
  return `${token.length}:${method}:${chat}:${user}`;
}

export function createTelegramClient(token: string): TelegramClient {
  return {
    async call(method, body, options) {
      const cached = method === "getChatMember" || method === "getChatMemberCount";
      const key = cached ? memberCacheKey(token, method, body) : "";
      if (cached && !options?.fresh) {
        const hit = memberCache.get(key);
        if (hit && Date.now() - hit.at < MEMBER_CACHE_MS) return hit.value;
      }
      const value = await callTelegram(token, method, body, true);
      if (cached) {
        memberCache.set(key, { at: Date.now(), value });
        if (memberCache.size > 2000) {
          const oldest = memberCache.keys().next().value;
          if (oldest) memberCache.delete(oldest);
        }
      }
      return value;
    },
  };
}

async function callTelegram(
  token: string,
  method: string,
  body: Record<string, unknown> | undefined,
  allowRetry: boolean,
): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new TelegramApiError("Telegram did not respond.", 504);
  }
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result?: Record<string, unknown>;
    description?: string;
    error_code?: number;
    parameters?: { retry_after?: number };
  } | null;
  if (!payload?.ok) {
    const status = payload?.error_code || response.status;
    const retryAfter = payload?.parameters?.retry_after;
    if (allowRetry && status === 429 && typeof retryAfter === "number" && retryAfter <= 2) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return callTelegram(token, method, body, false);
    }
    throw new TelegramApiError(payload?.description || "Telegram request failed.", status, retryAfter);
  }
  return payload.result ?? {};
}

export async function downloadTelegramFile(token: string, filePath: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!filePath || filePath.includes("..") || filePath.startsWith("/")) {
    throw new TelegramApiError("Telegram returned an unexpected file path.", 502);
  }
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new TelegramApiError("Telegram did not send the channel photo.", 504);
  }
  if (!response.ok) throw new TelegramApiError("Telegram did not send the channel photo.", response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 5_000_000) throw new TelegramApiError("The channel photo is too large to cache.", 502);
  return { bytes, contentType: contentTypeFor(filePath) };
}

function contentTypeFor(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
