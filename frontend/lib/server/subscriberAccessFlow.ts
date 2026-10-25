import { chatInviteLinkBody } from "../../../bot-service/src/telegram.ts";
import {
  INVITE_ADMIN_ERROR,
  botCanCreateInvite,
  inviteGapAction,
  isInsideChannel,
  type SubscriberAccess,
} from "../subscriberAccess";
import { createTelegramClient, type TelegramClient } from "./telegramClient";
import { getMembershipRepository, type MembershipRepository } from "./membershipRepository";

const INVITE_RETRY_MS = 30_000;
const inviteAttemptAt = new Map<string, number>();

export function telegramBotUserId(token: string): number | null {
  const fromEnv = Number(process.env.PASSGRAM_BOT_USER_ID);
  if (Number.isSafeInteger(fromEnv) && fromEnv > 0) return fromEnv;
  const fromToken = Number(token.split(":")[0]);
  if (Number.isSafeInteger(fromToken) && fromToken > 0) return fromToken;
  return null;
}

export function acceptInviteLink(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("invite_link" in value)) return null;
  const link = (value as { invite_link?: unknown }).invite_link;
  if (typeof link !== "string" || !link.startsWith("https://t.me/")) return null;
  return link;
}

export async function readSubscriberAccess(
  botToken: string,
  telegramUserId: number,
  repo?: MembershipRepository,
  options?: { fresh?: boolean; recoverInvites?: boolean },
): Promise<SubscriberAccess[]> {
  const store = repo ?? (await getMembershipRepository());
  const [channels, invites] = await Promise.all([
    store.listSubscriberChannels(telegramUserId),
    store.listSubscriberInvites(telegramUserId),
  ]);
  const inviteByCommunity = new Map(invites.map((row) => [row.communityId, row.inviteLink]));
  const telegram = createTelegramClient(botToken);
  const callOptions = options?.fresh ? { fresh: true as const } : undefined;
  const botId = telegramBotUserId(botToken);
  const access: SubscriberAccess[] = [];
  for (const channel of channels) {
    let inChannel: boolean | null = null;
    try {
      const member = (await telegram.call(
        "getChatMember",
        { chat_id: channel.telegramChatId, user_id: telegramUserId },
        callOptions,
      )) as { status?: string; is_member?: boolean } | null;
      inChannel = isInsideChannel(member?.status, member?.is_member);
    } catch {
      inChannel = null;
    }
    let inviteLink = inviteByCommunity.get(channel.communityId) ?? null;
    let inviteError: string | null = null;
    const botCanInvite = await readBotInviteRights(telegram, channel.telegramChatId, botId, inChannel === false && !inviteLink);
    const gap = inviteGapAction({ inChannel, inviteLink, botCanInvite });
    if (gap === "error") inviteError = INVITE_ADMIN_ERROR;
    if (gap === "recover" && options?.recoverInvites !== false) {
      inviteLink = await recoverSubscriberInvite(store, telegram, telegramUserId, channel.communityId, channel.telegramChatId);
    }
    access.push({
      communityId: channel.communityId,
      communityName: channel.title,
      inChannel,
      inviteLink,
      inviteError,
    });
  }
  return access;
}

async function readBotInviteRights(
  telegram: TelegramClient,
  chatId: string,
  botId: number | null,
  needed: boolean,
): Promise<boolean | null> {
  if (!needed || botId == null) return null;
  try {
    const member = (await telegram.call(
      "getChatMember",
      { chat_id: chatId, user_id: botId },
      { fresh: true },
    )) as { status?: string; can_invite_users?: boolean } | null;
    return botCanCreateInvite(member);
  } catch {
    return null;
  }
}

async function recoverSubscriberInvite(
  store: MembershipRepository,
  telegram: TelegramClient,
  telegramUserId: number,
  communityId: number,
  chatId: string,
): Promise<string | null> {
  const key = `${telegramUserId}:${communityId}`;
  const previous = inviteAttemptAt.get(key) ?? 0;
  if (Date.now() - previous < INVITE_RETRY_MS) return null;
  inviteAttemptAt.set(key, Date.now());
  try {
    const missing = await store.missingSubscriberInvite(telegramUserId, communityId);
    if (!missing) return null;
    const expireDateUnix = Math.floor(missing.expiresAtMs / 1000);
    if (expireDateUnix <= Math.floor(Date.now() / 1000)) return null;
    const created = await telegram.call("createChatInviteLink", chatInviteLinkBody(chatId, expireDateUnix));
    const link = acceptInviteLink(created);
    if (!link) return null;
    await store.saveSubscriberInvite(telegramUserId, communityId, missing.transactionReference, link);
    return link;
  } catch {
    return null;
  }
}

export function resetInviteRecoveryForTests(): void {
  inviteAttemptAt.clear();
}
