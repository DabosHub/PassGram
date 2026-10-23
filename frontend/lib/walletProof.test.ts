import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "./ton/walletProof.ts";
import { PAYOUT_PROOF_AFFILIATE, PAYOUT_PROOF_COMMUNITY } from "./ton/walletProof.ts";
import { signPayoutWalletProof, verifyPayoutWalletProof } from "./server/walletProof.ts";

test("crc32 matches the IEEE check value", () => {
  assert.equal(crc32("123456789"), 0xcbf43926);
});

test("a gasless wallet proof stores only the wallet that signed it", () => {
  const now = Math.floor(Date.now() / 1000);
  const proof = signPayoutWalletProof({
    seed: Buffer.alloc(32, 4),
    purpose: PAYOUT_PROOF_COMMUNITY,
    communityId: 7,
    telegramUserId: "9",
    timestamp: now,
  });
  const checked = verifyPayoutWalletProof(proof, {
    purpose: PAYOUT_PROOF_COMMUNITY,
    communityId: 7,
    telegramUserId: "9",
    nowSeconds: now,
  });
  assert.equal(checked.ok, true);
  if (checked.ok) assert.equal(checked.address, proof.address);

  const v5 = signPayoutWalletProof({
    seed: Buffer.alloc(32, 5),
    purpose: PAYOUT_PROOF_AFFILIATE,
    communityId: 0,
    telegramUserId: "9",
    timestamp: now,
    layout: "v5",
  });
  assert.equal(
    verifyPayoutWalletProof(v5, {
      purpose: PAYOUT_PROOF_AFFILIATE,
      communityId: 0,
      telegramUserId: "9",
      nowSeconds: now,
    }).ok,
    true,
  );

  assert.equal(
    verifyPayoutWalletProof(proof, {
      purpose: PAYOUT_PROOF_COMMUNITY,
      communityId: 8,
      telegramUserId: "9",
      nowSeconds: now,
    }).ok,
    false,
  );
  assert.equal(
    verifyPayoutWalletProof(proof, {
      purpose: PAYOUT_PROOF_COMMUNITY,
      communityId: 7,
      telegramUserId: "10",
      nowSeconds: now,
    }).ok,
    false,
  );
  assert.match(
    verifyPayoutWalletProof({ ...proof, timestamp: now - 601 }, {
      purpose: PAYOUT_PROOF_COMMUNITY,
      communityId: 7,
      telegramUserId: "9",
      nowSeconds: now,
    }).message || "",
    /expired/,
  );
  assert.match(
    verifyPayoutWalletProof({ ...proof, domain: "evil.example" }, {
      purpose: PAYOUT_PROOF_COMMUNITY,
      communityId: 7,
      telegramUserId: "9",
      nowSeconds: now,
    }).message || "",
    /different app/,
  );
  assert.equal(
    verifyPayoutWalletProof({ ...proof, signature: Buffer.alloc(64, 7).toString("base64") }, {
      purpose: PAYOUT_PROOF_COMMUNITY,
      communityId: 7,
      telegramUserId: "9",
      nowSeconds: now,
    }).ok,
    false,
  );
  const swapped = signPayoutWalletProof({
    seed: Buffer.alloc(32, 6),
    purpose: PAYOUT_PROOF_COMMUNITY,
    communityId: 7,
    telegramUserId: "9",
    timestamp: now,
  });
  assert.equal(
    verifyPayoutWalletProof({ ...proof, walletStateInit: swapped.walletStateInit, address: swapped.address }, {
      purpose: PAYOUT_PROOF_COMMUNITY,
      communityId: 7,
      telegramUserId: "9",
      nowSeconds: now,
    }).ok,
    false,
  );

  const account = signPayoutWalletProof({
    seed: Buffer.alloc(32, 8),
    purpose: 3,
    communityId: 0,
    telegramUserId: "9",
    timestamp: now,
    schema: "account_wallet#41636374 purpose:uint8 community_id:uint64 telegram_user_id:uint64 wallet:MsgAddress = AccountWallet",
  });
  assert.equal(
    verifyPayoutWalletProof(account, {
      purpose: 3,
      communityId: 0,
      telegramUserId: "9",
      nowSeconds: now,
      schema: account.schema,
    }).ok,
    true,
  );
  assert.equal(
    verifyPayoutWalletProof(account, {
      purpose: PAYOUT_PROOF_AFFILIATE,
      communityId: 0,
      telegramUserId: "9",
      nowSeconds: now,
    }).ok,
    false,
  );
  assert.equal(
    verifyPayoutWalletProof(proof, {
      purpose: 3,
      communityId: 0,
      telegramUserId: "9",
      nowSeconds: now,
      schema: account.schema,
    }).ok,
    false,
  );
});
