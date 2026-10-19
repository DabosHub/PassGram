import { BPS, REFERRER_FEE_BPS, TREASURY_FEE_BPS, PLATFORM_FEE_BPS, USDT_BASE } from "./ton/config";

export type Split = {
  creator: bigint;
  treasury: bigint;
  referrer: bigint;
};

export function parseUsdt(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const base = BigInt(whole) * USDT_BASE + BigInt(frac.padEnd(6, "0"));
  return base;
}

export function formatUsdt(amount: bigint | string): string {
  const value = typeof amount === "string" ? BigInt(amount) : amount;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / USDT_BASE;
  const frac = (abs % USDT_BASE).toString().padStart(6, "0").replace(/0+$/, "");
  const text = frac ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function computeSplit(gross: bigint, hasReferrer: boolean): Split {
  if (hasReferrer) {
    const treasury = (gross * TREASURY_FEE_BPS) / BPS;
    const referrer = (gross * REFERRER_FEE_BPS) / BPS;
    return { creator: gross - treasury - referrer, treasury, referrer };
  }
  const treasury = (gross * PLATFORM_FEE_BPS) / BPS;
  return { creator: gross - treasury, treasury, referrer: 0n };
}

/** Max community referral as percent of gross (50%). Leaves room after 2.5% platform fee. */
export const MAX_COMMUNITY_REFERRAL_BPS = 5000n;

export type CommunityAwareSplit = Split & { communityAffiliate: bigint };

/**
 * Platform fee first, then community affiliate from the remaining creator bucket
 * as R% of gross (creator-configured). Subscriber price is unchanged.
 */
export function computeCommunityAwareSplit(
  gross: bigint,
  hasPlatformReferrer: boolean,
  communityReferralBps: bigint,
): CommunityAwareSplit {
  const base = computeSplit(gross, hasPlatformReferrer);
  const bps = communityReferralBps < 0n ? 0n : communityReferralBps > MAX_COMMUNITY_REFERRAL_BPS ? MAX_COMMUNITY_REFERRAL_BPS : communityReferralBps;
  const communityAffiliate = (gross * bps) / BPS;
  const creator = base.creator - communityAffiliate;
  if (creator < 0n) {
    return { ...base, creator: 0n, communityAffiliate: base.creator };
  }
  return { ...base, creator, communityAffiliate };
}

export function communityReferralPercentValid(percent: number): boolean {
  return Number.isInteger(percent) && percent >= 1 && percent <= 50;
}

export function percentToBps(percent: number): number {
  return percent * 100;
}

export function bpsToPercent(bps: number): number {
  return Math.round(bps / 100);
}

export function formatPeriod(seconds: number): string {
  const day = 24 * 60 * 60;
  if (seconds % day === 0) {
    const days = seconds / day;
    if (days === 1) return "1 day";
    return `${days} days`;
  }
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export function formatWhen(ms: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(ms));
}

const CODE_PATTERN = /^[a-z0-9_-]{4,32}$/;

export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toLowerCase();
  return CODE_PATTERN.test(code) ? code : null;
}
