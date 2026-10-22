import crypto from "node:crypto";

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export type MiniAppIdentity = {
  userId: number;
  displayName: string;
  username: string;
  photoUrl: string;
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Validates Mini App initData. The user id is taken only from this checked payload. */
export function validateInitData(initData: string, botToken: string, nowSeconds = Date.now() / 1000): MiniAppIdentity | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (!safeEqual(computed, hash)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSeconds - authDate > MAX_AUTH_AGE_SECONDS || authDate - nowSeconds > 60) {
    return null;
  }
  const userRaw = params.get("user");
  if (!userRaw) return null;
  let user: { id?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown; photo_url?: unknown };
  try {
    user = JSON.parse(userRaw) as { id?: unknown; first_name?: unknown; last_name?: unknown; username?: unknown; photo_url?: unknown };
  } catch {
    return null;
  }
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const firstName = typeof user.first_name === "string" ? user.first_name.trim() : "";
  const lastName = typeof user.last_name === "string" ? user.last_name.trim() : "";
  return {
    userId: user.id,
    displayName: [firstName, lastName].filter(Boolean).join(" "),
    username: typeof user.username === "string" ? user.username.trim().replace(/^@/, "") : "",
    photoUrl: typeof user.photo_url === "string" ? user.photo_url.trim() : "",
  };
}
