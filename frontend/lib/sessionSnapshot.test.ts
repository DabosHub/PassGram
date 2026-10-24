import assert from "node:assert/strict";
import test from "node:test";
import type { CommunityRecord } from "./store.tsx";
import {
  bumpOwnedSnapshotGeneration,
  ownedSnapshotGenerationIsCurrent,
  replaceOwnedCommunities,
  type OwnerCommunityInput,
} from "./sessionSnapshot.ts";

function community(patch: Partial<CommunityRecord> & Pick<CommunityRecord, "id" | "ownerUserId" | "name">): CommunityRecord {
  return {
    telegramUsername: "",
    telegramChatId: "",
    description: "",
    imageUrl: "",
    price: "1000000",
    periodSeconds: 172_800,
    payoutAddress: "",
    accessMode: "subscription",
    automationMode: "full",
    automationReady: false,
    confirmation: "confirmed",
    status: "active",
    createdAt: 10,
    referralEnabled: false,
    referralPercentBps: 0,
    ...patch,
  };
}

const owned = community({ id: 49, ownerUserId: "tg:7", name: "dabos private channal", payoutAddress: "EQC" });
const foreign = community({ id: 8, ownerUserId: "tg:99", name: "Other" });

test("an empty owner snapshot removes the saved community and keeps someone else's", () => {
  const next = replaceOwnedCommunities([owned, foreign], ["tg:7"], []);
  assert.deepEqual(next, [foreign]);
});

test("an owner snapshot replaces the saved card with the database row", () => {
  const incoming: OwnerCommunityInput = {
    communityId: 49,
    title: "Renamed",
    description: "Notes",
    priceUsdt: "2000000",
    durationDays: 3,
    ownerTelegramUserId: "7",
    paused: true,
    active: true,
    telegramChatId: "-100",
    hasPhoto: false,
    referralEnabled: true,
    referralPercentBps: 500,
  };
  const next = replaceOwnedCommunities([owned, foreign], ["local:1", "tg:7"], [incoming]);
  assert.equal(next?.length, 2);
  assert.equal(next?.[0]?.id, 8);
  const updated = next?.find((item) => item.id === 49);
  assert.equal(updated?.name, "Renamed");
  assert.equal(updated?.price, "2000000");
  assert.equal(updated?.periodSeconds, 3 * 24 * 60 * 60);
  assert.equal(updated?.status, "paused");
  assert.equal(updated?.payoutAddress, "EQC");
  assert.equal(updated?.telegramChatId, "-100");
  assert.equal(updated?.imageUrl, "");
  assert.equal(updated?.referralPercentBps, 500);
  assert.equal(replaceOwnedCommunities(next ?? [], ["tg:7"], [incoming]), null);
});

test("a row without a community id is not shown", () => {
  const draft: OwnerCommunityInput = {
    communityId: null,
    title: "Draft",
    description: null,
    priceUsdt: null,
    durationDays: null,
    ownerTelegramUserId: "7",
  };
  const next = replaceOwnedCommunities([owned], ["tg:7"], [draft]);
  assert.deepEqual(next, []);
});

test("a newer owner snapshot invalidates an older response", () => {
  const first = bumpOwnedSnapshotGeneration();
  const second = bumpOwnedSnapshotGeneration();
  assert.equal(ownedSnapshotGenerationIsCurrent(first), false);
  assert.equal(ownedSnapshotGenerationIsCurrent(second), true);
});
