import { Address } from "@ton/core";
import { configuredRegistry, isTonAddress } from "../ton/config";
import { buildCommunityAuthorizationCell, buildCommunityReferralAuthorizationCell } from "../ton/communityAuthorization";
import { validateInitData } from "./initData";
import type { ChannelDeps } from "./channelFlow";
import { OwnerKeyError, ownerSeedFromEnv, signAuthorizationHash } from "./ownerKey";
import { requireCurrentRegistry } from "./registryCode";

export type CommunityAuthorizationResult =
  | {
      ok: true;
      signature: string;
      creator: string;
      payout: string;
      price: string;
      durationSeconds: number;
      platformMarketer: string | null;
      communityReferralBps: number;
      accessMode: 0;
    }
  | { ok: false; message: string };

export type ReferralAuthorizationResult =
  | { ok: true; signature: string }
  | { ok: false; message: string };

/**
 * Signs every field RegisterCommunity stores, using the community row and the PassGram referrer.
 * The creator wallet is the connected wallet that will send the message.
 * The contract accepts the message only when those fields still match.
 */
export async function authorizeCommunityRegistration(
  deps: ChannelDeps,
  initData: string,
  input: { communityId: number; creator: string },
): Promise<CommunityAuthorizationResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  if (!Number.isSafeInteger(input.communityId) || input.communityId < 1) {
    return { ok: false, message: "This community is invalid." };
  }
  const creator = input.creator.trim();
  if (!isTonAddress(creator)) return { ok: false, message: "Connect your TON wallet before registering this community." };
  const channel = await deps.repo.getChannelByCommunityId(input.communityId);
  if (!channel || channel.ownerTelegramUserId !== String(identity.userId)) {
    return { ok: false, message: "This community is not yours." };
  }
  const price = (channel.priceUsdt || "").trim();
  const durationDays = channel.durationDays;
  const payout = (channel.payoutAccount || "").trim();
  if (!/^\d+$/.test(price) || BigInt(price) <= 0n || durationDays == null || !isTonAddress(payout)) {
    return { ok: false, message: "This community has no saved price, duration, or payout, so it was not approved." };
  }
  const durationSeconds = durationDays * 86_400;
  const communityReferralBps = channel.referralPercentBps;
  if (!Number.isSafeInteger(communityReferralBps) || communityReferralBps < 0 || communityReferralBps > 5000) {
    return { ok: false, message: "This community referral rate cannot be approved." };
  }
  let platformMarketer: string | null = null;
  if (channel.referrerTelegramUserId && deps.getCreatorAttribution) {
    const attribution = await deps.getCreatorAttribution(channel.ownerTelegramUserId);
    if (attribution?.referrerTelegramUserId === channel.referrerTelegramUserId && attribution.referrerPayout) {
      if (!isTonAddress(attribution.referrerPayout)) {
        return { ok: false, message: "The PassGram referrer payout is not a TON address, so this community was not approved." };
      }
      platformMarketer = attribution.referrerPayout;
    }
  }
  const registry = configuredRegistry();
  if (!registry || !isTonAddress(registry)) {
    return { ok: false, message: "The registry contract is not configured, so this community cannot be approved." };
  }
  const current = await requireCurrentRegistry();
  if (!current.ok) return { ok: false, message: current.message };
  let creatorAddress: Address;
  let registryAddress: Address;
  let payoutAddress: Address;
  let marketerAddress: Address | null = null;
  try {
    creatorAddress = Address.parse(creator);
    registryAddress = Address.parse(registry);
    payoutAddress = Address.parse(payout);
    if (platformMarketer) marketerAddress = Address.parse(platformMarketer);
  } catch {
    return { ok: false, message: "Connect your TON wallet before registering this community." };
  }
  if (!creatorAddress.equals(payoutAddress)) {
    return { ok: false, message: "Subscription payments go to the wallet that registers this community. Connect that wallet." };
  }
  const signedCreator = creatorAddress.toString();
  const signedPayout = signedCreator;
  const signedMarketer = marketerAddress ? marketerAddress.toString() : null;
  const cell = buildCommunityAuthorizationCell({
    registry: registryAddress.toString(),
    communityId: input.communityId,
    creator: signedCreator,
    payout: signedPayout,
    price,
    durationSeconds,
    platformMarketer: signedMarketer,
    communityReferralBps,
    accessMode: 0,
  });
  const signature = signAuthorizationHash(ownerSeedFromEnv(), cell.hash());
  return {
    ok: true,
    signature: signature.toString("base64"),
    creator: signedCreator,
    payout: signedPayout,
    price,
    durationSeconds,
    platformMarketer: signedMarketer,
    communityReferralBps,
    accessMode: 0,
  };
}

export { OwnerKeyError };

/**
 * Signs the community payout for the wallet that will send the USDT.
 * The payout comes from the referral link. The client does not choose it.
 */
export function signCommunityReferralAuthorization(input: {
  communityId: number;
  subscriber: string;
  payout?: string | null;
  validUntil: number;
}): ReferralAuthorizationResult {
  const registry = configuredRegistry();
  if (!registry || !isTonAddress(registry)) {
    return { ok: false, message: "The registry contract is not configured, so this payment was not sent." };
  }
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil < 0 || input.validUntil > 0xffffffff) {
    return { ok: false, message: "Referral settlement could not be confirmed. The payment was not sent." };
  }
  let subscriberAddress: Address;
  let registryAddress: Address;
  let payoutAddress: Address | null = null;
  try {
    subscriberAddress = Address.parse(input.subscriber);
    registryAddress = Address.parse(registry);
    const payout = input.payout?.trim();
    if (payout) payoutAddress = Address.parse(payout);
  } catch {
    return { ok: false, message: "Connect your TON wallet before paying." };
  }
  try {
    const cell = buildCommunityReferralAuthorizationCell({
      registry: registryAddress.toString(),
      communityId: input.communityId,
      subscriber: subscriberAddress.toString(),
      payout: payoutAddress ? payoutAddress.toString() : null,
      validUntil: input.validUntil,
    });
    const signature = signAuthorizationHash(ownerSeedFromEnv(), cell.hash());
    return { ok: true, signature: signature.toString("base64") };
  } catch (error) {
    if (error instanceof OwnerKeyError) {
      return { ok: false, message: "The registry owner key is not configured, so this payment was not sent." };
    }
    throw error;
  }
}
