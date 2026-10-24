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
  readMyChatMember,
  subscriptionFulfillmentAllowed,
  type ChannelSnapshot,
  type ChannelUiState,
} from "../channelPolicy";
import {
  communityReferralNoticeKind,
  communityReferralNoticeText,
  communityReferralNoticeUrl,
  deliverCommunityReferralNotice,
  deliverReferralConversionNotice,
  referralConversionNoticeText,
  type CommunityReferralNoticeKind,
} from "../communityReferralNotice";
import { formatCommunityReferralPercent, parseCommunityReferralBps } from "../money";
import { normalizeTonAddress } from "../ton/config";
import type { ChannelRepository } from "./channelRepository";
import { validateInitData } from "./initData";
import { tonWalletKey } from "../ton/walletKey";
import { Cell } from "@ton/core";
import { bocContainsCell, buildRegisterCommunityBody } from "../ton/registry";
import { authorizeCommunityRegistration } from "./communityAuthorization";
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
  ) => Promise<{ referrerCode: string; referrerTelegramUserId: string; referrerPayout: string | null } | null>;
  /** Current confirmed subscribers of one community, excluding expired access. */
  listCurrentSubscriberIds?: (communityId: number, nowMs: number) => Promise<string[]>;
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
  platformMarketer?: string | null;
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
  paused: boolean;
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
  ownerDisplayName: string;
  ownerUsername: string;
  ownerAvatarUrl: string;
  telegramMemberCount: number | null;
  paused: boolean;
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
  if (shared) {
    const selection = await deps.repo.getSelection(shared.requestId);
    if (!selection || selection.ownerTelegramUserId !== shared.fromUserId) return { ok: true };
    if (selection.status !== "selection_pending" && selection.status !== "verification_pending") return { ok: true };
    await deps.repo.saveSelection({ ...selection, status: "verification_pending", telegramChatId: shared.chatId });
    try {
      await finalizeSharedSelection(
        deps,
        selection,
        shared.chatId,
        shared.fromUserId,
        shared.title,
        shared.photoFileId,
      );
      const latest = (await deps.repo.getSelection(shared.requestId)) || selection;
      const channel = await deps.repo.getChannel(shared.chatId);
      await notifyOwnerChannelReceived(deps, shared.fromUserId, channel?.title || shared.title, latest.status);
    } catch (error) {
      const message =
        error instanceof TelegramApiError
          ? error.message
          : "Telegram could not finish verifying this channel. Tap Check again.";
      await deps.repo.saveSelection({
        ...selection,
        status: "verification_pending",
        message,
        telegramChatId: shared.chatId,
      });
    }
    return { ok: true };
  }

  const member = readMyChatMember(update);
  if (member && member.botUserId === deps.botUserId) {
    const existing = await deps.repo.getChannel(member.chatId);
    if (existing) {
      const outcome = await verifyChat(deps, member.chatId, existing.ownerTelegramUserId, existing.title, existing.photoFileId);
      if (outcome.snapshot) {
        await deps.repo.saveChannel({
          ...existing,
          ...outcome.snapshot,
          payoutAccount: existing.payoutAccount,
          priceUsdt: existing.priceUsdt,
          durationDays: existing.durationDays,
          referrerCode: existing.referrerCode,
          referrerTelegramUserId: existing.referrerTelegramUserId,
          referralEnabled: existing.referralEnabled,
          referralPercentBps: existing.referralPercentBps,
          communityId: existing.communityId,
          paused: existing.paused,
          active: existing.active && outcome.state === "verified",
        });
        if (outcome.state === "verified") {
          try {
            await deps.telegram.call("sendMessage", {
              chat_id: Number(existing.ownerTelegramUserId),
              text: `PassGramBot is now an admin of “${existing.title}” with invite and ban rights. Open PassGram to finish creating your community.`,
              disable_web_page_preview: true,
            });
          } catch {
            // Mini App Check bot access still works without this DM.
          }
        }
      }
    }
  }
  return { ok: true };
}

