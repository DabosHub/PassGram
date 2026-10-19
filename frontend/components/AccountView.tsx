"use client";

import { useEffect, useState } from "react";
import { activePassgramCount, feePolicy } from "@/lib/domain";
import { formatDate, formatUsdt } from "@/lib/money";
import type { AccountPage, AppRoute } from "@/lib/route";
import { useStore } from "@/lib/store";
import { Avatar, useNow } from "./ui";

const NOTIFY_STORAGE_KEY = "passgram.notify.prefs";

type NotifyPrefs = {
  creatorNewSubscriber: boolean;
  creatorSubscriptionEnded: boolean;
  subscriberExpiringSoon: boolean;
  affiliateNewConversion: boolean;
};

const defaultNotifyPrefs: NotifyPrefs = {
  creatorNewSubscriber: true,
  creatorSubscriptionEnded: true,
  subscriberExpiringSoon: true,
  affiliateNewConversion: true,
};

export function AccountView({
  page,
  go,
}: {
  page: AccountPage;
  go: (next: AppRoute, replace?: boolean) => void;
}) {
  if (page === "analytics") return <AnalyticsPage />;
  if (page === "notifications") return <NotificationsPage />;
  if (page === "policies") return <PoliciesPage />;
  return <AccountHub go={go} />;
}

