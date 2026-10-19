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

export type TelegramClient = {
  call: (method: string, body?: Record<string, unknown>) => Promise<any>;
};

export function createTelegramClient(token: string): TelegramClient {
  return {
    call(method, body) {
      return callTelegram(token, method, body, true);
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