async function finalizeSharedSelection(
  deps: ChannelDeps,
  selection: {
    requestId: number;
    ownerTelegramUserId: string;
    preparedButtonId: string;
    status: ChannelUiState;
    message: string | null;
    telegramChatId: string | null;
  },
  chatId: string,
  ownerUserId: string,
  sharedTitle?: string | null,
  sharedPhotoFileId?: string | null,
): Promise<void> {
  const outcome = await verifyChat(deps, chatId, ownerUserId, sharedTitle, sharedPhotoFileId);
  if (!outcome.snapshot) {
    await deps.repo.saveSelection({
      ...selection,
      status: outcome.state,
      message: outcome.message,
      telegramChatId: chatId,
    });
    return;
  }
  const saved = await deps.repo.saveVerifiedChannel(outcome.snapshot);
  if (saved === "conflict") {
    await deps.repo.saveSelection({
      ...selection,
      status: "verification_failed",
      message: "This channel is already registered to another PassGram community.",
      telegramChatId: chatId,
    });
    return;
  }
  await deps.repo.saveSelection({
    ...selection,
    status: outcome.state,
    message: outcome.message,
    telegramChatId: chatId,
  });
}

export async function readChannelSelection(deps: ChannelDeps, initData: string, requestId: number): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  let selection = await deps.repo.getSelection(requestId);
  if (!selection || selection.ownerTelegramUserId !== String(identity.userId)) {
    return fail("verification_failed", "This channel selection could not be found.");
  }

  // Resume verification if webhook saved the chat id but crashed before finishing.
  if (
    (selection.status === "verification_pending" || selection.status === "selection_pending") &&
    selection.telegramChatId
  ) {
    await finalizeSharedSelection(deps, selection, selection.telegramChatId, selection.ownerTelegramUserId, null);
    selection = (await deps.repo.getSelection(requestId)) || selection;
  }

  if (!ownershipVerified(selection.status) || !selection.telegramChatId) {
    return {
      ok: selection.status === "selection_pending" || selection.status === "verification_pending",
      state: selection.status,
      message:
        selection.message ||
        (selection.status === "selection_pending"
          ? "Waiting for Telegram to deliver the channel. If you already shared it with the bot, tap Check again — or select the channel once more."
          : channelStateMessage(selection.status)),
    };
  }
  const chatId = selection.telegramChatId;
  let channel = await deps.repo.getChannel(chatId);
  if (!channel) {
    // Channel row missing — re-run verify to recreate ownership draft.
    await finalizeSharedSelection(deps, selection, chatId, selection.ownerTelegramUserId, null);
    selection = (await deps.repo.getSelection(requestId)) || selection;
    channel = await deps.repo.getChannel(chatId);
  }
  if (channel && memberCountIsStale(channel, deps.now())) {
    channel = await refreshMemberCount(deps, channel);
  }
  const state =
    channel && channel.botCanInviteUsers && channel.botCanRestrictMembers
      ? "verified"
      : ownershipVerified(selection.status)
        ? "permission_missing"
        : selection.status;
  return {
    ok: true,
    state,
    message: selection.message || channelStateMessage(state),
    requestId,
    channel: channel ? toPublic(channel) : undefined,
  };
}

