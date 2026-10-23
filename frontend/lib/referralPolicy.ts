import { normalizeCode } from "./money";
import { suggestReferralCode } from "./domain";

export type AffiliateRecord = {
  code: string;
  telegramUserId: string;
  payoutAccount: string;
  /** Same wallet as payoutAccount. It is the wallet that signed the link. */
  signerAddress?: string | null;
  createdAt: string;
};

export type AttributionRecord = {
  telegramUserId: string;
  referrerCode: string;
  referrerTelegramUserId: string;
  source: "start_webhook" | "mini_app";
  lockedAt: string;
};

export type AttributionDecision =
  | { result: "locked"; attribution: AttributionRecord }
  | { result: "already_locked"; attribution: AttributionRecord }
  | { result: "invalid" }
  | { result: "unknown" }
  | { result: "self" };

/** Extracts ref_<code> from Telegram start payloads and deep links. */
export function parseReferralStartPayload(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const start = /^\/start(?:@\w+)?(?:\s+|$)(.+)?$/i.exec(text);
  const payload = (start ? start[1] || "" : text).trim();
  if (!payload) return null;
  if (payload.toLowerCase().startsWith("ref_")) return normalizeCode(payload.slice(4));
  return normalizeCode(payload);
}

export function decideAttribution(input: {
  inviteeTelegramUserId: string;
  code: string;
  existing: AttributionRecord | null;
  affiliate: AffiliateRecord | null;
  source: AttributionRecord["source"];
  nowIso: string;
}): AttributionDecision {
  if (input.existing) return { result: "already_locked", attribution: input.existing };
  const code = normalizeCode(input.code);
  if (!code) return { result: "invalid" };
  if (!input.affiliate || input.affiliate.code !== code) return { result: "unknown" };
  if (input.affiliate.telegramUserId === input.inviteeTelegramUserId) return { result: "self" };
  return {
    result: "locked",
    attribution: {
      telegramUserId: input.inviteeTelegramUserId,
      referrerCode: code,
      referrerTelegramUserId: input.affiliate.telegramUserId,
      source: input.source,
      lockedAt: input.nowIso,
    },
  };
}

export function buildAffiliateCode(input: {
  telegramUsername?: string | null;
  telegramUserId: number;
}): string {
  return suggestReferralCode({
    telegramUsername: input.telegramUsername,
    telegramUserId: input.telegramUserId,
    userId: `tg:${input.telegramUserId}`,
  });
}

export function readStartFromUpdate(update: unknown): { telegramUserId: string; code: string } | null {
  if (!update || typeof update !== "object") return null;
  const message = (update as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const from = (message as { from?: { id?: unknown; is_bot?: unknown } }).from;
  const text = (message as { text?: unknown }).text;
  if (typeof text !== "string" || typeof from?.id !== "number" || !Number.isSafeInteger(from.id) || from.id <= 0) {
    return null;
  }
  if (from.is_bot === true) return null;
  const code = parseReferralStartPayload(text);
  if (!code) return null;
  return { telegramUserId: String(from.id), code };
}
