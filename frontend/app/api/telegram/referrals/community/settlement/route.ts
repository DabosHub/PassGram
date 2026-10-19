import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import {
  getCommunityReferralRepository,
  resolveCommunityReferrerPayout,
} from "@/lib/server/communityReferralFlow";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const communityId = Number(url.searchParams.get("communityId"));
    if (!Number.isSafeInteger(communityId) || communityId < 1) {
      return Response.json({ ok: false, message: "Community id is required." }, { status: 400 });
    }
    const channelDeps = await buildChannelDeps();
    const referralDeps = await buildReferralDeps();
    const communityRepo = await getCommunityReferralRepository();
    const result = await resolveCommunityReferrerPayout(
      channelDeps,
      referralDeps,
      communityRepo,
      initDataFrom(request),
      communityId,
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
