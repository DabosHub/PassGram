import { registerAffiliate } from "@/lib/server/referralFlow";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      payoutAccount?: unknown;
      telegramUsername?: unknown;
      signerAddress?: unknown;
    };
    const deps = await buildReferralDeps();
    const result = await registerAffiliate(
      deps,
      initDataFrom(request),
      typeof body.payoutAccount === "string" ? body.payoutAccount : "",
      typeof body.telegramUsername === "string" ? body.telegramUsername : null,
      typeof body.signerAddress === "string" ? body.signerAddress : null,
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