export async function createVerifiedCommunity(
  deps: ChannelDeps,
  initData: string,
  input: { requestId: number; price: string; durationDays: unknown; creatorWallet: string },
): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  const priceUsdt = parseCommunityPrice(input.price);
  const durationDays = parseDurationDays(input.durationDays);
  const payout = normalizeTonAddress(input.creatorWallet);
  if (!priceUsdt || !durationDays || !payout) {
    return fail("verification_failed", "Enter a valid USDT price and duration, and connect the wallet that will receive payments.");
  }
  const account = await deps.accountStatus(payout);
  if (account === "missing") return fail("verification_failed", "That wallet cannot receive payments. No community was created.");
  if (account === "unknown") return fail("verification_failed", "The wallet could not be confirmed. No community was created.");
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
  if (activated.result === "exists" && activated.row?.payoutAccount) {
    const stored = tonWalletKey(activated.row.payoutAccount);
    const next = tonWalletKey(payout);
    if (stored && next && stored !== next) {
      return fail("verification_failed", "This community receives payments at the wallet that registered it. Connect that wallet.");
    }
  }
  if (activated.result === "not_verified" || activated.result === "missing" || !activated.row) {
    return fail("verification_failed", "This channel is not verified, so no community was created.");
  }
  return {
    ok: true,
    state: "verified",
    message:
      activated.result === "exists"
        ? "This channel already has a community."
        : "Sign RegisterCommunity in your wallet. The community stays unpublished until that signature is stored.",
    alreadyExists: activated.result === "exists",
    channel: toPublic(activated.row),
    communityId: activated.row.communityId ?? undefined,
    platformMarketer: attribution?.referrerPayout || null,
  };
}

/** Publishes the draft only after the wallet message carries the owner signature. */
export async function confirmCommunityRegistration(
  deps: ChannelDeps,
  initData: string,
  input: { communityId: number; boc: string },
): Promise<ChannelResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("verification_failed", "Open PassGram from Telegram so your account can be confirmed.");
  if (!Number.isSafeInteger(input.communityId) || input.communityId < 1) {
    return fail("verification_failed", "This community is invalid.");
  }
  const channel = await deps.repo.getChannelByCommunityId(input.communityId);
  if (!channel || channel.ownerTelegramUserId !== String(identity.userId) || !channel.payoutAccount) {
    return fail("verification_failed", "This community is not yours.");
  }
  const approved = await authorizeCommunityRegistration(deps, initData, {
    communityId: input.communityId,
    creator: channel.payoutAccount,
  });
  if (!approved.ok) return fail("verification_failed", approved.message);
  const body = buildRegisterCommunityBody({
    communityId: input.communityId,
    creator: approved.creator,
    payout: approved.payout,
    price: approved.price,
    durationSeconds: approved.durationSeconds,
    platformMarketer: approved.platformMarketer,
    communityReferralBps: approved.communityReferralBps,
    authorization: approved.signature,
  });
  const expected = Cell.fromBase64(body);
  if (!bocContainsCell(input.boc, expected)) {
    return fail("verification_failed", "Your wallet did not sign RegisterCommunity. The community was not published.");
  }
  const signature = Buffer.from(approved.signature, "base64");
  const signatureHash = crypto.createHash("sha256").update(signature).digest("hex");
  const saved = await deps.repo.recordRegistration({
    communityId: input.communityId,
    ownerTelegramUserId: String(identity.userId),
    signatureHash,
  });
  if (!saved) {
    return fail("verification_failed", "This community signature could not be stored.");
  }
  if (saved.newlyActive && channel.referrerTelegramUserId && saved.row.communityId) {
    await deliverReferralConversionNotice({
      telegram: deps.telegram,
      recipientId: channel.referrerTelegramUserId,
      actorId: String(identity.userId),
      text: referralConversionNoticeText({
        program: "passgram",
        title: saved.row.title,
        actorName: identity.displayName,
      }),
      url: communityReferralNoticeUrl(saved.row.communityId),
    });
  }
  return {
    ok: true,
    state: "verified",
    message: "Community published. The RegisterCommunity signature is stored.",
    channel: toPublic(saved.row),
    communityId: saved.row.communityId ?? undefined,
  };
}

