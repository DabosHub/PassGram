import { contractIsConfigured } from "../ton/config";
import type { RankedAffiliate } from "../domain";

/**
 * Trusted confirmation boundary.
 * The TON registry can accept a Jetton transfer, but confirmation comes from the bot-service indexer.
 * A wallet submission alone is not confirmation.
 */
export const missingServices = [
  "Backend validation of Telegram initData",
  "Community, subscription, and account APIs",
  "Payment indexer for PassGram registry events",
  "Telegram bot permission checks and invitation links",
  "Affiliate leaderboard API",
] as const;

export type Gate = { ok: false; reasons: string[] };

function baseReasons(action: string): string[] {
  const reasons: string[] = [];
  if (!contractIsConfigured()) reasons.push("The PassGram registry contract is not configured.");
  reasons.push(`No indexer is running to confirm ${action}.`);
  reasons.push("A submitted wallet transaction is not treated as confirmation.");
  return reasons;
}

export async function confirmCommunityCreation(): Promise<Gate> {
  return {
    ok: false,
    reasons: [
      ...baseReasons("community creation"),
      "The bot service cannot verify channel permissions.",
    ],
  };
}

export async function confirmCreatorRegistration(): Promise<Gate> {
  return { ok: false, reasons: baseReasons("creator registration") };
}

export async function confirmPayment(): Promise<Gate> {
  return {
    ok: false,
    reasons: [
      ...baseReasons("payment"),
      "Access is not granted until a confirmed entitlement exists.",
    ],
  };
}

export async function confirmAffiliateRegistration(): Promise<Gate> {
  return { ok: false, reasons: baseReasons("affiliate registration") };
}

export async function confirmReferralAttribution(): Promise<Gate> {
  return { ok: false, reasons: baseReasons("referral attribution") };
}

export async function loadLeaderboard(): Promise<{ entries: RankedAffiliate[]; unavailable: true; reason: string }> {
  return {
    entries: [],
    unavailable: true,
    reason: "The leaderboard API is not connected. Rankings are not estimated in the app.",
  };
}

export async function verifyBotPermissions(): Promise<{ verified: false; reason: string }> {
  return {
    verified: false,
    reason: "The PassGram bot is not connected, so channel permissions cannot be checked.",
  };
}
