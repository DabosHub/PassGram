import type { AdminData, CommunityDetail, CommunityRow, PaymentRow } from "./adminRepository";
import { chartWindow, fillMonthSeries, fillTreasurySeries, type AdminPeriod, type AdminQuery } from "./adminView";

const ALPHA = 9001;
const NIGHT = 9002;
const DRAFT = 9003;
const HASH_A = "aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900";
const HASH_B = "bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff667788990011aa";
const PAYOUT = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

/** Sample ledger for the localhost UI Lab. It never reads the database. */
export function buildAdminPreview(query: AdminQuery, now: number): AdminData {
  const factor = periodFactor(query.period);
  if (query.section === "overview") return { section: "overview", overview: overview(query.period, factor, now) };
  if (query.section === "communities") {
    if (query.communityId && query.communityId !== ALPHA) {
      return { section: "communities", communities: [], truncated: false, detail: null, missingDetail: true };
    }
    if (query.communityId === ALPHA) {
      return { section: "communities", communities: [], truncated: false, detail: detail(factor, now), missingDetail: false };
    }
    return { section: "communities", communities: communities(factor), truncated: false, detail: null, missingDetail: false };
  }
  if (query.section === "payments") return { section: "payments", ...payments(query, factor, now) };
  if (query.section === "referrals") return { section: "referrals", ...referrals(factor) };
  return { section: "operations", operations: operations(now) };
}

function periodFactor(period: AdminPeriod): bigint {
  if (period === "24h") return 1n;
  if (period === "7d") return 4n;
  if (period === "30d") return 12n;
  return 28n;
}

function overview(period: AdminPeriod, factor: bigint, now: number) {
  const gross = 15_500_000n * factor;
  const treasury = 387_500n * factor;
  const window = chartWindow(period, now);
  const slots = fillTreasurySeries(window.fromMs, now, window.bucketMs, []);
  return {
    gross,
    paymentCount: Number(8n * factor),
    treasury,
    creator: 14_725_000n * factor,
    platformAffiliate: 77_500n * factor,
    communityAffiliate: 310_000n * factor,
    activeSubscribers: 18,
    listed: 1,
    paused: 1,
    unverified: 1,
    series: slots.map((point, index) => ({
      startMs: point.startMs,
      treasury: BigInt((index % 5) + 1) * 40_000n * factor,
    })),
    paymentsWithoutMembership: 2,
    expiredNotRemoved: 1,
    indexer: {
      hasCursor: true,
      position: "48219334",
      backlog: false,
      updatedAtMs: now - 2 * 60 * 1000,
    },
    mmr: fillMonthSeries(now, []).map((point, index) => ({
      ...point,
      treasury: BigInt(index + 2) * 140_000n,
    })),
  };
}

function communities(factor: bigint): CommunityRow[] {
  return [
    row({
      communityId: ALPHA,
      title: "Alpha Signals",
      price: "1500000",
      durationDays: 30,
      referralEnabled: true,
      referralBps: 1000,
      active: true,
      paused: false,
      verificationStatus: "verified",
      memberCount: 240,
      paidSubscribers: 18,
      paymentCount: Number(6n * factor),
      gross: 12_000_000n * factor,
      treasury: 300_000n * factor,
    }),
    row({
      communityId: NIGHT,
      title: "Night Desk",
      price: "5000000",
      durationDays: 30,
      referralEnabled: false,
      referralBps: 0,
      active: true,
      paused: true,
      verificationStatus: "verified",
      memberCount: 86,
      paidSubscribers: 4,
      paymentCount: Number(2n * factor),
      gross: 3_500_000n * factor,
      treasury: 87_500n * factor,
    }),
    row({
      communityId: DRAFT,
      title: "Draft Room",
      price: null,
      durationDays: null,
      referralEnabled: false,
      referralBps: 0,
      active: false,
      paused: false,
      verificationStatus: "verification_pending",
      memberCount: null,
      paidSubscribers: 0,
      paymentCount: 0,
      gross: 0n,
      treasury: 0n,
    }),
  ];
}

function detail(factor: bigint, now: number): CommunityDetail {
  const base = communities(factor)[0];
  return {
    ...base,
    description: "Daily market notes for members who already paid.",
    payoutAccount: PAYOUT,
    canInvite: true,
    canRestrict: true,
    payments: paymentRows(factor, now).filter((item) => item.communityId === ALPHA),
    memberships: [
      { telegramUserId: "900010", name: "Nora Hale", username: "norahale", expiresAtMs: now + 12 * 86_400_000, removedForExpiresAtMs: null },
      { telegramUserId: "900011", name: "Owen Park", username: "owen", expiresAtMs: now - 86_400_000, removedForExpiresAtMs: null },
      { telegramUserId: "900012", name: "Mina Cole", username: "", expiresAtMs: now - 3 * 86_400_000, removedForExpiresAtMs: now - 3 * 86_400_000 },
    ],
    links: [{ code: "alpha10", telegramUserId: "900020", payoutAccount: PAYOUT }],
    attributions: [
      {
        subscriberTelegramUserId: "900010",
        subscriberName: "Nora Hale",
        subscriberUsername: "norahale",
        referrerTelegramUserId: "900020",
        referrerName: "Lina West",
        code: "alpha10",
        bps: 1000,
        lockedAtMs: now - 5 * 86_400_000,
      },
    ],
  };
}