export async function getPublicCommunityListing(
  deps: ChannelDeps,
  communityId: number,
): Promise<{ ok: true; community: PublicCommunityListing } | { ok: false; message: string }> {
  if (!Number.isSafeInteger(communityId) || communityId < 1) {
    return { ok: false, message: "This community link is invalid." };
  }
  const stored = await deps.repo.getChannelByCommunityId(communityId);
  if (!stored || !stored.active || stored.verificationStatus !== "verified" || !stored.priceUsdt || stored.durationDays == null) {
    return { ok: false, message: "This community is unavailable." };
  }
  if (!stored.botCanInviteUsers || !stored.botCanRestrictMembers) {
    return { ok: false, message: "This community is unavailable." };
  }
  const row = memberCountIsStale(stored, deps.now()) ? await refreshMemberCount(deps, stored) : stored;
  if (!row.priceUsdt || row.durationDays == null) {
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
      ownerDisplayName: "",
      ownerUsername: "",
      ownerAvatarUrl: "",
      telegramMemberCount: row.telegramMemberCount,
      paused: row.paused,
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
  const fresh = [];
  for (const row of rows) {
    fresh.push(memberCountIsStale(row, deps.now()) ? await refreshMemberCount(deps, row) : row);
  }
  return { ok: true, communities: fresh.map(toPublic) };
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
        paused: existing.paused,
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
  sharedTitle?: string | null,
  sharedPhotoFileId?: string | null,
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
        snapshot: ownershipDraftSnapshot(chatId, ownerUserId, now, sharedTitle, sharedPhotoFileId),
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
      paused: false,
    },
  };
}

function ownershipDraftSnapshot(
  chatId: string,
  ownerUserId: string,
  now: string,
  sharedTitle?: string | null,
  sharedPhotoFileId?: string | null,
): ChannelSnapshot {
  return {
    telegramChatId: chatId,
    communityId: null,
    ownerTelegramUserId: ownerUserId,
    title: sharedTitle?.trim() || "Private channel",
    description: null,
    photoFileId: sharedPhotoFileId?.trim() || null,
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
    paused: false,
  };
}

/** Confirms the share in bot chat and tells the owner how to grant invite/ban rights. */
async function notifyOwnerChannelReceived(
  deps: ChannelDeps,
  ownerUserId: string,
  title: string | null | undefined,
  status: ChannelUiState,
): Promise<void> {
  if (!ownershipVerified(status)) return;
  const label = title?.trim() || "your private channel";
  const text =
    status === "verified"
      ? `PassGram verified “${label}” and @PassGramBot already has invite and ban rights. Open the Mini App to finish creating your community.`
      : [
          `PassGram verified ownership of “${label}”.`,
          "",
          "Next: open the channel → Administrators → Add Admin → @PassGramBot.",
          "Enable only:",
          "• Invite users via link",
          "• Ban users",
          "",
          "Leave other permissions off, then return to PassGram — it updates automatically when Telegram notifies the bot, or tap Check bot access.",
        ].join("\n");
  try {
    await deps.telegram.call("sendMessage", {
      chat_id: Number(ownerUserId),
      text,
      disable_web_page_preview: true,
    });
  } catch {
    // Owner may not have started the bot yet; Mini App UI still shows the same instructions.
  }
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
    paused: channel.paused,
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
        referralPercent: row.referralPercentBps / 100,
      })),
  };
}

export async function updateCommunityOffer(
  deps: ChannelDeps,
  initData: string,
  input: { communityId: number; price: string; durationDays: unknown },
): Promise<{ ok: boolean; message: string }> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  if (!Number.isSafeInteger(input.communityId) || input.communityId < 1) {
    return { ok: false, message: "This community is invalid." };
  }
  const priceUsdt = parseCommunityPrice(input.price);
  const durationDays = parseDurationDays(input.durationDays);
  if (!priceUsdt || durationDays == null) {
    return { ok: false, message: "Enter at least 1 USDT and a whole number of days from 1 to 366." };
  }
  const row = await deps.repo.getChannelByCommunityId(input.communityId);
  if (!row || row.ownerTelegramUserId !== String(identity.userId) || !row.active) {
    return { ok: false, message: "Only the community owner can update this subscription." };
  }
  if (row.paused) {
    return { ok: false, message: "Activate the community before changing the subscription." };
  }
  return {
    ok: false,
    message: "The listed price and duration change when the network confirms this update. Subscribers keep the current terms until then.",
  };
}

