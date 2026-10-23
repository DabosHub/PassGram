import assert from "node:assert/strict";
import test from "node:test";
import { allowUserAction } from "./server/rateLimit.ts";

test("a user can write ten times a minute and the eleventh waits", () => {
  process.env.PASSGRAM_RATE_LIMIT = "on";
  const userId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
  const now = 1_700_000_000_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(allowUserAction(userId, "write", now), true);
  }
  assert.equal(allowUserAction(userId, "write", now), false);
  assert.equal(allowUserAction(userId, "write", now + 60_000), true);
  delete process.env.PASSGRAM_RATE_LIMIT;
});
