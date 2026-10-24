"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoLab } from "@/lib/demoLabContext";
import {
  formatCommunityReferralLink,
  formatReferralLink,
  rankAffiliates,
  referralShareMessage,
  referralShareTargets,
  type RankedAffiliate,
} from "@/lib/domain";
import { computeSplit, formatUsdt } from "@/lib/money";
import { loadLeaderboard } from "@/lib/services/confirmation";
import { useStore } from "@/lib/store";
import { signReceivingWallet } from "@/lib/ton/wallet";
import { PAYOUT_PROOF_AFFILIATE, PAYOUT_PROOF_COMMUNITY } from "@/lib/ton/walletProof";
import { Avatar, EmptyState, primaryButton, ReasonList, secondaryButton } from "./ui";

type ReferralSegment = "passgram" | "communities" | "leaderboard";

type ReferralCommunityCard = {
  communityId: number;
  title: string;
  description: string | null;
  hasPhoto: boolean;
  telegramMemberCount: number | null;
  priceUsdt: string;
  durationDays: number;
  referralPercent: number;
};

function formatReferralRate(percent: number): string {
  const text = percent.toFixed(2).replace(/\.?0+$/, "");
  return `${text || "0"}%`;
}

export function ReferralView() {
  const lab = useDemoLab();
  const [segment, setSegment] = useState<ReferralSegment>("leaderboard");

  useEffect(() => {
    if (lab.referralSegment) setSegment(lab.referralSegment);
  }, [lab.referralSegment]);

  return (
    <div className="space-y-4">
      <h1 className="text-[26px]">Referral</h1>
      <div className="grid grid-cols-3 gap-0.5 rounded-full border border-[var(--pg-line)] bg-[var(--pg-card)] p-1">
        <button
          type="button"
          className={`min-h-10 rounded-full px-0.5 text-center text-[10px] leading-tight font-normal ${segment === "leaderboard" ? "bg-[var(--pg-blue)] text-white" : "text-[var(--pg-hint)]"}`}
          onClick={() => setSegment("leaderboard")}
        >
          Leaderboard
        </button>
        <button
          type="button"
          className={`min-h-10 rounded-full px-0.5 text-center text-[10px] leading-tight font-normal ${segment === "passgram" ? "bg-[var(--pg-blue)] text-white" : "text-[var(--pg-hint)]"}`}
          onClick={() => setSegment("passgram")}
        >
          PassGram referral
        </button>
        <button
          type="button"
          className={`min-h-10 rounded-full px-0.5 text-center text-[10px] leading-tight font-normal ${segment === "communities" ? "bg-[var(--pg-blue)] text-white" : "text-[var(--pg-hint)]"}`}
          onClick={() => setSegment("communities")}
        >
          Communities referral
        </button>
      </div>
      {segment === "leaderboard" ? (
        <LeaderboardSegment />
      ) : segment === "passgram" ? (
        <PassGramReferralSegment />
      ) : (
        <CommunitiesReferralSegment />
      )}
    </div>
  );
}

function PassGramReferralSegment() {
  const store = useStore();
  const lab = useDemoLab();
  const affiliate = store.affiliates.find((item) => item.userId === store.user.id && item.confirmation === "confirmed");
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function register() {
    if (busy || affiliate) return;
    setError(null);
    setBusy(true);
    try {
      if (lab.enabled) {
        const account = store.user.payoutAddress || "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
        store.replaceLedger({
          user: { ...store.user, payoutAddress: account },
          communities: store.communities,
          subscriptions: store.subscriptions,
          payments: store.payments,
          affiliates: [
            {
              userId: store.user.id,
              code: store.user.username || "democreator",
              payoutAddress: account,
              confirmation: "confirmed",
              createdAt: Date.now(),
            },
          ],
        });
        return;
      }
      const signed = await signReceivingWallet({
        purpose: PAYOUT_PROOF_AFFILIATE,
        communityId: 0,
        telegramUserId: store.user.telegramUserId ? String(store.user.telegramUserId) : "",
      });
      if (!signed.ok) {
        setError(signed.message);
        return;
      }
      const outcome = await store.prepareAffiliate(signed.proof);
      setReasons(outcome.ok ? [] : outcome.reasons);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--pg-hint)]">
        Invite creators to PassGram. You earn from PassGram platform revenue on their eligible subscriptions.
      </p>
      {affiliate ? (
        <AffiliateDashboard code={affiliate.code} payoutAddress={affiliate.payoutAddress} />
      ) : (
        <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
          <h2 className="text-lg font-semibold">Earn with PassGram</h2>
          <p className="text-sm text-[var(--pg-hint)]">
            Invite creators to PassGram and earn 20% of PassGram revenue generated by their eligible subscriptions.
            <br />
            PassGram revenue: 2.5% of every single subscription.
          </p>
          <p className="text-sm text-[var(--pg-hint)]">
            Commissions are paid to the connected wallet. You confirm that wallet with a free signature. There is no network fee, and that wallet stays the one recorded with this link.
          </p>
          {error ? <p className="text-sm text-[var(--pg-ruby)]">{error}</p> : null}
          <ReasonList reasons={reasons} />
          <button className={`${primaryButton} w-full`} onClick={() => void register()} disabled={busy}>
            {busy ? "Confirming wallet" : "Create referral link"}
          </button>
        </section>
      )}
    </div>
  );
}

function communityLinkCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

function CommunitiesReferralSegment() {
  const store = useStore();
  const lab = useDemoLab();
  const [communities, setCommunities] = useState<ReferralCommunityCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [links, setLinks] = useState<Record<number, string>>({});
  const [savedPayouts, setSavedPayouts] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (lab.enabled) {
          const demoCards: ReferralCommunityCard[] = store.communities
            .filter((item) => item.confirmation === "confirmed" && item.status !== "paused" && item.referralEnabled)
            .map((item) => ({
              communityId: item.id,
              title: item.name,
              description: item.description || null,
              hasPhoto: Boolean(item.imageUrl),
              telegramMemberCount: 128,
              priceUsdt: item.price,
              durationDays: Math.max(1, Math.round(item.periodSeconds / 86_400)),
              referralPercent: item.referralPercentBps / 100,
            }));
          if (active) {
            setCommunities(demoCards);
            setLoading(false);
          }
          return;
        }
        const response = await fetch("/api/telegram/referrals/communities");
        const result = (await response.json()) as { ok?: boolean; communities?: ReferralCommunityCard[] };
        if (!active) return;
        setCommunities(Array.isArray(result.communities) ? result.communities : []);
      } catch {
        if (active) setCommunities([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [lab.enabled, store.communities]);

  async function createLink(communityId: number) {
    if (busyId != null) return;
    setBusyId(communityId);
    setMessage("");
    if (lab.enabled) {
      setLinks((current) => ({
        ...current,
        [communityId]: formatCommunityReferralLink(communityId, communityLinkCode()),
      }));
      setSavedPayouts((current) => ({
        ...current,
        [communityId]: store.user.payoutAddress || "Preview wallet",
      }));
      setBusyId(null);
      return;
    }
    try {
      const signed = await signReceivingWallet({
        purpose: PAYOUT_PROOF_COMMUNITY,
        communityId,
        telegramUserId: store.user.telegramUserId ? String(store.user.telegramUserId) : "",
      });
      if (!signed.ok) {
        setMessage(signed.message);
        return;
      }
      const response = await fetch("/api/telegram/referrals/community/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": typeof window !== "undefined" ? window.Telegram?.WebApp?.initData || "" : "",
        },
        body: JSON.stringify({ communityId, proof: signed.proof }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; link?: string; payoutAccount?: string };
      if (!result.ok || !result.link) {
        setMessage(result.message || "Could not create this community referral link.");
      } else {
        setLinks((current) => ({ ...current, [communityId]: result.link! }));
        setSavedPayouts((current) => ({ ...current, [communityId]: result.payoutAccount || signed.proof.address }));
        setMessage(result.message?.includes("already active") ? result.message : "");
      }
    } catch {
      setMessage("Could not reach the server for community referral links.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--pg-hint)]">
        Promote communities that enabled referrals. You earn the listed percent from the creator share when someone
        subscribes via your link. You earn that same percent on every renewal, for as long as that subscriber keeps
        renewing.
      </p>
      {message ? <p className={`text-sm ${message.includes("ready") || message.includes("already active") ? "text-[var(--pg-hint)]" : "text-[var(--pg-ruby)]"}`}>{message}</p> : null}
      {loading ? (
        <p className="text-sm text-[var(--pg-hint)]">Loading communities</p>
      ) : communities.length === 0 ? (
        <EmptyState
          title="No communities with referrals yet"
          description="When creators enable community referrals, their communities appear here as cards."
        />
      ) : (
        communities.map((community) => {
          const photoUrl = community.hasPhoto ? `/api/telegram/communities/${community.communityId}/photo` : "";
          const link = links[community.communityId];
          const creatorShare = computeSplit(BigInt(community.priceUsdt), false).creator;
          return (
            <article key={community.communityId} className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
              <div className="flex items-start gap-3">
                <Avatar name={community.title} seed={String(community.communityId)} imageUrl={photoUrl || undefined} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">{community.title}</h2>
                  <p className="text-sm text-[var(--pg-hint)]">
                    {community.telegramMemberCount != null ? `${community.telegramMemberCount} members` : "Members unavailable"}
                  </p>
                </div>
              </div>
              {community.description ? <p className="text-sm leading-relaxed text-[var(--pg-hint)]">{community.description}</p> : null}
              <div className="rounded-2xl bg-[var(--pg-bg)] px-3 py-3">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-[var(--pg-hint)]">Creator share</dt>
                    <dd className="mt-1 text-sm font-semibold">{formatUsdt(creatorShare)} USDT</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--pg-hint)]">Referral rate</dt>
                    <dd className="mt-1 text-sm font-semibold">{formatReferralRate(community.referralPercent)}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs leading-relaxed text-[var(--pg-hint)]">The referral rate applies to the creator share.</p>
              </div>
              {link ? (
                <div className="space-y-3 border-t border-[var(--pg-line)] pt-3">
                  <div>
                    <p className="text-xs text-[var(--pg-hint)]">Referral link</p>
                    <a
                      className="mt-1 block break-all rounded-2xl bg-[var(--pg-bg)] px-3 py-2 text-xs leading-relaxed underline"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link}
                    </a>
                  </div>
                  {savedPayouts[community.communityId] ? (
                    <div>
                      <p className="text-xs text-[var(--pg-hint)]">Receiving wallet</p>
                      <p className="mt-1 break-all rounded-2xl bg-[var(--pg-bg)] px-3 py-2 text-xs leading-relaxed">
                        {savedPayouts[community.communityId]}
                      </p>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={primaryButton}
                      onClick={() => {
                        void navigator.clipboard.writeText(link).then(() => {
                          setCopiedId(community.communityId);
                          window.setTimeout(() => setCopiedId((current) => (current === community.communityId ? null : current)), 2000);
                        });
                      }}
                    >
                      {copiedId === community.communityId ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      className={secondaryButton}
                      onClick={() => void navigator.share?.({ url: link, title: community.title })}
                    >
                      Share
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-[var(--pg-hint)]">
                    You confirm the connected wallet with a free signature. Commissions for this community are paid to that wallet.
                  </p>
                  <button
                    type="button"
                    className={`${primaryButton} w-full`}
                    disabled={busyId === community.communityId}
                    onClick={() => void createLink(community.communityId)}
                  >
                    {busyId === community.communityId ? "Confirming wallet" : "Create referral link"}
                  </button>
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}

function LeaderboardSegment() {
  const store = useStore();
  const lab = useDemoLab();
  const [remote, setRemote] = useState<RankedAffiliate[]>([]);
  const [reason, setReason] = useState("Loading");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (lab.enabled) {
      setRemote([
        {
          id: "demo:1",
          displayName: "Mira",
          username: "mira",
          avatarUrl: "",
          referrals: 12,
          conversions: 4,
          confirmedCommission: "4200000",
        },
        {
          id: store.user.id,
          displayName: store.user.displayName || "You",
          username: store.user.username || "democreator",
          avatarUrl: store.user.avatarUrl,
          referrals: 3,
          conversions: 1,
          confirmedCommission: "750000",
        },
      ]);
      setReason("");
      setLoading(false);
      return;
    }
    void loadLeaderboard().then((result) => {
      if (!active) return;
      setRemote(result.entries);
      setReason(result.reason);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [lab.enabled, store.user.avatarUrl, store.user.displayName, store.user.id, store.user.username]);

  const localEntries = useMemo(() => {
    const confirmed = store.affiliates.filter((item) => item.confirmation === "confirmed");
    return rankAffiliates(
      confirmed.map((affiliate) => {
        const isSelf = affiliate.userId === store.user.id;
        const earnings = store.payments
          .filter((payment) => payment.status === "confirmed")
          .reduce((sum, payment) => {
            // Local preview: attribute confirmed affiliate + community cuts to the current affiliate profile when self.
            if (!isSelf) return sum;
            return sum + BigInt(payment.affiliateAmount || "0") + BigInt(payment.communityAffiliateAmount || "0");
          }, 0n);
        return {
          id: affiliate.userId,
          displayName: isSelf ? store.user.displayName || affiliate.code : affiliate.code,
          username: isSelf ? store.user.username : affiliate.code,
          avatarUrl: isSelf ? store.user.avatarUrl : "",
          referrals: 0,
          conversions: 0,
          confirmedCommission: earnings.toString(),
        } satisfies RankedAffiliate;
      }),
    );
  }, [store.affiliates, store.payments, store.user]);

  const entries = remote.length > 0 ? rankAffiliates(remote) : localEntries;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--pg-hint)]">
        Marketers ranked by confirmed USDT earnings from PassGram referral and Communities referral.
      </p>
      {loading && remote.length === 0 && localEntries.length === 0 ? (
        <p className="text-sm text-[var(--pg-hint)]">Loading</p>
      ) : entries.length === 0 ? (
        <EmptyState title="No marketers yet" description={reason} />
      ) : (
        entries.map((entry) => (
          <article
            key={entry.id}
            className="flex items-center justify-between gap-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={entry.displayName} imageUrl={entry.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate font-semibold">{entry.displayName}</p>
                <p className="truncate text-xs text-[var(--pg-hint)]">
                  {entry.username ? `@${entry.username.replace(/^@/, "")}` : "No username"}
                </p>
              </div>
            </div>
            <p className="shrink-0 text-right text-sm font-semibold tabular-nums">
              {formatUsdt(entry.confirmedCommission)} USDT
            </p>
          </article>
        ))
      )}
    </div>
  );
}

function openShareTarget(url: string) {
  const webApp = window.Telegram?.WebApp as { openLink?: (url: string) => void; openTelegramLink?: (url: string) => void } | undefined;
  if (url.startsWith("https://t.me/") && typeof webApp?.openTelegramLink === "function") {
    webApp.openTelegramLink(url);
    return;
  }
  if (typeof webApp?.openLink === "function") {
    webApp.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function AffiliateDashboard({ code, payoutAddress }: { code: string; payoutAddress: string }) {
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const origin = typeof window === "undefined" ? null : window.location.origin;
  const link = formatReferralLink(code, origin);
  const message = referralShareMessage(link);
  const targets = referralShareTargets(link);
  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }
  function share(target: "x" | "telegram") {
    openShareTarget(targets[target]);
    setShareOpen(false);
  }
  useEffect(() => {
    if (!shareOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setShareOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shareOpen]);
  return (
    <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
      <h2 className="font-semibold">Your PassGram referral link</h2>
      <a className="block break-all text-sm tracking-tight underline" href={link} target="_blank" rel="noreferrer">
        {link}
      </a>
      <p className="text-xs text-[var(--pg-hint)]">Code {code}</p>
      <p className="text-sm text-[var(--pg-hint)]">Receiving wallet: {payoutAddress}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={primaryButton} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" className={secondaryButton} onClick={() => setShareOpen(true)}>
          Share
        </button>
      </div>
      {shareOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8 sm:items-center"
          role="presentation"
          onClick={() => setShareOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="referral-share-title"
            className="w-full max-w-[398px] space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <h2 id="referral-share-title" className="text-lg font-semibold">
                Share your referral link
              </h2>
              <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-[var(--pg-bg)] px-3 py-3 text-sm leading-relaxed">
                {message}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={secondaryButton} onClick={() => share("x")}>
                Share on X
              </button>
              <button type="button" className={primaryButton} onClick={() => share("telegram")}>
                Share on Telegram
              </button>
            </div>
            <button type="button" className="min-h-11 w-full text-sm text-[var(--pg-hint)]" onClick={() => setShareOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
