import { Address, beginCell, Cell } from "@ton/core";

/** Gasless TON Connect signData schema. The CRC of this exact string is part of the signature. */
export const PAYOUT_WALLET_SCHEMA =
  "payout_wallet#50724757 purpose:uint8 community_id:uint64 telegram_user_id:uint64 wallet:MsgAddress = PayoutWallet";

/** PassGram referral link. */
export const PAYOUT_PROOF_AFFILIATE = 1;
/** Community referral link. */
export const PAYOUT_PROOF_COMMUNITY = 2;
/** Links this wallet to the signing Telegram account. It does not assign a commission. */
export const ACCOUNT_LINK_PURPOSE = 3;
export const ACCOUNT_WALLET_SCHEMA =
  "account_wallet#41636374 purpose:uint8 community_id:uint64 telegram_user_id:uint64 wallet:MsgAddress = AccountWallet";
export const ACCOUNT_LINK_TAG = 0x41636374;

export const PAYOUT_PROOF_TTL_SECONDS = 600;

export type PayoutProofPurpose =
  | typeof PAYOUT_PROOF_AFFILIATE
  | typeof PAYOUT_PROOF_COMMUNITY
  | typeof ACCOUNT_LINK_PURPOSE;

export type PayoutWalletProof = {
  signature: string;
  address: string;
  timestamp: number;
  domain: string;
  schema: string;
  cell: string;
  walletStateInit: string;
};

/** IEEE CRC-32. TON Connect hashes the schema string with this polynomial. */
export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** TEP-81 DNS wire form: labels reversed, each ending in a zero byte. */
export function encodeDnsDomain(domain: string): string {
  return domain
    .trim()
    .replace(/\.$/, "")
    .split(".")
    .reverse()
    .map((label) => `${label}\0`)
    .join("");
}

export function buildPayoutWalletCell(input: {
  purpose: PayoutProofPurpose;
  communityId: number;
  telegramUserId: string;
  address: string;
  tag?: number;
}): Cell {
  return beginCell()
    .storeUint(input.tag ?? 0x50724757, 32)
    .storeUint(input.purpose, 8)
    .storeUint(input.communityId, 64)
    .storeUint(BigInt(input.telegramUserId), 64)
    .storeAddress(Address.parse(input.address))
    .endCell();
}

/** Cell hashed by a TON Connect cell signature. */
export function buildSignDataMessage(input: {
  schema: string;
  timestamp: number;
  address: string;
  domain: string;
  payload: Cell;
}): Cell {
  const schemaHash = crc32(input.schema);
  return beginCell()
    .storeUint(0x75569022, 32)
    .storeUint(schemaHash, 32)
    .storeUint(BigInt(input.timestamp), 64)
    .storeAddress(Address.parse(input.address))
    .storeStringRefTail(encodeDnsDomain(input.domain))
    .storeRef(input.payload)
    .endCell();
}

export function readPayoutWalletProof(value: unknown): PayoutWalletProof | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.signature !== "string" || typeof body.address !== "string") return null;
  if (typeof body.timestamp !== "number" || !Number.isSafeInteger(body.timestamp)) return null;
  if (typeof body.domain !== "string" || typeof body.schema !== "string") return null;
  if (typeof body.cell !== "string" || typeof body.walletStateInit !== "string") return null;
  return {
    signature: body.signature,
    address: body.address,
    timestamp: body.timestamp,
    domain: body.domain,
    schema: body.schema,
    cell: body.cell,
    walletStateInit: body.walletStateInit,
  };
}
