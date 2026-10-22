export type SubscriberAccess = {
  communityId: number;
  communityName: string;
  inChannel: boolean | null;
  inviteLink: string | null;
};

export function isInsideChannel(status: string | undefined, isMember?: boolean): boolean {
  if (status === "creator" || status === "administrator" || status === "member") return true;
  if (status === "restricted") return isMember !== false;
  return false;
}

export function resolveSubscriberView(input: {
  access: SubscriberAccess[];
  requiredCommunityIds: number[];
  joinAttemptCommunityId: number | null;
}): { hold: number[]; offer: SubscriberAccess | null } {
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
  return { hold: [...hold], offer };
}
