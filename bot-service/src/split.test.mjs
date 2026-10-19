import assert from "node:assert/strict";
import test from "node:test";

const BPS = 10_000n;
const PLATFORM = 250n;
const TREASURY = 200n;
const REFERRER = 50n;

function split(gross, hasReferrer) {
  if (hasReferrer) {
    const treasury = (gross * TREASURY) / BPS;
    const referrer = (gross * REFERRER) / BPS;
    return { creator: gross - treasury - referrer, treasury, referrer };
  }
  const treasury = (gross * PLATFORM) / BPS;
  return { creator: gross - treasury, treasury, referrer: 0n };
}

test("bot-service fee split matches product policy", () => {
  const s = split(2_000_000n, true);
  assert.equal(s.creator, 1_950_000n);
  assert.equal(s.treasury, 40_000n);
  assert.equal(s.referrer, 10_000n);
});
