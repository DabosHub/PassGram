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
    // Same rule as community creation: a valid address is payable before the account is deployed.
    accountStatus: async (accountId) => (isTonAddress(accountId) ? "implicit" : "missing"),
  };
}
