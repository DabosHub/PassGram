import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCommunityLink,
  activePassgramCount,
  canSubscribe,
  chooseDashboardSection,
  creationBlockers,
  feePolicy,
  lockReferral,
  nextAffiliate,
  pageOf,
  parseStartParam,
  paymentBlockers,
  policyExample,
  rankAffiliates,
  remainingLabel,
  renewalWindowOpen,
  subscriptionActions,
  subscriptionProgress,
  subscriptionStatus,
  formatCommunityReferralLink,
  formatMiniAppHomeLink,
  formatReferralLink,
  referralShareMessage,
  referralShareTargets,
  suggestReferralCode,
  validateCommunityDraft,
} from "./domain.ts";
import { computeCommunityAwareSplit } from "./money.ts";
import { resolveRoute, routeToPath } from "./route.ts";
import { confirmPayment, loadLeaderboard } from "./services/confirmation.ts";

const day = 24 * 60 * 60 * 1000;

test("subscription progress is clamped and rejects missing dates", () => {
  assert.equal(subscriptionProgress(null, 10, 5), null);
  assert.equal(subscriptionProgress(10, 10, 10), null);
  assert.equal(subscriptionProgress(0, 100, -10), 0);
  assert.equal(subscriptionProgress(0, 100, 50), 0.5);
  assert.equal(subscriptionProgress(0, 100, 250), 1);
});

test("subscription status distinguishes expired from unconfirmed", () => {
  const now = 1_000_000;
  assert.equal(
    subscriptionStatus({ confirmation: "unconfirmed", expiresAt: now + day, now }),
    "payment_pending",
  );
  assert.equal(
    subscriptionStatus({ confirmation: "unconfirmed", expiresAt: null, now, renewalPending: true }),
    "renewal_pending",
  );
  assert.equal(
    subscriptionStatus({ confirmation: "confirmed", expiresAt: now, now }),
    "expired",
  );
  assert.equal(
    subscriptionStatus({ confirmation: "confirmed", expiresAt: now + 2 * day, now }),
    "expiring_soon",
  );
  assert.equal(
    subscriptionStatus({ confirmation: "confirmed", expiresAt: now + 10 * day, now }),
    "active",
  );
  assert.equal(remainingLabel(now, now, true), "Expired");
  assert.equal(remainingLabel(now + day, now, false), "Not confirmed");
  assert.match(remainingLabel(now + 5 * day, now, true), /5 days left/);
  assert.equal(renewalWindowOpen(now + 2 * day, now, true), false);
  assert.equal(renewalWindowOpen(now + day, now, true), true);
  assert.equal(renewalWindowOpen(now + 60 * 60 * 1000, now, true), true);
  assert.equal(renewalWindowOpen(now, now, true), false);
  assert.equal(renewalWindowOpen(now + day, now, false), false);
});

test("dashboard section follows ownership and memory", () => {
  assert.equal(chooseDashboardSection({ ownedCount: 0, subscriptionCount: 0, remembered: null }), "empty");
  assert.equal(chooseDashboardSection({ ownedCount: 2, subscriptionCount: 0, remembered: "subscriptions" }), "communities");
  assert.equal(chooseDashboardSection({ ownedCount: 0, subscriptionCount: 1, remembered: null }), "subscriptions");
  assert.equal(chooseDashboardSection({ ownedCount: 1, subscriptionCount: 1, remembered: null }), "communities");
  assert.equal(chooseDashboardSection({ ownedCount: 1, subscriptionCount: 1, remembered: "subscriptions" }), "subscriptions");
});

