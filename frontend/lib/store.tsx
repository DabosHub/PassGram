"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { paymentBlockers, type AffiliateProfile, type Confirmation } from "./domain";
import { normalizeCode } from "./money";
import { contractIsConfigured } from "./ton/config";
import { normalizeTonAddress } from "./ton/config";
import { sendSubscriptionPayment } from "./ton/payments";
import { connectTonWallet, type WalletSendResult } from "./ton/wallet";
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
  savePayout: (payoutAddress: string) => string | null;
  acceptReferral: (code: string) => Promise<string | null>;
  prepareCommunity: () => Promise<ActionOutcome>;
  preparePayment: (communityId: number) => Promise<ActionOutcome>;
  prepareAffiliate: (input: { payoutAddress: string }) => Promise<ActionOutcome>;
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
  }) => void;
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
      savePayout: (payoutAddress) => {
        const payout = normalizeTonAddress(payoutAddress);
        if (!payout) return "Enter a TON address (EQ… / UQ… or 0:…).";
        setSession((current) => ({ ...current, user: { ...current.user, payoutAddress: payout } }));
        setNotice("Payout preference saved on this device. It is not registered on-chain and does not move funds.");
        return null;
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
        };
        setSession((current) => {
          const without = current.communities.filter((item) => item.id !== row.id);
          return { ...current, communities: [...without, row] };
        });
      },
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
        const walletConnected = Boolean(walletAccount);
        const reasons = paymentBlockers({
          contractConfigured: contractIsConfigured(),
          communityConfirmed: Boolean(community),
          self: community ? community.ownerUserId === session.user.id : false,
          walletConnected,
        });
        if (!community || !walletConnected) return { ok: false, reasons, tx: null };
        let communityReferrerAddress: string | null = null;
        try {
          const settlement = await fetch(
            `/api/telegram/referrals/community/settlement?communityId=${community.id}`,
            {
              headers: {
                "x-telegram-init-data":
                  typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
              },
            },
          );
          const settled = (await settlement.json()) as { communityReferrerPayout?: string | null };
          communityReferrerAddress = settled.communityReferrerPayout ?? null;
        } catch {
          communityReferrerAddress = null;
        }
        const tx = await sendSubscriptionPayment({
          communityId: community.id,
          amount: community.price,
          hasPlatformReferrer: Boolean(session.user.referralCode),
          communityReferrerAddress,
        });
        setLastTx(tx);
        const gate = await confirmPayment();
        return { ok: false, reasons: [...reasons, ...gate.reasons], tx };
      },
      prepareAffiliate: async (input) => {
        const payout = normalizeTonAddress(input.payoutAddress);
        if (!payout) {
          return {
            ok: false,
            reasons: ["Enter a TON payout address (EQ… / UQ… or 0:…)."],
            tx: null,
          };
        }
        try {
          const response = await fetch("/api/telegram/referrals/register", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
            },
            body: JSON.stringify({
              payoutAccount: payout,
              telegramUsername: session.user.username,
            }),
          });
          const result = (await response.json()) as {
            ok?: boolean;
            message?: string;
            affiliate?: { code: string; payoutAccount: string; telegramUserId: string };
          };
          if (!result.ok || !result.affiliate) {
            return { ok: false, reasons: [result.message || "Referral registration failed."], tx: null };
          }
          const affiliateRow = {
            userId: session.user.id,
            code: result.affiliate.code,
            payoutAddress: result.affiliate.payoutAccount,
            confirmation: "confirmed" as const,
            createdAt: Date.now(),
          };
          setSession((current) => {
            const withoutSelf = current.affiliates.filter((item) => item.userId !== current.user.id);
            return {
              ...current,
              user: { ...current.user, payoutAddress: payout },
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