function AccountHub({ go }: { go: (next: AppRoute, replace?: boolean) => void }) {
  const store = useStore();

  function open(accountPage: Exclude<AccountPage, "hub">) {
    go({
      tab: "dashboard",
      screen: "account",
      accountPage,
      communityId: null,
      referralCode: null,
      communityReferralCode: null,
      linkError: null,
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[26px]">My account</h1>
      <section className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <div className="flex items-center gap-3">
          <Avatar name={store.user.displayName} imageUrl={store.user.avatarUrl} className="h-14 w-14" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{store.user.displayName}</p>
            {store.user.username ? <p className="truncate text-sm text-[var(--pg-hint)]">@{store.user.username}</p> : null}
          </div>
        </div>
        <div className="mt-3 space-y-1 text-sm text-[var(--pg-hint)]">
          <p>Joined {formatDate(store.user.createdAt)}</p>
          <p>Telegram id: {store.user.telegramUserId ? String(store.user.telegramUserId) : "Not provided"}</p>
          <p>Referral lock: {store.user.referralLocked && store.user.referralCode ? store.user.referralCode : "None"}</p>
        </div>
      </section>

      <nav className="space-y-3" aria-label="Account sections">
        <MenuCard
          title="Analytics"
          description="Communities, subscriptions, and referral totals"
          onClick={() => open("analytics")}
        />
        <MenuCard
          title="Notifications"
          description="Choose which bot messages you want to receive"
          onClick={() => open("notifications")}
        />
        <MenuCard
          title="PassGram policies"
          description="Bot access, payments, referrals, and privacy"
          onClick={() => open("policies")}
        />
      </nav>
    </div>
  );
}

function AnalyticsPage() {
  const store = useStore();
  const now = useNow();
  const fees = feePolicy();
  const owned = store.communities.filter((item) => item.ownerUserId === store.user.id);
  const mySubs = store.subscriptions.filter((item) => item.subscriberUserId === store.user.id);
  const activeOwnedSubs = owned.reduce((sum, community) => sum + activePassgramCount(store.subscriptions, community.id, now), 0);
  const activeMySubs = mySubs.filter(
    (item) => item.confirmation === "confirmed" && item.expiresAt != null && item.expiresAt > now,
  ).length;
  const creatorPayments = store.payments.filter(
    (item) => item.status === "confirmed" && owned.some((community) => community.id === item.communityId),
  );
  const creatorGross = creatorPayments.reduce((sum, payment) => sum + BigInt(payment.gross), 0n);
  const creatorProceeds = creatorPayments.reduce((sum, payment) => sum + BigInt(payment.creatorAmount), 0n);
  const spendTotal = store.payments
    .filter((item) => item.status === "confirmed" && item.subscriberUserId === store.user.id)
    .reduce((sum, payment) => sum + BigInt(payment.gross), 0n);
  const affiliate = store.affiliates.find((item) => item.userId === store.user.id && item.confirmation === "confirmed");
  const platformReferralEarnings = store.payments
    .filter((item) => item.status === "confirmed" && affiliate)
    .reduce((sum, payment) => sum + BigInt(payment.affiliateAmount), 0n);
  const communityReferralEarnings = store.payments
    .filter((item) => item.status === "confirmed" && affiliate)
    .reduce((sum, payment) => sum + BigInt(payment.communityAffiliateAmount || "0"), 0n);
  const successfulReferrals = affiliate
    ? store.payments.filter((item) => item.status === "confirmed" && BigInt(item.affiliateAmount) > 0n).length
    : 0;
  const successfulCommunityReferrals = affiliate
    ? store.payments.filter(
        (item) => item.status === "confirmed" && BigInt(item.communityAffiliateAmount || "0") > 0n,
      ).length
    : 0;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px]">Analytics</h1>
        <p className="mt-1 text-sm text-[var(--pg-hint)]">
          Confirmed PassGram activity on this account. Telegram member counts are not included.
        </p>
      </header>

      <section className="space-y-2 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="text-[18px] font-semibold">Communities</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-[var(--pg-hint)]">No communities on this account yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            <Stat label="Communities" value={String(owned.length)} />
            <Stat label="Active PassGram subscribers" value={String(activeOwnedSubs)} />
            <Stat label="Confirmed gross revenue" value={`${formatUsdt(creatorGross)} USDT`} />
            <Stat label="Confirmed creator proceeds" value={`${formatUsdt(creatorProceeds)} USDT`} />
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="text-[18px] font-semibold">Subscriptions</h2>
        {mySubs.length === 0 ? (
          <p className="text-sm text-[var(--pg-hint)]">No subscriptions on this account yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            <Stat label="Subscriptions" value={String(mySubs.length)} />
            <Stat label="Active now" value={String(activeMySubs)} />
            <Stat label="Confirmed spend" value={`${formatUsdt(spendTotal)} USDT`} />
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="text-[18px] font-semibold">PassGram referral</h2>
        {!affiliate ? (
          <p className="text-sm text-[var(--pg-hint)]">Create a PassGram referral link to start platform referral analytics.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            <Stat label="Referral code" value={affiliate.code} />
            <Stat label="Successful creator referrals" value={String(successfulReferrals)} />
            <Stat label="Confirmed platform earnings" value={`${formatUsdt(platformReferralEarnings)} USDT`} />
            <Stat label="Share of each payment" value={`${fees.affiliateOfPaymentPercent}%`} />
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="text-[18px] font-semibold">Communities referral</h2>
        {!affiliate ? (
          <p className="text-sm text-[var(--pg-hint)]">Register a PassGram payout address, then promote communities with referrals enabled.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            <Stat label="Successful community referrals" value={String(successfulCommunityReferrals)} />
            <Stat label="Confirmed community earnings" value={`${formatUsdt(communityReferralEarnings)} USDT`} />
            <Stat label="Source" value="Creator share (per community rate)" />
          </ul>
        )}
      </section>
    </div>
  );
}

function NotificationsPage() {
  const [notify, setNotify] = useState<NotifyPrefs>(defaultNotifyPrefs);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NOTIFY_STORAGE_KEY);
      if (raw) setNotify({ ...defaultNotifyPrefs, ...(JSON.parse(raw) as Partial<NotifyPrefs>) });
    } catch {
      /* keep defaults */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(NOTIFY_STORAGE_KEY, JSON.stringify(notify));
  }, [notify, ready]);

  function toggle(key: keyof NotifyPrefs) {
    setNotify((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px]">Notifications</h1>
        <p className="mt-1 text-sm text-[var(--pg-hint)]">
          Choose which bot messages you want. Preferences are saved on this device until the notification API is connected.
        </p>
      </header>
      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <NotifyToggle
          label="New subscriber joined"
          description="Creators: message when someone pays and is added."
          checked={notify.creatorNewSubscriber}
          onChange={() => toggle("creatorNewSubscriber")}
        />
        <NotifyToggle
          label="Subscription ended and removed"
          description="Creators: message when access expires and the member is removed from the channel."
          checked={notify.creatorSubscriptionEnded}
          onChange={() => toggle("creatorSubscriptionEnded")}
        />
        <NotifyToggle
          label="Subscription ending in 2 days"
          description="Subscribers: reminder before your access expires."
          checked={notify.subscriberExpiringSoon}
          onChange={() => toggle("subscriberExpiringSoon")}
        />
        <NotifyToggle
          label="New referral conversion"
          description="Affiliates: message when a referred payment is confirmed."
          checked={notify.affiliateNewConversion}
          onChange={() => toggle("affiliateNewConversion")}
        />
      </section>
    </div>
  );
}

function PoliciesPage() {
  const fees = feePolicy();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px]">PassGram policies</h1>
        <p className="mt-1 text-sm text-[var(--pg-hint)]">How the bot, payments, referrals, and privacy work.</p>
      </header>
      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <PolicyBlock title="Bot access">
          PassGramBot manages paid channel access after a confirmed USDT payment on TON. The bot invites or admits the subscriber when payment is confirmed, and removes access when the paid period ends. Channel verification requires the bot to be an admin with invite and restrict rights before a community can go live.
        </PolicyBlock>
        <PolicyBlock title="Payments">
          Prices are listed in USDT on TON. PassGram does not add a fee on top of the listed price. Network fees in TON may still apply. A subscription is not treated as active until payment confirmation is available from the indexer.
        </PolicyBlock>
        <PolicyBlock title="Fees and referrals">
          Platform fee is {fees.platformPercent}% of each confirmed payment. When a first-touch referrer is locked, the affiliate earns {fees.affiliateOfPaymentPercent}% of the payment ({fees.affiliateOfFeePercent}% of the platform fee). Referral attribution locks on the first Start / invite touch and does not change later.
        </PolicyBlock>
        <PolicyBlock title="Privacy">
          PassGram uses your Telegram identity from Mini App initData to operate the account. Wallet connection is used to sign payments. Payout accounts are collected when you create a community or a referral link. Do not share private keys. PassGram never asks for your seed phrase.
        </PolicyBlock>
        <PolicyBlock title="Account responsibility">
          Creators are responsible for their channel content and Telegram compliance. Affiliates must not misrepresent PassGram pricing or access. Abuse, fraud, or unauthorized access attempts may result in removal from the program.
        </PolicyBlock>
      </section>
    </div>
  );
}

function MenuCard({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4 text-left active:bg-[var(--pg-bg)]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold text-[var(--pg-text)]">{title}</p>
        <p className="mt-1 text-sm text-[var(--pg-hint)]">{description}</p>
      </div>
      <span className="shrink-0 text-[20px] text-[var(--pg-blue)]" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="text-[var(--pg-hint)]">{label}</span>
      <span className="text-right font-normal text-[var(--pg-text)]">{value}</span>
    </li>
  );
}

function NotifyToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-[var(--pg-line)] pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="text-[15px]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--pg-hint)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--pg-blue)]" : "bg-[var(--pg-line)]"}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? "left-5" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

function PolicyBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="border-t border-[var(--pg-line)] pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--pg-hint)]">{children}</p>
    </div>
  );
}
