import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import {
  attributeCommunityReferral,
  getCommunityReferralRepository,
} from "@/lib/server/communityReferralFlow";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { communityId?: unknown; code?: unknown };
    const communityId = typeof body.communityId === "number" ? body.communityId : Number(body.communityId);
    const code = typeof body.code === "string" ? body.code : "";
    if (!Number.isSafeInteger(communityId) || communityId < 1 || !code.trim()) {
      return Response.json({ ok: false, message: "Community id and code are required." }, { status: 400 });
    }
    const channelDeps = await buildChannelDeps();
    const referralDeps = await buildReferralDeps();
    const communityRepo = await getCommunityReferralRepository();
    const result = await attributeCommunityReferral(
      channelDeps,
      referralDeps,
      communityRepo,
      initDataFrom(request),
      communityId,
      code,
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
