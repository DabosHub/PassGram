"use client";

import { primaryButton } from "./ui";

export function JoinCommunityModal({
  communityName,
  inviteLink,
  checking,
  onJoin,
}: {
  communityName: string;
  inviteLink: string;
  checking: boolean;
  onJoin: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-8 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-community-title"
        className="w-full max-w-[398px] space-y-4 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]"
      >
        <div>
          <h2 id="join-community-title" className="text-lg font-semibold">
            Payment confirmed
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--pg-hint)]">
            You can now join {communityName}.
          </p>
        </div>
        <button type="button" className={`${primaryButton} w-full`} onClick={onJoin}>
          Join community
        </button>
        {checking ? <p className="text-xs text-[var(--pg-hint)]">Checking channel membership.</p> : null}
      </div>
    </div>
  );
}

export function InviteUnavailableNotice({ message }: { message: string }) {
  return (
    <div className="fixed inset-x-0 bottom-24 z-40 mx-auto w-full max-w-[430px] px-4">
      <div
        role="alert"
        className="space-y-2 rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] p-5 shadow-[var(--pg-shadow-float)]"
      >
        <h2 className="text-lg font-semibold">Join unavailable</h2>
        <p className="text-sm leading-relaxed text-[var(--pg-hint)]">{message}</p>
      </div>
    </div>
  );
}

export function openCommunityInvite(inviteLink: string) {
  const telegram = window.Telegram?.WebApp as { openTelegramLink?: (url: string) => void } | undefined;
  if (telegram?.openTelegramLink) {
    telegram.openTelegramLink(inviteLink);
    return;
  }
  window.open(inviteLink, "_blank", "noopener,noreferrer");
}
