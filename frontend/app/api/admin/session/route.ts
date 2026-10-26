import {
  ADMIN_COOKIE,
  SESSION_TTL_SECONDS,
  adminCookieOptions,
  adminTelegramIds,
  allowAdminSignIn,
  requestFromThisSite,
  signAdminSession,
  validateTelegramLogin,
} from "@/lib/server/adminAuth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

/** Telegram Login returns here in the browser address bar, with the signed fields as query parameters. */
export async function GET(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const allowlist = adminTelegramIds();
  if (!token || allowlist.size === 0) redirect("/admin/login?error=closed");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") redirect("/admin/login?error=invalid");
  if (!allowAdminSignIn()) redirect("/admin/login?error=limited");
  const url = new URL(request.url);
  const payload: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!/^[a-z0-9_]{1,64}$/.test(key) || payload[key] !== undefined) redirect("/admin/login?error=invalid");
    payload[key] = value;
  }
  const identity = validateTelegramLogin(payload, token);
  if (!identity) redirect("/admin/login?error=invalid");
  if (!allowlist.has(identity.userId)) redirect("/admin/login?error=denied");
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, signAdminSession(identity.userId, token), adminCookieOptions(SESSION_TTL_SECONDS));
  redirect("/admin");
}

export async function POST(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const allowlist = adminTelegramIds();
  if (!token || allowlist.size === 0) {
    return json({ ok: false, message: "Admin sign-in is not configured." }, 503);
  }
  if (!requestFromThisSite(request)) {
    return json({ ok: false, message: "Sign-in has to start on this site." }, 403);
  }
  if (!allowAdminSignIn()) {
    return json({ ok: false, message: "Too many sign-in attempts. Wait a minute and try again." }, 429);
  }
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 4000) return json({ ok: false, message: "Telegram could not confirm this sign-in." }, 400);
    payload = JSON.parse(text) as unknown;
  } catch {
    return json({ ok: false, message: "Telegram could not confirm this sign-in." }, 400);
  }
  const identity = validateTelegramLogin(payload, token);
  if (!identity) return json({ ok: false, message: "Telegram could not confirm this sign-in." }, 401);
  if (!allowlist.has(identity.userId)) {
    return json({ ok: false, message: "This Telegram account cannot open the admin console." }, 403);
  }
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, signAdminSession(identity.userId, token), adminCookieOptions(SESSION_TTL_SECONDS));
  return json({ ok: true }, 200);
}

function json(body: { ok: boolean; message?: string }, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
