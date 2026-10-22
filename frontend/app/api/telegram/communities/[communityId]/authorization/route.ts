import { authorizeCommunityRegistration, OwnerKeyError } from "@/lib/server/communityAuthorization";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request, context: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community is invalid." }, { status: 400 });
    }
    const body = (await request.json()) as { creator?: unknown };
    const creator = typeof body.creator === "string" ? body.creator : "";
    const deps = await buildChannelDeps();
    const result = await authorizeCommunityRegistration(deps, initDataFrom(request), {
      communityId: Number(raw),
      creator,
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
