import { parseUsdt } from "./money";
import { isTonAddress, MAX_PRICE, MIN_PRICE, normalizeTonAddress } from "./ton/config";

/** Bot API 9.6 added Mini App `requestChat`. Older clients cannot open the native selector. */
export const REQUEST_CHAT_VERSION = "9.6";

/** Matches the contract period range when stored as whole days (1 hour–366 days). */
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 366;
export type SubscriptionDuration = number;

export const CHANNEL_STATES = [
  "not_selected",
  "selection_pending",
  "verification_pending",
  "verified",
  "permission_missing",
  "not_owner",
  "public_channel",
  "unsupported_channel",
  "telegram_unavailable",
  "verification_failed",
] as const;

export type ChannelUiState = (typeof CHANNEL_STATES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

const ADMINISTRATOR_RIGHTS = [
  "is_anonymous",
  "can_manage_chat",
  "can_delete_messages",
  "can_manage_video_chats",
  "can_restrict_members",
  "can_promote_members",
  "can_change_info",
  "can_invite_users",
  "can_post_stories",
  "can_edit_stories",
  "can_delete_stories",
  "can_post_messages",
  "can_edit_messages",
  "can_pin_messages",
  "can_manage_topics",
  "can_manage_direct_messages",
  "can_manage_tags",
  "can_send_welcome_messages",
] as const;

export type ChannelSnapshot = {
  telegramChatId: string;
  /** Public shareable id. Null until the community is activated. */
  communityId: number | null;
  ownerTelegramUserId: string;
  title: string;
  description: string | null;
  photoFileId: string | null;
  telegramMemberCount: number | null;
  telegramMemberCountFetchedAt: string | null;
  botCanInviteUsers: boolean;
  botCanRestrictMembers: boolean;
  verificationStatus: ChannelUiState;
  verifiedAt: string | null;
  payoutAccount: string | null;
  priceUsdt: string | null;
  durationDays: SubscriptionDuration | null;
  referrerCode: string | null;
  referrerTelegramUserId: string | null;
  /** Community promoter program (cut from creator share). */
  referralEnabled: boolean;
  /** Basis points of the creator share paid to the community promoter (0–5000). */
  referralPercentBps: number;
  active: boolean;
  /** Creator-signed deactivation. Pages stay available; payments and new referrals do not. */
  paused: boolean;
};

export function botAdministratorRights(): Record<(typeof ADMINISTRATOR_RIGHTS)[number], boolean> {
  const rights = Object.fromEntries(ADMINISTRATOR_RIGHTS.map((key) => [key, false])) as Record<
    (typeof ADMINISTRATOR_RIGHTS)[number],
    boolean
  >;
  rights.can_invite_users = true;
  rights.can_restrict_members = true;
  return rights;
}

/** The selecting user must be allowed every right the bot requests. The same two rights are a valid superset. */
export function userAdministratorRights(): Record<(typeof ADMINISTRATOR_RIGHTS)[number], boolean> {
  return botAdministratorRights();
}

/**
 * First-step selector: private channel created by this user.
 * Bot admin rights are checked later (Added), so they are not required here.
 */
export function channelRequestButton(requestId: number) {
  return {
    text: "Select Telegram Channel",
    request_chat: {
      request_id: requestId,
      chat_is_channel: true,
      chat_has_username: false,
      chat_is_created: true,
      // Title/photo let PassGram show the channel before the bot is added as admin.
      request_title: true,
      request_photo: true,
      user_administrator_rights: userAdministratorRights(),
    },
  };
}

export function preparedButtonPayload(userId: number, requestId: number) {
  return { user_id: userId, button: channelRequestButton(requestId) };
}

/** USDT base units, matching the contract's 6-decimal price. */
export function parseCommunityPrice(raw: string): string | null {
  const base = parseUsdt(raw);
  if (base == null || base < MIN_PRICE || base > MAX_PRICE) return null;
  return base.toString();
}

export function parseDurationDays(value: unknown): SubscriptionDuration | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) return null;
    value = Number(trimmed);
  }
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < MIN_DURATION_DAYS || value > MAX_DURATION_DAYS) return null;
  return value;
}

/** Returns "friendly" for EQ/UQ, "raw" for 0:hex, or null if invalid. */
export function tonAddressKind(raw: string): "friendly" | "raw" | null {
  const id = normalizeTonAddress(raw);
  if (!id) return null;
  return id.startsWith("0:") ? "raw" : "friendly";
}

