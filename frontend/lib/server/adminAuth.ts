import crypto from "node:crypto";

export const ADMIN_COOKIE = "passgram_admin";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60;
const SIGN_IN_LIMIT = 10;
const SIGN_IN_WINDOW_MS = 60_000;

const signInAttempts = new Map<string, { count: number; resetAt: number }>();

export function adminTelegramIds(raw: string | undefined = process.env.PASSGRAM_ADMIN_TELEGRAM_IDS): Set<number> {
  const ids = new Set<number>();
  for (const part of (raw ?? "").split(",")) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

export function adminCookieOptions(maxAge: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

/** Telegram Login Widget payload. The user id is taken only after the bot-token check. */
export function validateTelegramLogin(
  payload: unknown,
  botToken: string,
  nowSeconds = Date.now() / 1000,
): { userId: number; displayName: string; username: string } | null {
  if (!payload || typeof payload !== "object" || !botToken) return null;
  const record = payload as Record<string, unknown>;
  const hash = record.hash;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;

  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === "hash") continue;
    if (!/^[a-z0-9_]{1,64}$/.test(key)) return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      entries.push([key, String(value)]);
    } else if (typeof value === "string") {
      entries.push([key, value]);
    } else if (typeof value === "boolean") {
      entries.push([key, value ? "true" : "false"]);
    } else {
      return null;
    }
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const dataCheck = entries.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (!safeEqual(computed, hash)) return null;

  const id = typeof record.id === "number" ? record.id : Number.NaN;
  const authDate = typeof record.auth_date === "number" ? record.auth_date : Number.NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSeconds - authDate > LOGIN_MAX_AGE_SECONDS || authDate - nowSeconds > 60) {
    return null;
  }
  const firstName = typeof record.first_name === "string" ? record.first_name.trim() : "";
  const lastName = typeof record.last_name === "string" ? record.last_name.trim() : "";
  const username = typeof record.username === "string" ? record.username.trim().replace(/^@/, "") : "";
  return {
    userId: id,
    displayName: [firstName, lastName].filter(Boolean).join(" "),
    username,
  };
}

export function signAdminSession(userId: number, botToken: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: nowSeconds + SESSION_TTL_SECONDS })).toString("base64url");
  return `${payload}.${sessionMac(payload, botToken)}`;
}

export function readAdminSession(
  token: string | undefined,
  botToken: string,
  allowlist: ReadonlySet<number>,
  nowSeconds = Math.floor(Date.now() / 1000),
): { userId: number } | null {
  if (!token || !botToken || allowlist.size === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature || !safeEqual(signature, sessionMac(payload, botToken))) return null;
  let parsed: { uid?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { uid?: unknown; exp?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.uid !== "number" || !Number.isSafeInteger(parsed.uid) || parsed.uid <= 0) return null;
  if (typeof parsed.exp !== "number" || !Number.isSafeInteger(parsed.exp)) return null;
  if (parsed.exp <= nowSeconds || parsed.exp > nowSeconds + SESSION_TTL_SECONDS + 60) return null;
  if (!allowlist.has(parsed.uid)) return null;
  return { userId: parsed.uid };
}

export function requestFromThisSite(request: { headers: { get(name: string): string | null } }): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Ten sign-in attempts per minute for this server process. */
export function allowAdminSignIn(now = Date.now()): boolean {
  if (process.env.NODE_TEST_CONTEXT && process.env.PASSGRAM_RATE_LIMIT !== "on") return true;
  const current = signInAttempts.get("admin-sign-in");
  if (!current || now >= current.resetAt) {
    signInAttempts.set("admin-sign-in", { count: 1, resetAt: now + SIGN_IN_WINDOW_MS });
    return true;
  }
  if (current.count >= SIGN_IN_LIMIT) return false;
  current.count += 1;
  return true;
}

function sessionMac(payload: string, botToken: string): string {
  const key = crypto.createHmac("sha256", botToken).update("passgram-admin-session-v1").digest();
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
