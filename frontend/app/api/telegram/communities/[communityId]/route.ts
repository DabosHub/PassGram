import { getPublicCommunityListing } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure } from "@/lib/server/channelDeps";

export async function GET(_request: Request, context: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community link is invalid." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    const result = await getPublicCommunityListing(deps, Number(raw));
    if (!result.ok) return Response.json(result, { status: 404 });
    return Response.json(result);
  } catch (error) {
    return channelFailure(error);
  }
}
