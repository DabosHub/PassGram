"use client";

import { useEffect, useState } from "react";
import {
  activePassgramCount,
  formatCommunityLink,
  pageOf,
  remainingLabel,
  renewalWindowOpen,
  statusLabel,
  subscriptionActions,
  subscriptionProgress,
  subscriptionStatus,
  type SubscriptionStatus,
} from "@/lib/domain";
import { formatCommunityReferralPercent, formatDate, formatUsdt, formatWhen, parseCommunityReferralBps } from "@/lib/money";
import { parseCommunityPrice, parseDurationDays } from "@/lib/channelPolicy";
import { contractIsConfigured, tonConfig } from "@/lib/ton/config";
import { buildSetCommunityPausedBody, buildSetCommunityReferralBody, buildUpdateCommunityBody } from "@/lib/ton/registry";
import { sendRegistryCall } from "@/lib/ton/send";
import { buildDemoLastTx } from "@/lib/demoLab";
import { useDemoLab } from "@/lib/demoLabContext";
import { useOwnerLedger } from "@/lib/useOwnerLedger";
import type { AppRoute } from "@/lib/route";
import { useStore, type CommunityRecord, type PaymentRecord, type SubscriptionRecord } from "@/lib/store";
import { getConnectedTonAddress } from "@/lib/ton/wallet";
import { Avatar, dangerButton, EmptyState, Field, primaryButton, ReasonList, secondaryButton, useNow } from "./ui";

