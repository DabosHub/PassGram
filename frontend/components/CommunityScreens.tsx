"use client";

import { useEffect, useState } from "react";
import {
  activePassgramCount,
  formatCommunityLink,
  pageOf,
  remainingLabel,
  subscriptionActions,
  subscriptionStatus,
} from "@/lib/domain";
import { formatDate, formatPeriod, formatUsdt, formatWhen } from "@/lib/money";
import { contractIsConfigured, tonConfig } from "@/lib/ton/config";
import { buildSetCommunityReferralBody } from "@/lib/ton/registry";
import { sendRegistryCall } from "@/lib/ton/send";
import type { AppRoute } from "@/lib/route";
import { useStore, type CommunityRecord, type SubscriptionRecord } from "@/lib/store";
import { Avatar, EmptyState, LifetimeBar, primaryButton, ReasonList, secondaryButton, StatusBadge, useNow } from "./ui";

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
    const existing = store.communities.find((item) => item.id === communityId && item.confirmation === "confirmed");
    if (existing) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
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
  }, [communityId, linkError, store]);

  if (linkError === "invalid_community" || communityId == null) {
    return <Unavailable title="This community link is invalid." body="The link does not contain a usable community id." />;
  }
  if (loading) return <p className="text-sm text-[var(--pg-hint)]">Loading community</p>;
  const community = store.communities.find((item) => item.id === communityId && item.confirmation === "confirmed" && item.status !== "paused");
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

export function ManageRoute({ communityId }: { communityId: number | null }) {
  const store = useStore();
  const now = useNow();
  const community = store.communities.find((item) => item.id === communityId && item.ownerUserId === store.user.id);
  if (!community) return <Unavailable title="Community not found." body="This account does not have a confirmed community with that id." />;
  return <Manage community={community} now={now} />;
}

