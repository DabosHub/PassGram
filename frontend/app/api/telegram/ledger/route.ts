export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { ChannelConfigError } from "@/lib/server/channelDeps";
import { readOwnerLedger } from "@/lib/server/membershipFlow";

export async function GET(request: Request) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  try {
    const result = await readOwnerLedger(request.headers.get("x-telegram-init-data") || "", botToken);
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("owner ledger failed");
    return Response.json({ ok: false, message: "Community data could not be loaded." }, { status: 500 });
  }
}
