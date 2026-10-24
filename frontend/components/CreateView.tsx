"use client";

import { useEffect, useRef, useState } from "react";
import {
  channelStateMessage,
  communityFormReady,
  ownershipVerified,
  parseDurationDays,
  parseCommunityPrice,
  selectorAvailability,
  type ChannelUiState,
} from "@/lib/channelPolicy";
import { DEMO_OWNED_COMMUNITY_ID } from "@/lib/demoLab";
import { useDemoLab } from "@/lib/demoLabContext";
import { formatCommunityLink, referralBotUsername } from "@/lib/domain";
import { useStore } from "@/lib/store";
import { contractIsConfigured } from "@/lib/ton/config";
import { buildRegisterCommunityBody } from "@/lib/ton/registry";
import { sendRegistryCall } from "@/lib/ton/send";
import { getConnectedTonAddress } from "@/lib/ton/wallet";
import { useAppRoute } from "@/lib/useRoute";
import { toNano } from "@ton/core";
import { Avatar, Field, primaryButton, secondaryButton } from "./ui";

type PublicChannel = {
  telegramChatId: string;
  communityId?: number | null;
  title: string;
  description: string | null;
  hasPhoto: boolean;
  telegramMemberCount: number | null;
  telegramMemberCountFetchedAt: string | null;
  verificationStatus: ChannelUiState;
  botCanInviteUsers?: boolean;
  botCanRestrictMembers?: boolean;
  botAdded?: boolean;
  ownerTelegramUserId?: string;
  priceUsdt?: string | null;
  durationDays?: number | null;
};

type ChannelResponse = {
  ok?: boolean;
  state?: ChannelUiState;
  message?: string;
  requestId?: number;
  preparedButtonId?: string;
  channel?: PublicChannel;
  alreadyExists?: boolean;
  allowed?: boolean;
  communityId?: number;
  platformMarketer?: string | null;
};

