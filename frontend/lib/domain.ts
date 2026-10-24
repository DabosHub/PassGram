import { PLATFORM_FEE_BPS, REFERRER_FEE_BPS, normalizeTonAddress } from "./ton/config";
import { computeSplit, formatUsdt, normalizeCode, parseUsdt } from "./money";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRING_SOON_MS = 3 * DAY_MS;
/** A confirmed subscriber can renew only during the final 24 hours. */
export const RENEWAL_WINDOW_MS = DAY_MS;
export const PAGE_SIZE = 8;

export type Confirmation = "unconfirmed" | "confirmed";

export type SubscriptionStatus =
  | "payment_pending"
  | "renewal_pending"
  | "active"
  | "expiring_soon"
  | "expired";

export type DashboardSection = "communities" | "subscriptions";

const USERNAME = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const IMAGE_URL = /^https:\/\/[^\s]{1,300}$/;

/** @deprecated Use normalizeTonAddress — kept as alias for gradual call-site updates. */
export function normalizeNearAccount(raw: string): string | null {
  return normalizeTonAddress(raw);
}

export { normalizeTonAddress };

export function subscriptionProgress(
  startAt: number | null,
  expiresAt: number | null,
  now: number,
): number | null {
  if (startAt == null || expiresAt == null) return null;
  if (!Number.isFinite(startAt) || !Number.isFinite(expiresAt) || expiresAt <= startAt) return null;
  const raw = (now - startAt) / (expiresAt - startAt);
  if (!Number.isFinite(raw)) return null;
  return Math.min(1, Math.max(0, raw));
}

export function subscriptionStatus(input: {
  confirmation: Confirmation;
  expiresAt: number | null;
  now: number;
  renewalPending?: boolean;
}): SubscriptionStatus {
  if (input.confirmation !== "confirmed") {
    return input.renewalPending ? "renewal_pending" : "payment_pending";
  }
  if (input.expiresAt == null || input.expiresAt <= input.now) return "expired";
  if (input.expiresAt - input.now <= EXPIRING_SOON_MS) return "expiring_soon";
  return "active";
}

export function renewalWindowOpen(expiresAt: number | null, now: number, confirmed: boolean): boolean {
  if (!confirmed || expiresAt == null) return false;
  const left = expiresAt - now;
  return left > 0 && left <= RENEWAL_WINDOW_MS;
}

export function remainingLabel(expiresAt: number | null, now: number, confirmed: boolean): string {
  if (!confirmed || expiresAt == null) return "Not confirmed";
  if (expiresAt <= now) return "Expired";
  const ms = expiresAt - now;
  const days = Math.ceil(ms / DAY_MS);
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
    return hours === 1 ? "1 hour left" : `${hours} hours left`;
  }
  return `${days} days left`;
}

export function statusLabel(status: SubscriptionStatus | "pending_confirmation" | "paused" | "active_community"): string {
  switch (status) {
    case "payment_pending":
      return "Payment pending";
    case "renewal_pending":
      return "Renewal pending";
    case "active":
    case "active_community":
      return "Active";
    case "expiring_soon":
      return "Expiring soon";
    case "expired":
      return "Expired";
    case "pending_confirmation":
      return "Awaiting confirmation";
    case "paused":
      return "Paused";
    default:
      return "Unavailable";
  }
}

export type SubscriptionAction = "open" | "renew" | "payment" | "subscribe";

export function subscriptionActions(status: SubscriptionStatus): SubscriptionAction[] {
  switch (status) {
    case "active":
      return ["open", "payment", "renew"];
    case "expiring_soon":
      return ["open", "renew", "payment"];
    case "expired":
      return ["subscribe", "payment"];
    default:
      return ["payment"];
  }
}

export function chooseDashboardSection(input: {
  ownedCount: number;
  subscriptionCount: number;
  remembered: DashboardSection | null;
}): "empty" | "communities" | "subscriptions" {
  if (input.ownedCount === 0 && input.subscriptionCount === 0) return "empty";
  if (input.ownedCount > 0 && input.subscriptionCount === 0) return "communities";
  if (input.subscriptionCount > 0 && input.ownedCount === 0) return "subscriptions";
  if (input.remembered === "subscriptions" || input.remembered === "communities") return input.remembered;
  return "communities";
}

