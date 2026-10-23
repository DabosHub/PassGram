export const runtime = "nodejs";

import crypto from "node:crypto";
import { ingestTelegramUpdate } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, ChannelConfigError } from "@/lib/server/channelDeps";
import { attributeFromWebhook } from "@/lib/server/referralFlow";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { webhookSecret } from "@/lib/server/telegramWebhook";

export async function POST(request: Request) {
  const expected = webhookSecret();
  if (!expected) {
    return Response.json(
      { ok: false, message: "Set TELEGRAM_WEBHOOK_SECRET and register it with setWebhook before accepting updates." },
      { status: 503 },
    );
  }
  const received = request.headers.get("x-telegram-bot-api-secret-token") || "";
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const update = await request.json();
    try {
      const referralDeps = await buildReferralDeps();
      await attributeFromWebhook(referralDeps, update);
    } catch (error) {
      if (!(error instanceof ChannelConfigError)) throw error;
    }
    const deps = await buildChannelDeps();
    await ingestTelegramUpdate(deps, update);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ChannelConfigError) return channelFailure(error);
    console.error("telegram webhook failed");
    return Response.json({ ok: false }, { status: 500 });
  }
}
