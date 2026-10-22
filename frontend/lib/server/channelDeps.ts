import { getChannelRepository, ChannelConfigError } from "./channelRepository";
import type { ChannelDeps } from "./channelFlow";
import { getMembershipRepository } from "./membershipRepository";
import { getReferralRepository } from "./referralRepository";
import { createTelegramClient } from "./telegramClient";
import { isTonAddress } from "../ton/config";

export { ChannelConfigError };

export async function buildChannelDeps(): Promise<ChannelDeps> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new ChannelConfigError("PassGramBot is not configured. Set TELEGRAM_BOT_TOKEN on the server. The token is never sent to the Mini App.");
  }
  const repo = await getChannelRepository();
  const referralRepo = await getReferralRepository();
  const telegram = createTelegramClient(botToken);
  let botUserId = process.env.PASSGRAM_BOT_USER_ID || "";
  if (!botUserId) {
    const me = await telegram.call("getMe");
    if (typeof me?.id !== "number") throw new ChannelConfigError("PassGramBot did not return its user id. Set PASSGRAM_BOT_USER_ID.");
    botUserId = String(me.id);
  }
  return {
    repo,
    telegram,
    botToken,
    botUserId,
    now: () => Date.now(),
    listCurrentSubscriberIds: async (communityId, nowMs) => {
      const members = await getMembershipRepository();
      return members.listCurrentSubscriberIds(communityId, nowMs);
    },
    accountStatus: async (accountId) => (isTonAddress(accountId) ? "exists" : "missing"),
    getCreatorAttribution: async (telegramUserId) => {
      const attribution = await referralRepo.getAttribution(telegramUserId);
      if (!attribution) return null;
      const affiliate = await referralRepo.getAffiliateByCode(attribution.referrerCode);
      return {
        referrerCode: attribution.referrerCode,
        referrerTelegramUserId: attribution.referrerTelegramUserId,
        referrerPayout: affiliate?.payoutAccount || null,
      };
    },
  };
}

export function initDataFrom(request: Request): string {
  return request.headers.get("x-telegram-init-data") || "";
}

export function channelFailure(error: unknown): Response {
  if (error instanceof ChannelConfigError) {
    return Response.json({ ok: false, state: "verification_failed", message: error.message }, { status: 503 });
  }
  console.error("channel request failed");
  return Response.json(
    { ok: false, state: "verification_failed", message: "The channel request could not be completed." },
    { status: 500 },
  );
}