export function CommunityRoute({
  communityId,
  linkError,
}: {
  communityId: number | null;
  linkError: AppRoute["linkError"];
}) {
  const store = useStore();
  const now = useNow();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (linkError === "invalid_community" || communityId == null) return;
    const cached = store.communities.some((item) => item.id === communityId && item.confirmation === "confirmed");
    let cancelled = false;
    if (!cached) {
      setLoading(true);
      setLoadError(null);
    }
    void fetch(`/api/telegram/communities/${communityId}`)
      .then(async (response) => {
        const result = (await response.json()) as {
          ok?: boolean;
          message?: string;
          community?: {
            communityId: number;
            title: string;
            description: string | null;
            hasPhoto: boolean;
            priceUsdt: string;
            durationDays: number;
            ownerTelegramUserId: string;
            ownerLabel: string;
            ownerDisplayName?: string;
            ownerUsername?: string;
            ownerAvatarUrl?: string;
            telegramMemberCount?: number | null;
            paused?: boolean;
          };
        };
        if (cancelled) return;
        if (!result.ok || !result.community) {
          setLoadError(result.message || "This community is unavailable.");
          return;
        }
        store.rememberCommunity({
          communityId: result.community.communityId,
          title: result.community.title,
          description: result.community.description,
          priceUsdt: result.community.priceUsdt,
          durationDays: result.community.durationDays,
          ownerTelegramUserId: result.community.ownerTelegramUserId,
          ownerDisplayName: result.community.ownerDisplayName,
          ownerUsername: result.community.ownerUsername,
          ownerAvatarUrl: result.community.ownerAvatarUrl,
          telegramMemberCount: result.community.telegramMemberCount,
          paused: result.community.paused,
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError("This community could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, linkError]);

  if (linkError === "invalid_community" || communityId == null) {
    return <Unavailable title="This community link is invalid." body="The link does not contain a usable community id." />;
  }
  if (loading) return <p className="text-sm text-[var(--pg-hint)]">Loading community</p>;
  const community = store.communities.find((item) => item.id === communityId && item.confirmation === "confirmed");
  if (!community) {
    return (
      <Unavailable
        title="This community is unavailable."
        body={loadError || "PassGram has no confirmed public listing for this link. An unknown id is not treated as a community."}
      />
    );
  }
  const existing = store.subscriptions.find(
    (item) => item.communityId === community.id && item.subscriberUserId === store.user.id && item.confirmation === "confirmed",
  );
  if (existing) {
    return <SubscriptionDetail community={community} subscription={existing} now={now} />;
  }
  return <Purchase community={community} />;
}

export function SubscriptionRoute({ communityId }: { communityId: number | null }) {
  const store = useStore();
  const now = useNow();
  const subscription = store.subscriptions.find(
    (item) => item.communityId === communityId && item.subscriberUserId === store.user.id,
  );
  const community = store.communities.find((item) => item.id === communityId);
  if (!subscription || !community) {
    return <Unavailable title="Subscription not found." body="There is no confirmed subscription for this community on your account." />;
  }
  return <SubscriptionDetail community={community} subscription={subscription} now={now} />;
}

export function ManageRoute({ communityId, go }: { communityId: number | null; go: (route: AppRoute) => void }) {
  const store = useStore();
  const now = useNow();
  const community = store.communities.find((item) => item.id === communityId && item.ownerUserId === store.user.id);
  if (!community) return <Unavailable title="Community not found." body="This account does not have a confirmed community with that id." />;
  return <Manage community={community} now={now} go={go} />;
}

function Purchase({ community }: { community: CommunityRecord }) {
  const store = useStore();
  const lab = useDemoLab();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const durationDays = Math.max(1, Math.round(community.periodSeconds / 86_400));
  const price = formatUsdt(community.price);
  const members = community.telegramMemberCount;

  async function pay() {
    if (busy || community.status === "paused") return;
    setBusy(true);
    setReasons([]);
    try {
      if (lab.enabled) {
        store.setDemoLastTx(buildDemoLastTx());
        return;
      }
      if (!getConnectedTonAddress()) {
        const account = await store.connectWallet();
        if (!account) {
          setReasons(["Connect a TON wallet to continue. Payment was not requested."]);
          return;
        }
      }
      const outcome = await store.preparePayment(community.id);
      setReasons(outcome.reasons);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
      <div className="flex items-start gap-3">
        <Avatar name={community.name} seed={community.telegramChatId || String(community.id)} imageUrl={community.imageUrl} className="h-14 w-14" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="truncate text-base font-semibold">{community.name}</h1>
          {community.telegramUsername ? (
            <p className="mt-0.5 truncate text-xs text-[var(--pg-hint)]">{`@${community.telegramUsername}`}</p>
          ) : null}
          <p className="mt-1 flex items-center gap-1 text-xs text-[var(--pg-hint)]">
            <MembersIcon />
            <span>{members == null ? "—" : members}</span>
            <span className="sr-only">Telegram members</span>
          </p>
        </div>
      </div>
      {community.description ? <p className="text-sm leading-relaxed text-[var(--pg-hint)]">{community.description}</p> : null}
      <CreatedBy community={community} />
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-[var(--pg-hint)]">Subscription price</dt>
          <dd className="mt-1 text-sm font-semibold">{price} USDT</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--pg-hint)]">Subscription duration</dt>
          <dd className="mt-1 text-sm font-semibold">{durationDays} days</dd>
        </div>
      </dl>
      <div className="space-y-2 border-t border-[var(--pg-line)] pt-3">
        <p className="text-[11px] text-[var(--pg-hint)]">Access</p>
        <p className="text-sm leading-relaxed">Channel access for {durationDays} days after the payment is confirmed.</p>
        <p className="text-xs leading-relaxed text-[var(--pg-hint)]">
          Paid in USDT on TON ({tonConfig.network}). TON may charge a small network fee. PassGram does not add a fee on top of the price.
        </p>
      </div>
      <ReasonList reasons={reasons} />
      {community.status === "paused" ? (
        <p className="text-sm text-[var(--pg-hint)]">This community is deactivated. New subscriptions are closed.</p>
      ) : (
        <div className="space-y-2">
          <button type="button" className={`${primaryButton} w-full`} onClick={() => void pay()} disabled={busy}>
            {busy ? "Opening wallet" : `Pay ${price} USDT`}
          </button>
          <p className="text-xs text-[var(--pg-hint)]">Opens your TON wallet to confirm this payment.</p>
        </div>
      )}
    </article>
  );
}

function CreatedBy({ community }: { community: CommunityRecord }) {
  const store = useStore();
  const lab = useDemoLab();
  useEffect(() => {
    if (lab.enabled) return;
    let cancelled = false;
    void fetch(`/api/telegram/communities/${community.id}`)
      .then(async (response) => {
        const result = (await response.json()) as {
          ok?: boolean;
          community?: { ownerDisplayName?: string; ownerUsername?: string; ownerAvatarUrl?: string };
        };
        if (cancelled || !result.ok || !result.community) return;
        store.noteCommunityCreator(community.id, {
          displayName: result.community.ownerDisplayName || "",
          username: result.community.ownerUsername || "",
          avatarUrl: result.community.ownerAvatarUrl || "",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lab.enabled, community.id, store]);

  const name = community.ownerDisplayName?.trim() || "Creator";
  const username = community.ownerUsername?.trim().replace(/^@/, "") || "";
  return (
    <div>
      <p className="text-[11px] text-[var(--pg-hint)]">Created by</p>
      <div className="mt-2 flex items-center gap-2.5">
        <Avatar name={name} seed={community.ownerUserId || String(community.id)} imageUrl={community.ownerAvatarUrl} className="h-9 w-9" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          {username ? <p className="truncate text-xs text-[var(--pg-hint)]">{`@${username}`}</p> : null}
        </div>
      </div>
    </div>
  );
}

function SubscriptionDetail({
  community,
  subscription,
  now,
}: {
  community: CommunityRecord;
  subscription: SubscriptionRecord;
  now: number;
}) {
  const store = useStore();
  const [reasons, setReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const status = subscriptionStatus({
    confirmation: subscription.confirmation,
    expiresAt: subscription.expiresAt,
    now,
    renewalPending: subscription.renewalPending,
  });
  const actions = subscriptionActions(status);
  const needsPay = actions.includes("renew") || actions.includes("subscribe");
  const confirmed = subscription.confirmation === "confirmed";
  const renewOpen = renewalWindowOpen(subscription.expiresAt, now, confirmed);
  const payEnabled = status === "expired" || renewOpen;
  const progress = subscriptionProgress(subscription.startedAt, subscription.expiresAt, now);
  const percent = progress == null ? 0 : Math.round(progress * 100);
  const timeValue = !confirmed ? "Not confirmed" : status === "expired" ? "Ended" : remainingLabel(subscription.expiresAt, now, true).replace(/ left$/, "");
  const durationDays = Math.max(1, Math.round(community.periodSeconds / 86_400));
  const barClass = status === "expiring_soon" ? "bg-[#efa651]" : status === "expired" ? "bg-[var(--pg-hint)]" : "bg-[var(--pg-blue)]";
  const latestPayment = latestConfirmedPayment(store.payments, community.id, subscription.subscriberUserId);
  const hash = (latestPayment?.transactionReference || subscription.transactionReference || "").trim();
  const paidAt = latestPayment?.at || subscription.startedAt;
  const scanUrl = tonTransactionUrl(hash);
  const subscribed = purchaseCount(store.payments, store.subscriptions, community.id, subscription.subscriberUserId);
  const members = community.telegramMemberCount;

  async function renew() {
    if (busy || !payEnabled || community.status === "paused") return;
    setBusy(true);
    setReasons([]);
    try {
      if (!getConnectedTonAddress()) {
        const account = await store.connectWallet();
        if (!account) {
          setReasons(["Connect a TON wallet to continue. Payment was not requested."]);
          return;
        }
      }
      const outcome = await store.preparePayment(community.id);
      setReasons(outcome.reasons);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
      <div className="flex items-start gap-3">
        <Avatar name={community.name} seed={community.telegramChatId || String(community.id)} imageUrl={community.imageUrl} className="h-14 w-14" />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pt-0.5">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{community.name}</h1>
            <p className="mt-1 flex items-center gap-1 text-xs text-[var(--pg-hint)]">
              <MembersIcon />
              <span>{members == null ? "—" : members}</span>
              <span className="sr-only">Telegram members</span>
            </p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${subscriberChipClass(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>
      {community.description ? <p className="text-sm leading-relaxed text-[var(--pg-hint)]">{community.description}</p> : null}
      <CreatedBy community={community} />
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-[var(--pg-hint)]">Subscription price</dt>
          <dd className="mt-1 text-sm font-semibold">{formatUsdt(community.price)} USDT</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--pg-hint)]">Subscription duration</dt>
          <dd className="mt-1 text-sm font-semibold">{durationDays} days</dd>
        </div>
      </dl>
      <div className="border-t border-[var(--pg-line)] pt-3">
        <p className="text-[11px] text-[var(--pg-hint)]">Time left</p>
        <p className="mt-1 text-sm font-semibold">{timeValue}</p>
        {progress == null ? (
          <p className="mt-2 text-xs text-[var(--pg-hint)]">Lifetime starts after confirmation.</p>
        ) : (
          <div className="mt-3">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[var(--pg-line)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Subscription lifetime"
            >
              <div className={`h-full ${barClass}`} style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-[var(--pg-hint)]">
              <span>{subscription.startedAt ? formatDate(subscription.startedAt) : "Not confirmed"}</span>
              <span>{subscription.expiresAt ? formatDate(subscription.expiresAt) : "Not confirmed"}</span>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2 border-t border-[var(--pg-line)] pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] text-[var(--pg-hint)]">Latest payment</p>
          <p className="text-[11px] text-[var(--pg-hint)]">{timesSubscribed(confirmed ? subscribed : 0)}</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-xs" title={hash || "No hash yet"}>
            {hash || "No hash yet"}
          </p>
          {scanUrl ? (
            <a
              href={scanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--pg-blue)] px-2.5 text-xs font-medium text-[var(--pg-blue)]"
              aria-label="Open payment on TON"
            >
              Open
              <ExternalLinkIcon />
            </a>
          ) : null}
        </div>
        <p className="text-xs text-[var(--pg-hint)]">{paidAt ? formatWhen(paidAt) : "Not confirmed"}</p>
      </div>
      {status === "expired" ? (
        <p className="text-sm text-[var(--pg-hint)]">This subscription has ended. Channel access may already have been removed.</p>
      ) : null}
      {community.status === "paused" && needsPay ? (
        <p className="text-sm text-[var(--pg-hint)]">This community is deactivated, so renewal and a new subscription are closed.</p>
      ) : null}
      <ReasonList reasons={reasons} />
      {needsPay && community.status !== "paused" ? (
        <div className="space-y-2">
          <button
            type="button"
            className={`${payEnabled ? primaryButton : secondaryButton} w-full`}
            onClick={() => void renew()}
            disabled={busy || !payEnabled}
          >
            {busy ? "Opening wallet" : status === "expired" ? "Subscribe again" : "Renew subscription"}
          </button>
          {status !== "expired" && !renewOpen ? (
            <p className="text-xs text-[var(--pg-hint)]">
              Renewal opens on the last day. PassGramBot will message you then.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function subscriberChipClass(status: SubscriptionStatus): string {
  switch (status) {
    case "active":
      return "bg-[var(--pg-mint)] text-white";
    case "expiring_soon":
      return "bg-[#efa651] text-white";
    case "expired":
      return "bg-[var(--pg-line)] text-[var(--pg-hint)]";
    default:
      return "bg-[var(--pg-tag)] text-[var(--pg-blue-press)]";
  }
}

function purchaseCount(
  payments: PaymentRecord[],
  subscriptions: SubscriptionRecord[],
  communityId: number,
  subscriberUserId: string,
): number {
  const paid = payments.filter(
    (item) => item.communityId === communityId && item.subscriberUserId === subscriberUserId && item.status === "confirmed",
  ).length;
  if (paid > 0) return paid;
  return subscriptions.filter(
    (item) => item.communityId === communityId && item.subscriberUserId === subscriberUserId && item.confirmation === "confirmed",
  ).length;
}

function latestConfirmedPayment(payments: PaymentRecord[], communityId: number, subscriberUserId: string): PaymentRecord | null {
  return payments
    .filter((item) => item.communityId === communityId && item.subscriberUserId === subscriberUserId && item.status === "confirmed")
    .sort((a, b) => b.at - a.at)[0] ?? null;
}

function timesSubscribed(count: number): string {
  if (count <= 0) return "Not confirmed";
  return count === 1 ? "1 time" : `${count} times`;
}

function SubscriberPassCard({
  subscription,
  now,
  name,
  username,
  imageUrl,
  purchases,
}: {
  subscription: SubscriptionRecord;
  now: number;
  name: string;
  username: string;
  imageUrl?: string;
  purchases: number;
}) {
  const status = subscriptionStatus({
    confirmation: subscription.confirmation,
    expiresAt: subscription.expiresAt,
    now,
    renewalPending: subscription.renewalPending,
  });
  const confirmed = subscription.confirmation === "confirmed";
  const progress = subscriptionProgress(subscription.startedAt, subscription.expiresAt, now);
  const percent = progress == null ? 0 : Math.round(progress * 100);
  const timeValue = !confirmed
    ? "Not confirmed"
    : status === "expired"
      ? "Ended"
      : remainingLabel(subscription.expiresAt, now, true).replace(/ left$/, "");
  const barClass =
    status === "expiring_soon" ? "bg-[#efa651]" : status === "expired" ? "bg-[var(--pg-hint)]" : "bg-[var(--pg-blue)]";

  return (
    <article className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} seed={subscription.subscriberUserId} imageUrl={imageUrl} className="h-10 w-10" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            {username ? <p className="truncate text-xs text-[var(--pg-hint)]">@{username.replace(/^@/, "")}</p> : null}
          </div>
        </div>
        <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${subscriberChipClass(status)}`}>
          {statusLabel(status)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-[11px] text-[var(--pg-hint)]">Time left</dt>
          <dd className="mt-1 text-sm font-semibold">{timeValue}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-[var(--pg-hint)]">Subscribed</dt>
          <dd className="mt-1 text-sm font-semibold">{timesSubscribed(confirmed ? purchases : 0)}</dd>
        </div>
      </dl>
      {progress == null ? (
        <p className="text-xs text-[var(--pg-hint)]">Lifetime starts after confirmation.</p>
      ) : (
        <div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[var(--pg-line)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Subscription lifetime"
          >
            <div className={`h-full ${barClass}`} style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-[var(--pg-hint)]">
            <span>{subscription.startedAt ? formatDate(subscription.startedAt) : "Not confirmed"}</span>
            <span>{subscription.expiresAt ? formatDate(subscription.expiresAt) : "Not confirmed"}</span>
          </div>
        </div>
      )}
    </article>
  );
}

function Manage({ community, now, go }: { community: CommunityRecord; now: number; go: (route: AppRoute) => void }) {
  const store = useStore();
  const lab = useDemoLab();
  const ledger = useOwnerLedger(Boolean(lab.sceneId));
  const remote = ledger?.communities.find((item) => item.community.id === community.id) ?? null;
  const view = remote?.community ?? community;
  const subscriptionRows = remote ? remote.subscriptions : store.subscriptions;
  const paymentRows = remote ? remote.payments : store.payments;
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);
  const subscribers = subscriptionRows
    .filter((item) => item.communityId === view.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const visible = pageOf(subscribers, page);
  const link = formatCommunityLink(view.id, typeof window === "undefined" ? null : window.location.origin);
  const active = activePassgramCount(subscriptionRows, view.id, now);
  const expired = expiredSubscriberCount(subscriptionRows, view.id, now);
  const revenue = creatorRevenue(paymentRows, view.id);
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const recentSubscribers = recentSubscriberCount(subscriptionRows, view.id, since, now);
  const recentExpired = recentExpiredCount(subscriptionRows, view.id, since, now);
  const recentRevenue = creatorRevenueSince(paymentRows, view.id, since, now);
  const durationDays = Math.max(1, Math.round(view.periodSeconds / 86_400));
  const status =
    view.confirmation === "confirmed"
      ? view.status === "paused"
        ? "paused"
        : "active_community"
      : "pending_confirmation";
  const statusActive = status === "active_community";

  return (
    <div className="space-y-4">
      <section className="relative space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <button
          type="button"
          className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pg-bg)] text-[#3d4c5c]"
          aria-label="Community settings"
          onClick={() =>
            go({
              tab: "dashboard",
              screen: "settings",
              accountPage: "hub",
              communityId: view.id,
              referralCode: null,
              communityReferralCode: null,
              linkError: null,
            })
          }
        >
          <SettingsGearIcon />
        </button>
        <div className="flex items-start gap-3">
          <Avatar
            name={view.name}
            seed={view.telegramChatId || String(view.id)}
            imageUrl={view.imageUrl}
            className="h-14 w-14"
          />
          <div className="min-w-0 space-y-1.5 pr-8 pt-0.5">
            <h1 className="truncate text-base font-semibold">{view.name}</h1>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${
                statusActive ? "bg-[var(--pg-mint)] text-white" : "bg-[var(--pg-line)] text-[var(--pg-hint)]"
              }`}
            >
              {status === "active_community" ? "Active" : status === "paused" ? "Paused" : "Pending"}
            </span>
          </div>
        </div>
        {view.description ? <p className="text-sm leading-relaxed text-[var(--pg-hint)]">{view.description}</p> : null}
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-[var(--pg-hint)]">Subscription price</dt>
            <dd className="mt-1 text-sm font-semibold text-[var(--pg-text)]">{formatUsdt(view.price)} USDT</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--pg-hint)]">Subscription duration</dt>
            <dd className="mt-1 text-sm font-semibold text-[var(--pg-text)]">{durationDays} days</dd>
          </div>
        </dl>
        <div className="border-t border-[var(--pg-line)] pt-3">
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-[11px] text-[var(--pg-hint)]">Subscribers</dt>
              <dd className="mt-1 text-sm font-semibold">{active}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--pg-hint)]">Expired</dt>
              <dd className="mt-1 text-sm font-semibold">{expired}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--pg-hint)]">Revenue</dt>
              <dd className="mt-1 text-sm font-semibold">{formatUsdt(revenue)} USDT</dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] text-[var(--pg-hint)]">Last 30 days</p>
          <dl className="mt-1 grid grid-cols-3 gap-2">
            <div>
              <dt className="sr-only">Subscribers in the last 30 days</dt>
              <dd className="text-sm font-semibold">{recentSubscribers}</dd>
            </div>
            <div>
              <dt className="sr-only">Expired without renewal in the last 30 days</dt>
              <dd className="text-sm font-semibold">{recentExpired}</dd>
            </div>
            <div>
              <dt className="sr-only">Revenue in the last 30 days</dt>
              <dd className="text-sm font-semibold">{formatUsdt(recentRevenue)} USDT</dd>
            </div>
          </dl>
        </div>
        <div>
          <p className="text-xs text-[var(--pg-hint)]">Subscription link</p>
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-2">
            <a
              className="min-w-0 flex-1 break-all text-xs text-[var(--pg-text)] underline"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              {link}
            </a>
            <button
              type="button"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--pg-blue)]"
              aria-label={copied ? "Copied" : "Copy subscription link"}
              title={copied ? "Copied" : "Copy"}
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? <CopiedIcon /> : <CopyLinkIcon />}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">PassGram subscribers</h2>
        {subscribers.length === 0 ? (
          <EmptyState title="No PassGram subscribers yet" description="Only members recorded by PassGram appear here." />
        ) : (
          visible.items.map((subscription) => {
            const self = subscription.subscriberUserId === store.user.id;
            const name = (self ? store.user.displayName : subscription.subscriberDisplayName)?.trim() || "PassGram subscriber";
            const username = (self ? store.user.username : subscription.subscriberUsername)?.replace(/^@/, "") || "";
            const imageUrl = (self ? store.user.avatarUrl : subscription.subscriberAvatarUrl) || undefined;
            return (
              <SubscriberPassCard
                key={subscription.id}
                subscription={subscription}
                now={now}
                name={name}
                username={username}
                imageUrl={imageUrl}
                purchases={purchaseCount(paymentRows, subscriptionRows, view.id, subscription.subscriberUserId)}
              />
            );
          })
        )}
        {visible.pages > 1 ? (
          <div className="flex items-center justify-between">
            <button className={secondaryButton} disabled={visible.page === 0} onClick={() => setPage(visible.page - 1)}>Previous</button>
            <p className="text-xs">Page {visible.page + 1} of {visible.pages}</p>
            <button className={secondaryButton} disabled={visible.page + 1 >= visible.pages} onClick={() => setPage(visible.page + 1)}>Next</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function SettingsRoute({
  communityId,
  go,
}: {
  communityId: number | null;
  go: (route: AppRoute) => void;
}) {
  const store = useStore();
  const community = store.communities.find((item) => item.id === communityId && item.ownerUserId === store.user.id);
  if (!community) {
    return <Unavailable title="Community not found." body="This account does not have a confirmed community with that id." />;
  }
  return <CommunitySettings community={community} go={go} />;
}

function CommunitySettings({ community, go }: { community: CommunityRecord; go: (route: AppRoute) => void }) {
  const store = useStore();
  const lab = useDemoLab();
  const [price, setPrice] = useState(formatUsdt(community.price));
  const [duration, setDuration] = useState(String(Math.max(1, Math.round(community.periodSeconds / 86_400))));
  const [offerMessage, setOfferMessage] = useState("");
  const [offerError, setOfferError] = useState("");
  const [offerBusy, setOfferBusy] = useState(false);
  const [percent, setPercent] = useState("");
  const [editPercent, setEditPercent] = useState("");
  const [referralMessage, setReferralMessage] = useState("");
  const [referralError, setReferralError] = useState("");
  const [referralBusy, setReferralBusy] = useState(false);
  const [confirmPause, setConfirmPause] = useState<"deactivate" | "activate" | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseMessage, setPauseMessage] = useState("");
  const [pauseError, setPauseError] = useState("");
  const [confirmReferral, setConfirmReferral] = useState<"activate" | "stop" | "edit" | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const ledger = useOwnerLedger(Boolean(lab.sceneId));
  const remote = ledger?.communities.find((item) => item.community.id === community.id) ?? null;
  const subscriptionRows = remote ? remote.subscriptions : store.subscriptions;
  const communityPayments = (remote ? remote.payments : store.payments)
    .filter((item) => item.communityId === community.id)
    .sort((a, b) => b.at - a.at);
  const paused = community.status === "paused";
  const referralLive = community.referralEnabled && community.referralPercentBps > 0;
  const activeRate = formatCommunityReferralPercent(community.referralPercentBps);
  const pendingRate = formatCommunityReferralPercent(parseCommunityReferralBps(percent) ?? 0);

  async function saveOffer() {
    if (offerBusy || paused) return;
    const priceUsdt = parseCommunityPrice(price);
    const durationDays = parseDurationDays(duration);
    if (!priceUsdt || durationDays == null) {
      setOfferError("Enter at least 1 USDT and a whole number of days from 1 to 366.");
      setOfferMessage("");
      return;
    }
    setOfferBusy(true);
    setOfferError("");
    setOfferMessage("");
    try {
      if (!lab.enabled) {
        if (!getConnectedTonAddress()) {
          const account = await store.connectWallet();
          if (!account) {
            setOfferError("Connect the wallet that created this community. UpdateCommunity was not signed.");
            return;
          }
        }
        if (!contractIsConfigured()) {
          setOfferError("The registry contract is not configured, so UpdateCommunity was not signed.");
          return;
        }
        const signed = await sendRegistryCall({
          payloadBase64: buildUpdateCommunityBody({
            communityId: community.id,
            price: priceUsdt,
            durationSeconds: durationDays * 86_400,
          }),
        });
        if (!signed) {
          setOfferError("Your wallet did not sign UpdateCommunity. The price and duration were not changed.");
          return;
        }
        setOfferMessage(
          "Submitted from the wallet that created this community. Subscribers keep the current price and duration until the network confirms this update. Payments continue to the wallet that registered this community.",
        );
        return;
      }
      const saved = store.patchOwnedCommunity(community.id, {
        price: priceUsdt,
        periodSeconds: durationDays * 86_400,
      });
      setOfferError(saved ? "" : "This community could not be updated.");
      setOfferMessage(
        saved
          ? "Saved in this preview. New subscribers and future renewals use this price and duration. Payments continue to the wallet that registered this community."
          : "",
      );
    } finally {
      setOfferBusy(false);
    }
  }

  function requestActivate() {
    const bps = parseCommunityReferralBps(percent);
    if (bps == null) {
      setReferralError("Enter a percent from 0.01% to 50%.");
      setReferralMessage("");
      return;
    }
    setReferralError("");
    setConfirmReferral("activate");
  }

  function requestEditRate() {
    const bps = parseCommunityReferralBps(editPercent);
    if (bps == null) {
      setReferralError("Enter a percent from 0.01% to 50%.");
      setReferralMessage("");
      return;
    }
    if (bps === community.referralPercentBps) {
      setReferralError("Enter a different percent to update the rate.");
      setReferralMessage("");
      return;
    }
    setReferralError("");
    setConfirmReferral("edit");
  }

  async function confirmReferralAction() {
    if (referralBusy || !confirmReferral) return;
    const settingRate = confirmReferral === "activate" || confirmReferral === "edit";
    const rateInput = confirmReferral === "edit" ? editPercent : percent;
    const bps = settingRate ? parseCommunityReferralBps(rateInput) : null;
    if (settingRate && bps == null) {
      setReferralError("Enter a percent from 0.01% to 50%.");
      setConfirmReferral(null);
      return;
    }
    setReferralBusy(true);
    setReferralError("");
    setReferralMessage("");
    const chainBps = settingRate && bps != null ? bps : confirmReferral === "stop" ? 0 : null;
    try {
      if (!lab.enabled && chainBps != null) {
        if (!getConnectedTonAddress()) {
          const account = await store.connectWallet();
          if (!account) {
            setReferralError(
              confirmReferral === "stop"
                ? "Connect the wallet that created this community. The referral program was not stopped."
                : "Connect the wallet that created this community. The referral rate was not signed.",
            );
            return;
          }
        }
        if (!contractIsConfigured()) {
          setReferralError("The registry contract is not configured, so the referral change was not signed.");
          return;
        }
        const signed = await sendRegistryCall({
          payloadBase64: buildSetCommunityReferralBody(community.id, chainBps),
        });
        if (!signed) {
          setReferralError(
            confirmReferral === "stop"
              ? "Your wallet did not sign the stop. The referral program is still on."
              : confirmReferral === "edit"
                ? "Your wallet did not sign the new referral rate. Registered referrals are unchanged."
                : "Your wallet did not sign the referral rate. The program was not activated.",
          );
          return;
        }
      }
      if (!lab.enabled) {
        const response = await fetch(`/api/telegram/communities/${community.id}/referral`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
          },
          body: JSON.stringify({ enabled: settingRate, percent: settingRate ? rateInput.trim() : "" }),
        });
        const result = (await response.json()) as { ok?: boolean; message?: string };
        if (!result.ok) {
          setReferralError(result.message || "Referral settings could not be saved.");
          return;
        }
      }
      const saved = store.patchOwnedCommunity(
        community.id,
        settingRate && bps != null
          ? { referralEnabled: true, referralPercentBps: bps }
          : { referralEnabled: false },
      );
      if (!saved) {
        setReferralError("Referral settings could not be saved.");
        return;
      }
      setPercent("");
      setEditPercent("");
      const rateLabel = bps == null ? "" : formatCommunityReferralPercent(bps);
      setReferralMessage(
        settingRate && bps != null
          ? confirmReferral === "edit"
            ? lab.enabled
              ? `Referral rate is now ${rateLabel}% in this preview. Referrals already registered keep their original rate. New registrations use ${rateLabel}%.`
              : `Submitted from the wallet that created this community. ${rateLabel}% applies to referrals registered after this update. Registered referrals keep their original rate. Current subscribers are notified in Telegram.`
            : lab.enabled
              ? `Referral program is on at ${rateLabel}% in this preview. This community is now in the referral list. Subscriber messages are not sent in this preview.`
              : `Submitted from the wallet that created this community. ${rateLabel}% is stored on the contract and taken from your 97.5% share. Current subscribers are notified in Telegram.`
          : lab.enabled
            ? "Referral program is stopped in this preview. This community left the referral list. New registrations are closed, including older marketer links. Referrals already registered still earn their original rate. Subscriber messages are not sent in this preview."
            : "Submitted from the wallet that created this community. This community left the referral list. New registrations are closed, including older marketer links. Referrals already registered still earn their original rate. Current subscribers are notified in Telegram.",
      );
    } catch {
      setReferralError("Could not reach the server.");
    } finally {
      setReferralBusy(false);
      setConfirmReferral(null);
    }
  }

  async function confirmPauseAction() {
    if (pauseBusy || !confirmPause) return;
    const pausing = confirmPause === "deactivate";
    setPauseBusy(true);
    setPauseError("");
    setPauseMessage("");
    try {
      if (!lab.enabled) {
        if (!getConnectedTonAddress()) {
          const account = await store.connectWallet();
          if (!account) {
            setPauseError(
              pausing
                ? "Connect the wallet that created this community. The community was not deactivated."
                : "Connect the wallet that created this community. The community was not activated.",
            );
            return;
          }
        }
        if (!contractIsConfigured()) {
          setPauseError("The registry contract is not configured, so this change was not signed.");
          return;
        }
        const signed = await sendRegistryCall({
          payloadBase64: buildSetCommunityPausedBody(community.id, pausing),
        });
        if (!signed) {
          setPauseError(
            pausing
              ? "Your wallet did not sign the deactivation. The community is still active."
              : "Your wallet did not sign the activation. The community is still deactivated.",
          );
          return;
        }
        const response = await fetch(`/api/telegram/communities/${community.id}/status`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
          },
          body: JSON.stringify({ paused: pausing }),
        });
        const result = (await response.json()) as { ok?: boolean; message?: string };
        if (!result.ok) {
          setPauseError(result.message || "The wallet signed the change, but it could not be saved.");
          return;
        }
      }
      const saved = store.patchOwnedCommunity(community.id, { status: pausing ? "paused" : "active" });
      if (!saved) {
        setPauseError("This community could not be updated.");
        return;
      }
      setPauseMessage(
        pausing
          ? lab.enabled
            ? "Deactivated in this preview. Pages stay open. Payments, renewals, and new referrals are closed. The saved price, duration, and referral rate stay in place."
            : "Submitted from the wallet that created this community. Pages stay open. Payments, renewals, and new referrals are closed. The saved settings stay in place."
          : lab.enabled
            ? "Activated in this preview. Payments, renewals, and the referral program use the same settings as before."
            : "Submitted from the wallet that created this community. Payments, renewals, and the referral program use the same settings as before.",
      );
    } catch {
      setPauseError("Could not reach the server.");
    } finally {
      setPauseBusy(false);
      setConfirmPause(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="space-y-4">
      <div>
        <h1 className="text-[26px]">Community settings</h1>
        <p className="mt-1 text-sm text-[var(--pg-hint)]">{community.name}</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-card)]">
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
          aria-expanded={offerOpen}
          onClick={() => setOfferOpen((open) => !open)}
        >
          <span className="text-base font-semibold">Update community</span>
          <ChevronIcon open={offerOpen} />
        </button>
        {offerOpen ? (
          <div className="space-y-3 border-t border-[var(--pg-line)] px-4 py-4">
            <p className="text-sm text-[var(--pg-hint)]">
              Price and duration apply to new subscriptions and renewals after the network confirms the update. Subscribers keep the current price until then. A subscriber who already paid keeps the period they bought. Payments continue to the wallet that registered this community.
            </p>
            <div className="rounded-2xl bg-[var(--pg-bg)] px-3 py-3">
              <p className="text-xs text-[var(--pg-hint)]">Receiving wallet</p>
              <p className="mt-1 break-all text-sm">{community.payoutAddress || "The wallet that registers this community"}</p>
            </div>
            <Field label="Subscription price (USDT)" value={price} onChange={setPrice} inputMode="decimal" placeholder="1.5" />
            <Field label="Subscription duration (days)" value={duration} onChange={setDuration} inputMode="numeric" placeholder="30" />
            {offerError ? <p className="text-sm text-[var(--pg-ruby)]">{offerError}</p> : null}
            {offerMessage ? <p className="text-sm text-[var(--pg-blue)]">{offerMessage}</p> : null}
            <button type="button" className={`${primaryButton} w-full`} onClick={() => void saveOffer()} disabled={paused || offerBusy}>
              {offerBusy ? "Opening wallet" : "Submit update"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-card)]">
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
          aria-expanded={referralOpen}
          onClick={() => setReferralOpen((open) => !open)}
        >
          <span className="text-base font-semibold">Community referral program</span>
          <ChevronIcon open={referralOpen} />
        </button>
        {referralOpen ? (
          <div className="space-y-3 border-t border-[var(--pg-line)] px-4 py-4">
            {referralLive ? (
              <>
                <p className="text-sm text-[var(--pg-hint)]">
                  The program is on at {activeRate}%. That percent is taken from your 97.5% share. The subscriber price does not change.
                  {paused ? " It is paused with this community and returns at the same rate when you activate the community again." : ""}
                </p>
                <p className="text-sm text-[var(--pg-hint)]">
                  Updating the rate applies only to referrals registered after the update. Referrals already registered keep the rate from when they were registered, including later payments by those same subscribers. A new subscriber uses the new rate even if the marketer link was created earlier.
                </p>
                <Field
                  label="New marketer percent"
                  value={editPercent}
                  onChange={setEditPercent}
                  inputMode="decimal"
                  suffix="%"
                  hint="From 0.01% to 50%."
                />
                <button type="button" className={`${primaryButton} w-full`} onClick={requestEditRate} disabled={paused || referralBusy}>
                  Update referral rate
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--pg-hint)]">
                  Set the percent a marketer earns from your 97.5% share. The 2.5% platform fee and the price the subscriber pays stay the same. Your creation wallet signs this rate on the contract.
                </p>
                <Field
                  label="Marketer percent of your share"
                  value={percent}
                  onChange={setPercent}
                  inputMode="decimal"
                  suffix="%"
                  hint="From 0.01% to 50%."
                />
              </>
            )}
            {referralError ? <p className="text-sm text-[var(--pg-ruby)]">{referralError}</p> : null}
            {referralMessage ? <p className="text-sm text-[var(--pg-blue)]">{referralMessage}</p> : null}
            {referralLive ? (
              <button
                type="button"
                className={`${secondaryButton} w-full`}
                onClick={() => {
                  setReferralError("");
                  setConfirmReferral("stop");
                }}
                disabled={referralBusy}
              >
                Stop referral program
              </button>
            ) : (
              <button type="button" className={`${primaryButton} w-full`} onClick={requestActivate} disabled={paused || referralBusy}>
                Activate referral program
              </button>
            )}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-card)]">
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
          aria-expanded={paymentsOpen}
          onClick={() => setPaymentsOpen((open) => !open)}
        >
          <span className="text-base font-semibold">Payment transactions</span>
          <ChevronIcon open={paymentsOpen} />
        </button>
        {paymentsOpen ? (
          <div className="border-t border-[var(--pg-line)] px-4 py-4">
            {communityPayments.length === 0 ? (
              <p className="text-sm text-[var(--pg-hint)]">No payments have been recorded for this community.</p>
            ) : (
              <ul className="space-y-4">
                {communityPayments.map((payment) => {
                  const profile = subscriptionRows.find(
                    (item) => item.communityId === community.id && item.subscriberUserId === payment.subscriberUserId,
                  );
                  const self = payment.subscriberUserId === store.user.id;
                  const name = (self ? store.user.displayName : profile?.subscriberDisplayName)?.trim() || "PassGram subscriber";
                  const username = (self ? store.user.username : profile?.subscriberUsername)?.replace(/^@/, "") || "";
                  const imageUrl = (self ? store.user.avatarUrl : profile?.subscriberAvatarUrl) || undefined;
                  const hash = payment.transactionReference?.trim() || "";
                  const scanUrl = tonTransactionUrl(hash);
                  return (
                    <li key={payment.id} className="space-y-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={name} seed={payment.subscriberUserId} imageUrl={imageUrl} className="h-10 w-10" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{name}</p>
                          {username ? <p className="truncate text-xs text-[var(--pg-hint)]">@{username}</p> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--pg-text)]" title={hash || "No hash yet"}>
                          {hash || "No hash yet"}
                        </p>
                        {scanUrl ? (
                          <a
                            href={scanUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--pg-blue)] px-2.5 text-xs font-medium text-[var(--pg-blue)]"
                            aria-label="Open payment on TON"
                          >
                            Open
                            <ExternalLinkIcon />
                          </a>
                        ) : (
                          <button type="button" className="inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--pg-line)] px-2.5 text-xs text-[var(--pg-hint)]" disabled>
                            Open
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-[var(--pg-hint)]">{formatWhen(payment.at)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
      </section>
      </div>

      <div className="sticky bottom-20 z-20 mt-auto bg-[var(--pg-bg)] pt-4">
      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="text-lg font-semibold">{paused ? "Activate community" : "Deactivate community"}</h2>
        <p className="text-sm text-[var(--pg-hint)]">
          {paused
            ? "This community is deactivated. Your page and your subscribers' pages stay open. New payments, renewals, and the referral program stay closed until you activate it again. The price, duration, and referral rate are unchanged."
            : "Deactivating closes new subscriptions and renewals, and pauses the referral program if it is on. Your page and your subscribers' pages stay open. Activating again restores the same price, duration, and referral rate."}
        </p>
        {pauseError ? <p className="text-sm text-[var(--pg-ruby)]">{pauseError}</p> : null}
        {pauseMessage ? <p className="text-sm text-[var(--pg-blue)]">{pauseMessage}</p> : null}
        {paused ? (
          <button type="button" className={`${primaryButton} w-full`} onClick={() => setConfirmPause("activate")} disabled={pauseBusy}>
            Activate community
          </button>
        ) : (
          <button type="button" className={`${dangerButton} w-full`} onClick={() => setConfirmPause("deactivate")} disabled={pauseBusy}>
            Deactivate community
          </button>
        )}
      </section>
      </div>

      {confirmReferral ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setConfirmReferral(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-[398px] space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-[20px] font-semibold">
              {confirmReferral === "activate"
                ? "Activate the referral program?"
                : confirmReferral === "edit"
                  ? "Update the referral rate?"
                  : "Stop the referral program?"}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
              {confirmReferral === "activate"
                ? `Your creation wallet will sign this rate. ${pendingRate}% of each subscriber payment is taken from your 97.5% share for the marketer who referred that subscriber, including later renewals. The subscriber price and the 2.5% platform fee do not change.`
                : confirmReferral === "edit"
                  ? `Your creation wallet will sign ${formatCommunityReferralPercent(parseCommunityReferralBps(editPercent) ?? 0)}%. Referrals already registered keep their current rate. Referrals registered after this update use the new rate, including subscribers who open a marketer link that was created earlier.`
                  : "Your creation wallet will sign this stop on the contract. This community leaves the referral list. New registrations stop, including marketer links created earlier. Referrals already registered stay active, and each keeps the rate from when that subscriber was registered."}
            </p>
            <button type="button" className={`${primaryButton} w-full`} onClick={() => void confirmReferralAction()} disabled={referralBusy}>
              {referralBusy
                ? lab.enabled && confirmReferral === "stop"
                  ? "Saving"
                  : "Opening wallet"
                : confirmReferral === "activate"
                  ? "Yes, activate"
                  : confirmReferral === "edit"
                    ? "Yes, update rate"
                    : "Yes, stop referrals"}
            </button>
            <button type="button" className={`${secondaryButton} w-full`} onClick={() => setConfirmReferral(null)} disabled={referralBusy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {confirmPause ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setConfirmPause(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-[398px] space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-[20px] font-semibold">
              {confirmPause === "deactivate" ? "Deactivate this community?" : "Activate this community?"}
            </h2>
            <p className="text-sm leading-relaxed text-[var(--pg-hint)]">
              {confirmPause === "deactivate"
                ? "Your creation wallet will sign this deactivation. New payments and renewals stop. The referral program pauses if it is on, and registered referral rates stay saved. Your page and your subscribers' pages stay open."
                : "Your creation wallet will sign this activation. Payments, renewals, and the referral program return with the same price, duration, and referral rate."}
            </p>
            <button type="button" className={`${confirmPause === "deactivate" ? dangerButton : primaryButton} w-full`} onClick={() => void confirmPauseAction()} disabled={pauseBusy}>
              {pauseBusy ? (lab.enabled ? "Saving" : "Opening wallet") : confirmPause === "deactivate" ? "Yes, deactivate" : "Yes, activate"}
            </button>
            <button type="button" className={`${secondaryButton} w-full`} onClick={() => setConfirmPause(null)} disabled={pauseBusy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function tonTransactionUrl(reference: string): string | null {
  const hash = reference.trim();
  const hex = /^[0-9a-fA-F]{64}$/.test(hash);
  const base64 = /^[A-Za-z0-9+/_-]{43,48}={0,2}$/.test(hash);
  if (!hex && !base64) return null;
  return `https://tonscan.org/tx/${encodeURIComponent(hash)}`;
}

function MembersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 18.5c.6-2.4 2.7-4 5.5-4s4.9 1.6 5.5 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.2 14.6c1.8.3 3.2 1.5 3.8 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 5h5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 5 10 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-[#3d4c5c] transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function expiredSubscriberCount(
  subscriptions: Array<{ communityId: number; subscriberUserId: string; confirmation: string; expiresAt: number | null }>,
  communityId: number,
  now: number,
): number {
  const byUser = new Map<string, { active: boolean; expired: boolean }>();
  for (const item of subscriptions) {
    if (item.communityId !== communityId || item.confirmation !== "confirmed" || item.expiresAt == null) continue;
    const current = byUser.get(item.subscriberUserId) ?? { active: false, expired: false };
    if (item.expiresAt > now) current.active = true;
    else current.expired = true;
    byUser.set(item.subscriberUserId, current);
  }
  let expired = 0;
  for (const state of byUser.values()) {
    if (state.expired && !state.active) expired += 1;
  }
  return expired;
}

function creatorRevenue(payments: Array<{ communityId: number; status: string; creatorAmount: string }>, communityId: number): string {
  return creatorRevenueSince(payments, communityId, 0, Number.POSITIVE_INFINITY);
}

function recentSubscriberCount(
  subscriptions: Array<{
    communityId: number;
    subscriberUserId: string;
    confirmation: string;
    startedAt: number | null;
    createdAt: number;
  }>,
  communityId: number,
  since: number,
  now: number,
): number {
  const firstStart = new Map<string, number>();
  for (const item of subscriptions) {
    if (item.communityId !== communityId || item.confirmation !== "confirmed") continue;
    const started = item.startedAt ?? item.createdAt;
    const previous = firstStart.get(item.subscriberUserId);
    if (previous == null || started < previous) firstStart.set(item.subscriberUserId, started);
  }
  let count = 0;
  for (const started of firstStart.values()) {
    if (started >= since && started <= now) count += 1;
  }
  return count;
}

function recentExpiredCount(
  subscriptions: Array<{
    communityId: number;
    subscriberUserId: string;
    confirmation: string;
    expiresAt: number | null;
  }>,
  communityId: number,
  since: number,
  now: number,
): number {
  const byUser = new Map<string, { expiredInWindow: boolean; active: boolean }>();
  for (const item of subscriptions) {
    if (item.communityId !== communityId || item.confirmation !== "confirmed" || item.expiresAt == null) continue;
    const state = byUser.get(item.subscriberUserId) ?? { expiredInWindow: false, active: false };
    if (item.expiresAt > now) state.active = true;
    else if (item.expiresAt >= since) state.expiredInWindow = true;
    byUser.set(item.subscriberUserId, state);
  }
  let count = 0;
  for (const state of byUser.values()) {
    if (state.expiredInWindow && !state.active) count += 1;
  }
  return count;
}

function creatorRevenueSince(
  payments: Array<{ communityId: number; status: string; creatorAmount: string; at?: number }>,
  communityId: number,
  since: number,
  now: number,
): string {
  let total = 0n;
  for (const payment of payments) {
    if (payment.communityId !== communityId || payment.status !== "confirmed") continue;
    const at = payment.at ?? 0;
    if (at < since || at > now) continue;
    try {
      total += BigInt(payment.creatorAmount || "0");
    } catch {
      /* skip malformed amounts */
    }
  }
  return total.toString();
}

function SettingsGearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CopyLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return <EmptyState title={title} description={body} />;
}
