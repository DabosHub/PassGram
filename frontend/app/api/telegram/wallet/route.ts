export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { ChannelConfigError } from "@/lib/server/channelDeps";
import { linkedSubscriberWallet, linkSubscriberWallet } from "@/lib/server/membershipFlow";
import { readPayoutWalletProof } from "@/lib/ton/walletProof";

export async function GET(request: Request) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  try {
    const result = await linkedSubscriberWallet(request.headers.get("x-telegram-init-data") || "", botToken);
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("wallet lookup failed");
    return Response.json({ ok: false, message: "Wallet could not be confirmed." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json({ ok: false, message: "PassGramBot is not configured." }, { status: 503 });
  }
  let proof = null;
  try {
    const body = (await request.json()) as { proof?: unknown };
    proof = readPayoutWalletProof(body.proof);
  } catch {
    proof = null;
  }
  try {
    const result = await linkSubscriberWallet(request.headers.get("x-telegram-init-data") || "", botToken, proof);
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    if (error instanceof ChannelConfigError) {
      return Response.json({ ok: false, message: error.message }, { status: 503 });
    }
    console.error("wallet link failed");
    return Response.json({ ok: false, message: "Wallet could not be linked." }, { status: 500 });
  }
}
