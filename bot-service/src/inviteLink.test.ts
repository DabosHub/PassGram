import assert from "node:assert/strict";
import test from "node:test";
import { chatInviteLinkBody } from "./telegram.ts";

test("invite link request matches the one-person subscription invite", () => {
  const expiresAt = 1_800_000_000;
  const body = chatInviteLinkBody("-1009000000002", expiresAt);
  assert.equal(body.member_limit, 1);
  assert.equal(body.creates_join_request, false);
  assert.equal(body.expire_date, expiresAt);
  assert.equal(body.name, "PassGram");
  assert.equal("subscription_period" in body, false);
  assert.equal("subscription_price" in body, false);
});
