import { Address, beginCell, Cell } from "@ton/core";

/** Tag "AUTH". The contract rebuilds this cell and checks the owner's signature of its hash. */
export const COMMUNITY_AUTHORIZATION_TAG = 0x41555448;
/** Tag "CREF". The contract rebuilds this cell from the subscribe payload and checks the owner's signature. */
export const COMMUNITY_REFERRAL_AUTHORIZATION_TAG = 0x43524546;
/** Seconds a subscribe signature stays valid. The contract rejects a later payment. */
export const COMMUNITY_REFERRAL_AUTHORIZATION_TTL_SECONDS = 600;

/**
 * Cell the registry owner signs before RegisterCommunity is accepted.
 * It binds this contract and every field the registration stores.
 * The payout terms sit in a reference so a marketer address still fits in the cell.
 * An empty PassGram marketer is one zero bit, matching the contract.
 */
export function buildCommunityAuthorizationCell(input: {
  registry: string;
  communityId: number;
  creator: string;
  payout: string;
  price: string;
  durationSeconds: number;
  platformMarketer?: string | null;
  communityReferralBps: number;
  accessMode: number;
}): Cell {
  const tail = beginCell()
    .storeAddress(Address.parse(input.payout))
    .storeCoins(BigInt(input.price))
    .storeUint(input.durationSeconds, 32);
  const marketer = input.platformMarketer?.trim();
  if (marketer) tail.storeBit(true).storeAddress(Address.parse(marketer));
  else tail.storeBit(false);
  tail.storeUint(input.communityReferralBps, 16).storeUint(input.accessMode, 8);
  return beginCell()
    .storeUint(COMMUNITY_AUTHORIZATION_TAG, 32)
    .storeAddress(Address.parse(input.registry))
    .storeUint(input.communityId, 64)
    .storeAddress(Address.parse(input.creator))
    .storeRef(tail.endCell())
    .endCell();
}

/**
 * Cell the registry owner signs for one subscription payment.
 * It binds this contract, the community, the paying wallet, the payout (or none), and the expiry.
 * An empty payout is one zero bit, matching the contract.
 */
export function buildCommunityReferralAuthorizationCell(input: {
  registry: string;
  communityId: number;
  subscriber: string;
  payout?: string | null;
  validUntil: number;
}): Cell {
  const builder = beginCell()
    .storeUint(COMMUNITY_REFERRAL_AUTHORIZATION_TAG, 32)
    .storeAddress(Address.parse(input.registry))
    .storeUint(input.communityId, 64)
    .storeAddress(Address.parse(input.subscriber));
  const payout = input.payout?.trim();
  if (payout) builder.storeBit(true).storeAddress(Address.parse(payout));
  else builder.storeBit(false);
  builder.storeUint(input.validUntil, 32);
  return builder.endCell();
}
