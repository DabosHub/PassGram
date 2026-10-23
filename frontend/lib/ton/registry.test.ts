import assert from "node:assert/strict";
import test from "node:test";
import { Address, Cell } from "@ton/core";
import { buildCommunityReferralAuthorizationCell } from "./communityAuthorization.ts";
import { buildRegisterCommunityBody, buildSetCommunityPausedBody, buildSubscribeForwardPayload, buildUpdateCommunityBody } from "./registry.ts";

const CREATOR = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const PAYOUT = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const AUTHORIZATION = Buffer.alloc(64, 7).toString("base64");

test("RegisterCommunity body is signed as the creator wallet and stores the subscription period", () => {
  const body = Cell.fromBase64(
    buildRegisterCommunityBody({
      communityId: 42,
      creator: CREATOR,
      payout: PAYOUT,
      price: "2500000",
      durationSeconds: 30 * 86_400,
      authorization: AUTHORIZATION,
    }),
  ).beginParse();
  assert.equal(body.loadUint(32), 0x52454743);
  assert.equal(body.loadUint(64), 42);
  assert.equal(body.loadAddress().equals(Address.parse(CREATOR)), true);
  assert.equal(body.loadAddress().equals(Address.parse(PAYOUT)), true);
  assert.equal(body.loadCoins(), 2_500_000n);
  assert.equal(body.loadUint(32), 30 * 86_400);
  const tail = body.loadRef().beginParse();
  assert.equal(tail.loadMaybeAddress(), null);
  assert.equal(tail.loadUint(16), 0);
  assert.equal(tail.loadUint(8), 0);
  assert.equal(tail.loadBuffer(64).equals(Buffer.alloc(64, 7)), true);
});

test("RegisterCommunity stores the PassGram referrer payout address", () => {
  const marketer = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
  const body = Cell.fromBase64(
    buildRegisterCommunityBody({
      communityId: 42,
      creator: CREATOR,
      payout: CREATOR,
      price: "2500000",
      durationSeconds: 30 * 86_400,
      platformMarketer: marketer,
      authorization: AUTHORIZATION,
    }),
  ).beginParse();
  const tail = body.loadRef().beginParse();
  assert.equal(tail.loadMaybeAddress()?.equals(Address.parse(marketer)), true);
});

test("subscribe payload names the payout wallet and carries the owner signature", () => {
  const body = Cell.fromBase64(
    buildSubscribeForwardPayload({
      communityId: 42,
      communityReferrerAddress: PAYOUT,
      validUntil: 1_700_000_000,
      authorization: AUTHORIZATION,
    }),
  ).beginParse();
  assert.equal(body.loadUint(32), 0x53554253);
  assert.equal(body.loadUint(64), 42);
  assert.equal(body.loadBit(), true);
  assert.equal(body.loadAddress().equals(Address.parse(PAYOUT)), true);
  assert.equal(body.loadUint(32), 1_700_000_000);
  assert.equal(body.loadBuffer(64).equals(Buffer.alloc(64, 7)), true);
  assert.equal(body.remainingBits, 0);
});

test("referral authorization cell binds the registry, the payer, and an optional payout", () => {
  const named = buildCommunityReferralAuthorizationCell({
    registry: CREATOR,
    communityId: 42,
    subscriber: PAYOUT,
    payout: PAYOUT,
    validUntil: 1_700_000_000,
  }).beginParse();
  assert.equal(named.loadUint(32), 0x43524546);
  assert.equal(named.loadAddress().equals(Address.parse(CREATOR)), true);
  assert.equal(named.loadUint(64), 42);
  assert.equal(named.loadAddress().equals(Address.parse(PAYOUT)), true);
  assert.equal(named.loadBit(), true);
  assert.equal(named.loadAddress().equals(Address.parse(PAYOUT)), true);
  assert.equal(named.loadUint(32), 1_700_000_000);
  assert.equal(named.remainingBits, 0);

  const empty = buildCommunityReferralAuthorizationCell({
    registry: CREATOR,
    communityId: 42,
    subscriber: PAYOUT,
    payout: null,
    validUntil: 1_700_000_000,
  }).beginParse();
  empty.loadUint(32);
  empty.loadAddress();
  empty.loadUint(64);
  empty.loadAddress();
  assert.equal(empty.loadBit(), false);
  assert.equal(empty.loadUint(32), 1_700_000_000);
});

test("SetCommunityPaused body is a creator-signed pause or resume", () => {
  const paused = Cell.fromBase64(buildSetCommunityPausedBody(42, true)).beginParse();
  assert.equal(paused.loadUint(32), 0x53435053);
  assert.equal(paused.loadUint(64), 0);
  assert.equal(paused.loadUint(64), 42);
  assert.equal(paused.loadBit(), true);
  const resumed = Cell.fromBase64(buildSetCommunityPausedBody(42, false)).beginParse();
  assert.equal(resumed.loadUint(32), 0x53435053);
  assert.equal(resumed.loadUint(64), 0);
  assert.equal(resumed.loadUint(64), 42);
  assert.equal(resumed.loadBit(), false);
});

test("UpdateCommunity body carries the new subscription price and duration", () => {
  const body = Cell.fromBase64(
    buildUpdateCommunityBody({
      communityId: 42,
      price: "1500000",
      durationSeconds: 7 * 86_400,
    }),
  ).beginParse();
  assert.equal(body.loadUint(32), 0x55504443);
  assert.equal(body.loadUint(64), 0);
  assert.equal(body.loadUint(64), 42);
  assert.equal(body.loadCoins(), 1_500_000n);
  assert.equal(body.loadUint(32), 7 * 86_400);
  assert.equal(body.remainingBits, 0);
});
