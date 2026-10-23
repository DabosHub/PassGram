export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import {
  getCommunityReferralRepository,
  resolveCommunityReferrerPayout,
} from "@/lib/server/communityReferralFlow";

export async function GET(request: Request) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  try {
    const url = new URL(request.url);
    const communityId = Number(url.searchParams.get("communityId"));
    const wallet = (url.searchParams.get("wallet") || "").trim();
    if (!Number.isSafeInteger(communityId) || communityId < 1) {
      return Response.json({ ok: false, message: "Community id is required." }, { status: 400 });
    }
    if (!wallet) {
      return Response.json({ ok: false, message: "Connect your TON wallet before paying." }, { status: 400 });
    }
    const channelDeps = await buildChannelDeps();
    const communityRepo = await getCommunityReferralRepository();
    const result = await resolveCommunityReferrerPayout(
      channelDeps,
      communityRepo,
      initDataFrom(request),
      communityId,
      wallet,
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