export function CreateView() {
  const store = useStore();
  const lab = useDemoLab();
  const { go } = useAppRoute();
  const demoCreate = Boolean(lab.enabled && lab.createSnapshot);
  const [channelState, setChannelState] = useState<ChannelUiState>("not_selected");
  const [channelMessage, setChannelMessage] = useState("");
  const [channel, setChannel] = useState<PublicChannel | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [shareId, setShareId] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [botHandleCopied, setBotHandleCopied] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const pollGeneration = useRef(0);
  const botHandle = `@${referralBotUsername() || "PassGramBot"}`;
  const githubRepoUrl = "https://github.com/DabosHub/PassGram";
  const githubRepoLabel = "DabosHub/PassGram";

  const botAdded = Boolean(channel?.botAdded ?? (channel?.botCanInviteUsers && channel?.botCanRestrictMembers));
  const owned = ownershipVerified(channelState) && channel != null;

  useEffect(() => {
    const snap = lab.createSnapshot;
    if (!snap) return;
    setChannelState(snap.channelState);
    setChannelMessage(snap.channelMessage);
    setChannel(snap.channel);
    setRequestId(snap.requestId);
    setPrice(snap.price);
    setDuration(snap.duration);
    setCreated(snap.created);
    setShareOpen(snap.shareOpen);
    setSafetyOpen(snap.safetyOpen);
    setShareId(snap.created ? DEMO_OWNED_COMMUNITY_ID : null);
    setFormMessage(snap.created ? "Community created." : "");
    setFormError("");
    setBusy(false);
  }, [lab.createSnapshot]);

  // While waiting for the owner to add PassGramBot, poll access so the Added badge flips without a manual tap.
  useEffect(() => {
    if (demoCreate || !owned || botAdded || !channel?.telegramChatId || busy) return;
    let cancelled = false;
    const generation = pollGeneration.current;
    const timer = window.setInterval(() => {
      if (cancelled || pollGeneration.current !== generation) return;
      void (async () => {
        try {
          const response = await fetch("/api/telegram/access", {
            method: "POST",
            headers: { ...telegramHeaders(), "content-type": "application/json" },
            body: JSON.stringify({ telegramChatId: channel.telegramChatId }),
          });
          const result = (await response.json()) as ChannelResponse;
          if (cancelled || pollGeneration.current !== generation) return;
          if (ownershipVerified(result.state || "") && result.channel) applyChannel(result);
        } catch {
          // Keep waiting; user can still tap Check bot access.
        }
      })();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [owned, botAdded, channel?.telegramChatId, busy]);

  useEffect(() => {
    if (!channel?.hasPhoto) {
      setPhotoUrl("");
      return;
    }
    const controller = new AbortController();
    let objectUrl = "";
    void (async () => {
      try {
        const response = await fetch(`/api/telegram/photo?chatId=${encodeURIComponent(channel.telegramChatId)}`, {
          headers: telegramHeaders(),
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (!controller.signal.aborted) setPhotoUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setPhotoUrl("");
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [channel?.hasPhoto, channel?.telegramChatId]);

  const durationDays = parseDurationDays(duration);
  const ready =
    communityFormReady({ channelState, botAdded, price, durationDays }) && !busy && !created;
  const priceError = price.trim() && !parseCommunityPrice(price) ? "Enter at least 1 USDT, with up to 6 decimal places." : "";
  const durationError =
    duration.trim() && durationDays == null ? "Enter a whole number of days from 1 to 366." : "";

  function applyChannel(result: ChannelResponse) {
    const state = result.state || "verification_failed";
    setChannelState(state);
    setChannelMessage(result.message || channelStateMessage(state));
    if (ownershipVerified(state) && result.channel) {
      setChannel(result.channel);
    } else if (!ownershipVerified(state)) {
      setChannel(null);
      setCreated(false);
    }
  }

  function finishCreatedCommunity() {
    setShareOpen(false);
    window.sessionStorage.setItem("passgram.dashboard.section", "communities");
    go({
      tab: "dashboard",
      screen: "home",
      accountPage: "hub",
      communityId: null,
      referralCode: null,
      communityReferralCode: null,
      linkError: null,
    });
  }

  function openChannelSafety() {
    if (busy) return;
    setFormError("");
    setSafetyOpen(true);
  }

  function openExternal(url: string) {
    const openLink = window.Telegram?.WebApp?.openLink;
    if (typeof openLink === "function") {
      openLink(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function beginChannelSelection() {
    setSafetyOpen(false);
    setFormError("");
    if (demoCreate) {
      lab.advanceCreateFlow(go);
      return;
    }
    const availability = selectorAvailability(window.Telegram?.WebApp);
    if (availability === "telegram_unavailable") {
      setChannel(null);
      setChannelState("telegram_unavailable");
      setChannelMessage(channelStateMessage("telegram_unavailable"));
      return;
    }
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.requestChat) return;
    pollGeneration.current += 1;
    setBusy(true);
    setChannelState("selection_pending");
    setChannelMessage(channelStateMessage("selection_pending"));
    setChannel(null);
    try {
      const response = await fetch("/api/telegram/prepare", { method: "POST", headers: telegramHeaders() });
      const result = (await response.json()) as ChannelResponse;
      if (!result.ok || !result.preparedButtonId || !result.requestId) {
        applyChannel(result);
        setBusy(false);
        return;
      }
      setRequestId(result.requestId);
      webApp.requestChat(result.preparedButtonId, (sent) => {
        if (!sent) {
          pollGeneration.current += 1;
          setBusy(false);
          setChannelState("not_selected");
          setChannelMessage("Channel selection was canceled.");
          return;
        }
        setChannelState("verification_pending");
        setChannelMessage(channelStateMessage("verification_pending"));
        void pollSelection(result.requestId as number);
      });
    } catch {
      setBusy(false);
      setChannelState("verification_failed");
      setChannelMessage(channelStateMessage("verification_failed"));
    }
  }

  async function pollSelection(id: number) {
    if (demoCreate) {
      lab.advanceCreateFlow(go);
      return;
    }
    const generation = ++pollGeneration.current;
    setBusy(true);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (pollGeneration.current !== generation) return;
      try {
        const response = await fetch(`/api/telegram/selections/${id}`, { headers: telegramHeaders() });
        const result = (await response.json()) as ChannelResponse;
        if (result.state === "selection_pending" || result.state === "verification_pending") {
          if (attempt === 0 || attempt % 3 === 0) {
            setChannelState(result.state || "verification_pending");
            setChannelMessage(
              result.message ||
                (result.state === "selection_pending"
                  ? "Waiting for Telegram to deliver the selected channel to PassGramBot…"
                  : "Verifying channel ownership…"),
            );
          }
          await delay(attempt < 8 ? 1000 : 1500);
          continue;
        }
        if (pollGeneration.current !== generation) return;
        applyChannel(result);
        setBusy(false);
        return;
      } catch {
        await delay(1500);
      }
    }
    if (pollGeneration.current !== generation) return;
    setBusy(false);
    setChannelState("selection_pending");
    setChannelMessage(
      "Still waiting for Telegram to deliver the channel to PassGram. Tap Check again after the share appears in the bot chat, or select the channel once more.",
    );
  }

  async function checkBotAccess() {
    if (!channel || busy) return;
    if (demoCreate) {
      lab.applyScene("create.verified", go);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/telegram/access", {
        method: "POST",
        headers: { ...telegramHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ telegramChatId: channel.telegramChatId }),
      });
      const result = (await response.json()) as ChannelResponse;
      applyChannel(result);
      if (requestId != null && ownershipVerified(result.state || "")) {
        const selection = await fetch(`/api/telegram/selections/${requestId}`, { headers: telegramHeaders() });
        const latest = (await selection.json()) as ChannelResponse;
        if (latest.channel) applyChannel(latest);
      }
    } catch {
      setChannelMessage("Telegram could not confirm bot access. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createCommunity() {
    if (!ready || requestId == null) return;
    if (demoCreate) {
      lab.applyScene("create.created", go);
      return;
    }
    setBusy(true);
    setFormError("");
    setFormMessage("");
    try {
      if (!getConnectedTonAddress()) {
        const account = await store.connectWallet();
        if (!account) {
          setFormError("Connect your TON wallet. Subscription payments are sent to that wallet.");
          return;
        }
      }
      const creatorWallet = getConnectedTonAddress();
      if (!creatorWallet) {
        setFormError("Connect your TON wallet. Subscription payments are sent to that wallet.");
        return;
      }
      const response = await fetch("/api/telegram/communities", {
        method: "POST",
        headers: { ...telegramHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ requestId, price, durationDays, creatorWallet }),
      });
      const result = (await response.json()) as ChannelResponse;
      if (!result.ok) {
        applyChannel(result);
        setFormError(result.message || "No community was created.");
        return;
      }
      const communityId = result.communityId ?? result.channel?.communityId ?? null;
      const priceUsdt = parseCommunityPrice(price);
      if (!communityId || !priceUsdt || !durationDays) {
        setFormError("No community was created.");
        return;
      }
      if (result.channel) setChannel(result.channel);
      if (!contractIsConfigured()) {
        setFormError("The registry contract is not configured, so RegisterCommunity was not signed.");
        return;
      }
      const approved = await fetch(`/api/telegram/communities/${communityId}/authorization`, {
        method: "POST",
        headers: { ...telegramHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ creator: creatorWallet }),
      });
      const approval = (await approved.json()) as {
        ok?: boolean;
        signature?: string;
        message?: string;
        creator?: string;
        payout?: string;
        price?: string;
        durationSeconds?: number;
        platformMarketer?: string | null;
        communityReferralBps?: number;
      };
      if (!approval.ok || !approval.signature || !approval.creator || !approval.payout || !approval.price || !approval.durationSeconds) {
        setFormError(approval.message || "PassGram did not approve this community for your wallet, so RegisterCommunity was not sent.");
        return;
      }
      const payloadBase64 = buildRegisterCommunityBody({
        communityId,
        creator: approval.creator,
        payout: approval.payout,
        price: approval.price,
        durationSeconds: approval.durationSeconds,
        platformMarketer: approval.platformMarketer,
        communityReferralBps: approval.communityReferralBps ?? 0,
        authorization: approval.signature,
      });
      const boc = await sendRegistryCall({
        payloadBase64,
        tonAmount: toNano("0.08").toString(),
      });
      if (!boc) {
        setFormError("Your wallet did not sign RegisterCommunity. The community was not published.");
        return;
      }
      const published = await fetch(`/api/telegram/communities/${communityId}/registration`, {
        method: "POST",
        headers: { ...telegramHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ boc }),
      });
      const saved = (await published.json()) as { ok?: boolean; message?: string };
      if (!saved.ok) {
        setFormError(saved.message || "The contract signature was not stored, so the community was not published.");
        return;
      }
      store.rememberCommunity({
        communityId,
        title: result.channel?.title || channel?.title || "Community",
        description: result.channel?.description ?? channel?.description ?? null,
        priceUsdt,
        durationDays,
        ownerTelegramUserId: String(result.channel?.ownerTelegramUserId || store.user.telegramUserId || ""),
        payoutAddress: creatorWallet,
      });
      setShareId(communityId);
      setShareOpen(true);
      setCreated(true);
      setFormMessage("Community published. Your wallet signed RegisterCommunity, and that signature is stored.");
    } catch {
      setFormError("No community was created.");
    } finally {
      setBusy(false);
    }
  }

  const shareLink =
    shareId == null
      ? ""
      : formatCommunityLink(shareId, typeof window === "undefined" ? null : window.location.origin);

  const showSelector = !owned;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void createCommunity();
      }}
    >
      <section className="space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-4">
        <h2 className="text-[22px]">Telegram channel</h2>
        {owned && channel ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Avatar
                name={channel.title}
                seed={channel.telegramChatId}
                imageUrl={photoUrl || undefined}
                className="h-14 w-14"
              />
              <div className="min-w-0 space-y-1.5 pt-0.5">
                <h3 className="truncate text-base">{channel.title}</h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip label="Verified" active tone="success" />
                  <StatusChip label="Added" active={botAdded} tone="brand" />
                </div>
              </div>
            </div>
            {!botAdded ? (
              <div className="space-y-2 rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] p-3">
                <p className="text-sm font-semibold text-[var(--pg-text)]">Next step: add the bot</p>
                <p className="text-sm text-[var(--pg-text)]">
                  Open your channel → Administrators → Add admin → choose{" "}
                  <span className="inline-flex items-center gap-0.5 align-middle">
                    <button
                      type="button"
                      className="rounded-md bg-[var(--pg-tag)] px-1.5 py-0.5 font-semibold text-[var(--pg-blue-press)]"
                      onClick={() => {
                        void navigator.clipboard.writeText(botHandle).then(() => {
                          setBotHandleCopied(true);
                          window.setTimeout(() => setBotHandleCopied(false), 1600);
                        });
                      }}
                      aria-label={`Copy ${botHandle}`}
                    >
                      {botHandle}
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--pg-blue)]"
                      onClick={() => {
                        void navigator.clipboard.writeText(botHandle).then(() => {
                          setBotHandleCopied(true);
                          window.setTimeout(() => setBotHandleCopied(false), 1600);
                        });
                      }}
                      aria-label={botHandleCopied ? "Copied" : `Copy ${botHandle}`}
                      title={botHandleCopied ? "Copied" : "Copy"}
                    >
                      {botHandleCopied ? <CheckIcon /> : <CopyIcon />}
                    </button>
                  </span>
                  . Enable only:
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--pg-hint)]">
                  <li>Invite users via link</li>
                  <li>Ban users</li>
                </ul>
                <p className="text-xs text-[var(--pg-hint)]">
                  Leave other permissions off. After saving, tap Check access.
                </p>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void checkBotAccess()}>
                  {busy ? "Checking" : "Check access"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-[var(--pg-blue)]">PassGramBot is added with invite and ban rights.</p>
            )}
          </div>
        ) : null}
        {channelMessage && !owned ? (
          <p className={`text-sm ${channelState === "selection_pending" || channelState === "verification_pending" ? "text-[var(--pg-hint)]" : "text-[var(--pg-ruby)]"}`}>
            {channelMessage}
          </p>
        ) : null}
        {channelState === "verification_pending" || channelState === "selection_pending" ? (
          <p className="text-sm text-[var(--pg-hint)]">
            {channelState === "selection_pending" ? "Waiting for Telegram to deliver the channel." : "Verification is still running."}
          </p>
        ) : null}
        {showSelector ? (
          <button type="button" className={primaryButton} disabled={busy} onClick={openChannelSafety}>
            Select Telegram Channel
          </button>
        ) : !botAdded ? (
          <button type="button" className={secondaryButton} disabled={busy} onClick={openChannelSafety}>
            Select a different channel
          </button>
        ) : null}
        {channelState === "verification_pending" || channelState === "selection_pending" ? (
          <button type="button" className={secondaryButton} disabled={busy || requestId == null} onClick={() => requestId != null && void pollSelection(requestId)}>
            Check again
          </button>
        ) : null}
      </section>

      <Field
        label="Subscription price (USDT)"
        value={price}
        onChange={setPrice}
        inputMode="decimal"
        placeholder="1.5"
        error={priceError}
        hint="Paid in USDT on TON."
      />

      <Field
        label="Subscription duration (days)"
        value={duration}
        onChange={setDuration}
        inputMode="numeric"
        placeholder="30"
        error={durationError}
        hint="Each subscriber's access ends this many days after their own confirmed payment."
      />

      <section className="rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-3" aria-label="Receiving wallet">
        <p className="text-[13px] font-medium">Receiving wallet</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--pg-hint)]">
          Subscription payments are sent to the wallet that signs RegisterCommunity. That wallet is the receiving wallet, and a later price or duration change does not replace it.
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-3" aria-label="Invite links">
        <p className="text-[13px] font-medium">Invite links</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--pg-hint)]">
          Each confirmed payment creates a one-person invite that lasts for the subscription period. The raw link is never shown. The subscriber sees Join community. The paid period starts when that invite is created, whether they join immediately or later.
        </p>
      </section>

      {formError ? <p className="text-sm text-[var(--pg-ruby)]">{formError}</p> : null}
      {formMessage ? <p className="text-sm text-[var(--pg-text)]">{formMessage}</p> : null}

      <button type="submit" className={`${primaryButton} w-full`} disabled={!ready}>
        {busy ? "Opening wallet" : "Create community"}
      </button>
      <p className="text-center text-xs text-[var(--pg-hint)]">
        Your wallet signs RegisterCommunity. Subscription payments are sent to that wallet.
      </p>
      {!botAdded && owned ? (
        <p className="text-center text-xs text-[var(--pg-hint)]">Create community unlocks after Verified and Added are both active.</p>
      ) : null}

      {shareOpen && shareId != null ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/35 p-4 sm:items-center">
          <div className="w-full max-w-[398px] space-y-3 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]">
            <h2 className="text-[20px] font-semibold">Community created</h2>
            <p className="text-sm text-[var(--pg-hint)]">
              Share this subscription link in your channel. Anyone who opens it lands on the PassGram subscribe page.
            </p>
            <a
              className="block break-all rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-2 text-sm underline"
              href={shareLink}
              target="_blank"
              rel="noreferrer"
            >
              {shareLink}
            </a>
            <button
              type="button"
              className={`${primaryButton} w-full`}
              onClick={() => {
                void navigator.clipboard.writeText(shareLink).finally(() => finishCreatedCommunity());
              }}
            >
              Copy subscription link
            </button>
            <button type="button" className={`${secondaryButton} w-full`} onClick={finishCreatedCommunity}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {safetyOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => setSafetyOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="channel-safety-title"
            className="max-h-[min(86dvh,640px)] w-full max-w-[398px] overflow-y-auto rounded-[28px] border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--pg-tag)] text-[var(--pg-blue)]">
                <ShieldIcon />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pg-blue)]">Before you continue</p>
                <h2 id="channel-safety-title" className="mt-1 text-[20px] font-semibold leading-snug text-[var(--pg-text)]">
                  Channel access &amp; security
                </h2>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] p-3.5">
                <p className="text-sm font-semibold text-[var(--pg-text)]">Verify ownership in Telegram</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--pg-hint)]">
                  PassGram opens Telegram’s native channel picker so you choose one of your channels directly. This confirms you are the real owner and that the channel is private.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] p-3.5">
                <p className="text-sm font-semibold text-[var(--pg-text)]">Add {botHandle} with limited rights</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--pg-hint)]">
                  After selection, add the PassGram bot as an admin with only Invite users and Ban users. That lets PassGram admit members automatically after a confirmed USDT payment and remove access when a subscription ends.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] p-3.5">
                <p className="text-sm font-semibold text-[var(--pg-text)]">Open source &amp; auditable</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--pg-hint)]">
                  PassGram and its bot are designed to be transparent. Review the public build and source on GitHub before connecting a channel.
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex w-full items-center gap-2.5 rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-card)] px-3 py-2.5 text-left transition active:bg-[var(--pg-bg)]"
                  onClick={() => openExternal(githubRepoUrl)}
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--pg-text)] text-white">
                    <GitHubIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--pg-text)]">{githubRepoLabel}</span>
                    <span className="block text-xs text-[var(--pg-hint)]">Open public repository</span>
                  </span>
                  <span className="text-xs font-medium text-[var(--pg-blue)]">GitHub</span>
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              <button type="button" className={`${primaryButton} w-full`} disabled={busy} onClick={() => void beginChannelSelection()}>
                Continue
              </button>
              <button type="button" className={`${secondaryButton} w-full`} disabled={busy} onClick={() => setSafetyOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.25 5.75 5.75v5.1c0 4.2 2.75 7.95 6.25 9.15 3.5-1.2 6.25-4.95 6.25-9.15v-5.1L12 3.25Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m9.2 12 1.9 1.9 3.7-3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.37-3.37-1.37-.46-1.2-1.12-1.52-1.12-1.52-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.58 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.9-1.32 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .26.18.59.69.48A10.33 10.33 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5 10 17.5 19 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusChip({
  label,
  active,
  tone = "brand",
}: {
  label: string;
  active: boolean;
  tone?: "brand" | "success";
}) {
  const activeClass =
    tone === "success" ? "bg-[var(--pg-mint)] text-white" : "bg-[var(--pg-blue)] text-white";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${
        active ? activeClass : "bg-[var(--pg-line)] text-[var(--pg-hint)]"
      }`}
    >
      {label}
    </span>
  );
}

function telegramHeaders(): HeadersInit {
  return { "x-telegram-init-data": window.Telegram?.WebApp?.initData || "" };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
