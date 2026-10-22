"use client";

import { useEffect, useState } from "react";
import type { CommunityRecord, PaymentRecord, SubscriptionRecord } from "./store";

export type OwnerLedger = {
  communities: Array<{
    community: CommunityRecord;
    subscriptions: SubscriptionRecord[];
    payments: PaymentRecord[];
  }>;
};

const POLL_MS = 15_000;

let cache: OwnerLedger | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function refreshLedger() {
  if (inflight || typeof window === "undefined") return;
  inflight = true;
  try {
    const response = await fetch("/api/telegram/ledger", {
      headers: { "x-telegram-init-data": window.Telegram?.WebApp?.initData || "" },
    });
    const result = (await response.json()) as { ok?: boolean; communities?: OwnerLedger["communities"] };
    if (result.ok && Array.isArray(result.communities)) {
      cache = { communities: result.communities };
      listeners.forEach((listener) => listener());
    }
  } catch {
    /* Keep the last database snapshot. */
  } finally {
    inflight = false;
  }
}

function startPolling() {
  if (timer) return;
  void refreshLedger();
  timer = setInterval(() => void refreshLedger(), POLL_MS);
}

function stopPolling() {
  if (listeners.size > 0 || !timer) return;
  clearInterval(timer);
  timer = null;
}

/** Live owner communities, memberships, and payments. A demo scene keeps the local preview. */
export function useOwnerLedger(paused: boolean): OwnerLedger | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (paused) return;
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    startPolling();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLedger();
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
