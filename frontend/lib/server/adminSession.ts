import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminTelegramIds, readAdminSession } from "./adminAuth";

export async function currentAdmin(): Promise<{ userId: number } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  if (!token) return null;
  const jar = await cookies();
  return readAdminSession(jar.get(ADMIN_COOKIE)?.value, token, adminTelegramIds());
}
