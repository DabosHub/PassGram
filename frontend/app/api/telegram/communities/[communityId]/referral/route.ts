import { updateCommunityReferralSettings } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request, context: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community is invalid." }, { status: 400 });
    }
    const body = (await request.json()) as { enabled?: unknown; percent?: unknown };
    const enabled = Boolean(body.enabled);
    const percent = body.percent == null ? "" : String(body.percent);
    const deps = await buildChannelDeps();
    const result = await updateCommunityReferralSettings(deps, initDataFrom(request), {
      communityId: Number(raw),
      enabled,
      percent,
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
