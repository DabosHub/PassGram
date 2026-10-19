import crypto from "node:crypto";
import {
  botAccessReady,
  channelStateMessage,
  classifyChannel,
  classifyOwnership,
  ownershipVerified,
  parseDurationDays,
  parseCommunityPrice,
  preparedButtonPayload,
  readChatShared,
  subscriptionFulfillmentAllowed,
  tonAddressKind,
  type ChannelSnapshot,
  type ChannelUiState,
} from "../channelPolicy";
import { normalizeTonAddress } from "../ton/config";
import type { ChannelRepository } from "./channelRepository";
import { validateInitData } from "./initData";
import { downloadTelegramFile, TelegramApiError, type TelegramClient } from "./telegramClient";

export type ChannelDeps = {
  repo: ChannelRepository;
  telegram: TelegramClient;
  botToken: string;
  botUserId: string;
  now: () => number;
  accountStatus: (accountId: string) => Promise<"exists" | "missing" | "implicit" | "unknown">;
  getCreatorAttribution?: (
    telegramUserId: string,
  ) => Promise<{ referrerCode: string; referrerTelegramUserId: string } | null>;
};

export type ChannelResult = {
  ok: boolean;
  state: ChannelUiState;
  message: string;
  requestId?: number;
  preparedButtonId?: string;
  channel?: PublicChannel;
  alreadyExists?: boolean;
  allowed?: boolean;
  communityId?: number;
};

export type PublicChannel = {
  telegramChatId: string;
  communityId: number | null;
  title: string;
  description: string | null;
  hasPhoto: boolean;
  telegramMemberCount: number | null;
  telegramMemberCountFetchedAt: string | null;
  verificationStatus: ChannelUiState;
  botCanInviteUsers: boolean;
  botCanRestrictMembers: boolean;
  botAdded: boolean;
  priceUsdt: string | null;
  durationDays: number | null;
  ownerTelegramUserId: string;
  active: boolean;
  referralEnabled: boolean;
  referralPercentBps: number;
};

/** Public subscribe-page listing (no payout secrets). */
export type PublicCommunityListing = {
  communityId: number;
  title: string;
  description: string | null;
  hasPhoto: boolean;
  priceUsdt: string;
  durationDays: number;
  ownerTelegramUserId: string;
  ownerLabel: string;
};

const MEMBER_COUNT_MAX_AGE_MS = 15 * 60 * 1000;

export async function prepareChannelSelection(deps: ChannelDeps, initData: string): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  const requestId = crypto.randomInt(1, 2_147_483_647);
  let prepared: { id?: unknown };
  try {
    prepared = await deps.telegram.call("savePreparedKeyboardButton", preparedButtonPayload(identity.userId, requestId));
  } catch (error) {
    const message = error instanceof TelegramApiError ? error.message : channelStateMessage("verification_failed");
    return fail("verification_failed", message);
  }
  if (typeof prepared.id !== "string" || !prepared.id) return fail("verification_failed", "Telegram did not return a channel selector.");
  await deps.repo.insertSelection({
    requestId,
    ownerTelegramUserId: String(identity.userId),
    preparedButtonId: prepared.id,
    status: "selection_pending",
    message: null,
    telegramChatId: null,
  });
  return {
    ok: true,
    state: "selection_pending",
    message: channelStateMessage("selection_pending"),
    requestId,
    preparedButtonId: prepared.id,
  };
}

export async function ingestTelegramUpdate(deps: ChannelDeps, update: unknown): Promise<{ ok: true }> {
  const shared = readChatShared(update);
  if (!shared) return { ok: true };
  const selection = await deps.repo.getSelection(shared.requestId);
  if (!selection || selection.ownerTelegramUserId !== shared.fromUserId) return { ok: true };
  if (selection.status !== "selection_pending" && selection.status !== "verification_pending") return { ok: true };
  await deps.repo.saveSelection({ ...selection, status: "verification_pending", telegramChatId: shared.chatId });
  const outcome = await verifyChat(deps, shared.chatId, shared.fromUserId);
  if (!outcome.snapshot) {
    await deps.repo.saveSelection({
      ...selection,
      status: outcome.state,
      message: outcome.message,
      telegramChatId: shared.chatId,
    });
    return { ok: true };
  }
  const saved = await deps.repo.saveVerifiedChannel(outcome.snapshot);
  if (saved === "conflict") {
    await deps.repo.saveSelection({
      ...selection,
      status: "verification_failed",
      message: "This channel is already registered to another PassGram community.",
      telegramChatId: shared.chatId,
    });
    return { ok: true };
  }
  await deps.repo.saveSelection({
    ...selection,
    status: outcome.state,
    message: outcome.message,
    telegramChatId: shared.chatId,
  });
  return { ok: true };
}

