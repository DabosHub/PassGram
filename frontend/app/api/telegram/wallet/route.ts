import { ChannelConfigError } from "@/lib/server/channelDeps";
import { linkSubscriberWallet } from "@/lib/server/membershipFlow";

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  let address = "";
  try {
    const body = (await request.json()) as { address?: unknown };
    address = typeof body.address === "string" ? body.address : "";
  } catch {
    address = "";
  }
  try {
    const result = await linkSubscriberWallet(request.headers.get("x-telegram-init-data") || "", botToken, address);
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("wallet link failed");
    return Response.json({ ok: false, message: "Wallet could not be linked." }, { status: 500 });
  }
}