export function showsBothDashboardSections(ownedCount: number, subscriptionCount: number): boolean {
  return ownedCount > 0 && subscriptionCount > 0;
}

export type DeepLink =
  | {
      communityId: number | null;
      referralCode: string | null;
      communityReferralCode: string | null;
      error: null;
    }
  | {
      communityId: number | null;
      referralCode: string | null;
      communityReferralCode: string | null;
      error: "invalid_community" | "invalid_referral";
    };

export function parseStartParam(param: string | null | undefined): DeepLink {
  if (!param?.trim()) {
    return { communityId: null, referralCode: null, communityReferralCode: null, error: null };
  }
  const text = param.trim();
  const communityRef = /^c_(\d+)_cref_(.+)$/.exec(text);
  if (communityRef) {
    const communityId = positiveId(communityRef[1]);
    const communityReferralCode = normalizeCode(communityRef[2]);
    if (communityId == null) {
      return { communityId: null, referralCode: null, communityReferralCode: null, error: "invalid_community" };
    }
    if (!communityReferralCode) {
      return { communityId, referralCode: null, communityReferralCode: null, error: "invalid_referral" };
    }
    return { communityId, referralCode: null, communityReferralCode, error: null };
  }
  const combined = /^c_(\d+)_ref_(.+)$/.exec(text);
  if (combined) {
    const communityId = positiveId(combined[1]);
    const referralCode = normalizeCode(combined[2]);
    if (communityId == null) {
      return { communityId: null, referralCode: null, communityReferralCode: null, error: "invalid_community" };
    }
    if (!referralCode) {
      return { communityId, referralCode: null, communityReferralCode: null, error: "invalid_referral" };
    }
    return { communityId, referralCode, communityReferralCode: null, error: null };
  }
  const community = /^c_(\d+)$/.exec(text);
  if (community) {
    const communityId = positiveId(community[1]);
    if (communityId == null) {
      return { communityId: null, referralCode: null, communityReferralCode: null, error: "invalid_community" };
    }
    return { communityId, referralCode: null, communityReferralCode: null, error: null };
  }
  if (text.startsWith("ref_")) {
    const referralCode = normalizeCode(text.slice(4));
    if (!referralCode) {
      return { communityId: null, referralCode: null, communityReferralCode: null, error: "invalid_referral" };
    }
    return { communityId: null, referralCode, communityReferralCode: null, error: null };
  }
  if (text.startsWith("c_") || text.startsWith("ref")) {
    return { communityId: null, referralCode: null, communityReferralCode: null, error: "invalid_community" };
  }
  return { communityId: null, referralCode: null, communityReferralCode: null, error: null };
}