export async function readChannelSelection(deps: ChannelDeps, initData: string, requestId: number): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  const selection = await deps.repo.getSelection(requestId);
  if (!selection || selection.ownerTelegramUserId !== String(identity.userId)) {
    return fail("verification_failed", "This channel selection could not be found.");
  }
  if (!ownershipVerified(selection.status) || !selection.telegramChatId) {
    return {
      ok: selection.status === "selection_pending" || selection.status === "verification_pending",
      state: selection.status,
      message: selection.message || channelStateMessage(selection.status),
    };
  }
  let channel = await deps.repo.getChannel(selection.telegramChatId);
  if (channel && memberCountIsStale(channel, deps.now())) {
    channel = await refreshMemberCount(deps, channel);
  }
  const state = channel && channel.botCanInviteUsers && channel.botCanRestrictMembers ? "verified" : "permission_missing";
  return {
    ok: true,
    state,
    message: channelStateMessage(state),
    requestId,
    channel: channel ? toPublic(channel) : undefined,
  };
}

export async function createVerifiedCommunity(
  deps: ChannelDeps,
  initData: string,
  input: { requestId: number; price: string; durationDays: unknown; payoutAccount: string },
): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  const priceUsdt = parseCommunityPrice(input.price);
  const durationDays = parseDurationDays(input.durationDays);
  const payout = normalizeTonAddress(input.payoutAccount);
  const kind = tonAddressKind(input.payoutAccount);
  if (!priceUsdt || !durationDays || !payout || !kind) {
    return fail("verification_failed", "Enter a valid USDT price, duration, and TON payout address.");
  }
  const account = await deps.accountStatus(payout);
  if (account === "missing") return fail("verification_failed", "That TON address is invalid. No payment was sent.");
  if (account === "unknown") return fail("verification_failed", "The TON address could not be confirmed. No payment was sent.");
  const selection = await deps.repo.getSelection(input.requestId);
  if (
    !selection ||
    selection.ownerTelegramUserId !== String(identity.userId) ||
    !ownershipVerified(selection.status) ||
    !selection.telegramChatId
  ) {
    return fail(selection?.status || "verification_failed", selection?.message || "Verify a private channel before creating a community.");
  }
  let recheck: Awaited<ReturnType<typeof verifyChat>>;
  try {
    recheck = await verifyChat(deps, selection.telegramChatId, String(identity.userId));
  } catch {
    return fail("verification_failed", "Telegram could not be reached. No community was created.");
  }
  if (!recheck.snapshot || recheck.state !== "verified") {
    await deps.repo.saveSelection({ ...selection, status: recheck.state, message: recheck.message });
    if (recheck.snapshot) {
      await deps.repo.saveVerifiedChannel(recheck.snapshot);
    } else {
      const existing = await deps.repo.getChannel(selection.telegramChatId);
      if (existing) {
        await deps.repo.saveChannel({
          ...existing,
          verificationStatus: ownershipVerified(recheck.state) ? "verified" : recheck.state,
          botCanInviteUsers: false,
          botCanRestrictMembers: false,
          active: false,
        });
      }
    }
    return fail(recheck.state, recheck.message);
  }
  const attribution = deps.getCreatorAttribution
    ? await deps.getCreatorAttribution(String(identity.userId))
    : null;
  const snapshotWithReferrer: ChannelSnapshot = {
    ...recheck.snapshot,
    referrerCode: attribution?.referrerCode ?? null,
    referrerTelegramUserId: attribution?.referrerTelegramUserId ?? null,
  };
  await deps.repo.saveVerifiedChannel(snapshotWithReferrer);
  const activated = await deps.repo.activateChannel({
    telegramChatId: selection.telegramChatId,
    ownerTelegramUserId: String(identity.userId),
    priceUsdt,
    durationDays,
    payoutAccount: payout,
  });
  if (activated.result === "conflict") return fail("verification_failed", "This channel is already registered to another PassGram community.");
  if (activated.result === "not_verified" || activated.result === "missing" || !activated.row) {
    return fail("verification_failed", "This channel is not verified, so no community was created.");
  }
  return {
    ok: true,
    state: "verified",
    message: activated.result === "exists" ? "This channel already has a community." : "Community created.",
    alreadyExists: activated.result === "exists",
    channel: toPublic(activated.row),
    communityId: activated.row.communityId ?? undefined,
  };
}

