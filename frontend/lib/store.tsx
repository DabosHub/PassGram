"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { paymentBlockers, type AffiliateProfile, type Confirmation } from "./domain";
import { normalizeCode } from "./money";
import { contractIsConfigured } from "./ton/config";
import { sendSubscriptionPayment } from "./ton/payments";
import { mergeSubscriberSnapshot, type SubscriberSnapshot } from "./subscriberLedger";
import { getConnectedTonAddress, signLinkedWallet, connectTonWallet, type WalletSendResult } from "./ton/wallet";
import { tonWalletKey } from "./ton/walletKey";
import { isDemoLabEnabled } from "./demoLab";
import type { PayoutWalletProof } from "./ton/walletProof";
import { confirmCommunityCreation, confirmPayment, type Gate } from "./services/confirmation";

export type PassgramUser = {
  id: string;
  displayName: string;
  username: string;
  telegramUserId: number | null;
  avatarUrl: string;
  createdAt: number;
  payoutAddress: string;
  referralCode: string | null;
  referralLocked: boolean;
};

export type CommunityRecord = {
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
  automationMode: "full" | "assisted";
  automationReady: false;
  confirmation: Confirmation;
  status: "pending_confirmation" | "active" | "paused";
  createdAt: number;
  referralEnabled: boolean;
  referralPercentBps: number;
  /** Telegram channel member total, including people who did not pay through PassGram. */
  telegramMemberCount?: number | null;
  ownerDisplayName?: string;
  ownerUsername?: string;
  ownerAvatarUrl?: string;
};

export type SubscriptionRecord = {
  id: number;
  subscriberUserId: string;
  communityId: number;
  confirmation: Confirmation;
  startedAt: number | null;
  expiresAt: number | null;
  paymentAmount: string;
  paymentAsset: "USDT";
  transactionReference: string | null;
  renewalPending: boolean;
  createdAt: number;
  subscriberDisplayName?: string;
  subscriberUsername?: string;
  subscriberAvatarUrl?: string;
};

export type AffiliateRecord = AffiliateProfile & {
  confirmation: Confirmation;
  createdAt: number;
};

