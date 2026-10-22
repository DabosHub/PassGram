import { updateCommunityOffer } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request, context: { params: Promise<{ communityId: string }> }) {
  try {
    const { communityId: raw } = await context.params;
    if (!/^[1-9]\d{0,11}$/.test(raw)) {
      return Response.json({ ok: false, message: "This community is invalid." }, { status: 400 });
    }
    const body = (await request.json()) as { price?: unknown; durationDays?: unknown; payoutAccount?: unknown };
    const deps = await buildChannelDeps();
    const result = await updateCommunityOffer(deps, initDataFrom(request), {
      communityId: Number(raw),
      price: typeof body.price === "string" ? body.price : "",
      durationDays: body.durationDays,
      payoutAccount: typeof body.payoutAccount === "string" ? body.payoutAccount : "",
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
