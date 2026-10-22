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

/** Max community referral as a percent of the creator share (50%), after the 2.5% platform fee. */
export const MAX_COMMUNITY_REFERRAL_BPS = 5000n;

export type CommunityAwareSplit = Split & { communityAffiliate: bigint };

/**
 * Platform fee first. The community affiliate is then R% of the remaining creator share.
 * The subscriber price is unchanged.
 */
export function computeCommunityAwareSplit(
  gross: bigint,
  hasPlatformReferrer: boolean,
  communityReferralBps: bigint,
): CommunityAwareSplit {
  const base = computeSplit(gross, hasPlatformReferrer);
  const bps = communityReferralBps < 0n ? 0n : communityReferralBps > MAX_COMMUNITY_REFERRAL_BPS ? MAX_COMMUNITY_REFERRAL_BPS : communityReferralBps;
  const communityAffiliate = (base.creator * bps) / BPS;
  const creator = base.creator - communityAffiliate;
  if (creator < 0n) {
    return { ...base, creator: 0n, communityAffiliate: base.creator };
  }
  return { ...base, creator, communityAffiliate };
}

export function communityReferralPercentValid(percent: number): boolean {
  return Number.isInteger(percent) && percent >= 1 && percent <= 50;
}

/** 0.01%–50% with up to 2 decimal places, as basis points (1 = 0.01%). */
export function parseCommunityReferralBps(raw: string): number | null {
  const trimmed = raw.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isInteger(bps) || bps < 1 || bps > 5000) return null;
  return bps;
}

export function formatCommunityReferralPercent(bps: number): string {
  const text = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return text || "0";
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