function positiveId(raw: string): number | null {
  if (!/^[1-9]\d{0,11}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export type CommunityDraft = {
  name: string;
  telegramUsername: string;
  telegramChatId: string;
  description: string;
  imageUrl: string;
  priceUsdt: string;
  periodDays: string;
  payoutAddress: string;
  automationMode: "full" | "assisted";
};

export function validateCommunityDraft(draft: CommunityDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (!name || name.length > 64) errors.name = "Enter a community name up to 64 characters.";
  const username = draft.telegramUsername.trim().replace(/^@/, "");
  if (username && !USERNAME.test(username)) errors.telegramUsername = "Enter a Telegram username, or leave this empty.";
  const chat = draft.telegramChatId.trim();
  if (chat && !/^-?\d{1,32}$/.test(chat)) errors.telegramChatId = "Chat id must be an integer.";
  if (draft.description.trim().length > 280) errors.description = "Description must be 280 characters or less.";
  const image = draft.imageUrl.trim();
  if (image && !IMAGE_URL.test(image)) errors.imageUrl = "Image address must start with https://.";
  const price = parseUsdt(draft.priceUsdt);
  if (price == null || price < 1_000_000n) errors.priceUsdt = "Minimum price is 1 USDT.";
  const days = Number(draft.periodDays);
  if (!/^\d+$/.test(draft.periodDays.trim()) || days < 1 || days > 366) {
    errors.periodDays = "Duration must be between 1 and 366 days.";
  }
  if (draft.automationMode === "full" && !chat) {
    errors.telegramChatId = "Full automation needs the Telegram chat id before the bot can be checked.";
  }
  return errors;
}

export function creationBlockers(input: {
  contractConfigured: boolean;
  creatorConfirmed: boolean;
  botVerified: boolean;
  automationMode: "full" | "assisted";
}): string[] {
  const reasons: string[] = [];
  if (!input.contractConfigured) reasons.push("The PassGram registry contract is not configured.");
  if (!input.creatorConfirmed) reasons.push("Creator registration is not confirmed on TON.");
  if (!input.botVerified && input.automationMode === "full") {
    reasons.push("Bot permissions are not verified, so full automation cannot be marked complete.");
  }
  reasons.push("No indexer is running to confirm community creation.");
  return reasons;
}

export function paymentBlockers(input: {
  contractConfigured: boolean;
  communityConfirmed: boolean;
  self: boolean;
  walletConnected: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!input.walletConnected) {
    reasons.push("Connect your TON wallet with TON Connect before paying.");
  }
  if (input.self) reasons.push("You cannot subscribe to your own community.");
  if (!input.communityConfirmed) reasons.push("This community is not confirmed, so payment cannot start.");
  if (!input.contractConfigured) reasons.push("The PassGram registry contract is not configured.");
  return reasons;
}

export function canSubscribe(ownerUserId: string, subscriberUserId: string): boolean {
  return ownerUserId !== subscriberUserId;
}

export type AffiliateProfile = {
  userId: string;
  code: string;
  payoutAddress: string;
};

/**
 * Builds a short permanent referral code for the current user.
 * Prefer a Telegram username when it is a valid code; otherwise a compact id.
 * The UI does not ask the user to invent one.
 */
export function suggestReferralCode(input: {
  telegramUsername?: string | null;
  telegramUserId?: number | null;
  userId: string;
}): string {
  const fromUsername = (input.telegramUsername || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (normalizeCode(fromUsername) && fromUsername.length <= 24) return fromUsername;

  if (input.telegramUserId && input.telegramUserId > 0) {
    const fromId = `u${input.telegramUserId.toString(36)}`.padEnd(4, "0");
    if (normalizeCode(fromId)) return fromId;
  }

  const compact = input.userId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const fromUser = `g${compact.slice(-7)}`.padEnd(4, "0");
  if (normalizeCode(fromUser)) return fromUser;
  return "gguest";
}

export function referralBotUsername(): string {
  return (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
}

/** BotFather Mini App short name. Direct links are t.me/<bot>/<short_name>?startapp=… */
export function miniAppShortNameFrom(env: NodeJS.ProcessEnv): string {
  return (env.TELEGRAM_MINI_APP_SHORT_NAME || env.NEXT_PUBLIC_TELEGRAM_MINI_APP_SHORT_NAME || "passgram").trim().replace(/^@/, "") || "passgram";
}

export function miniAppShortName(): string {
  return miniAppShortNameFrom(process.env);
}

/**
 * Opens the Mini App itself (not the bot chat).
 * `startapp` becomes WebApp start_param. Telegram prompts first-time users to start the bot, then opens the app.
 */
export function formatMiniAppHomeLink(): string {
  const bot = referralBotUsername() || "PassGramBot";
  const app = miniAppShortName();
  return `https://t.me/${bot}/${app}`;
}

export function formatMiniAppLink(startParam: string): string {
  return `${formatMiniAppHomeLink()}?startapp=${startParam}`;
}

/**
 * Opens the Mini App directly. Telegram only forwards `startapp` into the app as start_param.
 * `?start=` opens the bot chat instead, so the referral code would never reach PassGram.
 */
export function formatReferralLink(code: string, _origin?: string | null): string {
  const safe = normalizeCode(code);
  if (!safe) return "";
  return formatMiniAppLink(`ref_${safe}`);
}

/** Announcement posted when a marketer shares a newly created PassGram referral link. */
export const PASSGRAM_REFERRAL_SHARE_TEXT =
  "I just created my referral link on PassGram. Join to create a community and manage memberships automatically.";

export function referralShareMessage(link: string): string {
  return `${PASSGRAM_REFERRAL_SHARE_TEXT}\n\n${link}`;
}

/** X receives the full post. Telegram attaches the link separately so it is not repeated. */
export function referralShareTargets(link: string): { x: string; telegram: string } {
  return {
    x: `https://x.com/intent/tweet?text=${encodeURIComponent(referralShareMessage(link))}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(PASSGRAM_REFERRAL_SHARE_TEXT)}`,
  };
}

/** Public subscription link. Opens the Mini App on that community card. */
export function formatCommunityLink(communityId: number, _origin?: string | null): string {
  if (!Number.isSafeInteger(communityId) || communityId < 1) return "";
  return formatMiniAppLink(`c_${communityId}`);
}

/** Promoter link for a community with referrals enabled: c_<id>_cref_<code>. */
export function formatCommunityReferralLink(
  communityId: number,
  code: string,
  _origin?: string | null,
): string {
  if (!Number.isSafeInteger(communityId) || communityId < 1) return "";
  const safe = normalizeCode(code);
  if (!safe) return "";
  return formatMiniAppLink(`c_${communityId}_cref_${safe}`);
}

export function referralPath(code: string): string {
  const safe = normalizeCode(code);
  return safe ? `/?ref=${safe}` : "/";
}

export function nextAffiliate(existing: AffiliateProfile | null, incoming: AffiliateProfile): {
  affiliate: AffiliateProfile;
  created: boolean;
} {
  if (existing) return { affiliate: existing, created: false };
  return { affiliate: incoming, created: true };
}

export function lockReferral(input: {
  userId: string;
  currentCode: string | null;
  locked: boolean;
  incomingCode: string;
  affiliate: { userId: string; code: string; confirmed: boolean } | null;
}): { code: string | null; locked: boolean; result: "locked" | "already_locked" | "invalid" | "unknown" | "self" | "unconfirmed" } {
  if (input.locked && input.currentCode) {
    return { code: input.currentCode, locked: true, result: "already_locked" };
  }
  const code = normalizeCode(input.incomingCode);
  if (!code) return { code: input.currentCode, locked: false, result: "invalid" };
  if (!input.affiliate || input.affiliate.code !== code) {
    return { code: input.currentCode, locked: false, result: "unknown" };
  }
  if (!input.affiliate.confirmed) {
    return { code: input.currentCode, locked: false, result: "unconfirmed" };
  }
  if (input.affiliate.userId === input.userId) {
    return { code: input.currentCode, locked: false, result: "self" };
  }
  return { code, locked: true, result: "locked" };
}

export function pageOf<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const safe = Math.min(Math.max(page, 0), pages - 1);
  return { items: items.slice(safe * size, safe * size + size), page: safe, pages };
}

export function activePassgramCount(
  subscriptions: Array<{ communityId: number; confirmation: Confirmation; expiresAt: number | null }>,
  communityId: number,
  now: number,
): number {
  return subscriptions.filter(
    (item) =>
      item.communityId === communityId &&
      item.confirmation === "confirmed" &&
      item.expiresAt != null &&
      item.expiresAt > now,
  ).length;
}

export function feePolicy(): { platformPercent: string; affiliateOfFeePercent: string; affiliateOfPaymentPercent: string } {
  const platform = Number(PLATFORM_FEE_BPS) / 100;
  const affiliate = Number(REFERRER_FEE_BPS) / 100;
  const ofFee = (Number(REFERRER_FEE_BPS) / Number(PLATFORM_FEE_BPS)) * 100;
  return {
    platformPercent: trimNumber(platform),
    affiliateOfFeePercent: trimNumber(ofFee),
    affiliateOfPaymentPercent: trimNumber(affiliate),
  };
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function policyExample(usdt = "100"): {
  gross: string;
  platformFee: string;
  affiliate: string;
  platformRemainder: string;
  creator: string;
} {
  const gross = parseUsdt(usdt);
  if (gross == null) throw new Error("Example amount is invalid");
  const split = computeSplit(gross, true);
  return {
    gross: formatUsdt(gross),
    platformFee: formatUsdt(split.treasury + split.referrer),
    affiliate: formatUsdt(split.referrer),
    platformRemainder: formatUsdt(split.treasury),
    creator: formatUsdt(split.creator),
  };
}

export type RankedAffiliate = {
  id: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
  referrals: number;
  conversions: number;
  /** Confirmed earnings in USDT base units (platform + community referral). */
  confirmedCommission: string;
};

export function rankAffiliates(entries: RankedAffiliate[]): RankedAffiliate[] {
  return [...entries].sort((a, b) => {
    const commission = BigInt(b.confirmedCommission) - BigInt(a.confirmedCommission);
    if (commission !== 0n) return commission > 0n ? 1 : -1;
    return b.referrals - a.referrals;
  });
}
