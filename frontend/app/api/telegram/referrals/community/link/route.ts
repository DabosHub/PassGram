export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { createCommunityReferralLink } from "@/lib/server/communityReferralFlow";
import { readPayoutWalletProof } from "@/lib/ton/walletProof";

export async function POST(request: Request) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  try {
    const body = (await request.json()) as { communityId?: unknown; proof?: unknown };
    const communityId = typeof body.communityId === "number" ? body.communityId : Number(body.communityId);
    const proof = readPayoutWalletProof(body.proof);
    if (!Number.isSafeInteger(communityId) || communityId < 1) {
      return Response.json({ ok: false, message: "Community id is required." }, { status: 400 });
    }
    if (!proof) {
      return Response.json(
        { ok: false, message: "Sign with the wallet that should receive commissions. There is no network fee." },
        { status: 400 },
      );
    }
    const channelDeps = await buildChannelDeps();
    const result = await createCommunityReferralLink(channelDeps, initDataFrom(request), communityId, proof);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
