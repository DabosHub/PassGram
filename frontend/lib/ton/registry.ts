import { Address, beginCell } from "@ton/core";

/** opcode "SCRF" — SetCommunityReferral */
export const OP_SET_COMMUNITY_REFERRAL = 0x53435246;
/** opcode "SUBS" — subscribe / payment forward payload */
export const OP_SUBSCRIBE = 0x53554253;
/** opcode "REGC" — creator wallet registers the community. */
export const OP_REGISTER_COMMUNITY = 0x52454743;
/** opcode "UPDC" — creator wallet updates subscription price and duration. */
export const OP_UPDATE_COMMUNITY = 0x55504443;
/** opcode "SCPS" — creator wallet pauses or resumes the community. */
export const OP_SET_COMMUNITY_PAUSED = 0x53435053;
/**
 * RegisterCommunity body. The signing wallet must equal `creator`.
 * Layout matches the Tact wrapper: inline fields, then one ref holding the optional
 * referrer, bps, access mode, and the owner's 64-byte authorization.
 */
export function buildRegisterCommunityBody(input: {
  communityId: number;
  creator: string;
  payout: string;
  price: string;
  durationSeconds: number;
  /** PassGram referrer payout wallet. The contract stores this address and pays it from the platform fee. */
  platformMarketer?: string | null;
  /** Rate stored for this community. Registration sends the database value. */
  communityReferralBps?: number;
  /** Base64 Ed25519 signature by the registry owner over every stored registration field. */
  authorization: string;
}): string {
  const signature = Buffer.from(input.authorization, "base64");
  if (signature.length !== 64) throw new Error("Owner authorization must be 64 bytes.");
  const marketer = input.platformMarketer?.trim();
  const tail = beginCell()
    .storeAddress(marketer ? Address.parse(marketer) : null)
    .storeUint(input.communityReferralBps ?? 0, 16)
    .storeUint(0, 8)
    .storeBuffer(signature)
    .endCell();
  const cell = beginCell()
    .storeUint(OP_REGISTER_COMMUNITY, 32)
    .storeUint(input.communityId, 64)
    .storeAddress(Address.parse(input.creator))
    .storeAddress(Address.parse(input.payout))
    .storeCoins(BigInt(input.price))
    .storeUint(input.durationSeconds, 32)
    .storeRef(tail)
    .endCell();
  return cell.toBoc().toString("base64");
}

/**
 * UpdateCommunity body. Only the wallet that registered the community can send it.
 * payout receives that creator's share on later subscriptions and renewals.
 */
export function buildUpdateCommunityBody(input: {
  communityId: number;
  price: string;
  durationSeconds: number;
  payout: string;
}): string {
  const cell = beginCell()
    .storeUint(OP_UPDATE_COMMUNITY, 32)
    .storeUint(0, 64)
    .storeUint(input.communityId, 64)
    .storeCoins(BigInt(input.price))
    .storeUint(input.durationSeconds, 32)
    .storeAddress(Address.parse(input.payout))
    .endCell();
  return cell.toBoc().toString("base64");
}

/**
 * Body for SetCommunityReferral on PassGramRegistry.
 * Creator wallet sets the current community referral rate (1–5000 bps) or
 * stops new referrals with 0. A stop does not erase rates already locked.
 */
/** SetCommunityPaused body. Only the creation wallet can send it. */
export function buildSetCommunityPausedBody(communityId: number, paused: boolean): string {
  const cell = beginCell()
    .storeUint(OP_SET_COMMUNITY_PAUSED, 32)
    .storeUint(0, 64)
    .storeUint(communityId, 64)
    .storeBit(paused)
    .endCell();
  return cell.toBoc().toString("base64");
}

export function buildSetCommunityReferralBody(communityId: number, communityReferralBps: number): string {
  const cell = beginCell()
    .storeUint(OP_SET_COMMUNITY_REFERRAL, 32)
    .storeUint(0, 64) // query id
    .storeUint(communityId, 64)
    .storeUint(communityReferralBps, 16)
    .endCell();
  return cell.toBoc().toString("base64");
}

/**
 * Jetton forward payload for subscribe.
 * The optional address is the community referrer's payout wallet from the database.
 * validUntil and the owner signature authorize that address for this payment.
 * PassGram's affiliate is not named here. It is stored on the community at registration.
 */
export function buildSubscribeForwardPayload(input: {
  communityId: number;
  /** Community referrer payout wallet. The contract applies the community's current rate. */
  communityReferrerAddress?: string | null;
  /** Unix time after which the contract rejects this payment. */
  validUntil: number;
  /** Base64 Ed25519 signature by the registry owner over the referral authorization cell. */
  authorization: string;
}): string {
  const signature = Buffer.from(input.authorization, "base64");
  if (signature.length !== 64) throw new Error("Referral authorization must be 64 bytes.");
  if (!Number.isSafeInteger(input.validUntil) || input.validUntil < 0 || input.validUntil > 0xffffffff) {
    throw new Error("Referral authorization expiry is invalid.");
  }
  const builder = beginCell().storeUint(OP_SUBSCRIBE, 32).storeUint(input.communityId, 64);

  const ref = input.communityReferrerAddress?.trim();
  if (ref) {
    builder.storeBit(true).storeAddress(Address.parse(ref));
  } else {
    builder.storeBit(false);
  }
  builder.storeUint(input.validUntil, 32).storeBuffer(signature);

  return builder.endCell().toBoc().toString("base64");
}
