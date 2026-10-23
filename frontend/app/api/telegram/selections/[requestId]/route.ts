export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { readChannelSelection } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  try {
    const { requestId } = await context.params;
    const parsed = Number(requestId);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      return Response.json({ ok: false, state: "verification_failed", message: "This channel selection could not be found." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    const result = await readChannelSelection(deps, initDataFrom(request), parsed);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
