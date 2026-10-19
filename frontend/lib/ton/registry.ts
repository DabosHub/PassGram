import { Address, beginCell } from "@ton/core";

/** opcode "SCRF" — SetCommunityReferral */
export const OP_SET_COMMUNITY_REFERRAL = 0x53435246;
/** opcode "SUBS" — subscribe / payment forward payload */
export const OP_SUBSCRIBE = 0x53554253;

/**
 * Body for SetCommunityReferral on PassGramRegistry.
 * Creator (or owner) sets communityReferralBps (0 disables).
 */
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
 * Jetton forward payload for subscribe:
 * opcode + communityId + hasPlatformReferrer + hasCommunityReferrer [+ communityReferrer address].
 */
export function buildSubscribeForwardPayload(input: {
  communityId: number;
  hasPlatformReferrer?: boolean;
  communityReferrerAddress?: string | null;
}): string {
  const builder = beginCell()
    .storeUint(OP_SUBSCRIBE, 32)
    .storeUint(input.communityId, 64)
    .storeBit(Boolean(input.hasPlatformReferrer));

  const ref = input.communityReferrerAddress?.trim();
  if (ref) {
    builder.storeBit(true).storeAddress(Address.parse(ref));
  } else {
    builder.storeBit(false);
  }

  return builder.endCell().toBoc().toString("base64");
}
