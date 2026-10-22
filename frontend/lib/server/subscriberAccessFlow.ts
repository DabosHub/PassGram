import { isInsideChannel, type SubscriberAccess } from "../subscriberAccess";
import { createTelegramClient } from "./telegramClient";
import { getMembershipRepository, type MembershipRepository } from "./membershipRepository";

export async function readSubscriberAccess(
  botToken: string,
  telegramUserId: number,
  repo?: MembershipRepository,
): Promise<SubscriberAccess[]> {
  const store = repo ?? (await getMembershipRepository());
  const [channels, invites] = await Promise.all([
    store.listSubscriberChannels(telegramUserId),
    store.listSubscriberInvites(telegramUserId),
  ]);
  const inviteByCommunity = new Map(invites.map((row) => [row.communityId, row.inviteLink]));
  const telegram = createTelegramClient(botToken);
  const access: SubscriberAccess[] = [];
  for (const channel of channels) {
    let inChannel: boolean | null = null;
    try {
      const member = (await telegram.call("getChatMember", {
        chat_id: channel.telegramChatId,
        user_id: telegramUserId,
      })) as { status?: string; is_member?: boolean } | null;
      inChannel = isInsideChannel(member?.status, member?.is_member);
    } catch {
      inChannel = null;
    }
    access.push({
      communityId: channel.communityId,
      communityName: channel.title,
      inChannel,
      inviteLink: inviteByCommunity.get(channel.communityId) ?? null,
    });
  }
  return access;
}
