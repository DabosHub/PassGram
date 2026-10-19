import { readReferralState } from "@/lib/server/referralFlow";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function GET(request: Request) {
  try {
    const deps = await buildReferralDeps();
    const result = await readReferralState(deps, initDataFrom(request));
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
