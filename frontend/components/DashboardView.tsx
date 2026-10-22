"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  activePassgramCount,
  chooseDashboardSection,
  formatCommunityLink,
  remainingLabel,
  showsBothDashboardSections,
  statusLabel,
  subscriptionProgress,
  subscriptionStatus,
  type DashboardSection,
  type SubscriptionStatus,
} from "@/lib/domain";
import { formatDate, formatUsdt } from "@/lib/money";
import { useDemoLab } from "@/lib/demoLabContext";
import { useOwnerLedger } from "@/lib/useOwnerLedger";
import type { AppRoute } from "@/lib/route";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, primaryButton, useNow } from "./ui";

const SECTION_KEY = "passgram.dashboard.section";

export function DashboardView({ go }: { go: (route: AppRoute) => void }) {
  const store = useStore();
  const lab = useDemoLab();
  const now = useNow();
  const owned = store.communities.filter((item) => item.ownerUserId === store.user.id);
  const subscriptions = store.subscriptions.filter((item) => item.subscriberUserId === store.user.id);
  const both = showsBothDashboardSections(owned.length, subscriptions.length);
  const [section, setSection] = useState<DashboardSection>("communities");

  useEffect(() => {
    if (lab.enabled) return;
    let cancelled = false;
    void fetch("/api/telegram/communities", {
      headers: { "x-telegram-init-data": window.Telegram?.WebApp?.initData || "" },
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          ok?: boolean;
          communities?: Array<{
            communityId: number | null;
            title: string;
            description: string | null;
            priceUsdt: string | null;
            durationDays: number | null;
            ownerTelegramUserId: string;
            active: boolean;
            telegramMemberCount?: number | null;
          }>;
        };
        if (cancelled || !result.ok || !result.communities) return;
        for (const row of result.communities) {
          if (row.communityId == null || !row.priceUsdt || row.durationDays == null) continue;
          store.rememberCommunity({
            communityId: row.communityId,
            title: row.title,
            description: row.description,
            priceUsdt: row.priceUsdt,
            durationDays: row.durationDays,
            ownerTelegramUserId: row.ownerTelegramUserId,
            telegramMemberCount: "telegramMemberCount" in row ? row.telegramMemberCount : undefined,
          });
        }
      })
      .catch(() => {
        /* keep local store */
      });
    return () => {
      cancelled = true;
    };
  }, [store, lab.enabled]);

  useEffect(() => {
    const remembered = window.sessionStorage.getItem(SECTION_KEY);
    const next = chooseDashboardSection({
      ownedCount: owned.length,
      subscriptionCount: subscriptions.length,
      remembered: remembered === "communities" || remembered === "subscriptions" ? remembered : null,
    });
    if (next !== "empty") setSection(next);
  }, [owned.length, subscriptions.length]);

  function choose(next: DashboardSection) {
    window.sessionStorage.setItem(SECTION_KEY, next);
    setSection(next);
  }

  if (owned.length === 0 && subscriptions.length === 0) {
    return (
      <div className="flex w-full flex-1 items-center">
      <EmptyState
        title="Nothing here yet"
        description="Your subscriptions and communities will appear here when you join or create one."
        action={
          <button
            className={primaryButton}
            onClick={() =>
              go({
                tab: "create",
                screen: "home",
                accountPage: "hub",
                communityId: null,
                referralCode: null,
                communityReferralCode: null,
                linkError: null,
              })
            }
          >
            Create your first community
          </button>
        }
      />
      </div>
    );
  }

  const showCommunities = both ? section === "communities" : owned.length > 0;
  return (
    <div className="space-y-4">
      <h1 className="text-[26px]">Dashboard</h1>
      {both ? (
        <div className="grid grid-cols-2 rounded-full bg-[var(--pg-card)] p-1" role="tablist" aria-label="Dashboard sections">
          <SectionButton active={section === "communities"} onClick={() => choose("communities")}>
            My Communities
          </SectionButton>
          <SectionButton active={section === "subscriptions"} onClick={() => choose("subscriptions")}>
            My Subscriptions
          </SectionButton>
        </div>
      ) : null}
      {showCommunities ? (
        <CommunityList
          title={both ? undefined : "My Communities"}
          empty={owned.length === 0}
          onCreate={() =>
            go({
              tab: "create",
              screen: "home",
              accountPage: "hub",
              communityId: null,
              referralCode: null,
              communityReferralCode: null,
              linkError: null,
            })
          }
        >
          {owned.map((community) => (
            <CommunityCard key={community.id} communityId={community.id} go={go} />
          ))}
        </CommunityList>
      ) : (
        <section className="space-y-3">
          {both ? null : <h2 className="font-semibold">My Subscriptions</h2>}
          {subscriptions.length === 0 ? (
            <EmptyState title="No subscriptions yet" description="Communities you join will appear here after payment is confirmed." />
          ) : (
            subscriptions.map((subscription) => (
              <SubscriptionCard key={subscription.id} subscriptionId={subscription.id} now={now} go={go} />
            ))
          )}
        </section>
      )}
    </div>
  );
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