export async function getPublicCommunityListing(
  deps: ChannelDeps,
  communityId: number,
): Promise<{ ok: true; community: PublicCommunityListing } | { ok: false; message: string }> {
  if (!Number.isSafeInteger(communityId) || communityId < 1) {
    return { ok: false, message: "This community link is invalid." };
  }
  const row = await deps.repo.getChannelByCommunityId(communityId);
  if (!row || !row.active || row.verificationStatus !== "verified" || !row.priceUsdt || row.durationDays == null) {
    return { ok: false, message: "This community is unavailable." };
  }
  if (!row.botCanInviteUsers || !row.botCanRestrictMembers) {
    return { ok: false, message: "This community is unavailable." };
  }
  return {
    ok: true,
    community: {
      communityId: row.communityId!,
      title: row.title,
      description: row.description,
      hasPhoto: row.photoFileId != null,
      priceUsdt: row.priceUsdt,
      durationDays: row.durationDays,
      ownerTelegramUserId: row.ownerTelegramUserId,
      ownerLabel: `Creator ${row.ownerTelegramUserId}`,
    },
  };
}

export async function listOwnerCommunities(deps: ChannelDeps, initData: string): Promise<{
  ok: boolean;
  message?: string;
  communities: PublicChannel[];
}> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed.", communities: [] };
  const rows = await deps.repo.listChannelsByOwner(String(identity.userId));
  return { ok: true, communities: rows.map(toPublic) };
}

export async function loadCommunityPhotoById(
  deps: ChannelDeps,
  communityId: number,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!Number.isSafeInteger(communityId) || communityId < 1) return null;
  const channel = await deps.repo.getChannelByCommunityId(communityId);
  if (!channel?.active || !channel.photoFileId) return null;
  const file = await deps.telegram.call("getFile", { file_id: channel.photoFileId });
  if (typeof file.file_path !== "string") return null;
  return downloadTelegramFile(deps.botToken, file.file_path);
}

export async function recheckChannelAccess(deps: ChannelDeps, initData: string, telegramChatId: string): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  const existing = await deps.repo.getChannel(telegramChatId);
  if (!existing || existing.ownerTelegramUserId !== String(identity.userId)) {
    return fail("verification_failed", "This community could not be found.");
  }
  let snapshot: ChannelSnapshot;
  try {
    const outcome = await verifyChat(deps, telegramChatId, String(identity.userId));
    if (outcome.snapshot) {
      snapshot = {
        ...existing,
        ...outcome.snapshot,
        payoutAccount: existing.payoutAccount,
        priceUsdt: existing.priceUsdt,
        durationDays: existing.durationDays,
        referrerCode: existing.referrerCode,
        referrerTelegramUserId: existing.referrerTelegramUserId,
        referralEnabled: existing.referralEnabled,
        referralPercentBps: existing.referralPercentBps,
        active: existing.active && outcome.state === "verified",
      };
    } else {
      snapshot = {
        ...existing,
        verificationStatus: outcome.state,
        botCanInviteUsers: false,
        botCanRestrictMembers: false,
        active: false,
      };
    }
  } catch {
    return {
      ok: false,
      state: existing.botCanInviteUsers && existing.botCanRestrictMembers ? "verified" : "permission_missing",
      message: "Telegram could not be reached, so subscriptions stay blocked until the check succeeds.",
      allowed: false,
      channel: toPublic(existing),
    };
  }
  await deps.repo.saveChannel(snapshot);
  const allowed = subscriptionFulfillmentAllowed(snapshot);
  const state = snapshot.botCanInviteUsers && snapshot.botCanRestrictMembers ? "verified" : ownershipVerified(snapshot.verificationStatus) ? "permission_missing" : snapshot.verificationStatus;
  return {
    ok: allowed || state === "permission_missing",
    state,
    message:
      state === "verified"
        ? "PassGramBot is added with invite and ban rights."
        : channelStateMessage(state),
    allowed,
    channel: toPublic(snapshot),
  };
}

