export const runtime = "nodejs";

import { limitedResponse } from "@/lib/server/rateLimit";
import { ingestTelegramUpdate, readChannelSelection } from "@/lib/server/channelFlow";
import { buildChannelDeps, channelFailure, ChannelConfigError, initDataFrom } from "@/lib/server/channelDeps";
import { attributeFromWebhook } from "@/lib/server/referralFlow";
import { buildReferralDeps } from "@/lib/server/referralDeps";
import { recoverUndeliveredUpdates, webhookOrigin, webhookSecret } from "@/lib/server/telegramWebhook";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const limited = limitedResponse(request, "read");
  if (limited) return limited;
  try {
    const { requestId } = await context.params;
    const parsed = Number(requestId);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      return Response.json({ ok: false, state: "verification_failed", message: "This channel selection could not be found." }, { status: 400 });
    }
    const deps = await buildChannelDeps();
    try {
      await recoverUndeliveredUpdates(
        {
          telegram: deps.telegram,
          ingest: async (update) => {
            try {
              const referralDeps = await buildReferralDeps();
              await attributeFromWebhook(referralDeps, update);
            } catch (error) {
              if (!(error instanceof ChannelConfigError)) throw error;
            }
            await ingestTelegramUpdate(deps, update);
          },
        },
        {
          secret: webhookSecret(),
          webhookUrl: `${webhookOrigin(request.url)}/api/telegram/webhook`,
        },
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      console.error("telegram webhook recovery failed", name);
    }
    const result = await readChannelSelection(deps, initDataFrom(request), parsed);
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return channelFailure(error);
  }
}
