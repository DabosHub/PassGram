export const runtime = "nodejs";
export const maxDuration = 60;

import { limitedResponse } from "@/lib/server/rateLimit";
import { ChannelConfigError } from "@/lib/server/channelDeps";
import { validateInitData } from "@/lib/server/initData";
import { readSubscriberLedger } from "@/lib/server/membershipFlow";
import { awaitChainPass, CHAIN_PASS_WAIT_MS } from "@/lib/server/chainMaintenance";
import { readSubscriberAccess } from "@/lib/server/subscriberAccessFlow";

export async function GET(request: Request) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const identity = validateInitData(initData, botToken);
    if (!identity) {
      return Response.json(
        { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." },
        { status: 401 },
      );
    }
    let pass: "ran" | "skipped" | "busy" | "timeout" = "skipped";
    try {
      pass = await awaitChainPass(CHAIN_PASS_WAIT_MS);
    } catch {
      console.error("chain pass failed");
    }
    const result = await readSubscriberLedger(initData, botToken);
    if (!result.ok) return Response.json(result, { status: 401 });
    const freshMember = request.headers.get("x-passgram-fresh-member") === "1";
    const access = await readSubscriberAccess(botToken, identity.userId, undefined, {
      fresh: freshMember,
      recoverInvites: pass !== "timeout",
    });
    return Response.json({ ...result, access });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("subscriber ledger failed");
    return Response.json({ ok: false, message: "Subscription data could not be loaded." }, { status: 500 });
  }
}
