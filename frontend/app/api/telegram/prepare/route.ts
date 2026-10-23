export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { prepareChannelSelection } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  try {
    const deps = await buildChannelDeps();
    const result = await prepareChannelSelection(deps, initDataFrom(request));
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
