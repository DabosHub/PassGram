import assert from "node:assert/strict";
import test from "node:test";
import { beginCell } from "@ton/core";
import { sanitizeError } from "./log.ts";
import { parseCommunityUpdated, parseSubscriptionHint, subscriptionExpiryMs, tonCenterHeaders } from "./tonApi.ts";

test("logged errors do not keep a bot token or an API key", () => {
  const error = new Error("fetch failed https://api.telegram.org/bot123456:AASecret_token/getMe?api_key=ton-secret");
  const text = sanitizeError(error);
  assert.equal(text.includes("AASecret_token"), false);
  assert.equal(text.includes("ton-secret"), false);
  assert.match(text, /bot\[redacted\]/);
  assert.match(text, /api_key=\[redacted\]/);
});

test("a subscription without an expiry is not given 30 days", () => {
  assert.equal(subscriptionExpiryMs(undefined), null);
  assert.equal(subscriptionExpiryMs(0), null);
  assert.equal(subscriptionExpiryMs(1_700_000_000), 1_700_000_000_000);
});

test("the TonCenter API key is a header, not part of the URL", () => {
  assert.deepEqual(tonCenterHeaders("secret-key"), { "X-API-Key": "secret-key" });
  assert.deepEqual(tonCenterHeaders(""), {});
});

test("production indexing does not accept a JSON payment fixture", () => {
  const body = Buffer.from(JSON.stringify({ communityId: 7, amount: "1000000", hasReferrer: true })).toString("base64");
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(parseSubscriptionHint(body), null);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  assert.equal(parseSubscriptionHint(body)?.communityId, 7);
});

test("a community update event carries the new price and whole-day duration", () => {
  const body = beginCell()
    .storeUint(0x43555044, 32)
    .storeUint(7, 64)
    .storeCoins(1_500_000n)
    .storeUint(30 * 86_400, 32)
    .endCell()
    .toBoc()
    .toString("base64");
  assert.deepEqual(parseCommunityUpdated(body), { communityId: 7, price: "1500000", durationDays: 30 });
  const partial = beginCell().storeUint(0x43555044, 32).storeUint(7, 64).storeCoins(1_500_000n).storeUint(90_000, 32).endCell();
  assert.equal(parseCommunityUpdated(partial.toBoc().toString("base64")), null);
});
