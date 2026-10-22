import crypto from "node:crypto";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export class OwnerKeyError extends Error {
  constructor() {
    super("Owner authorization key is not configured.");
  }
}

/** 32-byte ed25519 seed. A 64-byte secret key uses its first 32 bytes. */
export function ownerSeedFromHex(raw: string | undefined): Buffer {
  const hex = (raw || "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new OwnerKeyError();
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length === 32) return bytes;
  if (bytes.length === 64) return Buffer.from(bytes.subarray(0, 32));
  throw new OwnerKeyError();
}

export function ownerSeedFromEnv(): Buffer {
  return ownerSeedFromHex(process.env.PASSGRAM_OWNER_SECRET);
}

function privateKey(seed: Buffer) {
  return crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

/** Detached Ed25519 signature of the 32-byte cell hash. Matches Tact checkSignature. */
export function signAuthorizationHash(seed: Buffer, hash: Buffer): Buffer {
  if (seed.length !== 32 || hash.length !== 32) throw new OwnerKeyError();
  return crypto.sign(null, hash, privateKey(seed));
}
