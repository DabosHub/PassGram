import crypto from "node:crypto";
import { Address, beginCell, Cell, contractAddress, loadStateInit, storeStateInit } from "@ton/core";
import {
  ACCOUNT_LINK_TAG,
  ACCOUNT_WALLET_SCHEMA,
  buildPayoutWalletCell,
  buildSignDataMessage,
  PAYOUT_PROOF_TTL_SECONDS,
  PAYOUT_WALLET_SCHEMA,
  type PayoutProofPurpose,
  type PayoutWalletProof,
} from "../ton/walletProof";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type WalletProofCheck =
  | { ok: true; address: string }
  | { ok: false; message: string };

/** Hosts whose gasless wallet proofs PassGram accepts. */
export function payoutProofDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = new Set<string>(["passgram.app", "passgram.io"]);
  if (env.NODE_ENV !== "production") {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
  }
  for (const raw of [env.PASSGRAM_PUBLIC_URL, env.PASSGRAM_APP_DOMAINS]) {
    for (const part of (raw || "").split(",")) {
      const item = part.trim();
      if (!item) continue;
      try {
        const url = item.includes("://") ? new URL(item) : new URL(`https://${item}`);
        if (url.hostname) hosts.add(url.hostname.toLowerCase());
        if (url.host) hosts.add(url.host.toLowerCase());
      } catch {
        hosts.add(item.toLowerCase());
      }
    }
  }
  return [...hosts];
}

export function payoutProofDomainAllowed(domain: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const trimmed = domain.trim().toLowerCase();
  const host = trimmed.split(":")[0];
  return payoutProofDomains(env).some((item) => item === trimmed || item === host);
}

const INVALID = "This wallet proof is not valid. No link was created.";
const EXPIRED = "This wallet proof expired. Sign again. No link was created.";
const DOMAIN = "This wallet proof is for a different app. No link was created.";

function ed25519PublicKey(raw: Buffer) {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function ed25519PrivateKey(seed: Buffer) {
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKeyFromSeed(seed: Buffer): Buffer {
  const exported = crypto.createPublicKey(ed25519PrivateKey(seed)).export({ format: "der", type: "spki" }) as Buffer;
  return exported.subarray(exported.length - 32);
}

function candidatePublicKeys(data: Cell): Buffer[] {
  const keys: Buffer[] = [];
  const readers = [
    () => {
      const slice = data.beginParse();
      slice.loadUint(32);
      slice.loadUint(32);
      return slice.loadBuffer(32);
    },
    () => {
      const slice = data.beginParse();
      slice.loadBit();
      slice.loadUint(32);
      slice.loadUint(32);
      return slice.loadBuffer(32);
    },
  ];
  for (const read of readers) {
    try {
      const key = read();
      if (key.length === 32) keys.push(key);
    } catch {
      /* This wallet data layout does not match. */
    }
  }
  return keys;
}

/**
 * Confirms the gasless signature was made by the wallet in the proof,
 * for this Telegram user, purpose, and community.
 * The returned address is the only receiving wallet the caller may store.
 */
export function verifyPayoutWalletProof(
  proof: PayoutWalletProof,
  expected: {
    purpose: PayoutProofPurpose;
    communityId: number;
    telegramUserId: string;
    nowSeconds: number;
    schema?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): WalletProofCheck {
  const schema = expected.schema ?? PAYOUT_WALLET_SCHEMA;
  const tag = schema === PAYOUT_WALLET_SCHEMA ? 0x50724757 : schema === ACCOUNT_WALLET_SCHEMA ? ACCOUNT_LINK_TAG : 0;
  if (!payoutProofDomainAllowed(proof.domain, env)) return { ok: false, message: DOMAIN };
  if (
    proof.timestamp < expected.nowSeconds - PAYOUT_PROOF_TTL_SECONDS ||
    proof.timestamp > expected.nowSeconds + 120
  ) {
    return { ok: false, message: EXPIRED };
  }
  if (tag === 0 || proof.schema !== schema) return { ok: false, message: INVALID };
  if (!/^[1-9]\d{0,19}$/.test(expected.telegramUserId)) return { ok: false, message: INVALID };
  if (!Number.isSafeInteger(expected.communityId) || expected.communityId < 0) return { ok: false, message: INVALID };
  try {
    const wallet = Address.parse(proof.address);
    const payload = buildPayoutWalletCell({
      purpose: expected.purpose,
      communityId: expected.communityId,
      telegramUserId: expected.telegramUserId,
      address: wallet.toString(),
      tag,
    });
    if (!payload.hash().equals(Cell.fromBase64(proof.cell).hash())) return { ok: false, message: INVALID };
    const stateInit = loadStateInit(Cell.fromBase64(proof.walletStateInit).beginParse());
    if (!stateInit.code || !stateInit.data) return { ok: false, message: INVALID };
    const deployed = contractAddress(wallet.workChain, { code: stateInit.code, data: stateInit.data });
    if (!deployed.equals(wallet)) return { ok: false, message: INVALID };
    const message = buildSignDataMessage({
      schema: proof.schema,
      timestamp: proof.timestamp,
      address: wallet.toString(),
      domain: proof.domain.trim(),
      payload: Cell.fromBase64(proof.cell),
    });
    const signature = Buffer.from(proof.signature, "base64");
    if (signature.length !== 64) return { ok: false, message: INVALID };
    const signed = candidatePublicKeys(stateInit.data).some((key) =>
      crypto.verify(null, message.hash(), ed25519PublicKey(key), signature),
    );
    if (!signed) return { ok: false, message: INVALID };
    return { ok: true, address: wallet.toString() };
  } catch {
    return { ok: false, message: INVALID };
  }
}

/** Builds a real gasless proof. Tests use it; the Mini App uses the connected wallet. */
export function signPayoutWalletProof(input: {
  seed: Buffer;
  purpose: PayoutProofPurpose;
  communityId: number;
  telegramUserId: string;
  domain?: string;
  timestamp?: number;
  layout?: "v4" | "v5";
  schema?: string;
}): PayoutWalletProof & { address: string } {
  if (input.seed.length !== 32) throw new Error("Wallet proof seed must be 32 bytes.");
  const schema = input.schema ?? PAYOUT_WALLET_SCHEMA;
  const tag = schema === ACCOUNT_WALLET_SCHEMA ? ACCOUNT_LINK_TAG : 0x50724757;
  const publicKey = publicKeyFromSeed(input.seed);
  const data = beginWalletData(publicKey, input.layout === "v5");
  const code = beginCell().endCell();
  const address = contractAddress(0, { code, data }).toString();
  const domain = input.domain ?? "passgram.app";
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const payload = buildPayoutWalletCell({
    purpose: input.purpose,
    communityId: input.communityId,
    telegramUserId: input.telegramUserId,
    address,
    tag,
  });
  const message = buildSignDataMessage({
    schema,
    timestamp,
    address,
    domain,
    payload,
  });
  const signature = crypto.sign(null, message.hash(), ed25519PrivateKey(input.seed));
  return {
    address,
    signature: signature.toString("base64"),
    timestamp,
    domain,
    schema,
    cell: payload.toBoc().toString("base64"),
    walletStateInit: beginCell().store(storeStateInit({ code, data })).endCell().toBoc().toString("base64"),
  };
}

function beginWalletData(publicKey: Buffer, walletV5: boolean): Cell {
  const builder = beginCell();
  if (walletV5) builder.storeBit(true);
  return builder.storeUint(0, 32).storeUint(0, 32).storeBuffer(publicKey).storeBit(false).endCell();
}
