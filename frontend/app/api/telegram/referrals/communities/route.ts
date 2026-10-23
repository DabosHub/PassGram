export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { listReferralEnabledCommunities } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure } from "@/lib/server/channelDeps";

export async function GET(request: Request) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  try {
    const deps = await buildChannelDeps();
    const result = await listReferralEnabledCommunities(deps);
    return Response.json(result);
  } catch (error) {
    return channelFailure(error);
  }
}
