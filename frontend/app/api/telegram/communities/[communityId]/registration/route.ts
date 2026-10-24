export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { confirmCommunityRegistration } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { OwnerKeyError } from "@/lib/server/ownerKey";

export async function POST(request: Request, context: { params: Promise<{ communityId: string }> }) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community is invalid." }, { status: 400 });
    }
    const body = (await request.json()) as { boc?: unknown };
    const boc = typeof body.boc === "string" ? body.boc.trim() : "";
    if (!boc) {
      return Response.json(
        { ok: false, message: "Your wallet did not sign RegisterCommunity. The community was not published." },
        { status: 400 },
      );
    }
    const deps = await buildChannelDeps();
    const result = await confirmCommunityRegistration(deps, initDataFrom(request), {
      communityId: Number(raw),
      boc,
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    if (error instanceof OwnerKeyError) {
      console.error("community authorization key is not configured");
      return Response.json(
        { ok: false, message: "PassGram could not approve this community for your wallet." },
        { status: 503 },
      );
    }
    return channelFailure(error);
  }
}
