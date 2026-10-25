export const runtime = "nodejs";
export const maxDuration = 60;

import { runChainPass } from "@/lib/server/chainMaintenance";
import { cronRequestAuthorized } from "@/lib/server/cronAuth";

export async function GET(request: Request) {
  if (!cronRequestAuthorized(request)) {
    return Response.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  const result = await runChainPass();
  return Response.json({ ok: true, result });
}
