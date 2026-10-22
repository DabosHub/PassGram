"use client";

import { useEffect, useState } from "react";
import type { SubscriberAccess } from "./subscriberAccess";
import type { PaymentRecord, SubscriptionRecord } from "./store";

export type SubscriberLedger = {
  subscriptions: SubscriptionRecord[];
  payments: PaymentRecord[];
  access: SubscriberAccess[];
};

const POLL_MS = 15_000;

let cache: SubscriberLedger | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function refreshSubscriberLedger() {
  if (inflight || typeof window === "undefined") return;
  const initData = window.Telegram?.WebApp?.initData || "";
  if (!initData) return;
  inflight = true;
  try {
    const response = await fetch("/api/telegram/memberships", {
      headers: { "x-telegram-init-data": initData },
    });
    const result = (await response.json()) as SubscriberLedger & { ok?: boolean };
    if (!result.ok || !Array.isArray(result.subscriptions) || !Array.isArray(result.payments)) return;
    cache = {
      subscriptions: result.subscriptions,
      payments: result.payments,
      access: Array.isArray(result.access) ? result.access : [],
    };
    listeners.forEach((listener) => listener());
  } catch {
    /* Keep the last confirmed membership snapshot. */
  } finally {
    inflight = false;
  }
}

function startPolling() {
  if (timer) return;
  void refreshSubscriberLedger();
  timer = setInterval(() => void refreshSubscriberLedger(), POLL_MS);
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
