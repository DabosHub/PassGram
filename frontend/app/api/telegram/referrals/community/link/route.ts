import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { createCommunityReferralLink } from "@/lib/server/communityReferralFlow";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { communityId?: unknown; payoutAccount?: unknown };
    const communityId = typeof body.communityId === "number" ? body.communityId : Number(body.communityId);
    const payoutAccount = typeof body.payoutAccount === "string" ? body.payoutAccount : "";
    if (!Number.isSafeInteger(communityId) || communityId < 1) {
      return Response.json({ ok: false, message: "Community id is required." }, { status: 400 });
    }
    const channelDeps = await buildChannelDeps();
    const result = await createCommunityReferralLink(channelDeps, initDataFrom(request), communityId, payoutAccount);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
