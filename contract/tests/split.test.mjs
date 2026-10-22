import assert from "node:assert/strict";
import test from "node:test";

const BPS = 10_000n;
const PLATFORM_FEE_BPS = 250n;
const TREASURY_FEE_BPS = 200n;
const REFERRER_FEE_BPS = 50n;
const MAX_COMMUNITY_REFERRAL_BPS = 5000n;

function computeSplit(gross, hasPlatformReferrer) {
  if (hasPlatformReferrer) {
    const treasury = (gross * TREASURY_FEE_BPS) / BPS;
    const referrer = (gross * REFERRER_FEE_BPS) / BPS;
    return { creator: gross - treasury - referrer, treasury, referrer };
  }
  const treasury = (gross * PLATFORM_FEE_BPS) / BPS;
  return { creator: gross - treasury, treasury, referrer: 0n };
}

function computeCommunityAwareSplit(gross, hasPlatformReferrer, communityReferralBps) {
  const base = computeSplit(gross, hasPlatformReferrer);
  const bps =
    communityReferralBps < 0n
      ? 0n
      : communityReferralBps > MAX_COMMUNITY_REFERRAL_BPS
        ? MAX_COMMUNITY_REFERRAL_BPS
        : communityReferralBps;
  const communityAffiliate = (base.creator * bps) / BPS;
  const creator = base.creator - communityAffiliate;
  if (creator < 0n) {
    return { ...base, creator: 0n, communityAffiliate: base.creator };
  }
  return { ...base, creator, communityAffiliate };
}

test("split without referrer: 97.5 / 2.5 / 0", () => {
  const gross = 1_000_000n;
  const s = computeSplit(gross, false);
  assert.equal(s.creator, 975_000n);
  assert.equal(s.treasury, 25_000n);
  assert.equal(s.referrer, 0n);
  assert.equal(s.creator + s.treasury + s.referrer, gross);
});

test("split with platform referrer: 97.5 / 2.0 / 0.5", () => {
  const gross = 1_000_000n;
  const s = computeSplit(gross, true);
  assert.equal(s.creator, 975_000n);
  assert.equal(s.treasury, 20_000n);
  assert.equal(s.referrer, 5_000n);
  assert.equal(s.creator + s.treasury + s.referrer, gross);
});

test("community referral is taken from creator share on-chain", () => {
  const gross = 1_000_000n;
  const s = computeCommunityAwareSplit(gross, false, 1000n); // 10%
  assert.equal(s.treasury, 25_000n);
  assert.equal(s.communityAffiliate, 97_500n);
  assert.equal(s.creator, 877_500n);
  assert.equal(s.creator + s.treasury + s.referrer + s.communityAffiliate, gross);
});

test("platform + community referral stack correctly", () => {
  const gross = 1_000_000n;
  const s = computeCommunityAwareSplit(gross, true, 1000n);
  assert.equal(s.referrer, 5_000n);
  assert.equal(s.treasury, 20_000n);
  assert.equal(s.communityAffiliate, 97_500n);
  assert.equal(s.creator, 877_500n);
  assert.equal(s.creator + s.treasury + s.referrer + s.communityAffiliate, gross);
});

test("affiliate is 20% of platform fee", () => {
  const gross = 10_000_000n;
  const platform = (gross * PLATFORM_FEE_BPS) / BPS;
  const affiliate = (platform * 2000n) / BPS;
  assert.equal(affiliate, (gross * REFERRER_FEE_BPS) / BPS);
});
