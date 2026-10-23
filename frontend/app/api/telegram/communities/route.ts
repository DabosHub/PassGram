export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { createVerifiedCommunity, listOwnerCommunities } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";
import { tonWalletKey } from "@/lib/ton/walletKey";

export async function GET(request: Request) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  try {
    const deps = await buildChannelDeps();
    const result = await listOwnerCommunities(deps, initDataFrom(request));
    return Response.json(result, { status: result.ok ? 200 : 401 });
  } catch (error) {
    return channelFailure(error);
  }
}

export async function POST(request: Request) {
  const limited = limitedResponse(request, "write");
  if (limited) return limited;
  try {
    const body = (await request.json()) as {
      requestId?: unknown;
      price?: unknown;
      durationDays?: unknown;
      creatorWallet?: unknown;
      payoutAccount?: unknown;
    };
    const requestId = body.requestId;
    if (typeof requestId !== "number" || !Number.isSafeInteger(requestId)) {
      return Response.json({ ok: false, state: "verification_failed", message: "Verify a private channel before creating a community." }, { status: 400 });
    }
    const creatorWallet = typeof body.creatorWallet === "string" ? body.creatorWallet : "";
    const legacyPayout = typeof body.payoutAccount === "string" ? body.payoutAccount : "";
    if (!creatorWallet) {
      return Response.json(
        { ok: false, state: "verification_failed", message: "Connect your TON wallet. Subscription payments are sent to that wallet." },
        { status: 400 },
      );
    }
    if (legacyPayout) {
      const left = tonWalletKey(legacyPayout);
      const right = tonWalletKey(creatorWallet);
      if (!left || !right || left !== right) {
        return Response.json(
          { ok: false, state: "verification_failed", message: "Subscription payments are sent to the wallet that registers this community." },
          { status: 400 },
        );
      }
    }
    const deps = await buildChannelDeps();
    const result = await createVerifiedCommunity(deps, initDataFrom(request), {
      requestId,
      price: typeof body.price === "string" ? body.price : "",
      durationDays: body.durationDays,
      creatorWallet,
    });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