export type PaymentRecord = {
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

type Ledger = {
  user: PassgramUser;
  communities: CommunityRecord[];
  subscriptions: SubscriptionRecord[];
  affiliates: AffiliateRecord[];
  payments: PaymentRecord[];
};

export type ActionOutcome = {
  ok: boolean;
  reasons: string[];
  tx: WalletSendResult | null;
};

type Store = Ledger & {
  ready: boolean;
  notice: string | null;
  lastTx: WalletSendResult | null;
  /** TON address from TON Connect in this session. Not persisted. */
  walletAccount: string | null;
  clearNotice: () => void;
  dismissTx: () => void;
  connectWallet: () => Promise<string | null>;
  syncWalletAccount: (address: string | null) => void;
  setTelegramProfile: (profile: {
    telegramUserId: number | null;
    displayName: string;
    username: string;
    avatarUrl: string;
  }) => void;
  acceptReferral: (code: string) => Promise<string | null>;
  prepareCommunity: () => Promise<ActionOutcome>;
  preparePayment: (communityId: number) => Promise<ActionOutcome>;
  prepareAffiliate: (proof: PayoutWalletProof) => Promise<ActionOutcome>;
  patchOwnedCommunity: (
    communityId: number,
    patch: Partial<Pick<CommunityRecord, "price" | "periodSeconds" | "payoutAddress" | "referralEnabled" | "referralPercentBps" | "status">>,
  ) => boolean;
  rememberCommunity: (input: {
    communityId: number;
    title: string;
    description: string | null;
    priceUsdt: string;
    durationDays: number;
    ownerTelegramUserId: string;
    imageUrl?: string;
    payoutAddress?: string;
    referralEnabled?: boolean;
    referralPercentBps?: number;
    telegramMemberCount?: number | null;
    ownerDisplayName?: string;
    ownerUsername?: string;
    ownerAvatarUrl?: string;
    paused?: boolean;
  }) => void;
  noteCommunityCreator: (communityId: number, creator: { displayName: string; username: string; avatarUrl: string }) => void;
  noteTelegramMembers: (communityId: number, count: number) => void;
  applySubscriberLedger: (ledger: SubscriberSnapshot) => void;
  /** Dev lab only: replace local preview ledger for UI walkthroughs. */
  replaceLedger: (ledger: Ledger) => void;
  /** Dev lab only: show/hide the transaction overlay. */
  setDemoLastTx: (tx: WalletSendResult | null) => void;
};

const StoreContext = createContext<Store | null>(null);
const STORAGE_KEY = "passgram.preview.v5";
const LEGACY_KEYS = ["passgram.preview.v1", "passgram.preview.v2", "passgram.preview.v3", "passgram.preview.v4"];

function blankUser(): PassgramUser {
  return {
    id: "local:pending",
    displayName: "Guest",
    username: "",
    telegramUserId: null,
    avatarUrl: "",
    createdAt: Date.now(),
    payoutAddress: "",
    referralCode: null,
    referralLocked: false,
  };
}

function blankLedger(): Ledger {
  return { user: blankUser(), communities: [], subscriptions: [], affiliates: [], payments: [] };
}

function loadLedger(): Ledger {
  if (typeof window === "undefined") return blankLedger();
  for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
  const fallback = blankLedger();
  const storedId = window.localStorage.getItem("passgram.userId");
  const id = storedId || `local:${crypto.randomUUID()}`;
  window.localStorage.setItem("passgram.userId", id);
  fallback.user = { ...fallback.user, id, createdAt: Date.now() };
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    return {
      user: { ...fallback.user, ...parsed.user, id: parsed.user?.id || id },
      communities: Array.isArray(parsed.communities) ? parsed.communities : [],
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      affiliates: Array.isArray(parsed.affiliates) ? parsed.affiliates : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
    };
  } catch {
    return fallback;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Ledger>(blankLedger);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<WalletSendResult | null>(null);
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const applied = useRef(false);

  useEffect(() => {
    setSession(loadLedger());
    applied.current = true;
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !applied.current) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    window.localStorage.setItem("passgram.userId", session.user.id);
  }, [session, ready]);

  const api = useMemo<Store>(() => {
    return {
      ...session,
      ready,
      notice,
      lastTx,
      walletAccount,
      clearNotice: () => setNotice(null),
      dismissTx: () => setLastTx(null),
      connectWallet: async () => {
        const account = await connectTonWallet();
        setWalletAccount(account);
        return account;
      },
      syncWalletAccount: (address) => setWalletAccount(address),
      setTelegramProfile: (profile) => {
        setSession((current) => {
          const noActivity =
            current.communities.length === 0 &&
            current.subscriptions.length === 0 &&
            current.affiliates.length === 0;
          const id =
            profile.telegramUserId && profile.telegramUserId > 0 && current.user.id.startsWith("local:") && noActivity
              ? `tg:${profile.telegramUserId}`
              : current.user.id;
          return {
            ...current,
            user: {
              ...current.user,
              id,
              displayName: profile.displayName.trim() || current.user.displayName,
              username: profile.username,
              telegramUserId: profile.telegramUserId,
              avatarUrl: profile.avatarUrl || current.user.avatarUrl,
            },
          };
        });
      },
      patchOwnedCommunity: (communityId, patch) => {
        const owned = session.communities.some((item) => item.id === communityId && item.ownerUserId === session.user.id);
        if (!owned) return false;
        setSession((current) => ({
          ...current,
          communities: current.communities.map((item) => (item.id === communityId ? { ...item, ...patch } : item)),
        }));
        return true;
      },
      rememberCommunity: (input) => {
        const ownerUserId = `tg:${input.ownerTelegramUserId}`;
        const row: CommunityRecord = {
          id: input.communityId,
          ownerUserId,
          name: input.title,
          telegramUsername: "",
          telegramChatId: "",
          description: input.description || "",
          imageUrl: input.imageUrl || `/api/telegram/communities/${input.communityId}/photo`,
          price: input.priceUsdt,
          periodSeconds: input.durationDays * 24 * 60 * 60,
          payoutAddress: input.payoutAddress || "",
          accessMode: "subscription",
          automationMode: "full",
          automationReady: false,
          confirmation: "confirmed",
          status: "active",
          createdAt: Date.now(),
          referralEnabled: Boolean(input.referralEnabled),
          referralPercentBps: input.referralPercentBps ?? 0,
          telegramMemberCount: input.telegramMemberCount ?? null,
          ownerDisplayName: input.ownerDisplayName || "",
          ownerUsername: input.ownerUsername || "",
          ownerAvatarUrl: input.ownerAvatarUrl || "",
        };
        setSession((current) => {
          const previous = current.communities.find((item) => item.id === row.id);
          const next = {
            ...row,
            telegramChatId: previous?.telegramChatId || row.telegramChatId,
            telegramMemberCount: input.telegramMemberCount !== undefined ? input.telegramMemberCount : previous?.telegramMemberCount ?? null,
            ownerDisplayName: input.ownerDisplayName || previous?.ownerDisplayName || "",
            ownerUsername: input.ownerUsername || previous?.ownerUsername || "",
            ownerAvatarUrl: input.ownerAvatarUrl || previous?.ownerAvatarUrl || "",
            status: input.paused === true ? "paused" : input.paused === false ? "active" : previous?.status || row.status,
            createdAt: previous?.createdAt || row.createdAt,
          };
          const without = current.communities.filter((item) => item.id !== row.id);
          return { ...current, communities: [...without, next] };
        });
      },
      applySubscriberLedger: (ledger) => {
        setSession((current) => {
          const next = mergeSubscriberSnapshot(
            { userId: current.user.id, subscriptions: current.subscriptions, payments: current.payments },
            ledger,
          );
          if (!next) return current;
          return { ...current, subscriptions: next.subscriptions, payments: next.payments };
        });
      },
      noteCommunityCreator: (communityId, creator) => {
        const displayName = creator.displayName.trim();
        const username = creator.username.trim().replace(/^@/, "");
        const avatarUrl = creator.avatarUrl.trim();
        if (!displayName && !username && !avatarUrl) return;
        setSession((current) => {
          const existing = current.communities.find((item) => item.id === communityId);
          if (!existing) return current;
          if (
            (existing.ownerDisplayName || "") === displayName &&
            (existing.ownerUsername || "") === username &&
            (existing.ownerAvatarUrl || "") === avatarUrl
          ) {
            return current;
          }
          return {
            ...current,
            communities: current.communities.map((item) =>
              item.id === communityId
                ? { ...item, ownerDisplayName: displayName, ownerUsername: username, ownerAvatarUrl: avatarUrl }
                : item,
            ),
          };
        });
      },
      noteTelegramMembers: (communityId, count) => {
        if (!Number.isInteger(count) || count < 0) return;
        setSession((current) => {
          const existing = current.communities.find((item) => item.id === communityId);
          if (!existing || existing.telegramMemberCount === count) return current;
          return {
            ...current,
            communities: current.communities.map((item) => (item.id === communityId ? { ...item, telegramMemberCount: count } : item)),
          };
        });
      },
      replaceLedger: (ledger) => {
        setSession({
          user: { ...ledger.user },
          communities: [...ledger.communities],
          subscriptions: [...ledger.subscriptions],
          affiliates: [...ledger.affiliates],
          payments: [...ledger.payments],
        });
      },
      setDemoLastTx: (tx) => setLastTx(tx),
      acceptReferral: async (code) => {
        try {
          const response = await fetch("/api/telegram/referrals/attribute", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
            },
            body: JSON.stringify({ code }),
          });
          const result = (await response.json()) as {
            ok?: boolean;
            message?: string;
            result?: string;
            attribution?: { referrerCode: string };
          };
          if (result.result === "already_locked" || result.result === "locked") {
            const lockedCode = result.attribution?.referrerCode || normalizeCode(code);
            if (lockedCode) {
              setSession((current) => ({
                ...current,
                user: { ...current.user, referralCode: lockedCode, referralLocked: true },
              }));
            }
            return null;
          }
          return result.message || "This referral code was not saved.";
        } catch {
          return "Referral attribution could not reach the server.";
        }
      },
      prepareCommunity: async () => {
        const gate: Gate = await confirmCommunityCreation();
        return { ok: false, reasons: gate.reasons, tx: null };
      },
      preparePayment: async (communityId) => {
        const community = session.communities.find((item) => item.id === communityId && item.confirmation === "confirmed");
        const walletConnected = Boolean(walletAccount || getConnectedTonAddress());
        const reasons = paymentBlockers({
          contractConfigured: contractIsConfigured(),
          communityConfirmed: Boolean(community),
          self: community ? community.ownerUserId === session.user.id : false,
          walletConnected,
        });
        if (!community || !walletConnected) return { ok: false, reasons, tx: null };
        if (community.status === "paused") {
          return { ok: false, reasons: ["This community is deactivated. Payments and renewals are closed."], tx: null };
        }
        const initData = typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "";
        const linkedAddress = getConnectedTonAddress();
        if (initData && linkedAddress && !isDemoLabEnabled()) {
          try {
            const known = await fetch("/api/telegram/wallet", {
              headers: { "x-telegram-init-data": initData },
            });
            const saved = (await known.json()) as { ok?: boolean; address?: string | null };
            const savedKey = saved.ok ? tonWalletKey(saved.address || "") : null;
            const connectedKey = tonWalletKey(linkedAddress);
            if (!savedKey || savedKey !== connectedKey) {
              const telegramUserId = session.user.telegramUserId ? String(session.user.telegramUserId) : "";
              const signed = await signLinkedWallet(telegramUserId);
              if (!signed.ok) return { ok: false, reasons: [signed.message], tx: null };
              const linked = await fetch("/api/telegram/wallet", {
                method: "POST",
                headers: { "content-type": "application/json", "x-telegram-init-data": initData },
                body: JSON.stringify({ proof: signed.proof }),
              });
              const body = (await linked.json()) as { ok?: boolean; message?: string };
              if (!body.ok) {
                return { ok: false, reasons: [body.message || "Wallet could not be linked to this Telegram account."], tx: null };
              }
            }
          } catch {
            return { ok: false, reasons: ["Wallet link could not reach the server."], tx: null };
          }
        }
        const payerWallet = getConnectedTonAddress() || walletAccount;
        if (!payerWallet) return { ok: false, reasons: ["Connect your TON wallet before paying."], tx: null };
        let communityReferrerAddress: string | null = null;
        let communityReferralBps: number | null = null;
        let referralAuthorization: string | null = null;
        let referralAuthorizationValidUntil: number | null = null;
        try {
          const settlement = await fetch(
            `/api/telegram/referrals/community/settlement?communityId=${community.id}&wallet=${encodeURIComponent(payerWallet)}`,
            {
              headers: {
                "x-telegram-init-data":
                  typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
              },
            },
          );
          const settled = (await settlement.json()) as {
            ok?: boolean;
            message?: string;
            communityReferrerPayout?: string | null;
            referralPercentBps?: number;
            referralAuthorization?: string;
            referralAuthorizationValidUntil?: number;
          };
          if (!settlement.ok || settled.ok === false || !settled.referralAuthorization || !settled.referralAuthorizationValidUntil) {
            return {
              ok: false,
              reasons: [settled.message || "Referral settlement could not be confirmed. The payment was not sent."],
              tx: null,
            };
          }
          communityReferrerAddress = settled.communityReferrerPayout ?? null;
          communityReferralBps = settled.referralPercentBps ?? null;
          referralAuthorization = settled.referralAuthorization;
          referralAuthorizationValidUntil = settled.referralAuthorizationValidUntil;
        } catch {
          return {
            ok: false,
            reasons: ["Referral settlement could not be confirmed. The payment was not sent."],
            tx: null,
          };
        }
        const tx = await sendSubscriptionPayment({
          communityId: community.id,
          amount: community.price,
          communityReferrerAddress,
          communityReferralBps,
          referralAuthorization,
          referralAuthorizationValidUntil,
        });
        setLastTx(tx);
        const gate = await confirmPayment();
        return { ok: false, reasons: [...reasons, ...gate.reasons], tx };
      },
      prepareAffiliate: async (proof) => {
        try {
          const response = await fetch("/api/telegram/referrals/register", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
            },
            body: JSON.stringify({
              proof,
              telegramUsername: session.user.username,
            }),
          });
          const result = (await response.json()) as {
            ok?: boolean;
            message?: string;
            affiliate?: { code: string; payoutAccount: string; telegramUserId: string };
          };
          const affiliate = result.affiliate;
          if (!result.ok || !affiliate) {
            return { ok: false, reasons: [result.message || "Referral registration failed."], tx: null };
          }
          const affiliateRow = {
            userId: session.user.id,
            code: affiliate.code,
            payoutAddress: affiliate.payoutAccount,
            confirmation: "confirmed" as const,
            createdAt: Date.now(),
          };
          setSession((current) => {
            const withoutSelf = current.affiliates.filter((item) => item.userId !== current.user.id);
            return {
              ...current,
              user: { ...current.user, payoutAddress: affiliate.payoutAccount },
              affiliates: [...withoutSelf, affiliateRow],
            };
          });
          return { ok: true, reasons: [], tx: null };
        } catch {
          return { ok: false, reasons: ["Referral registration could not reach the server."], tx: null };
        }
      },
    };
  }, [session, ready, notice, lastTx, walletAccount]);

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("Store missing");
  return store;
}
