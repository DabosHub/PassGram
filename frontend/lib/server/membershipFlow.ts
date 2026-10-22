import { tonWalletKey } from "../ton/walletKey";
import { validateInitData } from "./initData";
import {
  getMembershipRepository,
  type MembershipPaymentRow,
  type MembershipRepository,
  type MembershipRow,
  type OwnedCommunityRow,
} from "./membershipRepository";

export type LedgerSubscription = {
  id: number;
  subscriberUserId: string;
  communityId: number;
  confirmation: "unconfirmed" | "confirmed";
  startedAt: number | null;
  expiresAt: number | null;
  paymentAmount: string;
  paymentAsset: "USDT";
  transactionReference: string | null;
  renewalPending: boolean;
  createdAt: number;
  subscriberDisplayName: string;
  subscriberUsername: string;
  subscriberAvatarUrl: string;
};

export type LedgerPayment = {
  id: number;
  communityId: number;
  subscriberUserId: string;
  gross: string;
  creatorAmount: string;
  platformFee: string;
  affiliateAmount: string;
  communityAffiliateAmount: string;
  status: "unconfirmed" | "confirmed" | "failed";
  transactionReference: string | null;
  at: number;
};

export type LedgerCommunity = {
  id: number;
  ownerUserId: string;
  name: string;
  telegramUsername: string;
  telegramChatId: string;
  description: string;
  imageUrl: string;
  price: string;
  periodSeconds: number;
  payoutAddress: string;
  accessMode: "subscription";
  automationMode: "full";
  automationReady: false;
  confirmation: "confirmed";
  status: "active" | "paused";
  createdAt: number;
  referralEnabled: boolean;
  referralPercentBps: number;
};

export type OwnerLedgerCommunity = {
  community: LedgerCommunity;
  subscriptions: LedgerSubscription[];
  payments: LedgerPayment[];
};

export function toLedgerCommunity(row: OwnedCommunityRow): LedgerCommunity | null {
  if (!row.price || row.durationDays == null) return null;
  return {
    id: row.communityId,
    ownerUserId: `tg:${row.ownerTelegramUserId}`,
    name: row.title,
    telegramUsername: "",
    telegramChatId: row.telegramChatId,
    description: row.description || "",
    imageUrl: row.hasPhoto ? `/api/telegram/communities/${row.communityId}/photo` : "",
    price: row.price,
    periodSeconds: row.durationDays * 86_400,
    payoutAddress: "",
    accessMode: "subscription",
    automationMode: "full",
    automationReady: false,
    confirmation: "confirmed",
    status: row.paused || !row.active ? "paused" : "active",
    createdAt: 0,
    referralEnabled: row.referralEnabled,
    referralPercentBps: row.referralPercentBps,
  };
}

export function toLedgerSubscription(row: MembershipRow): LedgerSubscription {
  return {
    id: row.subscriberTelegramUserId,
    subscriberUserId: `tg:${row.subscriberTelegramUserId}`,
    communityId: row.communityId,
    confirmation: row.confirmation,
    startedAt: row.startedAtMs,
    expiresAt: row.expiresAtMs,
    paymentAmount: row.paymentAmount,
    paymentAsset: "USDT",
    transactionReference: null,
    renewalPending: row.renewalPending,
    createdAt: row.createdAtMs,
    subscriberDisplayName: row.displayName,
    subscriberUsername: row.username,
    subscriberAvatarUrl: row.photoUrl,
  };
}

export function toLedgerPayment(row: MembershipPaymentRow): LedgerPayment {
  return {
    id: row.paymentId,
    communityId: row.communityId,
    subscriberUserId: `tg:${row.subscriberTelegramUserId}`,
    gross: row.grossAmount,
    creatorAmount: row.creatorAmount,
    platformFee: row.platformFee,
    affiliateAmount: row.affiliateAmount,
    communityAffiliateAmount: row.communityAffiliateAmount,
    status: row.status,
    transactionReference: row.transactionReference,
    at: row.paidAtMs,
  };
}

export function assembleOwnerLedger(
  communities: OwnedCommunityRow[],
  memberships: MembershipRow[],
  payments: MembershipPaymentRow[],
): OwnerLedgerCommunity[] {
  return communities.flatMap((row) => {
    const community = toLedgerCommunity(row);
    if (!community) return [];
    return [
      {
        community,
        subscriptions: memberships.filter((item) => item.communityId === row.communityId).map(toLedgerSubscription),
        payments: payments.filter((item) => item.communityId === row.communityId).map(toLedgerPayment),
      },
    ];
  });
}

export async function readOwnerLedger(
  initData: string,
  botToken: string,
  repo?: MembershipRepository,
  nowSeconds = Date.now() / 1000,
): Promise<{ ok: true; communities: OwnerLedgerCommunity[] } | { ok: false; message: string }> {
  const identity = validateInitData(initData, botToken, nowSeconds);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const store = repo ?? (await getMembershipRepository());
  await store.upsertProfile({
    telegramUserId: identity.userId,
    displayName: identity.displayName,
    username: identity.username,
    photoUrl: identity.photoUrl,
  });
  const owned = await store.listOwnedCommunities(String(identity.userId));
  const ids = owned.map((row) => row.communityId);
  const [memberships, payments] = await Promise.all([store.listMemberships(ids), store.listPayments(ids)]);
  return { ok: true, communities: assembleOwnerLedger(owned, memberships, payments) };
}

export async function saveTelegramProfile(
  initData: string,
  botToken: string,
  repo?: MembershipRepository,
  nowSeconds = Date.now() / 1000,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const identity = validateInitData(initData, botToken, nowSeconds);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const store = repo ?? (await getMembershipRepository());
  await store.upsertProfile({
    telegramUserId: identity.userId,
    displayName: identity.displayName,
    username: identity.username,
    photoUrl: identity.photoUrl,
  });
  return { ok: true };
}

export async function readSubscriberLedger(
  initData: string,
  botToken: string,
  repo?: MembershipRepository,
  nowSeconds = Date.now() / 1000,
): Promise<{ ok: true; subscriptions: LedgerSubscription[]; payments: LedgerPayment[] } | { ok: false; message: string }> {
  const identity = validateInitData(initData, botToken, nowSeconds);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const store = repo ?? (await getMembershipRepository());
  const [memberships, payments] = await Promise.all([
    store.listSubscriberMemberships(identity.userId),
    store.listSubscriberPayments(identity.userId),
  ]);
  const ledgerPayments = payments.map(toLedgerPayment);
  const subscriptions = memberships.map((row) => {
    const subscription = toLedgerSubscription(row);
    const latest = ledgerPayments.find(
      (payment) => payment.communityId === row.communityId && payment.status === "confirmed",
    );
    return { ...subscription, transactionReference: latest?.transactionReference ?? null };
  });
  return { ok: true, subscriptions, payments: ledgerPayments };
}

export async function linkSubscriberWallet(
  initData: string,
  botToken: string,
  address: string,
  repo?: MembershipRepository,
  nowSeconds = Date.now() / 1000,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const identity = validateInitData(initData, botToken, nowSeconds);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const key = tonWalletKey(address);
  if (!key) return { ok: false, message: "Enter a TON wallet address." };
  const store = repo ?? (await getMembershipRepository());
  const linked = await store.linkTonWallet(identity.userId, key);
  if (linked === "taken") return { ok: false, message: "This wallet is already linked to another Telegram account." };
  return { ok: true };
}
