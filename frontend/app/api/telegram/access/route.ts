import { recheckChannelAccess } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, initDataFrom } from "@/lib/server/channelDeps";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { telegramChatId?: unknown };
    if (typeof body.telegramChatId !== "string" || !/^-?\d+$/.test(body.telegramChatId)) {
      return Response.json({ ok: false, state: "verification_failed", message: "This community could not be found." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    const result = await recheckChannelAccess(deps, initDataFrom(request), body.telegramChatId);
    return Response.json(result, { status: result.allowed ? 200 : 409 });
  } catch (error) {
    return channelFailure(error);
  }
}
