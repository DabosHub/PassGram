import { ChannelConfigError } from "@/lib/server/channelDeps";
import { validateInitData } from "@/lib/server/initData";
import { readSubscriberLedger } from "@/lib/server/membershipFlow";
import { readSubscriberAccess } from "@/lib/server/subscriberAccessFlow";

export async function GET(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  try {
    const initData = request.headers.get("x-telegram-init-data") || "";
    const result = await readSubscriberLedger(initData, botToken);
    if (!result.ok) return Response.json(result, { status: 401 });
    const identity = validateInitData(initData, botToken);
    const access = identity ? await readSubscriberAccess(botToken, identity.userId) : [];
    return Response.json({ ...result, access });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("subscriber ledger failed");
    return Response.json({ ok: false, message: "Subscription data could not be loaded." }, { status: 500 });
  }
}
