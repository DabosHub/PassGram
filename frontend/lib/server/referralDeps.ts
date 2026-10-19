import { ChannelConfigError } from "./channelRepository";
import { getReferralRepository } from "./referralRepository";
import type { ReferralDeps } from "./referralFlow";
import { isTonAddress } from "../ton/config";

export async function buildReferralDeps(): Promise<ReferralDeps> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new ChannelConfigError("PassGramBot is not configured. Set TELEGRAM_BOT_TOKEN on the server. The token is never sent to the Mini App.");
  }
  const repo = await getReferralRepository();
  return {
    repo,
    botToken,
    now: () => Date.now(),
    accountStatus: async (accountId) => (isTonAddress(accountId) ? "exists" : "missing"),
  };
}
