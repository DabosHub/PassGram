"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  activePassgramCount,
  chooseDashboardSection,
  formatCommunityLink,
  remainingLabel,
  showsBothDashboardSections,
  subscriptionStatus,
  type DashboardSection,
} from "@/lib/domain";
import { formatDate, formatUsdt } from "@/lib/money";
import type { AppRoute } from "@/lib/route";
import { useStore } from "@/lib/store";
import { Avatar, EmptyState, LifetimeBar, primaryButton, secondaryButton, StatusBadge, useNow } from "./ui";

const SECTION_KEY = "passgram.dashboard.section";

export function DashboardView({ go }: { go: (route: AppRoute) => void }) {
  const store = useStore();
  const now = useNow();
  const owned = store.communities.filter((item) => item.ownerUserId === store.user.id);
  const subscriptions = store.subscriptions.filter((item) => item.subscriberUserId === store.user.id);
  const both = showsBothDashboardSections(owned.length, subscriptions.length);
  const [section, setSection] = useState<DashboardSection>("communities");

  useEffect(() => {
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
          });
        }
      })
      .catch(() => {
        /* keep local store */
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

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
            subscriptions.map((subscription) => {
              const community = store.communities.find((item) => item.id === subscription.communityId);
              const status = subscriptionStatus({
                confirmation: subscription.confirmation,
                expiresAt: subscription.expiresAt,
                now,
                renewalPending: subscription.renewalPending,
              });
              return (
                <button
                  key={subscription.id}
                  className="w-full rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4 text-left"
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
                    <Avatar name={community?.name ?? "Community"} imageUrl={community?.imageUrl} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-semibold">{community?.name ?? "Unavailable community"}</p>
                        <StatusBadge status={status} />
                      </div>
                      {community?.telegramUsername ? <p className="text-xs text-[var(--pg-hint)]">@{community.telegramUsername}</p> : null}
                      <p className="text-xs text-[var(--pg-hint)]">
                        Started {subscription.startedAt ? formatDate(subscription.startedAt) : "Not confirmed"}
                        {" · "}
                        Expires {subscription.expiresAt ? formatDate(subscription.expiresAt) : "Not confirmed"}
                      </p>
                      <p className="text-xs">{remainingLabel(subscription.expiresAt, now, subscription.confirmation === "confirmed")}</p>
                      <LifetimeBar startAt={subscription.startedAt} expiresAt={subscription.expiresAt} now={now} />
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}

function CommunityCard({ communityId, go }: { communityId: number; go: (route: AppRoute) => void }) {
  const store = useStore();
  const now = useNow();
  const [copied, setCopied] = useState(false);
  const community = store.communities.find((item) => item.id === communityId);
  if (!community) return null;
  const link = formatCommunityLink(community.id, typeof window === "undefined" ? null : window.location.origin);

  return (
    <div className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
      <button
        type="button"
        className="w-full text-left"
        onClick={() =>
          go({
            tab: "dashboard",
            screen: "manage",
            accountPage: "hub",
            communityId: community.id,
            referralCode: null,
            communityReferralCode: null,
            linkError: null,
          })
        }
      >

        <div className="flex items-start gap-3">
          <Avatar name={community.name} imageUrl={community.imageUrl} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate font-semibold">{community.name}</p>
              <StatusBadge
                status={
                  community.confirmation === "confirmed"
                    ? community.status === "paused"
                      ? "paused"
                      : "active_community"
                    : "pending_confirmation"
                }
              />
            </div>
            {community.telegramUsername ? <p className="truncate text-xs text-[var(--pg-hint)]">@{community.telegramUsername}</p> : null}
            <p className="pg-amount mt-2 text-sm">{formatUsdt(community.price)} USDT</p>
            <p className="text-xs text-[var(--pg-hint)]">
              {activePassgramCount(store.subscriptions, community.id, now)} active PassGram subscriptions
            </p>
          </div>
        </div>
      </button>
      <p className="break-all text-[11px] text-[var(--pg-hint)]">{link}</p>
      <button
        type="button"
        className={secondaryButton}
        onClick={() => {
          void navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy subscription link"}
      </button>
    </div>
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