test("deep links and history paths", () => {
  assert.deepEqual(parseStartParam("c_12_ref_pass"), {
    communityId: 12,
    referralCode: "pass",
    communityReferralCode: null,
    error: null,
  });
  assert.deepEqual(parseStartParam("c_12_cref_mira"), {
    communityId: 12,
    referralCode: null,
    communityReferralCode: "mira",
    error: null,
  });
  assert.equal(parseStartParam("c_0")?.error, "invalid_community");
  assert.equal(parseStartParam("ref_no")?.error, "invalid_referral");
  assert.deepEqual(parseStartParam("ref_pass"), {
    communityId: null,
    referralCode: "pass",
    communityReferralCode: null,
    error: null,
  });
  assert.equal(resolveRoute("", "c_4").screen, "community");
  assert.equal(resolveRoute("?tab=create", "c_4").screen, "home");
  assert.equal(resolveRoute("?tab=create", "c_4").tab, "create");
  assert.equal(resolveRoute("?community=9").communityId, 9);
  assert.equal(resolveRoute("?community=no").linkError, "invalid_community");
  assert.equal(
    routeToPath({
      tab: "referral",
      screen: "home",
      accountPage: "hub",
      communityId: null,
      referralCode: null,
      communityReferralCode: null,
      linkError: null,
    }),
    "/?tab=referral",
  );
  assert.equal(resolveRoute("?account=1").screen, "account");
  assert.equal(resolveRoute("?account=1").accountPage, "hub");
  assert.equal(resolveRoute("?account=analytics").accountPage, "analytics");
  assert.equal(
    routeToPath({
      tab: "dashboard",
      screen: "account",
      accountPage: "notifications",
      communityId: null,
      referralCode: null,
      communityReferralCode: null,
      linkError: null,
    }),
    "/?account=notifications",
  );
});

test("community form and blockers", () => {
  const errors = validateCommunityDraft({
    name: "",
    telegramUsername: "bad",
    telegramChatId: "abc",
    description: "",
    imageUrl: "http://example.com/a.png",
    priceUsdt: "0.5",
    periodDays: "0",
    payoutAddress: "not valid",
    automationMode: "assisted",
  });
  assert.ok(errors.name && errors.priceUsdt);
  const blockers = creationBlockers({
    contractConfigured: false,
    creatorConfirmed: false,
    botVerified: false,
    automationMode: "full",
  });
  assert.ok(blockers.length >= 3);
  assert.equal(canSubscribe("user-a", "user-a"), false);
  assert.equal(canSubscribe("user-a", "user-b"), true);
  assert.ok(
    paymentBlockers({
      contractConfigured: false,
      communityConfirmed: false,
      self: true,
      walletConnected: false,
    }).length >= 4,
  );
  assert.ok(
    paymentBlockers({
      contractConfigured: true,
      communityConfirmed: true,
      self: false,
      walletConnected: false,
    }).some((reason) => reason.includes("TON Connect")),
  );
});

test("referral codes are short and links look like Telegram invites", () => {
  assert.equal(suggestReferralCode({ telegramUsername: "Pass_Gram", telegramUserId: 99, userId: "tg:99" }), "pass_gram");
  assert.equal(suggestReferralCode({ telegramUsername: "ab", telegramUserId: 42, userId: "tg:42" }), "u160");
  assert.equal(suggestReferralCode({ telegramUsername: null, telegramUserId: null, userId: "local:a1c1f8bcc95d422090bab6c00" }), "gbab6c00");
  const previous = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  delete process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  assert.equal(formatMiniAppHomeLink(), "https://t.me/PassGramBot/passgram");
  assert.equal(formatReferralLink("mira", "http://localhost:3000"), "https://t.me/PassGramBot/passgram?startapp=ref_mira");
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = "PassGramBot";
  assert.equal(formatReferralLink("mira", "http://localhost:3000"), "https://t.me/PassGramBot/passgram?startapp=ref_mira");
  assert.equal(formatCommunityLink(42, "http://localhost:3000"), "https://t.me/PassGramBot/passgram?startapp=c_42");
  assert.equal(
    formatCommunityReferralLink(42, "mira", "http://localhost:3000"),
    "https://t.me/PassGramBot/passgram?startapp=c_42_cref_mira",
  );
  delete process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  assert.equal(formatReferralLink("mira", "https://app.passgram.example"), "https://t.me/PassGramBot/passgram?startapp=ref_mira");
  if (previous == null) delete process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  else process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = previous;
});