function payments(query: AdminQuery, factor: bigint, now: number) {
  const known = query.communityId === ALPHA || query.communityId === NIGHT || query.communityId === DRAFT;
  if (query.communityId && !known) {
    return { rows: [], hasMore: false, filterTitle: null, missingFilter: true };
  }
  const all = paymentRows(factor, now).filter((row) => !query.communityId || row.communityId === query.communityId);
  const page = query.page;
  return {
    rows: page === 1 ? all : all.slice(0, 1),
    hasMore: page === 1 && all.length > 1,
    filterTitle: query.communityId === ALPHA ? "Alpha Signals" : query.communityId === NIGHT ? "Night Desk" : query.communityId === DRAFT ? "Draft Room" : null,
    missingFilter: false,
  };
}

function paymentRows(factor: bigint, now: number): PaymentRow[] {
  return [
    pay(now - 3_600_000, ALPHA, "Alpha Signals", 1_500_000n * factor, HASH_A, 30_000n * factor),
    pay(now - 26 * 3_600_000, NIGHT, "Night Desk", 5_000_000n * factor, HASH_B, null),
    pay(now - 50 * 3_600_000, ALPHA, "Alpha Signals", 1_500_000n * factor, HASH_A.replaceAll("a", "c"), 0n),
  ];
}

function pay(
  paidAtMs: number,
  communityId: number,
  title: string,
  gross: bigint,
  txHash: string,
  communityAffiliate: bigint | null,
): PaymentRow {
  const treasury = (gross * 250n) / 10_000n;
  const platformAffiliate = (gross * 50n) / 10_000n;
  return {
    paidAtMs,
    communityId,
    title,
    gross,
    creator: gross - treasury - platformAffiliate,
    treasury,
    platformAffiliate,
    communityAffiliate,
    txHash,
  };
}

function referrals(factor: bigint) {
  return {
    platform: [
      {
        code: "ada42",
        telegramUserId: "900030",
        payoutAccount: PAYOUT,
        attributed: 6,
        paymentCount: Number(3n * factor),
        paid: 77_500n * factor,
      },
    ],
    unassigned: { paymentCount: 1, paid: 25_000n * factor },
    community: [
      {
        communityId: ALPHA,
        title: "Alpha Signals",
        code: "alpha10",
        telegramUserId: "900020",
        payoutAccount: PAYOUT,
        attributed: 4,
        recorded: Number(factor),
        paid: 310_000n * factor,
      },
      {
        communityId: NIGHT,
        title: "Night Desk",
        code: "night",
        telegramUserId: "900021",
        payoutAccount: null,
        attributed: 2,
        recorded: 0,
        paid: 0n,
      },
    ],
  };
}

function operations(now: number) {
  return {
    indexer: {
      hasCursor: true,
      position: "48219334",
      backlog: false,
      updatedAtMs: now - 2 * 60 * 1000,
    },
    wallets: 36,
    profiles: 41,
    paymentsWithoutMembership: 2,
    openPayments: [
      { paidAtMs: now - 5 * 3_600_000, communityId: ALPHA, title: "Alpha Signals", gross: 1_500_000n, txHash: HASH_B },
    ],
    expiredNotRemoved: 1,
    openRemovals: [
      {
        communityId: ALPHA,
        title: "Alpha Signals",
        telegramUserId: "900011",
        name: "Owen Park",
        username: "owen",
        expiresAtMs: now - 86_400_000,
      },
    ],
    botGaps: [{ communityId: NIGHT, title: "Night Desk", canInvite: true, canRestrict: false }],
    stuckSelections: [
      {
        requestId: 18,
        ownerTelegramUserId: "900001",
        status: "verification_pending",
        createdAtMs: now - 40 * 60 * 1000,
      },
    ],
  };
}

function row(overrides: Partial<CommunityRow> & Pick<CommunityRow, "communityId" | "title">): CommunityRow {
  return {
    ownerTelegramUserId: "900001",
    price: "1500000",
    durationDays: 30,
    referralEnabled: false,
    referralBps: 0,
    active: false,
    paused: false,
    verificationStatus: "verified",
    memberCount: null,
    paidSubscribers: 0,
    paymentCount: 0,
    gross: 0n,
    treasury: 0n,
    ...overrides,
  };
}