export async function updateCommunityReferralSettings(
  deps: ChannelDeps,
  initData: string,
  input: { communityId: number; enabled: boolean; percent: string },
): Promise<{ ok: boolean; message: string; channel?: PublicChannel }> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  if (!Number.isSafeInteger(input.communityId) || input.communityId < 1) {
    return { ok: false, message: "This community is invalid." };
  }
  const row = await deps.repo.getChannelByCommunityId(input.communityId);
  if (!row || row.ownerTelegramUserId !== String(identity.userId) || !row.active) {
    return { ok: false, message: "Only the community owner can change referral settings." };
  }
  if (row.paused) {
    return { ok: false, message: "Activate the community before changing the referral program." };
  }
  const bps = input.enabled ? parseCommunityReferralBps(input.percent) : row.referralPercentBps;
  if (input.enabled && bps == null) {
    return { ok: false, message: "Enter a percent from 0.01% to 50%, with up to 2 decimal places." };
  }
  const updated: ChannelSnapshot = {
    ...row,
    referralEnabled: input.enabled,
    // Stopping the program keeps the rate so referrals already locked still settle.
    referralPercentBps: bps ?? row.referralPercentBps,
  };
  await deps.repo.saveChannel(updated);
  const noticeKind = communityReferralNoticeKind(row, updated);
  if (noticeKind && row.communityId != null) {
    const percentLabel = formatCommunityReferralPercent(
      noticeKind === "stopped" ? row.referralPercentBps : updated.referralPercentBps,
    );
    await sendCommunityReferralNotice(deps, {
      communityId: row.communityId,
      ownerTelegramUserId: row.ownerTelegramUserId,
      title: row.title,
      kind: noticeKind,
      percentLabel,
    });
  }
  return {
    ok: true,
    message: input.enabled
      ? "Community referral program is on."
      : "Community referral program is stopped. Referrals already registered still earn on those subscribers.",
    channel: toPublic(updated),
  };
}

async function sendCommunityReferralNotice(
  deps: ChannelDeps,
  input: {
    communityId: number;
    ownerTelegramUserId: string;
    title: string;
    kind: CommunityReferralNoticeKind;
    percentLabel: string;
  },
): Promise<void> {
  if (!deps.listCurrentSubscriberIds) return;
  try {
    const subscriberIds = await deps.listCurrentSubscriberIds(input.communityId, deps.now());
    await deliverCommunityReferralNotice({
      telegram: deps.telegram,
      subscriberIds,
      ownerTelegramUserId: input.ownerTelegramUserId,
      text: communityReferralNoticeText(input),
      url: communityReferralNoticeUrl(input.communityId),
    });
  } catch {
    /* The referral setting is already saved. A notice failure does not roll it back. */
  }
}

export async function updateCommunityPaused(
  deps: ChannelDeps,
  initData: string,
  input: { communityId: number; paused: boolean },
): Promise<{ ok: boolean; message: string; channel?: PublicChannel }> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  if (!Number.isSafeInteger(input.communityId) || input.communityId < 1) {
    return { ok: false, message: "This community is invalid." };
  }
  const row = await deps.repo.getChannelByCommunityId(input.communityId);
  if (!row || row.ownerTelegramUserId !== String(identity.userId) || !row.active) {
    return { ok: false, message: "Only the community owner can change this community." };
  }
  const updated: ChannelSnapshot = { ...row, paused: input.paused };
  await deps.repo.saveChannel(updated);
  return {
    ok: true,
    message: input.paused
      ? "Community is deactivated. Pages stay open. Payments, renewals, and new referrals are closed."
      : "Community is active again. Payments, renewals, and the referral program use the saved settings.",
    channel: toPublic(updated),
  };
}

function fail(state: ChannelUiState, message: string): ChannelResult {
  return { ok: false, state, message };
}