export async function loadChannelPhoto(deps: ChannelDeps, initData: string, telegramChatId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return null;
  const channel = await deps.repo.getChannel(telegramChatId);
  if (!channel || channel.ownerTelegramUserId !== String(identity.userId) || !channel.photoFileId) return null;
  const file = await deps.telegram.call("getFile", { file_id: channel.photoFileId });
  if (typeof file.file_path !== "string") return null;
  return downloadTelegramFile(deps.botToken, file.file_path);
}

async function verifyChat(
  deps: ChannelDeps,
  chatId: string,
  ownerUserId: string,
): Promise<{ state: ChannelUiState; message: string; snapshot: ChannelSnapshot | null }> {
  const now = new Date(deps.now()).toISOString();
  let chat: Record<string, unknown>;
  try {
    chat = await deps.telegram.call("getChat", { chat_id: chatId });
  } catch (error) {
    if (error instanceof TelegramApiError && (error.status === 400 || error.status === 403)) {
      // requestChat already required a private channel created by this user.
      // Bot cannot read details until it is added — keep Verified, wait for Added.
      return {
        state: "permission_missing",
        message: channelStateMessage("permission_missing"),
        snapshot: ownershipDraftSnapshot(chatId, ownerUserId, now),
      };
    }
    throw error;
  }
  const owner = await readMember(deps, chatId, ownerUserId);
  const bot = await readMember(deps, chatId, deps.botUserId);
  const ownershipFailure = classifyOwnership({
    chatType: typeof chat.type === "string" ? chat.type : undefined,
    username: typeof chat.username === "string" ? chat.username : null,
    ownerStatus: owner?.status,
  });
  if (ownershipFailure) {
    return { state: ownershipFailure, message: channelStateMessage(ownershipFailure), snapshot: null };
  }
  if (typeof chat.title !== "string" || !chat.title.trim()) {
    return { state: "verification_failed", message: "Telegram did not return a channel title.", snapshot: null };
  }
  const added = botAccessReady({
    botStatus: bot?.status,
    botCanInviteUsers: bot?.can_invite_users === true,
    botCanRestrictMembers: bot?.can_restrict_members === true,
  });
  const state = classifyChannel({
    chatType: typeof chat.type === "string" ? chat.type : undefined,
    username: typeof chat.username === "string" ? chat.username : null,
    ownerStatus: owner?.status,
    botStatus: bot?.status,
    botCanInviteUsers: bot?.can_invite_users === true,
    botCanRestrictMembers: bot?.can_restrict_members === true,
  });
  const count = await readMemberCount(deps, chatId);
  const photo = chat.photo && typeof chat.photo === "object" ? (chat.photo as { big_file_id?: unknown }).big_file_id : undefined;
  return {
    state,
    message: channelStateMessage(state),
    snapshot: {
      telegramChatId: chatId,
      communityId: null,
      ownerTelegramUserId: ownerUserId,
      title: chat.title,
      description: typeof chat.description === "string" && chat.description.trim() ? chat.description : null,
      photoFileId: typeof photo === "string" ? photo : null,
      telegramMemberCount: count,
      telegramMemberCountFetchedAt: count == null ? null : now,
      botCanInviteUsers: added,
      botCanRestrictMembers: added,
      verificationStatus: "verified",
      verifiedAt: now,
      payoutAccount: null,
      priceUsdt: null,
      durationDays: null,
      referrerCode: null,
      referrerTelegramUserId: null,
      referralEnabled: false,
      referralPercentBps: 0,
      active: false,
    },
  };
}

function ownershipDraftSnapshot(chatId: string, ownerUserId: string, now: string): ChannelSnapshot {
  return {
    telegramChatId: chatId,
    communityId: null,
    ownerTelegramUserId: ownerUserId,
    title: "Private channel",
    description: null,
    photoFileId: null,
    telegramMemberCount: null,
    telegramMemberCountFetchedAt: null,
    botCanInviteUsers: false,
    botCanRestrictMembers: false,
    verificationStatus: "verified",
    verifiedAt: now,
    payoutAccount: null,
    priceUsdt: null,
    durationDays: null,
    referrerCode: null,
    referrerTelegramUserId: null,
    referralEnabled: false,
    referralPercentBps: 0,
    active: false,
  };
}

async function readMember(deps: ChannelDeps, chatId: string, userId: string): Promise<{ status?: string; can_invite_users?: boolean; can_restrict_members?: boolean } | null> {
  try {
    return (await deps.telegram.call("getChatMember", { chat_id: chatId, user_id: Number(userId) })) as {
      status?: string;
      can_invite_users?: boolean;
      can_restrict_members?: boolean;
    };
  } catch (error) {
    if (error instanceof TelegramApiError && (error.status === 400 || error.status === 403)) return null;
    throw error;
  }
}

