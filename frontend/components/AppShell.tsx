"use client";

import { useEffect, useState } from "react";
import type { AppRoute } from "@/lib/route";
import { useStore } from "@/lib/store";
import { bootTelegram, bootTelegramSdk } from "@/lib/telegram";
import { useAppRoute } from "@/lib/useRoute";
import { AccountView } from "./AccountView";
import { CommunityRoute, ManageRoute, SubscriptionRoute } from "./CommunityScreens";
import { CreateView } from "./CreateView";
import { DashboardView } from "./DashboardView";
import { Logo } from "./Logo";
import { ReferralView } from "./ReferralView";
import { Avatar } from "./ui";

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "create", label: "Create" },
  { id: "referral", label: "Referral" },
] as const;

export function AppShell() {
  const store = useStore();
  const { route, ready, go } = useAppRoute();
  const [banner, setBanner] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const walletAccount = store.walletAccount;

  useEffect(() => {
    const profile = bootTelegram();
    if (profile) {
      store.setTelegramProfile({
        telegramUserId: profile.id > 0 ? profile.id : null,
        displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
        username: profile.username ?? "",
        avatarUrl: profile.photoUrl ?? "",
      });
    }
    void bootTelegramSdk();
  }, [store.ready]);

  useEffect(() => {
    if (!store.ready || !route.referralCode) return;
    const code = route.referralCode;
    void store.acceptReferral(code).then((message) => {
      if (message) setBanner(message);
      go({ ...route, referralCode: null }, true);
    });
  }, [store.ready, route.referralCode]);

  useEffect(() => {
    if (!store.ready || !route.communityId || !route.communityReferralCode) return;
    const communityId = route.communityId;
    const code = route.communityReferralCode;
    void (async () => {
      try {
        const response = await fetch("/api/telegram/referrals/community/attribute", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
          },
          body: JSON.stringify({ communityId, code }),
        });
        const result = (await response.json()) as { ok?: boolean; message?: string };
        if (!result.ok && result.message) setBanner(result.message);
      } catch {
        setBanner("Community referral could not be saved.");
      } finally {
        go({ ...route, communityReferralCode: null }, true);
      }
    })();
  }, [store.ready, route.communityId, route.communityReferralCode]);

  const nested = route.screen !== "home";
  const title = "PassGram";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col border-x border-[var(--pg-line)] bg-[var(--pg-bg)] text-[var(--pg-text)]">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--pg-line)] bg-[var(--pg-card)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {nested ? (
            <button className="min-h-11 min-w-11 rounded-full text-base font-normal text-[var(--pg-blue)]" onClick={() => history.back()}>
              Back
            </button>
          ) : (
            <>
              <Logo className="h-9 w-9 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[20px]">{title}</p>
                {store.ready ? <p className="truncate text-[13px] text-[var(--pg-hint)]">{store.user.displayName}</p> : null}
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--pg-blue)] bg-[var(--pg-card)] py-1 pl-2 pr-3 text-[13px] font-normal text-[var(--pg-blue)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={walletBusy}
            aria-label={walletAccount ? `Connected wallet ${walletAccount}` : "Connect wallet"}
            onClick={() => {
              if (walletBusy) return;
              setWalletBusy(true);
              void store
                .connectWallet()
                .then((account) => {
                  if (!account) setBanner("Connect a TON wallet (Telegram Wallet or Tonkeeper) to sign payments.");
                })
                .finally(() => setWalletBusy(false));
            }}
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--pg-tag)] text-[var(--pg-blue-press)]" aria-hidden="true">
              <WalletIcon />
            </span>
            <span>{walletBusy ? "Connecting" : walletAccount ? shortenAccount(walletAccount) : "Connect"}</span>
          </button>
          <button
            className="rounded-full"
            aria-label="My account"
            onClick={() =>
              go({
                tab: route.tab,
                screen: "account",
                accountPage: "hub",
                communityId: null,
                referralCode: null,
                communityReferralCode: null,
                linkError: null,
              })
            }
          >
            <Avatar name={store.ready ? store.user.displayName : "Guest"} imageUrl={store.user.avatarUrl} className="h-9 w-9" />
          </button>
        </div>
      </header>
      <section className="flex-1 space-y-3 px-4 py-4 pb-28">
        {banner || route.linkError === "invalid_referral" ? (
          <p className="rounded-lg border border-[var(--pg-line)] bg-[var(--pg-card)] px-3 py-2 text-[15px]">{banner || "This referral code is invalid."}</p>
        ) : null}
        {!ready || !store.ready ? <p className="text-sm text-[var(--pg-hint)]">Loading</p> : <Screen route={route} go={go} />}
      </section>
      {store.lastTx ? (
        <div className="fixed inset-x-0 bottom-24 z-20 mx-auto w-full max-w-[430px] px-4">
          <div className="rounded-xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-6 shadow-[var(--pg-shadow-float)]">
            <h2 className="text-[18px]">{store.lastTx.status === "sent" ? "Transaction submitted" : "Transaction prepared"}</h2>
            <p className="mt-1 text-[15px] text-[var(--pg-hint)]">
              USDT subscribe for community {store.lastTx.intent.communityId}
              {store.lastTx.intent.hasCommunityReferrer ? " (with community referral on-chain)" : ""}. This does not confirm
              payment, access, or registration.
            </p>
            <button className="mt-3 text-base font-normal text-[var(--pg-blue)]" onClick={store.dismissTx}>Close</button>
          </div>
        </div>
      ) : null}
      <nav className="fixed bottom-0 left-1/2 z-10 w-full max-w-[430px] -translate-x-1/2 border-t border-[var(--pg-line)] bg-[var(--pg-card)] pb-[env(safe-area-inset-bottom)]" aria-label="Primary">
        <div className="grid grid-cols-3">
          {tabs.map((tab) => {
            const active = route.tab === tab.id;
            return (
              <button
                key={tab.id}
                className={`min-h-14 border-t-2 text-[15px] font-normal ${active ? "border-[var(--pg-blue)] text-[var(--pg-text)]" : "border-transparent text-[var(--pg-hint)]"}`}
                aria-current={active ? "page" : undefined}
                onClick={() =>
                  go({
                    tab: tab.id,
                    screen: "home",
                    accountPage: "hub",
                    communityId: null,
                    referralCode: null,
                    communityReferralCode: null,
                    linkError: null,
                  })
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </main>
  );
}

function shortenAccount(account: string): string {
  if (account.length <= 12) return account;
  return `${account.slice(0, 6)}…${account.slice(-4)}`;
}

function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5A2.5 2.5 0 0 1 6 6h12.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20H6A2.5 2.5 0 0 1 3.5 17.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M3.5 10H21" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="15" r="1.25" fill="currentColor" />
    </svg>
  );
}

function Screen({ route, go }: { route: AppRoute; go: (next: AppRoute, replace?: boolean) => void }) {
  if (route.screen === "account") return <AccountView page={route.accountPage} go={go} />;
  if (route.screen === "community") return <CommunityRoute communityId={route.communityId} linkError={route.linkError} />;
  if (route.screen === "subscription") return <SubscriptionRoute communityId={route.communityId} />;
  if (route.screen === "manage") return <ManageRoute communityId={route.communityId} />;
  if (route.tab === "create") return <CreateView />;
  if (route.tab === "referral") return <ReferralView />;
  return <DashboardView go={go} />;
}
