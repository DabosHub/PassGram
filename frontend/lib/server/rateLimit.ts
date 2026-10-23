import { validateInitData } from "./initData";

const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Per Telegram user, inside this server instance. Writes are rarer than reads. */
export function allowUserAction(userId: number, action: "read" | "write", now = Date.now()): boolean {
  if (process.env.NODE_TEST_CONTEXT && process.env.PASSGRAM_RATE_LIMIT !== "on") return true;
  const limit = action === "write" ? 10 : 60;
  const key = `${action}:${userId}`;
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 5000) {
      for (const [stored, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(stored);
      }
    }
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

/** Stops an authenticated Mini App user who is calling too often. Unsigned requests are left to the route. */
export function limitedResponse(request: Request, action: "read" | "write"): Response | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const initData = request.headers.get("x-telegram-init-data") || "";
  if (!initData || !botToken) return null;
  const identity = validateInitData(initData, botToken);
  if (!identity) return null;
  if (allowUserAction(identity.userId, action)) return null;
  return Response.json(
    { ok: false, message: "Too many requests. Wait a minute and try again." },
    { status: 429 },
  );
}