async function readMemberCount(deps: ChannelDeps, chatId: string): Promise<number | null> {
  try {
    const count = await deps.telegram.call("getChatMemberCount", { chat_id: chatId });
    return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

async function refreshMemberCount(deps: ChannelDeps, channel: ChannelSnapshot): Promise<ChannelSnapshot> {
  const count = await readMemberCount(deps, channel.telegramChatId);
  if (count == null) return channel;
  const updated = { ...channel, telegramMemberCount: count, telegramMemberCountFetchedAt: new Date(deps.now()).toISOString() };
  await deps.repo.saveChannel(updated);
  return updated;
}

function memberCountIsStale(channel: ChannelSnapshot, nowMs: number): boolean {
  if (channel.telegramMemberCountFetchedAt == null) return true;
  const fetched = Date.parse(channel.telegramMemberCountFetchedAt);
  return !Number.isFinite(fetched) || nowMs - fetched >= MEMBER_COUNT_MAX_AGE_MS;
}

function toPublic(channel: ChannelSnapshot): PublicChannel {
  const botAdded = channel.botCanInviteUsers && channel.botCanRestrictMembers;
  return {
    telegramChatId: channel.telegramChatId,
    communityId: channel.communityId,
    title: channel.title,
    description: channel.description,
    hasPhoto: channel.photoFileId != null,
    telegramMemberCount: channel.telegramMemberCount,
    telegramMemberCountFetchedAt: channel.telegramMemberCountFetchedAt,
    verificationStatus: channel.verificationStatus,
    botCanInviteUsers: channel.botCanInviteUsers,
    botCanRestrictMembers: channel.botCanRestrictMembers,
    botAdded,
    priceUsdt: channel.priceUsdt,
    durationDays: channel.durationDays,
    ownerTelegramUserId: channel.ownerTelegramUserId,
    active: channel.active,
    referralEnabled: channel.referralEnabled,
    referralPercentBps: channel.referralPercentBps,
  };
}

export type ReferralCommunityCard = {
  communityId: number;
  title: string;
  description: string | null;
  hasPhoto: boolean;
  telegramMemberCount: number | null;
  priceUsdt: string;
  durationDays: number;
  referralPercentBps: number;
  referralPercent: number;
};

export async function listReferralEnabledCommunities(
  deps: ChannelDeps,
): Promise<{ ok: true; communities: ReferralCommunityCard[] }> {
  const rows = await deps.repo.listReferralEnabledCommunities();
  return {
    ok: true,
    communities: rows
      .filter((row) => row.communityId != null && row.priceUsdt && row.durationDays != null)
      .map((row) => ({
        communityId: row.communityId!,
        title: row.title,
        description: row.description,
        hasPhoto: row.photoFileId != null,
        telegramMemberCount: row.telegramMemberCount,
        priceUsdt: row.priceUsdt!,
        durationDays: row.durationDays!,
        referralPercentBps: row.referralPercentBps,
        referralPercent: Math.round(row.referralPercentBps / 100),
      })),
  };
}

export async function updateCommunityReferralSettings(
  deps: ChannelDeps,
  initData: string,
  input: { communityId: number; enabled: boolean; percent: number },
): Promise<{ ok: boolean; message: string; channel?: PublicChannel }> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  if (!Number.isSafeInteger(input.communityId) || input.communityId < 1) {
    return { ok: false, message: "This community is invalid." };
  }
  if (input.enabled && (input.percent < 1 || input.percent > 50 || !Number.isInteger(input.percent))) {
    return { ok: false, message: "Enter a whole referral percent from 1 to 50." };
  }
  const row = await deps.repo.getChannelByCommunityId(input.communityId);
  if (!row || row.ownerTelegramUserId !== String(identity.userId) || !row.active) {
    return { ok: false, message: "Only the community owner can change referral settings." };
  }
  const updated: ChannelSnapshot = {
    ...row,
    referralEnabled: input.enabled,
    referralPercentBps: input.enabled ? input.percent * 100 : 0,
  };
  await deps.repo.saveChannel(updated);
  return { ok: true, message: input.enabled ? "Community referrals enabled." : "Community referrals turned off.", channel: toPublic(updated) };
}

function fail(state: ChannelUiState, message: string): ChannelResult {
  return { ok: false, state, message };
}
