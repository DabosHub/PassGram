"use client";

import { useEffect, useState } from "react";
import { MAX_DURATION_DAYS, MIN_DURATION_DAYS } from "@/lib/channelPolicy";
import { activePassgramCount, feePolicy } from "@/lib/domain";
import { MAX_COMMUNITY_REFERRAL_BPS, formatDate, formatUsdt } from "@/lib/money";
import { MAX_PRICE, MIN_PRICE, PLATFORM_FEE_BPS, REFERRER_FEE_BPS } from "@/lib/ton/config";
import type { AccountPage, AppRoute } from "@/lib/route";
import { useStore } from "@/lib/store";
import { Avatar, useNow } from "./ui";

const NOTIFY_STORAGE_KEY = "passgram.notify.prefs";

type NotifyPrefs = {
  creatorNewSubscriber: boolean;
  creatorSubscriptionEnded: boolean;
  creatorReferralLink: boolean;
  subscriberExpiringSoon: boolean;
  subscriberCommunityReferral: boolean;
  affiliateNewConversion: boolean;
};

const defaultNotifyPrefs: NotifyPrefs = {
  creatorNewSubscriber: true,
  creatorSubscriptionEnded: true,
  creatorReferralLink: true,
  subscriberExpiringSoon: true,
  subscriberCommunityReferral: true,
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
    .filter((item) => item.status === "confirmed")
    .reduce((sum, payment) => sum + BigInt(payment.communityAffiliateAmount || "0"), 0n);
  const successfulReferrals = affiliate
    ? store.payments.filter((item) => item.status === "confirmed" && BigInt(item.affiliateAmount) > 0n).length
    : 0;
  const successfulCommunityReferrals = store.payments.filter(
    (item) => item.status === "confirmed" && BigInt(item.communityAffiliateAmount || "0") > 0n,
  ).length;

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
        <ul className="space-y-1 text-sm">
          <Stat label="Successful community referrals" value={String(successfulCommunityReferrals)} />
          <Stat label="Confirmed community earnings" value={`${formatUsdt(communityReferralEarnings)} USDT`} />
          <Stat label="Source" value="Creator share (per community rate)" />
        </ul>
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
          label="New community referral link"
          description="Creators: PassGramBot messages you when someone creates a referral link for a community whose referral program is on."
          checked={notify.creatorReferralLink}
          onChange={() => toggle("creatorReferralLink")}
        />
        <NotifyToggle
          label="Subscription ending in 1 day"
          description="Subscribers: PassGramBot messages you on the last day, before channel access is removed."
          checked={notify.subscriberExpiringSoon}
          onChange={() => toggle("subscriberExpiringSoon")}
        />
        <NotifyToggle
          label="Community referral program"
          description="Subscribers: PassGramBot messages you when a community you subscribe to starts, changes, or stops its referral program."
          checked={notify.subscriberCommunityReferral}
          onChange={() => toggle("subscriberCommunityReferral")}
        />
        <NotifyToggle
          label="New referral conversion"
          description="You: PassGramBot messages you when someone you referred subscribes through a community referral, or creates a community through your PassGram referral."
          checked={notify.affiliateNewConversion}
          onChange={() => toggle("affiliateNewConversion")}
        />
      </section>
    </div>
  );
}

