export type SubscriberAccess = {
  communityId: number;
  communityName: string;
  inChannel: boolean | null;
  inviteLink: string | null;
  inviteError?: string | null;
};

export const INVITE_ADMIN_ERROR =
  "PassGramBot is not an admin of this channel with permission to invite users, so Join community is unavailable. Ask the channel owner to grant that permission.";

export const IDLE_MEMBERSHIP_POLL_MS = 15_000;
export const PENDING_MEMBERSHIP_POLL_MS = 3_000;

export function membershipPollMs(paymentPending: boolean): number {
  return paymentPending ? PENDING_MEMBERSHIP_POLL_MS : IDLE_MEMBERSHIP_POLL_MS;
}

/** True when this Telegram member can create a one-person invite. Unknown status stays unknown. */
export function botCanCreateInvite(member: { status?: string; can_invite_users?: boolean } | null | undefined): boolean | null {
  if (!member?.status) return null;
  if (member.status === "creator") return true;
  if (member.status === "administrator") return member.can_invite_users === true;
  if (member.status === "member" || member.status === "restricted" || member.status === "left" || member.status === "kicked") {
    return false;
  }
  return null;
}

export function inviteGapAction(input: {
  inChannel: boolean | null;
  inviteLink: string | null;
  botCanInvite: boolean | null;
}): "ready" | "error" | "recover" | "wait" {
  if (input.inChannel !== false || input.inviteLink) return "ready";
  if (input.botCanInvite === false) return "error";
  if (input.botCanInvite === true) return "recover";
  return "wait";
}

export function isInsideChannel(status: string | undefined, isMember?: boolean): boolean {
  if (status === "creator" || status === "administrator" || status === "member") return true;
  if (status === "restricted") return isMember !== false;
  return false;
}

export function resolveSubscriberView(input: {
  access: SubscriberAccess[];
  requiredCommunityIds: number[];
  joinAttemptCommunityId: number | null;
}): { hold: number[]; offer: SubscriberAccess | null; inviteError: string | null } {
  const release = new Set<number>();
  if (input.joinAttemptCommunityId != null) {
    const attempted = input.access.find((row) => row.communityId === input.joinAttemptCommunityId);
    if (attempted?.inChannel === true) release.add(attempted.communityId);
  }
  const hold = new Set<number>();
  for (const id of input.requiredCommunityIds) {
    if (!release.has(id)) hold.add(id);
  }
  for (const row of input.access) {
    if (row.inChannel !== true && !release.has(row.communityId)) hold.add(row.communityId);
  }
  const offer = input.access.find((row) => hold.has(row.communityId) && row.inviteLink) ?? null;
  const blocked = input.access.find((row) => hold.has(row.communityId) && !row.inviteLink && row.inviteError) ?? null;
  return { hold: [...hold], offer, inviteError: blocked?.inviteError ?? null };
}
