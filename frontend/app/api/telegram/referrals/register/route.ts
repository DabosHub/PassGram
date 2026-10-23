export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { registerAffiliate } from "@/lib/server/referralFlow";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { readPayoutWalletProof } from "@/lib/ton/walletProof";

export async function POST(request: Request) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  try {
    const body = (await request.json()) as {
      proof?: unknown;
      telegramUsername?: unknown;
    };
    const proof = readPayoutWalletProof(body.proof);
    if (!proof) {
      return Response.json(
        { ok: false, message: "Sign with the wallet that should receive commissions. There is no network fee." },
        { status: 400 },
      );
    }
    const deps = await buildReferralDeps();
    const result = await registerAffiliate(
      deps,
      initDataFrom(request),
      proof,
      typeof body.telegramUsername === "string" ? body.telegramUsername : null,
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
