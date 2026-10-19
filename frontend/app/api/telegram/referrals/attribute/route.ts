import { attributeReferral } from "@/lib/server/referralFlow";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: unknown };
    const deps = await buildReferralDeps();
    const result = await attributeReferral(
      deps,
      initDataFrom(request),
      typeof body.code === "string" ? body.code : "",
      "mini_app",
    );
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
