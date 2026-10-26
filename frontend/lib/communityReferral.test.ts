import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { ChannelSnapshot } from "./channelPolicy.ts";
import {
  communityReferralNoticeKind,
  communityReferralNoticeText,
  creatorReferralLinkNoticeText,
  deliverCommunityReferralNotice,
  deliverReferralConversionNotice,
  referralConversionNoticeText,
} from "./communityReferralNotice.ts";
import { formatCommunityReferralPercent, parseCommunityReferralBps } from "./money.ts";
import { MemoryChannelRepository } from "./server/channelRepository.ts";
import { buildCommunityReferralAuthorizationCell } from "./ton/communityAuthorization.ts";
import {
  listReferralEnabledCommunities,
  updateCommunityPaused,
  updateCommunityReferralSettings,
  type ChannelDeps,
} from "./server/channelFlow.ts";
import {
  attributeCommunityReferral,
  createCommunityReferralLink,
  createMemoryCommunityReferralRepository,
  resolveCommunityReferrerPayout,
  type CommunityReferralRepository,
} from "./server/communityReferralFlow.ts";
import { signPayoutWalletProof } from "./server/walletProof.ts";
import { PAYOUT_PROOF_COMMUNITY, type PayoutWalletProof } from "./ton/walletProof.ts";

const token = "test-token";
const payout = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

function communityProof(userId: number, communityId: number, seed: number) {
  return signPayoutWalletProof({
    seed: Buffer.alloc(32, seed),
    purpose: PAYOUT_PROOF_COMMUNITY,
    communityId,
    telegramUserId: String(userId),
  });
}

const brokenProof: PayoutWalletProof = {
  signature: "aa",
  address: "not-a-wallet",
  timestamp: 1,
  domain: "passgram.app",
  schema: "nope",
  cell: "aa",
  walletStateInit: "aa",
};