function membershipChipClass(status: SubscriptionStatus): string {
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

function SubscriptionCard({
  subscriptionId,
  now,
  go,
}: {
  subscriptionId: number;
  now: number;
  go: (route: AppRoute) => void;
}) {
  const store = useStore();
  const lab = useDemoLab();
  const subscription = store.subscriptions.find((item) => item.id === subscriptionId);
  useEffect(() => {
    if (lab.enabled || !subscription) return;
    const communityId = subscription.communityId;
    let cancelled = false;
    async function loadMembers() {
      try {
        const response = await fetch(`/api/telegram/communities/${communityId}`);
        const result = (await response.json()) as { ok?: boolean; community?: { telegramMemberCount?: number | null } };
        if (cancelled || !result.ok || result.community?.telegramMemberCount == null) return;
        store.noteTelegramMembers(communityId, result.community.telegramMemberCount);
      } catch {
        /* Keep the last Telegram member total. */
      }
    }
    void loadMembers();
    const timer = window.setInterval(() => void loadMembers(), 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [lab.enabled, store, subscription]);
  if (!subscription) return null;
  const community = store.communities.find((item) => item.id === subscription.communityId);
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
  const durationDays = community ? Math.max(1, Math.round(community.periodSeconds / 86_400)) : null;
  const price = community?.price || subscription.paymentAmount;
  const barClass =
    status === "expiring_soon" ? "bg-[#efa651]" : status === "expired" ? "bg-[var(--pg-hint)]" : "bg-[var(--pg-blue)]";
  const name = community?.name ?? "Unavailable community";
  const members = community?.telegramMemberCount;

  return (
    <button
      type="button"
      className="w-full space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4 text-left"
      onClick={() =>
        go({
          tab: "dashboard",
          screen: "subscription",
          accountPage: "hub",
          communityId: subscription.communityId,
          referralCode: null,
          communityReferralCode: null,
          linkError: null,
        })
      }
    >
      <div className="flex items-start gap-3">
        <Avatar name={name} seed={community?.telegramChatId || String(community?.id ?? subscription.communityId)} imageUrl={community?.imageUrl} className="h-14 w-14" />
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 pt-0.5">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{name}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-[var(--pg-hint)]">
              <MembersIcon />
              <span>{members == null ? "—" : members}</span>
              <span className="sr-only">Telegram members</span>
            </p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${membershipChipClass(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>
      {community?.description ? <p className="text-sm leading-relaxed text-[var(--pg-hint)]">{community.description}</p> : null}
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-[var(--pg-hint)]">Subscription price</dt>
          <dd className="mt-1 text-sm font-semibold">{formatUsdt(price)} USDT</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--pg-hint)]">Subscription duration</dt>
          <dd className="mt-1 text-sm font-semibold">{durationDays == null ? "Not confirmed" : `${durationDays} days`}</dd>
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
    </button>
  );
}

function CommunityCard({ communityId, go }: { communityId: number; go: (route: AppRoute) => void }) {
  const store = useStore();
  const lab = useDemoLab();
  const ledger = useOwnerLedger(Boolean(lab.sceneId));
  const now = useNow();
  const [copied, setCopied] = useState(false);
  const community = store.communities.find((item) => item.id === communityId);
  if (!community) return null;
  const remote = ledger?.communities.find((item) => item.community.id === community.id) ?? null;
  const view = remote?.community ?? community;
  const subscriptionRows = remote ? remote.subscriptions : store.subscriptions;
  const paymentRows = remote ? remote.payments : store.payments;
  const link = formatCommunityLink(view.id, typeof window === "undefined" ? null : window.location.origin);
  const subscribers = activePassgramCount(subscriptionRows, view.id, now);
  const removed = removedSubscriberCount(subscriptionRows, view.id, now);
  const revenue = creatorRevenue(paymentRows, view.id);
  const durationDays = Math.max(1, Math.round(view.periodSeconds / 86_400));
  const status =
    view.confirmation === "confirmed"
      ? view.status === "paused"
        ? "paused"
        : "active_community"
      : "pending_confirmation";
  const statusActive = status === "active_community";

  function openManage() {
    go({
      tab: "dashboard",
      screen: "manage",
      accountPage: "hub",
      communityId: community.id,
      referralCode: null,
      communityReferralCode: null,
      linkError: null,
    });
  }

  return (
    <article className="relative cursor-pointer space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
      <button type="button" className="absolute inset-0 z-0 rounded-3xl" aria-label={`Open ${view.name}`} onClick={openManage} />
      <button
        type="button"
        className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pg-bg)] text-[#3d4c5c]"
        aria-label="Community settings"
        onClick={() =>
          go({
            tab: "dashboard",
            screen: "settings",
            accountPage: "hub",
            communityId: community.id,
            referralCode: null,
            communityReferralCode: null,
            linkError: null,
          })
        }
      >
        <GearIcon />
      </button>
      <div className="pointer-events-none relative z-[1] space-y-4">
        <div className="flex items-start gap-3">
          <Avatar
            name={view.name}
            seed={view.telegramChatId || String(view.id)}
            imageUrl={view.imageUrl}
            className="h-14 w-14"
          />
          <div className="min-w-0 space-y-1.5 pr-8 pt-0.5">
            <p className="truncate text-base font-semibold">{view.name}</p>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${
                statusActive
                  ? "bg-[var(--pg-mint)] text-white"
                  : "bg-[var(--pg-line)] text-[var(--pg-hint)]"
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

        <dl className="grid grid-cols-3 gap-2 border-t border-[var(--pg-line)] pt-3">
          <div>
            <dt className="text-[11px] text-[var(--pg-hint)]">Subscribers</dt>
            <dd className="mt-1 text-sm font-semibold">{subscribers}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--pg-hint)]">Expired</dt>
            <dd className="mt-1 text-sm font-semibold">{removed}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--pg-hint)]">Revenue</dt>
            <dd className="mt-1 text-sm font-semibold">{formatUsdt(revenue)} USDT</dd>
          </div>
        </dl>

        <div>
          <p className="text-xs text-[var(--pg-hint)]">Subscription link</p>
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-2">
            <a
              className="pointer-events-auto relative z-10 min-w-0 flex-1 break-all text-xs text-[var(--pg-text)] underline"
              href={link}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              {link}
            </a>
            <button
              type="button"
              className="pointer-events-auto relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--pg-blue)]"
              aria-label={copied ? "Copied" : "Copy subscription link"}
              title={copied ? "Copied" : "Copy"}
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function removedSubscriberCount(
  subscriptions: Array<{
    communityId: number;
    subscriberUserId: string;
    confirmation: string;
    expiresAt: number | null;
  }>,
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
  let removed = 0;
  for (const state of byUser.values()) {
    if (state.expired && !state.active) removed += 1;
  }
  return removed;
}

function creatorRevenue(
  payments: Array<{ communityId: number; status: string; creatorAmount: string }>,
  communityId: number,
): string {
  let total = 0n;
  for (const payment of payments) {
    if (payment.communityId !== communityId || payment.status !== "confirmed") continue;
    try {
      total += BigInt(payment.creatorAmount || "0");
    } catch {
      /* skip malformed amounts */
    }
  }
  return total.toString();
}

function GearIcon() {
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

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6.5 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommunityList({
  title,
  empty,
  onCreate,
  children,
}: {
  title?: string;
  empty: boolean;
  onCreate: () => void;
  children: ReactNode;
}) {
  if (empty) {
    return (
      <EmptyState
        title="No communities yet"
        description="Communities you create will appear here after PassGram confirms them."
        action={
          <button className={primaryButton} onClick={onCreate}>
            Create a community
          </button>
        }
      />
    );
  }
  return (
    <section className="space-y-3">
      {title ? <h2 className="font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}

function SectionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      className={`min-h-10 rounded-full text-[15px] font-normal ${active ? "bg-[var(--pg-blue)] text-white" : "text-[var(--pg-hint)]"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