function Purchase({ community }: { community: CommunityRecord }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const walletReady = Boolean(store.walletAccount);
  const ownerLabel = community.ownerUserId.startsWith("tg:")
    ? `Creator ${community.ownerUserId.slice(3)}`
    : community.ownerUserId;

  async function pay() {
    if (busy || !walletReady) return;
    setBusy(true);
    const outcome = await store.preparePayment(community.id);
    setReasons(outcome.reasons);
    setBusy(false);
  }

  return (
    <article className="space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5">
      <div className="flex items-start gap-3">
        <Avatar name={community.name} imageUrl={community.imageUrl} />
        <div>
          <h1 className="text-xl font-semibold">{community.name}</h1>
          {community.telegramUsername ? <p className="text-sm text-[var(--pg-hint)]">@{community.telegramUsername}</p> : null}
          <p className="mt-1 text-sm text-[var(--pg-hint)]">{ownerLabel}</p>
        </div>
      </div>
      {community.description ? <p className="text-sm">{community.description}</p> : null}
      <p className="pg-amount text-[26px]">{formatUsdt(community.price)} USDT</p>
      <p className="text-sm text-[var(--pg-hint)]">Access for {formatPeriod(community.periodSeconds)} after confirmed payment.</p>
      <p className="text-sm text-[var(--pg-hint)]">
        Asset: USDT. Network: TON ({tonConfig.network}). You pay this price. TON may also charge a small network fee in TON. PassGram does not add a fee on top of the listed price.
      </p>
      {!walletReady ? (
        <p className="text-sm text-[var(--pg-hint)]">
          Connect a TON wallet from the header before paying. Payment signs with TON Connect (Telegram Wallet or Tonkeeper).
        </p>
      ) : null}
      <ReasonList reasons={reasons} />
      <button className={`${primaryButton} w-full`} onClick={() => void pay()} disabled={busy || !walletReady}>
        {busy ? "Checking" : !walletReady ? "Connect wallet to pay" : `Pay ${formatUsdt(community.price)} USDT`}
      </button>
    </article>
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
  const walletReady = Boolean(store.walletAccount);
  const status = subscriptionStatus({
    confirmation: subscription.confirmation,
    expiresAt: subscription.expiresAt,
    now,
    renewalPending: subscription.renewalPending,
  });
  const actions = subscriptionActions(status);
  const needsPay = actions.includes("renew") || actions.includes("subscribe");

  async function renew() {
    if (busy || !walletReady) return;
    setBusy(true);
    const outcome = await store.preparePayment(community.id);
    setReasons(outcome.reasons);
    setBusy(false);
  }

  return (
    <article className="space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5">
      <div className="flex items-start gap-3">
        <Avatar name={community.name} imageUrl={community.imageUrl} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{community.name}</h1>
          {community.telegramUsername ? <p className="text-sm text-[var(--pg-hint)]">@{community.telegramUsername}</p> : null}
        </div>
      </div>
      {community.description ? <p className="text-sm">{community.description}</p> : null}
      <StatusBadge status={status} />
      <p className="text-sm">
        {formatUsdt(subscription.paymentAmount)} {subscription.paymentAsset} on TON
      </p>
      <p className="text-sm text-[var(--pg-hint)]">
        Started {subscription.startedAt ? formatWhen(subscription.startedAt) : "Not confirmed"}
        <br />
        Expires {subscription.expiresAt ? formatWhen(subscription.expiresAt) : "Not confirmed"}
      </p>
      <p className="text-sm">{remainingLabel(subscription.expiresAt, now, subscription.confirmation === "confirmed")}</p>
      <LifetimeBar startAt={subscription.startedAt} expiresAt={subscription.expiresAt} now={now} />
      <p className="text-xs text-[var(--pg-hint)]">
        {subscription.transactionReference ? `Transaction ${subscription.transactionReference}` : "No confirmed transaction reference."}
      </p>
      {status === "expired" ? (
        <p className="text-sm">This subscription is expired. Channel access may already have been removed.</p>
      ) : null}
      {needsPay && !walletReady ? (
        <p className="text-sm text-[var(--pg-hint)]">
          Connect a TON wallet from the header before paying. Payment signs with TON Connect (Telegram Wallet or Tonkeeper).
        </p>
      ) : null}
      <ReasonList reasons={reasons} />
      <div className="space-y-2">
        {actions.includes("open") ? (
          <button className={`${secondaryButton} w-full`} disabled>
            Open community. Invitation links are unavailable until the bot is connected.
          </button>
        ) : null}
        {needsPay ? (
          <button className={`${primaryButton} w-full`} onClick={() => void renew()} disabled={busy || !walletReady}>
            {busy ? "Checking" : !walletReady ? "Connect wallet to pay" : status === "expired" ? "Subscribe again" : "Renew"}
          </button>
        ) : null}
        {actions.includes("payment") ? (
          <p className="text-xs text-[var(--pg-hint)]">Payment details stay on this screen. There is no separate ledger API yet.</p>
        ) : null}
      </div>
    </article>
  );
}

function Manage({ community, now }: { community: CommunityRecord; now: number }) {
  const store = useStore();
  const [page, setPage] = useState(0);
  const [copied, setCopied] = useState(false);
  const [referralEnabled, setReferralEnabled] = useState(community.referralEnabled);
  const [referralPercent, setReferralPercent] = useState(
    community.referralPercentBps > 0 ? String(Math.round(community.referralPercentBps / 100)) : "10",
  );
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralMessage, setReferralMessage] = useState("");
  const subscribers = store.subscriptions
    .filter((item) => item.communityId === community.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const visible = pageOf(subscribers, page);
  const confirmedPayments = store.payments.filter((item) => item.communityId === community.id && item.status === "confirmed");
  const link = formatCommunityLink(community.id, typeof window === "undefined" ? null : window.location.origin);
  const active = activePassgramCount(store.subscriptions, community.id, now);
  const expiring = subscribers.filter((item) => subscriptionStatus({ confirmation: item.confirmation, expiresAt: item.expiresAt, now }) === "expiring_soon").length;
  const expired = subscribers.filter((item) => subscriptionStatus({ confirmation: item.confirmation, expiresAt: item.expiresAt, now }) === "expired").length;

  async function saveReferralSettings() {
    if (referralBusy) return;
    const percent = Number(referralPercent);
    if (referralEnabled && (!Number.isInteger(percent) || percent < 1 || percent > 50)) {
      setReferralMessage("Enter a whole percent from 1 to 50.");
      return;
    }
    setReferralBusy(true);
    setReferralMessage("");
    try {
      const response = await fetch(`/api/telegram/communities/${community.id}/referral`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
        },
        body: JSON.stringify({ enabled: referralEnabled, percent: referralEnabled ? percent : 0 }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!result.ok) {
        setReferralMessage(result.message || "Could not save referral settings.");
        return;
      }
      store.rememberCommunity({
        communityId: community.id,
        title: community.name,
        description: community.description,
        priceUsdt: community.price,
        durationDays: Math.round(community.periodSeconds / 86400),
        ownerTelegramUserId: community.ownerUserId.replace(/^tg:/, ""),
        imageUrl: community.imageUrl,
        payoutAddress: community.payoutAddress,
        referralEnabled,
        referralPercentBps: referralEnabled ? percent * 100 : 0,
      });
      let chainNote = "";
      if (contractIsConfigured() && store.walletAccount) {
        const bps = referralEnabled ? percent * 100 : 0;
        const boc = await sendRegistryCall({
          payloadBase64: buildSetCommunityReferralBody(community.id, bps),
        });
        chainNote = boc
          ? " On-chain referral rate submitted to the registry."
          : " Saved off-chain; connect wallet and retry to sync the rate on-chain.";
      } else if (contractIsConfigured()) {
        chainNote = " Saved off-chain; connect your TON wallet to sync the rate on-chain.";
      }
      setReferralMessage((result.message || "Saved.") + chainNote);
    } catch {
      setReferralMessage("Could not reach the server.");
    } finally {
      setReferralBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <div className="flex items-start gap-3">
          <Avatar name={community.name} imageUrl={community.imageUrl} />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{community.name}</h1>
            <p className="text-sm">{formatUsdt(community.price)} USDT · {community.accessMode === "subscription" ? "Subscription link" : "Token-Gating"}</p>
          </div>
        </div>
        <p className="text-sm">{active} active PassGram subscriptions. This is not the Telegram member count.</p>
        <p className="text-sm text-[var(--pg-hint)]">{expiring} expiring · {expired} expired</p>
        <p className="text-sm">
          Confirmed gross: {confirmedPayments.length ? "see payment records" : "none yet"}. Platform fees, affiliate commissions, and creator proceeds are shown only from confirmed payments. None are confirmed.
        </p>
        <p className="text-sm font-semibold">Subscription link</p>
        <p className="break-all text-xs text-[var(--pg-hint)]">{link}</p>
        <button
          className={secondaryButton}
          onClick={() => {
            void navigator.clipboard.writeText(link);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy subscription link"}
        </button>
      </section>

      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="font-semibold">Community referrals</h2>
        <p className="text-sm text-[var(--pg-hint)]">
          Promoters earn this percent from your payout when someone subscribes via their link. Subscriber price stays the
          same. When a registry is configured, saving also submits the rate on-chain so the contract splits at payment
          time.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={referralEnabled}
            onChange={(event) => setReferralEnabled(event.target.checked)}
          />
          Enable community referrals
        </label>
        {referralEnabled ? (
          <label className="block space-y-1 text-sm">
            <span>Referral percent (1–50)</span>
            <input
              className="min-h-11 w-full rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3"
              inputMode="numeric"
              value={referralPercent}
              onChange={(event) => setReferralPercent(event.target.value)}
              placeholder="10"
            />
          </label>
        ) : null}
        {referralMessage ? <p className="text-sm text-[var(--pg-hint)]">{referralMessage}</p> : null}
        <button type="button" className={`${primaryButton} w-full`} disabled={referralBusy} onClick={() => void saveReferralSettings()}>
          {referralBusy ? "Saving" : "Save referral settings"}
        </button>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">PassGram subscribers</h2>
        {subscribers.length === 0 ? (
          <EmptyState title="No PassGram subscribers yet" description="Only members recorded by PassGram appear here." />
        ) : (
          visible.items.map((subscription) => {
            const status = subscriptionStatus({
              confirmation: subscription.confirmation,
              expiresAt: subscription.expiresAt,
              now,
              renewalPending: subscription.renewalPending,
            });
            const self = subscription.subscriberUserId === store.user.id;
            return (
              <article key={subscription.id} className="space-y-2 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={self ? store.user.displayName : "Subscriber"} className="h-9 w-9" />
                    <div>
                      <p className="text-sm font-semibold">{self ? store.user.displayName : "PassGram subscriber"}</p>
                      <p className="text-xs text-[var(--pg-hint)]">{formatDate(subscription.createdAt)}</p>
                    </div>
                  </div>
                  <StatusBadge status={status} />
                </div>
                <p className="text-xs text-[var(--pg-hint)]">
                  {subscription.startedAt ? formatDate(subscription.startedAt) : "Not confirmed"} to{" "}
                  {subscription.expiresAt ? formatDate(subscription.expiresAt) : "Not confirmed"} ·{" "}
                  {remainingLabel(subscription.expiresAt, now, subscription.confirmation === "confirmed")}
                </p>
                <LifetimeBar startAt={subscription.startedAt} expiresAt={subscription.expiresAt} now={now} />
              </article>
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

function Unavailable({ title, body }: { title: string; body: string }) {
  return <EmptyState title={title} description={body} />;
}