function sign(userId: number, authDate = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = { auth_date: String(authDate), user: JSON.stringify({ id: userId }) };
  const dataCheck = Object.entries(fields)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

function channel(overrides?: Partial<ChannelSnapshot>): ChannelSnapshot {
  return {
    telegramChatId: "-1001",
    communityId: 7,
    ownerTelegramUserId: "42",
    title: "Alpha",
    description: null,
    photoFileId: null,
    telegramMemberCount: null,
    telegramMemberCountFetchedAt: null,
    botCanInviteUsers: true,
    botCanRestrictMembers: true,
    verificationStatus: "verified",
    verifiedAt: new Date().toISOString(),
    payoutAccount: payout,
    priceUsdt: "1500000",
    durationDays: 30,
    referrerCode: null,
    referrerTelegramUserId: null,
    referralEnabled: false,
    referralPercentBps: 0,
    active: true,
    paused: false,
    ...overrides,
  };
}

async function seedCommunityLink(
  repo: CommunityReferralRepository,
  communityId: number,
  referrerTelegramUserId: string,
  code: string,
  payoutAccount: string,
) {
  const recorded = await repo.recordReferralLink({ communityId, referrerTelegramUserId, code, payoutAccount });
  assert.equal(recorded, "inserted");
}

test("community referral percent accepts 0.01% through 50%", () => {
  assert.equal(parseCommunityReferralBps("0.01"), 1);
  assert.equal(parseCommunityReferralBps("10"), 1000);
  assert.equal(parseCommunityReferralBps("12.5%"), 1250);
  assert.equal(parseCommunityReferralBps("50"), 5000);
  assert.equal(parseCommunityReferralBps(""), null);
  assert.equal(parseCommunityReferralBps("0"), null);
  assert.equal(parseCommunityReferralBps("50.01"), null);
  assert.equal(formatCommunityReferralPercent(1), "0.01");
  assert.equal(formatCommunityReferralPercent(1250), "12.5");
});

test("stopping the referral program hides the community and keeps locked payouts", async () => {
  const repo = new MemoryChannelRepository();
  await repo.saveChannel(channel());
  const deps: ChannelDeps = {
    repo,
    telegram: {
      call: async () => {
        throw new Error("unused");
      },
    },
    botToken: token,
    botUserId: "1",
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const activated = await updateCommunityReferralSettings(deps, sign(42), {
    communityId: 7,
    enabled: true,
    percent: "12.5",
  });
  assert.equal(activated.ok, true);
  assert.equal((await repo.getChannelByCommunityId(7))?.referralEnabled, true);
  assert.equal((await repo.getChannelByCommunityId(7))?.referralPercentBps, 1250);
  assert.equal((await listReferralEnabledCommunities(deps)).communities.length, 1);

  const attributions = createMemoryCommunityReferralRepository();
  await seedCommunityLink(attributions, 7, "9", "mira", payout);
  const locked = await attributeCommunityReferral(deps, attributions, sign(11), 7, "mira");
  assert.equal(locked.ok, true);

  const stopped = await updateCommunityReferralSettings(deps, sign(42), {
    communityId: 7,
    enabled: false,
    percent: "",
  });
  assert.equal(stopped.ok, true);
  const saved = await repo.getChannelByCommunityId(7);
  assert.equal(saved?.referralEnabled, false);
  assert.equal(saved?.referralPercentBps, 1250);
  assert.equal((await listReferralEnabledCommunities(deps)).communities.length, 0);

  const link = await createCommunityReferralLink(deps, sign(9), 7, communityProof(9, 7, 9));
  assert.equal(link.ok, false);
  const again = await attributeCommunityReferral(deps, attributions, sign(12), 7, "mira");
  assert.equal(again.ok, false);

  const payoutResult = await resolveCommunityReferrerPayout(deps, attributions, sign(11), 7);
  assert.equal(payoutResult.communityReferrerPayout, payout);
  assert.equal(payoutResult.referralPercentBps, 1250);
  const stranger = await resolveCommunityReferrerPayout(deps, attributions, sign(12), 7);
  assert.equal(stranger.communityReferrerPayout, null);
  assert.equal(stranger.referralPercentBps, 0);

  await repo.saveChannel({ ...(await repo.getChannelByCommunityId(7))!, referralEnabled: false, referralPercentBps: 0 });
  const stillPaid = await resolveCommunityReferrerPayout(deps, attributions, sign(11), 7);
  assert.equal(stillPaid.communityReferrerPayout, payout);
  assert.equal(stillPaid.referralPercentBps, 1250);
});

test("a referral rate edit keeps registered subscribers on the old rate", async () => {
  const repo = new MemoryChannelRepository();
  await repo.saveChannel(channel({ referralEnabled: true, referralPercentBps: 1000 }));
  const deps: ChannelDeps = {
    repo,
    botToken: token,
    botUserId: "1",
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const attributions = createMemoryCommunityReferralRepository();
  await seedCommunityLink(attributions, 7, "9", "mira", payout);
  const first = await attributeCommunityReferral(deps, attributions, sign(11), 7, "mira");
  assert.equal(first.result, "locked");

  const edited = await updateCommunityReferralSettings(deps, sign(42), {
    communityId: 7,
    enabled: true,
    percent: "20",
  });
  assert.equal(edited.ok, true);
  assert.equal((await repo.getChannelByCommunityId(7))?.referralPercentBps, 2000);

  const oldPayout = await resolveCommunityReferrerPayout(deps, attributions, sign(11), 7);
  assert.equal(oldPayout.communityReferrerPayout, payout);
  assert.equal(oldPayout.referralPercentBps, 1000);

  const second = await attributeCommunityReferral(deps, attributions, sign(13), 7, "mira");
  assert.equal(second.result, "locked");
  const newPayout = await resolveCommunityReferrerPayout(deps, attributions, sign(13), 7);
  assert.equal(newPayout.referralPercentBps, 2000);
});

test("deactivating a community closes payments and new referrals, then reactivation restores the same settings", async () => {
  const repo = new MemoryChannelRepository();
  await repo.saveChannel(channel({ referralEnabled: true, referralPercentBps: 1000 }));
  const deps: ChannelDeps = {
    repo,
    botToken: token,
    botUserId: "1",
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const attributions = createMemoryCommunityReferralRepository();
  await seedCommunityLink(attributions, 7, "9", "mira", payout);
  assert.equal((await attributeCommunityReferral(deps, attributions, sign(11), 7, "mira")).result, "locked");

  const paused = await updateCommunityPaused(deps, sign(42), { communityId: 7, paused: true });
  assert.equal(paused.ok, true);
  const saved = await repo.getChannelByCommunityId(7);
  assert.equal(saved?.paused, true);
  assert.equal(saved?.active, true);
  assert.equal(saved?.referralEnabled, true);
  assert.equal(saved?.referralPercentBps, 1000);
  assert.equal(saved?.priceUsdt, "1500000");
  assert.equal((await listReferralEnabledCommunities(deps)).communities.length, 0);
  assert.equal((await createCommunityReferralLink(deps, sign(9), 7, communityProof(9, 7, 9))).ok, false);
  assert.equal((await attributeCommunityReferral(deps, attributions, sign(12), 7, "mira")).ok, false);
  const whilePaused = await resolveCommunityReferrerPayout(deps, attributions, sign(11), 7);
  assert.equal(whilePaused.communityReferrerPayout, null);

  const resumed = await updateCommunityPaused(deps, sign(42), { communityId: 7, paused: false });
  assert.equal(resumed.ok, true);
  const restored = await repo.getChannelByCommunityId(7);
  assert.equal(restored?.paused, false);
  assert.equal(restored?.referralEnabled, true);
  assert.equal(restored?.referralPercentBps, 1000);
  assert.equal(restored?.priceUsdt, "1500000");
  assert.equal(restored?.durationDays, 30);
  assert.equal((await listReferralEnabledCommunities(deps)).communities.length, 1);
  const after = await resolveCommunityReferrerPayout(deps, attributions, sign(11), 7);
  assert.equal(after.communityReferrerPayout, payout);
  assert.equal(after.referralPercentBps, 1000);
});

test("referral program changes notify current subscribers and skip the owner", async () => {
  assert.equal(communityReferralNoticeKind({ referralEnabled: false, referralPercentBps: 0 }, { referralEnabled: true, referralPercentBps: 1000 }), "activated");
  assert.equal(communityReferralNoticeKind({ referralEnabled: true, referralPercentBps: 1000 }, { referralEnabled: true, referralPercentBps: 2000 }), "updated");
  assert.equal(communityReferralNoticeKind({ referralEnabled: true, referralPercentBps: 1000 }, { referralEnabled: false, referralPercentBps: 1000 }), "stopped");
  assert.match(communityReferralNoticeText({ kind: "activated", title: "Alpha", percentLabel: "10" }), /10%/);
  assert.match(communityReferralNoticeText({ kind: "stopped", title: "Alpha", percentLabel: "10" }), /stopped its referral program/);

  const sent: string[] = [];
  const delivered = await deliverCommunityReferralNotice({
    telegram: {
      call: async (_method, body) => {
        if (body?.chat_id === 13) throw new Error("blocked");
        sent.push(String(body?.chat_id));
      },
    },
    subscriberIds: ["11", "42", "13", "0"],
    ownerTelegramUserId: "42",
    text: "notice",
    url: "https://t.me/PassGramBot/passgram?startapp=c_7",
  });
  assert.deepEqual(delivered, ["11"]);
  assert.deepEqual(sent, ["11"]);

  const repo = new MemoryChannelRepository();
  await repo.saveChannel(channel());
  const messages: string[] = [];
  const deps: ChannelDeps = {
    repo,
    telegram: {
      call: async (_method, body) => {
        messages.push(String(body?.text));
      },
    },
    botToken: token,
    botUserId: "1",
    now: () => Date.now(),
    accountStatus: async () => "exists",
    listCurrentSubscriberIds: async () => ["11", "42"],
  };
  const activated = await updateCommunityReferralSettings(deps, sign(42), { communityId: 7, enabled: true, percent: "10" });
  assert.equal(activated.ok, true);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /started a referral program/);
  assert.match(messages[0], /10%/);
  assert.match(messages[1], /turned on referrals/);
  assert.match(messages[1], /creator's share/);
});

test("the community creator is notified once when a marketer creates a referral link", async () => {
  assert.match(creatorReferralLinkNoticeText({ title: "Alpha", percentLabel: "10", code: "mira" }), /mira/);
  const repo = new MemoryChannelRepository();
  await repo.saveChannel(channel({ referralEnabled: true, referralPercentBps: 1000 }));
  const messages: string[] = [];
  const deps: ChannelDeps = {
    repo,
    telegram: {
      call: async (_method, body) => {
        messages.push(String(body?.chat_id));
        messages.push(String(body?.text));
      },
    },
    botToken: token,
    botUserId: "1",
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const communityRepo = createMemoryCommunityReferralRepository();
  const firstProof = communityProof(9, 7, 9);
  const secondProof = communityProof(9, 7, 10);
  const first = await createCommunityReferralLink(deps, sign(9), 7, firstProof, communityRepo);
  assert.equal(first.ok, true);
  assert.equal(first.payoutAccount, firstProof.address);
  const second = await createCommunityReferralLink(deps, sign(9), 7, secondProof, communityRepo);
  assert.equal(second.ok, true);
  assert.equal(second.link, first.link);
  assert.equal(second.payoutAccount, firstProof.address);
  assert.match(second.message, /first confirmed/);
  assert.deepEqual(messages, ["42", messages[1]]);
  assert.match(messages[1], /created a link for/);
  assert.match(messages[1], /Alpha/);
  assert.match(messages[1], /10%/);
});

test("each community referral link keeps its own payout and ignores a PassGram affiliate", async () => {
  const repo = new MemoryChannelRepository();
  await repo.saveChannel(channel({ referralEnabled: true, referralPercentBps: 1000 }));
  await repo.saveChannel(
    channel({
      telegramChatId: "-1002",
      communityId: 8,
      title: "Beta",
      referralEnabled: true,
      referralPercentBps: 2000,
    }),
  );
  const deps: ChannelDeps = {
    repo,
    telegram: { call: async () => ({}) },
    botToken: token,
    botUserId: "1",
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const links = createMemoryCommunityReferralRepository();
  const firstProof = communityProof(9, 7, 11);
  const secondProof = communityProof(9, 8, 12);
  const first = await createCommunityReferralLink(deps, sign(9), 7, firstProof, links);
  const second = await createCommunityReferralLink(deps, sign(9), 8, secondProof, links);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.code, second.code);
  assert.equal((await attributeCommunityReferral(deps, links, sign(11), 7, first.code!)).result, "locked");
  assert.equal((await attributeCommunityReferral(deps, links, sign(11), 8, second.code!)).result, "locked");
  const payFirst = await resolveCommunityReferrerPayout(deps, links, sign(11), 7);
  const paySecond = await resolveCommunityReferrerPayout(deps, links, sign(11), 8);
  assert.equal(payFirst.communityReferrerPayout, firstProof.address);
  assert.equal(paySecond.communityReferrerPayout, secondProof.address);
  const repeat = await createCommunityReferralLink(deps, sign(9), 7, brokenProof, links);
  assert.equal(repeat.ok, true);
  assert.equal(repeat.payoutAccount, firstProof.address);
  const missing = await createCommunityReferralLink(deps, sign(15), 7, brokenProof, links);
  assert.equal(missing.ok, false);
});

test("a converted referral messages the referrer for either program and skips the actor", async () => {
  assert.match(referralConversionNoticeText({ program: "community", title: "Alpha Signals", actorName: "Lina Nasser", percentLabel: "10" }), /Referral earned/);
  assert.match(referralConversionNoticeText({ program: "community", title: "Alpha Signals", actorName: "Lina Nasser", percentLabel: "10" }), /creator's share/);
  assert.match(referralConversionNoticeText({ program: "passgram", title: "Builder Lounge", actorName: "" }), /New community/);
  const sent: string[] = [];
  const delivered = await deliverReferralConversionNotice({
    telegram: {
      call: async (_method, body) => {
        sent.push(String(body?.chat_id));
      },
    },
    recipientId: "9",
    actorId: "12",
    text: "created",
    url: "https://t.me/PassGramBot/passgram?startapp=c_7",
  });
  const self = await deliverReferralConversionNotice({
    telegram: {
      call: async () => {
        sent.push("self");
      },
    },
    recipientId: "12",
    actorId: "12",
    text: "created",
    url: "https://t.me/PassGramBot/passgram?startapp=c_7",
  });
  assert.equal(delivered, true);
  assert.equal(self, false);
  assert.deepEqual(sent, ["9"]);
});

test("settlement signs the stored community payout for the paying wallet", async () => {
  const previousSecret = process.env.PASSGRAM_OWNER_SECRET;
  const previousRegistry = process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY;
  const seed = Buffer.alloc(32, 9);
  const registry = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
  const subscriber = "0:3333333333333333333333333333333333333333333333333333333333333333";
  process.env.PASSGRAM_OWNER_SECRET = seed.toString("hex");
  process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY = registry;
  try {
    const repo = new MemoryChannelRepository();
    await repo.saveChannel(channel({ referralEnabled: true, referralPercentBps: 1000 }));
    const deps: ChannelDeps = {
      repo,
      telegram: { call: async () => ({}) },
      botToken: token,
      botUserId: "1",
      now: () => Date.now(),
      accountStatus: async () => "exists",
    };
    const links = createMemoryCommunityReferralRepository();
    const createdProof = communityProof(9, 7, 13);
    const created = await createCommunityReferralLink(deps, sign(9), 7, createdProof, links);
    assert.equal((await attributeCommunityReferral(deps, links, sign(11), 7, created.code!)).result, "locked");
    const settled = await resolveCommunityReferrerPayout(deps, links, sign(11), 7, subscriber);
    assert.equal(settled.ok, true);
    assert.equal(settled.communityReferrerPayout, createdProof.address);
    const expectedExpiry = Math.floor(Date.now() / 1000) + 600;
    assert.ok(Math.abs((settled.referralAuthorizationValidUntil ?? 0) - expectedExpiry) < 5);
    const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    const publicKey = crypto.createPublicKey(
      crypto.createPrivateKey({ key: Buffer.concat([prefix, seed]), format: "der", type: "pkcs8" }),
    );
    const cell = buildCommunityReferralAuthorizationCell({
      registry,
      communityId: 7,
      subscriber,
      payout: createdProof.address,
      validUntil: settled.referralAuthorizationValidUntil!,
    });
    const signature = Buffer.from(settled.referralAuthorization || "", "base64");
    assert.equal(signature.length, 64);
    assert.equal(crypto.verify(null, cell.hash(), publicKey, signature), true);
    const swapped = buildCommunityReferralAuthorizationCell({
      registry,
      communityId: 7,
      subscriber,
      payout: registry,
      validUntil: settled.referralAuthorizationValidUntil!,
    });
    assert.equal(crypto.verify(null, swapped.hash(), publicKey, signature), false);
  } finally {
    if (previousSecret === undefined) delete process.env.PASSGRAM_OWNER_SECRET;
    else process.env.PASSGRAM_OWNER_SECRET = previousSecret;
    if (previousRegistry === undefined) delete process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY;
    else process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY = previousRegistry;
  }
});
