import { listReferralEnabledCommunities } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure } from "@/lib/server/channelDeps";

export async function GET() {
  try {
    const deps = await buildChannelDeps();
    const result = await listReferralEnabledCommunities(deps);
    return Response.json(result);
  } catch (error) {
    return channelFailure(error);
  }
}
