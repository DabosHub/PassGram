import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Address } from "@ton/core";
import { buildCommunityAuthorizationCell } from "../ton/communityAuthorization.ts";
import { ownerSeedFromHex, OwnerKeyError, signAuthorizationHash } from "./ownerKey.ts";

const REGISTRY = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const CREATOR = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

function publicKey(seed: Buffer): crypto.KeyObject {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return crypto.createPublicKey(
    crypto.createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" }),
  );
}

test("owner approval signs every community registration field", () => {
  const seed = crypto.randomBytes(32);
  const cell = buildCommunityAuthorizationCell({
    registry: REGISTRY,
    communityId: 42,
    creator: CREATOR,
    payout: CREATOR,
    price: "1000000",
    durationSeconds: 30 * 86_400,
    platformMarketer: null,
    communityReferralBps: 0,
    accessMode: 0,
  });
  const parsed = cell.beginParse();
  assert.equal(parsed.loadUint(32), 0x41555448);
  assert.equal(parsed.loadAddress().equals(Address.parse(REGISTRY)), true);
  assert.equal(parsed.loadUint(64), 42);
  assert.equal(parsed.loadAddress().equals(Address.parse(CREATOR)), true);
  const terms = parsed.loadRef().beginParse();
  assert.equal(terms.loadAddress().equals(Address.parse(CREATOR)), true);
  assert.equal(terms.loadCoins(), 1_000_000n);
  assert.equal(terms.loadUint(32), 30 * 86_400);
  assert.equal(terms.loadBit(), false);
  assert.equal(terms.loadUint(16), 0);
  assert.equal(terms.loadUint(8), 0);
  const signature = signAuthorizationHash(seed, cell.hash());
  assert.equal(signature.length, 64);
  assert.equal(crypto.verify(null, cell.hash(), publicKey(seed), signature), true);
  const otherPrice = buildCommunityAuthorizationCell({
    registry: REGISTRY,
    communityId: 42,
    creator: CREATOR,
    payout: CREATOR,
    price: "2000000",
    durationSeconds: 30 * 86_400,
    platformMarketer: null,
    communityReferralBps: 0,
    accessMode: 0,
  });
  assert.equal(crypto.verify(null, otherPrice.hash(), publicKey(seed), signature), false);
});

test("owner seed accepts 32-byte and 64-byte hex and rejects anything else", () => {
  const seed = ownerSeedFromHex("ab".repeat(32));
  assert.equal(seed.length, 32);
  const longer = ownerSeedFromHex("ab".repeat(32) + "cd".repeat(32));
  assert.equal(longer.equals(seed), true);
  assert.throws(() => ownerSeedFromHex(""), OwnerKeyError);
  assert.throws(() => ownerSeedFromHex("abcd"), OwnerKeyError);
});
