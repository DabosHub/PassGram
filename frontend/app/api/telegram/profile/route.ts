export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { ChannelConfigError } from "@/lib/server/channelDeps";
import { saveTelegramProfile } from "@/lib/server/membershipFlow";

export async function POST(request: Request) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  try {
    const result = await saveTelegramProfile(request.headers.get("x-telegram-init-data") || "", botToken);
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("telegram profile save failed");
    return Response.json({ ok: false, message: "Telegram profile could not be saved." }, { status: 500 });
  }
}