test("a PassGram referral share post includes the link for X and Telegram", () => {
  const link = "https://t.me/PassGramBot/passgram?startapp=ref_mira";
  const message = referralShareMessage(link);
  assert.match(message, /I just created my referral link on PassGram/);
  assert.match(message, /manage memberships automatically/);
  assert.ok(message.endsWith(link));
  const targets = referralShareTargets(link);
  const tweet = new URL(targets.x);
  assert.equal(tweet.origin + tweet.pathname, "https://x.com/intent/tweet");
  assert.equal(tweet.searchParams.get("text"), message);
  const telegram = new URL(targets.telegram);
  assert.equal(telegram.origin + telegram.pathname, "https://t.me/share/url");
  assert.equal(telegram.searchParams.get("url"), link);
  assert.match(telegram.searchParams.get("text") || "", /I just created my referral link on PassGram/);
  assert.equal((telegram.searchParams.get("text") || "").includes(link), false);
});

test("community referral cut comes from creator share after platform fee", () => {
  const gross = 1_000_000n;
  const split = computeCommunityAwareSplit(gross, false, 1000n); // 10% of the creator share
  assert.equal(split.treasury, 25_000n);
  assert.equal(split.communityAffiliate, 97_500n);
  assert.equal(split.creator, 877_500n);
  assert.equal(split.creator + split.treasury + split.referrer + split.communityAffiliate, gross);
});

test("referral lock, idempotent registration, and commission policy", () => {
  const first = lockReferral({
    userId: "tg:1",
    currentCode: null,
    locked: false,
    incomingCode: "pass",
    affiliate: { userId: "tg:2", code: "pass", confirmed: true },
  });
  assert.equal(first.result, "locked");
  const again = lockReferral({
    userId: "tg:1",
    currentCode: first.code,
    locked: true,
    incomingCode: "other",
    affiliate: { userId: "tg:3", code: "other", confirmed: true },
  });
  assert.equal(again.result, "already_locked");
  assert.equal(again.code, "pass");
  assert.equal(
    lockReferral({
      userId: "tg:2",
      currentCode: null,
      locked: false,
      incomingCode: "pass",
      affiliate: { userId: "tg:2", code: "pass", confirmed: true },
    }).result,
    "self",
  );
  assert.equal(
    lockReferral({
      userId: "tg:1",
      currentCode: null,
      locked: false,
      incomingCode: "pass",
      affiliate: { userId: "tg:2", code: "pass", confirmed: false },
    }).result,
    "unconfirmed",
  );
  const created = nextAffiliate(null, { userId: "tg:1", code: "pass", payoutAddress: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs" });
  const repeat = nextAffiliate(created.affiliate, { userId: "tg:1", code: "other", payoutAddress: "UQBkgXCNLPexWhsRZT2ocpgU5fgwUHQXlwJQ9EueFIFK9Nh_" });
  assert.equal(created.created, true);
  assert.equal(repeat.created, false);
  assert.equal(repeat.affiliate.code, "pass");
  const policy = feePolicy();
  assert.equal(policy.platformPercent, "2.5");
  assert.equal(policy.affiliateOfFeePercent, "20");
  assert.equal(policy.affiliateOfPaymentPercent, "0.5");
  const example = policyExample("100");
  assert.equal(example.gross, "100");
  assert.equal(example.platformFee, "2.5");
  assert.equal(example.affiliate, "0.5");
  assert.equal(example.platformRemainder, "2");
  assert.equal(example.creator, "97.5");
});

test("subscriber counts ignore unconfirmed rows and rank confirmed commissions", () => {
  const now = Date.now();
  assert.equal(
    activePassgramCount(
      [
        { communityId: 1, confirmation: "confirmed", expiresAt: now + day },
        { communityId: 1, confirmation: "unconfirmed", expiresAt: now + day },
        { communityId: 1, confirmation: "confirmed", expiresAt: now - day },
      ],
      1,
      now,
    ),
    1,
  );
  const ranked = rankAffiliates([
    { id: "a", displayName: "A", referrals: 9, conversions: 1, confirmedCommission: "10" },
    { id: "b", displayName: "B", referrals: 1, conversions: 1, confirmedCommission: "50" },
  ]);
  assert.equal(ranked[0]?.id, "b");
  assert.equal(pageOf([1, 2, 3], 1, 2).items.length, 1);
  assert.deepEqual(subscriptionActions("expired"), ["subscribe", "payment"]);
});

test("confirmation services do not invent success", async () => {
  const payment = await confirmPayment();
  assert.equal(payment.ok, false);
  const board = await loadLeaderboard();
  assert.equal(board.entries.length, 0);
  assert.equal(board.unavailable, true);
});
