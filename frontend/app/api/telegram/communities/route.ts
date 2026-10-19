import { createVerifiedCommunity, listOwnerCommunities } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function GET(request: Request) {
  try {
    const deps = await buildChannelDeps();
    const result = await listOwnerCommunities(deps, initDataFrom(request));
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    return channelFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      requestId?: unknown;
      price?: unknown;
      durationDays?: unknown;
      payoutAccount?: unknown;
    };
    const requestId = body.requestId;
    if (typeof requestId !== "number" || !Number.isSafeInteger(requestId)) {
      return Response.json({ ok: false, state: "verification_failed", message: "Verify a private channel before creating a community." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    const result = await createVerifiedCommunity(deps, initDataFrom(request), {
      requestId,
      price: typeof body.price === "string" ? body.price : "",
      durationDays: body.durationDays,
      payoutAccount: typeof body.payoutAccount === "string" ? body.payoutAccount : "",
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