function PoliciesPage() {
  const fees = feePolicy();
  const creatorShare = (10_000 - Number(PLATFORM_FEE_BPS)) / 100;
  const platformRemainder = (Number(PLATFORM_FEE_BPS) - Number(REFERRER_FEE_BPS)) / 100;
  const communityMax = Number(MAX_COMMUNITY_REFERRAL_BPS) / 100;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[26px]">PassGram policies</h1>
        <p className="mt-1 text-sm text-[var(--pg-hint)]">The rules for access, payments, referrals, and privacy.</p>
      </header>
      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <PolicyBlock
          title="Bot access"
          points={[
            "PassGramBot opens channel access after a USDT payment is confirmed, and removes it when that subscriber's paid period ends.",
            "Before a community can be created, the bot must be a channel admin with only Invite users via link and Ban users.",
            "Each confirmed payment creates a one-person invite for that subscription period. The raw invite stays private. The subscriber sees Join community.",
            "The paid period starts when that invite is created, whether the subscriber joins immediately or later.",
            "PassGramBot can message the subscriber on the last day, before access is removed.",
          ]}
        />
        <PolicyBlock
          title="Payments"
          points={[
            "The subscriber pays the listed price in USDT on TON. PassGram adds nothing on top of that price.",
            `The price is from ${formatUsdt(MIN_PRICE)} to ${formatUsdt(MAX_PRICE)} USDT. The duration is a whole number of days from ${MIN_DURATION_DAYS} to ${MAX_DURATION_DAYS}. That duration belongs to the subscriber, measured from their own confirmed payment.`,
            "A subscription becomes active only after the payment is confirmed. Submitting the transaction from the wallet leaves payment, access, and registration unconfirmed.",
            "A payment below the listed price is returned in full and opens no access. A payment above the listed price is settled at that price, and the extra is returned.",
            "A payment to a deactivated community is returned in full. The community page stays open.",
            "A new price or duration applies to subscribers and renewals after that change is confirmed. A period already paid stays as purchased.",
            "The creator sets the payout address when the community is registered, and can replace it from community settings. The wallet that registered the community signs that change. New subscriptions and renewals after confirmation pay the new address. Payments already sent stay where they were paid.",
            "Wallet actions can require a network fee on TON. That fee is separate from the USDT price.",
          ]}
        />
        <PolicyBlock
          title="Platform fee"
          points={[
            `PassGram keeps ${fees.platformPercent}% of each confirmed payment.`,
            `The creator's share starts at the remaining ${creatorShare}%. A community referral, when one applies, comes out of that creator share.`,
            "The creator, PassGram, and any referrer are paid from the confirmed payment itself. There is no later withdrawal step.",
          ]}
        />
        <PolicyBlock
          title="PassGram referral"
          points={[
            "This program pays the person who referred a creator to PassGram.",
            `That referrer earns ${fees.affiliateOfPaymentPercent}% of each confirmed subscription in the creator's communities. This is ${fees.affiliateOfFeePercent}% of the platform fee. The other ${platformRemainder}% stays with PassGram.`,
            `A community registered without a PassGram referrer keeps the full ${fees.platformPercent}% with PassGram.`,
            "The referrer is recorded the first time someone opens PassGram from that referral link, and that record stays with the account. Self-referral is rejected.",
            "The referrer's payout address is stored when the creator registers the community. Later subscription payments use that stored address.",
            "Creating the referral link is recorded by PassGram, with no wallet transaction and no network fee. The payout address is required then, and it stays the address recorded with that link.",
          ]}
        />
        <PolicyBlock
          title="Community referral"
          points={[
            `A creator can pay a marketer from the creator's own ${creatorShare}% share. The subscriber price stays the same, and the ${fees.platformPercent}% platform fee stays the same.`,
            `The creator sets the rate from 0.01% to ${communityMax}% of the creator share, with up to two decimal places. The platform fee is already removed from that share.`,
            "The marketer and the rate current at that moment are locked on the subscriber's first confirmed payment. Renewals keep that marketer and that rate.",
            "A first confirmed payment with no marketer stays without a community marketer on later payments by that subscriber.",
            "A later rate change applies to people who have not paid yet. People who already paid keep the rate from their first payment.",
            "Stopping the program closes new registrations, including older marketer links. Referrals already locked keep their original rate.",
            "Deactivating the community pauses the program with it and closes new payments, renewals, and new registrations. The saved price, duration, and rate stay in place. Activating again restores that same rate.",
            "Creating a community referral link is recorded by PassGram, with no wallet transaction. The payout address is entered for that community alone, and it stays the address recorded with that link. It is separate from any PassGram referral payout.",
            "The creator receives no community commission on their own community. The subscriber receives no community commission on their own payment.",
            "One payment can include both a PassGram referral and a community referral. Each follows its own rule above.",
          ]}
        />
        <PolicyBlock
          title="Privacy"
          points={[
            "PassGram uses your Telegram identity from the Mini App to operate the account.",
            "Your wallet signs community registration, subscription payments, and later updates that require the creator's or marketer's signature.",
            "Payout addresses are stored when you create a community or a referral link. Settlement pays that address.",
            "Notification choices saved on this device stay on this device.",
            "PassGram asks for neither your seed phrase nor your private key.",
          ]}
        />
        <PolicyBlock
          title="Responsibilities"
          points={[
            "Creators are responsible for their channel content and for following Telegram's rules.",
            "Marketers present the listed price, the access period, and the access a subscriber receives.",
            "Abuse, fraud, or an attempt to take access or funds without a confirmed payment can remove an account from PassGram.",
          ]}
        />
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

function PolicyBlock({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="border-t border-[var(--pg-line)] pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--pg-hint)]">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}