/** @deprecated Use tonAddressKind */
export function nearAccountKind(raw: string): "named" | "implicit" | null {
  const kind = tonAddressKind(raw);
  if (!kind) return null;
  return kind === "raw" ? "implicit" : "named";
}

export { isTonAddress, normalizeTonAddress };

/** Entitlement ends relative to that subscriber's confirmed payment, not community creation. */
export function entitlementExpiresAt(paymentConfirmedAtMs: number, durationDays: SubscriptionDuration): number | null {
  if (!Number.isInteger(paymentConfirmedAtMs) || paymentConfirmedAtMs < 0) return null;
  return paymentConfirmedAtMs + durationDays * DAY_MS;
}

export function communityFormReady(input: {
  channelState: string;
  botAdded: boolean;
  price: string;
  durationDays: number | null;
}): boolean {
  return (
    (input.channelState === "verified" || input.channelState === "permission_missing") &&
    input.botAdded &&
    parseCommunityPrice(input.price) != null &&
    parseDurationDays(input.durationDays) != null
  );
}

/** Ownership verified: private channel owned by the creator (Verified badge). */
export function ownershipVerified(state: string): boolean {
  return state === "verified" || state === "permission_missing";
}

/** Bot added with invite + restrict rights (Added badge). */
export function botAccessReady(input: {
  botStatus: string | undefined;
  botCanInviteUsers: boolean | undefined;
  botCanRestrictMembers: boolean | undefined;
}): boolean {
  return (
    input.botStatus === "administrator" &&
    input.botCanInviteUsers === true &&
    input.botCanRestrictMembers === true
  );
}

export function selectorAvailability(webApp: {
  initData?: string;
  requestChat?: unknown;
  isVersionAtLeast?: (version: string) => boolean;
} | null | undefined): "ready" | "telegram_unavailable" {
  if (!webApp?.initData || typeof webApp.requestChat !== "function") return "telegram_unavailable";
  if (typeof webApp.isVersionAtLeast === "function" && !webApp.isVersionAtLeast(REQUEST_CHAT_VERSION)) {
    return "telegram_unavailable";
  }
  return "ready";
}

/** Ownership-only classification. `null` means private channel owned by the creator. */
export function classifyOwnership(input: {
  chatType: string | undefined;
  username: string | null | undefined;
  ownerStatus: string | undefined;
}): "unsupported_channel" | "public_channel" | "not_owner" | null {
  if (input.chatType !== "channel") return "unsupported_channel";
  if (typeof input.username === "string" && input.username.trim()) return "public_channel";
  if (input.ownerStatus !== "creator") return "not_owner";
  return null;
}

export function classifyChannel(input: {
  chatType: string | undefined;
  username: string | null | undefined;
  ownerStatus: string | undefined;
  botStatus: string | undefined;
  botCanInviteUsers: boolean | undefined;
  botCanRestrictMembers: boolean | undefined;
}): Exclude<ChannelUiState, "not_selected" | "selection_pending" | "verification_pending" | "telegram_unavailable"> {
  const ownershipFailure = classifyOwnership(input);
  if (ownershipFailure) return ownershipFailure;
  if (!botAccessReady(input)) return "permission_missing";
  return "verified";
}

export function channelStateMessage(state: ChannelUiState): string {
  switch (state) {
    case "not_selected":
      return "";
    case "selection_pending":
      return "Opening the Telegram channel selector.";
    case "verification_pending":
      return "Checking that this is a private channel you own.";
    case "verified":
      return "Channel verified and PassGramBot is added with the required rights.";
    case "permission_missing":
      return "Channel ownership is verified. Add @PassGramBot as a channel administrator with Invite users via link and Ban users only, then tap Check bot access.";
    case "not_owner":
      return "Only the channel owner can connect it. Being an administrator is not enough.";
    case "public_channel":
      return "PassGram only connects private channels. This channel has a public username.";
    case "unsupported_channel":
      return "Choose a private channel. Groups and other chat types are not supported.";
    case "telegram_unavailable":
      return "Channel selection needs the Telegram app, version 9.6 or newer. PassGram does not list channels inside the browser.";
    case "verification_failed":
      return "Telegram could not verify this channel. Select it again.";
  }
}

