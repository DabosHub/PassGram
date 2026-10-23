export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { updateCommunityPaused } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request, context: { params: Promise<{ communityId: string }> }) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community is invalid." }, { status: 400 });
    }
    const body = (await request.json()) as { paused?: unknown };
    const deps = await buildChannelDeps();
    const result = await updateCommunityPaused(deps, initDataFrom(request), {
      communityId: Number(raw),
      paused: body.paused === true,
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
