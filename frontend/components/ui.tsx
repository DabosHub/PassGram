"use client";

import { useEffect, useState, type ReactNode } from "react";
import { subscriptionProgress, statusLabel, type SubscriptionStatus } from "@/lib/domain";

export const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--pg-blue)] px-4 py-2 text-base font-normal text-white active:bg-[var(--pg-blue-press)] disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--pg-blue)] bg-[var(--pg-card)] px-4 py-2 text-base font-normal text-[var(--pg-blue)] disabled:cursor-not-allowed disabled:opacity-50";

export function Avatar({
  name,
  imageUrl,
  className = "h-11 w-11",
}: {
  name: string;
  imageUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (name.trim()[0] || "?").toUpperCase();
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${className} rounded-full object-cover`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className={`${className} inline-flex items-center justify-center rounded-full bg-[var(--pg-tag)] text-sm font-normal text-[var(--pg-blue-press)]`}>
      {letter}
    </span>
  );
}

export function Field({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  inputMode,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "numeric" | "url";
  multiline?: boolean;
}) {
  const className =
    "mt-1 w-full rounded-[6px] border border-[var(--pg-input-line)] bg-[var(--pg-card)] px-3 py-2 text-[15px] font-light text-[var(--pg-text)] outline-none focus:border-[var(--pg-blue)]";
  return (
    <label className="block">
      <span className="text-[13px] font-normal text-[var(--pg-hint)]">{label}</span>
      {multiline ? (
        <textarea className={className} value={value} placeholder={placeholder} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          className={className}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? <span className="mt-1 block text-[13px] text-[var(--pg-ruby)]">{error}</span> : null}
      {hint && !error ? <span className="mt-1 block text-xs text-[var(--pg-hint)]">{hint}</span> : null}
    </label>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[var(--pg-line)] bg-[var(--pg-card)] px-8 py-8 text-center">
      <h2 className="text-[22px]">{title}</h2>
      <p className="mx-auto mt-2 max-w-xs text-[15px] text-[var(--pg-hint)]">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

export function StatusBadge({ status }: { status: SubscriptionStatus | "pending_confirmation" | "paused" | "active_community" }) {
  return (
    <span className="inline-flex rounded-full bg-[var(--pg-tag)] px-2 py-1 text-[10px] font-normal tracking-wide text-[var(--pg-blue-press)]">{statusLabel(status)}</span>
  );
}

export function LifetimeBar({
  startAt,
  expiresAt,
  now,
}: {
  startAt: number | null;
  expiresAt: number | null;
  now: number;
}) {
  const value = subscriptionProgress(startAt, expiresAt, now);
  if (value == null) return <p className="text-xs text-[var(--pg-hint)]">Lifetime starts after confirmation.</p>;
  const percent = Math.round(value * 100);
  return (
    <div
      className="h-1 overflow-hidden rounded-full bg-[var(--pg-line)]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label="Subscription lifetime"
    >
      <div className="h-full bg-[var(--pg-blue)]" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function ReasonList({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-[var(--pg-line)] bg-[var(--pg-bg)] px-3 py-3 text-[15px]">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}

export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