export function telegramIdString(value: unknown): string | null {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

export function readChatShared(update: unknown): {
  requestId: number;
  chatId: string;
  fromUserId: string;
  title: string | null;
  photoFileId: string | null;
} | null {
  if (!update || typeof update !== "object") return null;
  const message =
    (update as { message?: unknown }).message ?? (update as { edited_message?: unknown }).edited_message;
  if (!message || typeof message !== "object") return null;
  const shared = (message as { chat_shared?: unknown }).chat_shared;
  const from = (message as { from?: { id?: unknown } }).from;
  if (!shared || typeof shared !== "object") return null;
  const requestId = parseTelegramInt((shared as { request_id?: unknown }).request_id);
  const chatId = telegramIdString((shared as { chat_id?: unknown }).chat_id);
  const fromUserId = telegramIdString(from?.id);
  const titleRaw = (shared as { title?: unknown }).title;
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : null;
  const photoFileId = largestSharedPhotoFileId((shared as { photo?: unknown }).photo);
  if (requestId == null || requestId < 1 || !chatId || !fromUserId) return null;
  return { requestId, chatId, fromUserId, title, photoFileId };
}

function largestSharedPhotoFileId(photo: unknown): string | null {
  if (!Array.isArray(photo) || photo.length === 0) return null;
  let best: { file_id?: unknown; width?: unknown; height?: unknown } | null = null;
  let bestArea = -1;
  for (const entry of photo) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { file_id?: unknown; width?: unknown; height?: unknown };
    const width = typeof item.width === "number" ? item.width : 0;
    const height = typeof item.height === "number" ? item.height : 0;
    const area = width * height;
    if (typeof item.file_id === "string" && item.file_id && area >= bestArea) {
      best = item;
      bestArea = area;
    }
  }
  return typeof best?.file_id === "string" ? best.file_id : null;
}

/** Bot membership change in a channel/group (used to auto-detect Added rights). */
export function readMyChatMember(update: unknown): {
  chatId: string;
  botUserId: string;
  status: string;
  canInviteUsers: boolean;
  canRestrictMembers: boolean;
} | null {
  if (!update || typeof update !== "object") return null;
  const event = (update as { my_chat_member?: unknown }).my_chat_member;
  if (!event || typeof event !== "object") return null;
  const chat = (event as { chat?: { id?: unknown; type?: unknown } }).chat;
  const newMember = (event as { new_chat_member?: Record<string, unknown> }).new_chat_member;
  if (!chat || !newMember) return null;
  const chatId = telegramIdString(chat.id);
  const botUserId = telegramIdString(newMember.user && typeof newMember.user === "object" ? (newMember.user as { id?: unknown }).id : null);
  const status = typeof newMember.status === "string" ? newMember.status : "";
  if (!chatId || !botUserId || !status) return null;
  return {
    chatId,
    botUserId,
    status,
    canInviteUsers: newMember.can_invite_users === true,
    canRestrictMembers: newMember.can_restrict_members === true,
  };
}

function parseTelegramInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function subscriptionFulfillmentAllowed(channel: {
  active: boolean;
  verificationStatus: string;
  botCanInviteUsers: boolean;
  botCanRestrictMembers: boolean;
}): boolean {
  return channel.active && channel.verificationStatus === "verified" && channel.botCanInviteUsers && channel.botCanRestrictMembers;
}

export function nextVerification(
  existing: { ownerTelegramUserId: string } | null,
  incomingOwner: string,
): "insert" | "update" | "conflict" {
  if (!existing) return "insert";
  if (existing.ownerTelegramUserId !== incomingOwner) return "conflict";
  return "update";
}

export function nextActivation(
  existing: ChannelSnapshot | null,
  input: { ownerTelegramUserId: string; priceUsdt: string; durationDays: SubscriptionDuration; payoutAccount: string },
): { result: "created" | "exists" | "missing" | "not_verified" | "conflict"; row: ChannelSnapshot | null } {
  if (!existing) return { result: "missing", row: null };
  if (existing.ownerTelegramUserId !== input.ownerTelegramUserId) return { result: "conflict", row: existing };
  if (existing.verificationStatus !== "verified" || !existing.botCanInviteUsers || !existing.botCanRestrictMembers) {
    return { result: "not_verified", row: existing };
  }
  if (existing.active) return { result: "exists", row: existing };
  return {
    result: "created",
    row: {
      ...existing,
      communityId: existing.communityId,
      payoutAccount: input.payoutAccount,
      priceUsdt: input.priceUsdt,
      durationDays: input.durationDays,
      referrerCode: existing.referrerCode,
      referrerTelegramUserId: existing.referrerTelegramUserId,
      referralEnabled: existing.referralEnabled,
      referralPercentBps: existing.referralPercentBps,
      active: true,
    },
  };
}
