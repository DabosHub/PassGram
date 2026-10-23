import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { resolveSubscriberView } from "./subscriberAccess.ts";
import { mergeSubscriberSnapshot } from "./subscriberLedger.ts";
import { assembleOwnerLedger, linkSubscriberWallet } from "./server/membershipFlow.ts";
import type { MembershipPaymentRow, MembershipRepository, MembershipRow, OwnedCommunityRow } from "./server/membershipRepository.ts";
import { signPayoutWalletProof } from "./server/walletProof.ts";
import type { PaymentRecord, SubscriptionRecord } from "./store.tsx";
import { ACCOUNT_LINK_PURPOSE, ACCOUNT_WALLET_SCHEMA, PAYOUT_PROOF_AFFILIATE } from "./ton/walletProof.ts";
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

function signedInitData(userId: number, authDate: number) {
  const token = "test-bot";
  const fields: Record<string, string> = { auth_date: String(authDate), user: JSON.stringify({ id: userId }) };
  const dataCheck = Object.entries(fields)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  return { token, data: new URLSearchParams({ ...fields, hash }).toString() };
}

test("a wallet link requires a signature and the owner can take a pre-claimed address back", async () => {
  const now = Math.floor(Date.now() / 1000);
  const rows = new Map<number, string>();
  const repo = {
    async getLinkedWallet(id: number) {
      return rows.get(id) ?? null;
    },
    async linkTonWallet(id: number, address: string) {
      for (const [user, saved] of rows) {
        if (saved === address && user !== id) rows.delete(user);
      }
      rows.set(id, address);
      return "linked" as const;
    },
  } as unknown as MembershipRepository;
  const victim = signedInitData(5, now);
  const attacker = signedInitData(9, now);
  const proof = signPayoutWalletProof({
    seed: Buffer.alloc(32, 8),
    purpose: ACCOUNT_LINK_PURPOSE,
    communityId: 0,
    telegramUserId: "5",
    timestamp: now,
    schema: ACCOUNT_WALLET_SCHEMA,
  });
  rows.set(9, tonWalletKey(proof.address) || proof.address);
  assert.equal((await linkSubscriberWallet(attacker.data, attacker.token, null, repo, now)).ok, false);
  const commission = signPayoutWalletProof({
    seed: Buffer.alloc(32, 8),
    purpose: PAYOUT_PROOF_AFFILIATE,
    communityId: 0,
    telegramUserId: "5",
    timestamp: now,
  });
  assert.equal((await linkSubscriberWallet(victim.data, victim.token, commission, repo, now)).ok, false);
  assert.equal((await linkSubscriberWallet(attacker.data, attacker.token, proof, repo, now)).ok, false);
  assert.equal((await linkSubscriberWallet(victim.data, victim.token, proof, repo, now)).ok, true);
  assert.equal(rows.get(5), tonWalletKey(proof.address));
  assert.equal(rows.has(9), false);
});
