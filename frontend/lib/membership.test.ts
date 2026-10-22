import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubscriberView } from "./subscriberAccess.ts";
import { mergeSubscriberSnapshot } from "./subscriberLedger.ts";
import { assembleOwnerLedger } from "./server/membershipFlow.ts";
import type { MembershipPaymentRow, MembershipRow, OwnedCommunityRow } from "./server/membershipRepository.ts";
import type { PaymentRecord, SubscriptionRecord } from "./store.tsx";
import { tonWalletKey } from "./ton/walletKey.ts";

test("owner ledger keeps a community's members and payments together", () => {
  const community: OwnedCommunityRow = {
    communityId: 7,
    title: "Alpha",
    description: "Notes",
    price: "1500000",
    durationDays: 30,
    active: true,
    paused: false,
    telegramChatId: "-1001",
    hasPhoto: false,
    ownerTelegramUserId: "42",
    referralEnabled: false,
    referralPercentBps: 0,
  };
  const member: MembershipRow = {
    communityId: 7,
    subscriberTelegramUserId: 99,
    displayName: "Layla Haddad",
    username: "laylahaddad",
    photoUrl: "https://t.me/i/userpic/99.jpg",
    confirmation: "confirmed",
    startedAtMs: 1_000,
    expiresAtMs: 2_000,
    paymentAmount: "1500000",
    renewalPending: false,
    createdAtMs: 1_000,
  };
  const payment: MembershipPaymentRow = {
    paymentId: 3,
    communityId: 7,
    subscriberTelegramUserId: 99,
    grossAmount: "1500000",
    creatorAmount: "1350000",
    platformFee: "150000",
    affiliateAmount: "0",
    communityAffiliateAmount: "0",
    status: "confirmed",
    transactionReference: "tx",
    paidAtMs: 1_000,
  };
  const [row] = assembleOwnerLedger([community], [member], [payment]);
  assert.equal(row?.community.name, "Alpha");
  assert.equal(row?.community.status, "active");
  assert.equal(row?.subscriptions[0]?.subscriberDisplayName, "Layla Haddad");
  assert.equal(row?.subscriptions[0]?.subscriberUsername, "laylahaddad");
  assert.equal(row?.subscriptions[0]?.subscriberAvatarUrl, "https://t.me/i/userpic/99.jpg");
  assert.equal(row?.payments[0]?.creatorAmount, "1350000");
  assert.equal(row?.payments[0]?.subscriberUserId, "tg:99");
});

test("a confirmed renewal rewrites the subscriber period and keeps the card id", () => {
  const current: SubscriptionRecord = {
    id: 9101,
    subscriberUserId: "tg:5",
    communityId: 9002,
    confirmation: "confirmed",
    startedAt: 1_000,
    expiresAt: 2_000,
    paymentAmount: "2500000",
    paymentAsset: "USDT",
    transactionReference: "old",
    renewalPending: false,
    createdAt: 1_000,
  };
  const renewed: SubscriptionRecord = {
    ...current,
    id: 5,
    startedAt: 5_000,
    expiresAt: 9_000,
    transactionReference: "new",
  };
  const payment: PaymentRecord = {
    id: 8,
    communityId: 9002,
    subscriberUserId: "tg:5",
    gross: "2500000",
    creatorAmount: "2250000",
    platformFee: "250000",
    affiliateAmount: "0",
    communityAffiliateAmount: "0",
    status: "confirmed",
    transactionReference: "new",
    at: 5_000,
  };
  const next = mergeSubscriberSnapshot(
    { userId: "tg:5", subscriptions: [current], payments: [] },
    { subscriptions: [renewed], payments: [payment] },
  );
  assert.equal(next?.subscriptions[0]?.id, 9101);
  assert.equal(next?.subscriptions[0]?.startedAt, 5_000);
  assert.equal(next?.subscriptions[0]?.expiresAt, 9_000);
  assert.equal(next?.subscriptions[0]?.transactionReference, "new");
  assert.equal(next?.payments.length, 1);
  assert.equal(
    mergeSubscriberSnapshot(
      { userId: "tg:5", subscriptions: next?.subscriptions ?? [], payments: next?.payments ?? [] },
      { subscriptions: [renewed], payments: [payment] },
    ),
    null,
  );
  assert.equal(tonWalletKey("not-an-address"), null);
});

test("a subscriber outside the channel keeps the old card until join is verified", () => {
  const access = [{ communityId: 9002, communityName: "Builder Lounge", inChannel: false, inviteLink: "https://t.me/+invite" }];
  const waiting = resolveSubscriberView({ access, requiredCommunityIds: [9002], joinAttemptCommunityId: null });
  assert.deepEqual(waiting.hold, [9002]);
  assert.equal(waiting.offer?.inviteLink, "https://t.me/+invite");
  const clicked = resolveSubscriberView({ access, requiredCommunityIds: [9002], joinAttemptCommunityId: 9002 });
  assert.deepEqual(clicked.hold, [9002]);
  const joined = resolveSubscriberView({
    access: [{ ...access[0], inChannel: true }],
    requiredCommunityIds: [9002],
    joinAttemptCommunityId: 9002,
  });
  assert.deepEqual(joined.hold, []);
  assert.equal(joined.offer, null);
  const stillInside = resolveSubscriberView({
    access: [{ communityId: 9002, communityName: "Builder Lounge", inChannel: true, inviteLink: null }],
    requiredCommunityIds: [],
    joinAttemptCommunityId: null,
  });
  assert.deepEqual(stillInside.hold, []);
  assert.equal(stillInside.offer, null);
});
