import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { createCommunityReferralLink } from "@/lib/server/communityReferralFlow";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { communityId?: unknown };
    const communityId = typeof body.communityId === "number" ? body.communityId : Number(body.communityId);
    if (!Number.isSafeInteger(communityId) || communityId < 1) {
      return Response.json({ ok: false, message: "Community id is required." }, { status: 400 });
    }
    const channelDeps = await buildChannelDeps();
    const referralDeps = await buildReferralDeps();
    const result = await createCommunityReferralLink(channelDeps, referralDeps, initDataFrom(request), communityId);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
