import type { CommunityRecord } from "./store";

export type OwnerCommunityInput = {
  communityId: number | null;
  title: string;
  description: string | null;
  priceUsdt: string | null;
  durationDays: number | null;
  ownerTelegramUserId: string;
  paused?: boolean;
  active?: boolean;
  telegramMemberCount?: number | null;
  referralEnabled?: boolean;
  referralPercentBps?: number;
  telegramChatId?: string;
  hasPhoto?: boolean;
};

let ownedGeneration = 0;

/** Invalidates an in-flight owner snapshot so a newer local write is not overwritten by a stale response. */
export function bumpOwnedSnapshotGeneration(): number {
  ownedGeneration += 1;
  return ownedGeneration;
}

export function ownedSnapshotGenerationIsCurrent(generation: number): boolean {
  return generation === ownedGeneration;
}

function communitySignature(row: CommunityRecord): string {
  return [
    row.id,
    row.ownerUserId,
    row.name,
    row.telegramChatId,
    row.description,
    row.imageUrl,
    row.price,
    row.periodSeconds,
    row.payoutAddress,
    row.confirmation,
    row.status,
    row.referralEnabled,
    row.referralPercentBps,
    row.telegramMemberCount ?? "",
    row.ownerDisplayName ?? "",
    row.ownerUsername ?? "",
    row.ownerAvatarUrl ?? "",
  ].join("\u001f");
}

function sameCommunities(current: CommunityRecord[], next: CommunityRecord[]): boolean {
  if (current.length !== next.length) return false;
  const left = current.map(communitySignature).sort();
  const right = next.map(communitySignature).sort();
  return left.every((value, index) => value === right[index]);
}

function listedCommunity(row: OwnerCommunityInput, previous: CommunityRecord | undefined): CommunityRecord | null {
  if (row.communityId == null || !row.priceUsdt || row.durationDays == null) return null;
  const paused = row.paused === true || row.active === false;
  return {
    id: row.communityId,
    ownerUserId: `tg:${row.ownerTelegramUserId}`,
    name: row.title,
    telegramUsername: previous?.telegramUsername || "",
    telegramChatId: row.telegramChatId || previous?.telegramChatId || "",
    description: row.description || "",
    imageUrl: row.hasPhoto === false ? "" : previous?.imageUrl || `/api/telegram/communities/${row.communityId}/photo`,
    price: row.priceUsdt,
    periodSeconds: row.durationDays * 24 * 60 * 60,
    payoutAddress: previous?.payoutAddress || "",
    accessMode: "subscription",
    automationMode: previous?.automationMode || "full",
    automationReady: false,
    confirmation: "confirmed",
    status: paused ? "paused" : "active",
    createdAt: previous?.createdAt || 0,
    referralEnabled: row.referralEnabled ?? previous?.referralEnabled ?? false,
    referralPercentBps: row.referralPercentBps ?? previous?.referralPercentBps ?? 0,
    telegramMemberCount: row.telegramMemberCount !== undefined ? row.telegramMemberCount : previous?.telegramMemberCount ?? null,
    ownerDisplayName: previous?.ownerDisplayName || "",
    ownerUsername: previous?.ownerUsername || "",
    ownerAvatarUrl: previous?.ownerAvatarUrl || "",
  };
}

/**
 * Replace communities owned by this account with the database list.
 * An empty successful list removes those cards. Communities owned by other people stay.
 * Returns null when the stored cards already match the list.
 */
export function replaceOwnedCommunities(
  current: CommunityRecord[],
  ownerUserIds: readonly string[],
  incoming: readonly OwnerCommunityInput[],
): CommunityRecord[] | null {
  const owners = new Set(ownerUserIds.filter((id) => id.length > 0));
  const previousById = new Map(current.map((item) => [item.id, item]));
  const listed: CommunityRecord[] = [];
  const listedIds = new Set<number>();
  for (const row of incoming) {
    const community = listedCommunity(row, row.communityId == null ? undefined : previousById.get(row.communityId));
    if (!community || listedIds.has(community.id)) continue;
    listedIds.add(community.id);
    listed.push(community);
  }
  const kept = current.filter((item) => !owners.has(item.ownerUserId) && !listedIds.has(item.id));
  const next = [...kept, ...listed];
  return sameCommunities(current, next) ? null : next;
}
