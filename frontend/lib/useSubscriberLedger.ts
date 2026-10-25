"use client";

import { useEffect, useState } from "react";
import { membershipPollMs } from "./subscriberAccess";
import type { SubscriberAccess } from "./subscriberAccess";
import type { PaymentRecord, SubscriptionRecord } from "./store";

export type SubscriberLedger = {
  subscriptions: SubscriptionRecord[];
  payments: PaymentRecord[];
  access: SubscriberAccess[];
};

const PENDING_WINDOW_MS = 3 * 60_000;
const PAYMENT_CLOCK_SKEW_MS = 120_000;

let cache: SubscriberLedger | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let inflightFresh = false;
let refreshAgain = false;
let freshMemberCheck = false;
let awaiting: { communityId: number; since: number } | null = null;
const FRESH_MEMBER_KEY = "passgram.freshMember";

function readStoredFresh(): { until: number; communityId: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(FRESH_MEMBER_KEY) || "null") as {
      until?: number;
      communityId?: number;
    } | null;
    if (!parsed || typeof parsed.until !== "number" || parsed.until <= Date.now() || typeof parsed.communityId !== "number") {
      sessionStorage.removeItem(FRESH_MEMBER_KEY);
      return null;
    }
    return { until: parsed.until, communityId: parsed.communityId };
  } catch {
    return null;
  }
}

function freshRequested(): boolean {
  if (freshMemberCheck) return true;
  if (!readStoredFresh()) return false;
  freshMemberCheck = true;
  return true;
}

function paymentStillPending(now = Date.now()): boolean {
  if (!awaiting) return false;
  if (now - awaiting.since <= PENDING_WINDOW_MS) return true;
  awaiting = null;
  reschedule();
  return false;
}

function noteConfirmedPayments(payments: PaymentRecord[]) {
  if (!awaiting) return;
  const since = awaiting.since;
  const communityId = awaiting.communityId;
  const found = payments.some(
    (payment) =>
      payment.communityId === communityId &&
      payment.status === "confirmed" &&
      payment.at >= since - PAYMENT_CLOCK_SKEW_MS,
  );
  if (!found) return;
  awaiting = null;
  reschedule();
}

function reschedule() {
  if (!timer) return;
  clearInterval(timer);
  timer = setInterval(() => void refreshSubscriberLedger(), membershipPollMs(paymentStillPending()));
}

/** Poll faster until this community's confirmed payment shows up, then return to the idle interval. */
export function notePaymentAwaitingConfirmation(communityId: number) {
  awaiting = { communityId, since: Date.now() };
  reschedule();
  void refreshSubscriberLedger();
}

/** The next membership read asks Telegram again instead of using the 30s member cache. */
export function setFreshMemberCheck(enabled: boolean, communityId?: number) {
  freshMemberCheck = enabled;
  try {
    if (typeof window !== "undefined") {
      if (enabled && communityId != null) {
        sessionStorage.setItem(FRESH_MEMBER_KEY, JSON.stringify({ until: Date.now() + 2 * 60_000, communityId }));
      } else if (!enabled) {
        sessionStorage.removeItem(FRESH_MEMBER_KEY);
      }
    }
  } catch {
    /* The in-memory flag still covers this open page. */
  }
  if (enabled) void refreshSubscriberLedger();
}

async function refreshSubscriberLedger() {
  if (typeof window === "undefined") return;
  paymentStillPending();
  const wantFresh = freshRequested();
  if (inflight) {
    if (wantFresh && !inflightFresh) refreshAgain = true;
    return;
  }
  const initData = window.Telegram?.WebApp?.initData || "";
  if (!initData) return;
  inflight = true;
  inflightFresh = wantFresh;
  try {
    const headers: Record<string, string> = { "x-telegram-init-data": initData };
    if (inflightFresh) headers["x-passgram-fresh-member"] = "1";
    const response = await fetch("/api/telegram/memberships", { headers });
    const result = (await response.json()) as SubscriberLedger & { ok?: boolean };
    if (!result.ok || !Array.isArray(result.subscriptions) || !Array.isArray(result.payments)) return;
    cache = {
      subscriptions: result.subscriptions,
      payments: result.payments,
      access: Array.isArray(result.access) ? result.access : [],
    };
    noteConfirmedPayments(cache.payments);
    const watched = readStoredFresh()?.communityId;
    if (watched != null && cache.access.some((row) => row.communityId === watched && row.inChannel === true)) {
      setFreshMemberCheck(false);
    }
    listeners.forEach((listener) => listener());
  } catch {
    /* Keep the last confirmed membership snapshot. */
  } finally {
    const wasFresh = inflightFresh;
    inflight = false;
    inflightFresh = false;
    const again = refreshAgain || (freshMemberCheck && !wasFresh);
    refreshAgain = false;
    if (again) void refreshSubscriberLedger();
  }
}

function startPolling() {
  if (timer) return;
  void refreshSubscriberLedger();
  timer = setInterval(() => void refreshSubscriberLedger(), membershipPollMs(paymentStillPending()));
}

function stopPolling() {
  if (listeners.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
}

export function refreshSubscriberLedgerNow() {
  void refreshSubscriberLedger();
}

/** Confirmed memberships for the signed-in subscriber. A demo scene keeps the local preview. */
export function useSubscriberLedger(paused: boolean): SubscriberLedger | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (paused) return;
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    startPolling();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshSubscriberLedger();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      listeners.delete(listener);
      document.removeEventListener("visibilitychange", onVisible);
      stopPolling();
    };
  }, [paused]);
  return paused ? null : cache;
}
