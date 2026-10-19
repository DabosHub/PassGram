"use client";

import { useEffect, useRef, useState } from "react";
import {
  channelStateMessage,
  communityFormReady,
  tonAddressKind,
  ownershipVerified,
  parseDurationDays,
  parseCommunityPrice,
  selectorAvailability,
  type ChannelUiState,
} from "@/lib/channelPolicy";
import { formatCommunityLink } from "@/lib/domain";
import { formatWhen } from "@/lib/money";
import { useStore } from "@/lib/store";
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
};

export function CreateView() {
  const store = useStore();
  const [channelState, setChannelState] = useState<ChannelUiState>("not_selected");
  const [channelMessage, setChannelMessage] = useState("");
  const [channel, setChannel] = useState<PublicChannel | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [payout, setPayout] = useState(store.user.payoutAddress);
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [shareId, setShareId] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollGeneration = useRef(0);

  const botAdded = Boolean(channel?.botAdded ?? (channel?.botCanInviteUsers && channel?.botCanRestrictMembers));
  const owned = ownershipVerified(channelState) && channel != null;

  // While waiting for the owner to add PassGramBot, poll access so the Added badge flips without a manual tap.
  useEffect(() => {
    if (!owned || botAdded || !channel?.telegramChatId || busy) return;
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
    communityFormReady({ channelState, botAdded, price, durationDays, payout }) && !busy && !created;
  const priceError = price.trim() && !parseCommunityPrice(price) ? "Enter at least 1 USDT, with up to 6 decimal places." : "";
  const durationError =
    duration.trim() && durationDays == null ? "Enter a whole number of days from 1 to 366." : "";
  const payoutError = payout.trim() && !tonAddressKind(payout) ? "Enter a TON address (EQ… / UQ… or 0:…)." : "";

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

  async function selectChannel() {
    setFormError("");
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
    setBusy(true);
    setFormError("");
    setFormMessage("");
    try {
      const response = await fetch("/api/telegram/communities", {
        method: "POST",
        headers: { ...telegramHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ requestId, price, durationDays, payoutAccount: payout }),
      });
      const result = (await response.json()) as ChannelResponse;
      if (!result.ok) {
        applyChannel(result);
        setFormError(result.message || "No community was created.");
        return;
      }
      if (result.channel) setChannel(result.channel);
      const communityId = result.communityId ?? result.channel?.communityId ?? null;
      const priceUsdt = parseCommunityPrice(price);
      if (communityId && priceUsdt && durationDays) {
        store.rememberCommunity({
          communityId,
          title: result.channel?.title || channel?.title || "Community",
          description: result.channel?.description ?? channel?.description ?? null,
          priceUsdt,
          durationDays,
          ownerTelegramUserId: String(
            result.channel?.ownerTelegramUserId || store.user.telegramUserId || "",
          ),
          payoutAddress: payout,
        });
        setShareId(communityId);
        setShareOpen(true);
        setCopied(false);
      }
      setCreated(true);
      setFormMessage(result.message || "Community created.");
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
  const memberLine = memberCountLine(channel);

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
            <div className="flex gap-3">
              <Avatar name={channel.title} imageUrl={photoUrl || undefined} className="h-14 w-14" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base">{channel.title}</h3>
                  <StatusChip label="Verified" active />
                  <StatusChip label="Added" active={botAdded} />
                </div>
                {channel.description ? <p className="mt-1 text-sm text-[var(--pg-hint)]">{channel.description}</p> : null}
                <p className="mt-2 text-sm text-[var(--pg-text)]">{memberLine}</p>
                <p className="mt-1 text-xs text-[var(--pg-hint)]">Paid PassGram subscribers are counted separately from Telegram members.</p>
              </div>
            </div>
            {!botAdded ? (
              <div className="space-y-2 rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] p-3">
                <p className="text-sm font-semibold text-[var(--pg-text)]">Next step: add the bot</p>
                <p className="text-sm text-[var(--pg-text)]">
                  Open your channel → Administrators → Add admin → choose{" "}
                  <span className="font-semibold">@PassGramBot</span>. Enable only:
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--pg-hint)]">
                  <li>Invite users via link</li>
                  <li>Ban users</li>
                </ul>
                <p className="text-xs text-[var(--pg-hint)]">
                  Leave other permissions off. After saving, tap Check bot access — PassGram also updates automatically when Telegram notifies the bot.
                </p>
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void checkBotAccess()}>
                  {busy ? "Checking" : "Check bot access"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-[var(--pg-mint)]">PassGramBot is added with invite and ban rights.</p>
            )}
          </div>
        ) : null}
        {channelMessage && !owned ? (
          <p className={`text-sm ${channelState === "selection_pending" || channelState === "verification_pending" ? "text-[var(--pg-hint)]" : "text-[var(--pg-ruby)]"}`}>
            {channelMessage}
          </p>
        ) : null}
        {owned && !botAdded && channelMessage ? <p className="text-sm text-[var(--pg-hint)]">{channelMessage}</p> : null}
        {channelState === "verification_pending" || channelState === "selection_pending" ? (
          <p className="text-sm text-[var(--pg-hint)]">
            {channelState === "selection_pending" ? "Waiting for Telegram to deliver the channel." : "Verification is still running."}
          </p>
        ) : null}
        {showSelector ? (
          <button type="button" className={primaryButton} disabled={busy} onClick={() => void selectChannel()}>
            Select Telegram Channel
          </button>
        ) : (
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => void selectChannel()}>
            Select a different channel
          </button>
        )}
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

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[var(--pg-text)]">Access model</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="accessMode" checked readOnly />
          Subscription (USDT)
        </label>
        <label className="flex cursor-not-allowed items-center gap-2 text-sm text-[var(--pg-hint)] opacity-60">
          <input type="radio" name="accessMode" disabled />
          Token-Gated (coming soon)
        </label>
        <p className="text-xs text-[var(--pg-hint)]">v1 accepts USDT subscriptions only. Token-Gating is a placeholder for a later release.</p>
      </fieldset>

      <Field
        label="Subscription duration (days)"
        value={duration}
        onChange={setDuration}
        inputMode="numeric"
        placeholder="30"
        error={durationError}
        hint="Each subscriber's access ends this many days after their own confirmed payment."
      />

      <Field
        label="Creator TON payout address"
        value={payout}
        onChange={setPayout}
        placeholder="EQ…"
        error={payoutError}
        hint="Friendly EQ/UQ address or raw 0: form. Checking it does not send a payment."
      />

      {formError ? <p className="text-sm text-[var(--pg-ruby)]">{formError}</p> : null}
      {formMessage ? <p className="text-sm text-[var(--pg-text)]">{formMessage}</p> : null}

      <button type="submit" className={`${primaryButton} w-full`} disabled={!ready}>
        Create community
      </button>
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
            <p className="break-all rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-2 text-sm">{shareLink}</p>
            <button
              type="button"
              className={`${primaryButton} w-full`}
              onClick={() => {
                void navigator.clipboard.writeText(shareLink);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy subscription link"}
            </button>
            <button type="button" className={`${secondaryButton} w-full`} onClick={() => setShareOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function StatusChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-[10px] font-normal tracking-wide ${
        active
          ? "bg-[var(--pg-tag)] text-[var(--pg-blue-press)]"
          : "bg-[var(--pg-line)] text-[var(--pg-hint)]"
      }`}
    >
      {label}
    </span>
  );
}

function telegramHeaders(): HeadersInit {
  return { "x-telegram-init-data": window.Telegram?.WebApp?.initData || "" };
}

function memberCountLine(channel: PublicChannel | null): string {
  if (!channel || channel.telegramMemberCount == null || !channel.telegramMemberCountFetchedAt) {
    return "Telegram member count is unavailable until PassGramBot is added.";
  }
  const fetched = Date.parse(channel.telegramMemberCountFetchedAt);
  const when = Number.isFinite(fetched) ? formatWhen(fetched) : channel.telegramMemberCountFetchedAt;
  return `Telegram members: ${channel.telegramMemberCount}, as of ${when}. This is not a live count.`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
