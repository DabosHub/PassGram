import { formatCommunityReferralLink } from "../domain";
import { normalizeCode } from "../money";
import type { ChannelDeps } from "./channelFlow";
import { validateInitData } from "./initData";
import type { ReferralDeps } from "./referralFlow";

export type CommunityAttributionRecord = {
  communityId: number;
  subscriberTelegramUserId: string;
  referrerCode: string;
  referrerTelegramUserId: string;
  lockedAt: string;
};

export type CommunityReferralRepository = {
  getAttribution: (communityId: number, subscriberTelegramUserId: string) => Promise<CommunityAttributionRecord | null>;
  insertAttribution: (row: CommunityAttributionRecord) => Promise<"inserted" | "exists">;
};

const memoryAttributions = new Map<string, CommunityAttributionRecord>();

function memoryKey(communityId: number, subscriber: string): string {
  return `${communityId}:${subscriber}`;
}

export const memoryCommunityReferralRepository: CommunityReferralRepository = {
  async getAttribution(communityId, subscriberTelegramUserId) {
    return memoryAttributions.get(memoryKey(communityId, subscriberTelegramUserId)) ?? null;
  },
  async insertAttribution(row) {
    const key = memoryKey(row.communityId, row.subscriberTelegramUserId);
    if (memoryAttributions.has(key)) return "exists";
    memoryAttributions.set(key, row);
    return "inserted";
  },
};

let postgresPromise: Promise<CommunityReferralRepository> | null = null;

export function getCommunityReferralRepository(): Promise<CommunityReferralRepository> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return Promise.resolve(memoryCommunityReferralRepository);
  postgresPromise ??= postgresCommunityReferralRepository(databaseUrl);
  return postgresPromise;
}

async function postgresCommunityReferralRepository(databaseUrl: string): Promise<CommunityReferralRepository> {
  const loaded = (await import("pg").catch(() => null)) as {
    Pool: new (config: { connectionString: string }) => {
      query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    };
  } | null;
  if (!loaded) return memoryCommunityReferralRepository;
  const pool = new loaded.Pool({ connectionString: databaseUrl });
  return {
    async getAttribution(communityId, subscriberTelegramUserId) {
      const result = await pool.query(
        `select * from community_attributions
         where community_id = $1 and subscriber_telegram_user_id = $2`,
        [communityId, subscriberTelegramUserId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        communityId: Number(row.community_id),
        subscriberTelegramUserId: String(row.subscriber_telegram_user_id),
        referrerCode: String(row.referrer_code),
        referrerTelegramUserId: String(row.referrer_telegram_user_id),
        lockedAt: new Date(String(row.locked_at)).toISOString(),
      };
    },
    async insertAttribution(row) {
      try {
        await pool.query(
          `insert into community_attributions (
            community_id, subscriber_telegram_user_id, referrer_code, referrer_telegram_user_id, locked_at
          ) values ($1,$2,$3,$4,$5)`,
          [row.communityId, row.subscriberTelegramUserId, row.referrerCode, row.referrerTelegramUserId, row.lockedAt],
        );
        return "inserted";
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        if (code === "23505") return "exists";
        throw error;
      }
    },
  };
}

export async function createCommunityReferralLink(
  channelDeps: ChannelDeps,
  referralDeps: ReferralDeps,
  initData: string,
  communityId: number,
): Promise<{ ok: boolean; message: string; link?: string; code?: string }> {
  const identity = validateInitData(initData, channelDeps.botToken, channelDeps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const community = await channelDeps.repo.getChannelByCommunityId(communityId);
  if (!community?.active || !community.referralEnabled || community.referralPercentBps <= 0) {
    return { ok: false, message: "This community does not have referrals enabled." };
  }
  if (community.ownerTelegramUserId === String(identity.userId)) {
    return { ok: false, message: "You cannot create a referral link for your own community." };
  }
  const affiliate = await referralDeps.repo.getAffiliateByTelegramUserId(String(identity.userId));
  if (!affiliate) {
    return { ok: false, message: "Register a PassGram referral payout address first, then create community links." };
  }
  const origin = process.env.PASSGRAM_PUBLIC_URL || null;
  const link = formatCommunityReferralLink(communityId, affiliate.code, origin);
  return { ok: true, message: "Community referral link ready.", link, code: affiliate.code };
}

/**
 * For payment settlement: return the community promoter's TON payout address
 * for the current subscriber (if first-touch community attribution exists).
 */
export async function resolveCommunityReferrerPayout(
  channelDeps: ChannelDeps,
  referralDeps: ReferralDeps,
  communityRepo: CommunityReferralRepository,
  initData: string,
  communityId: number,
): Promise<{ ok: boolean; message: string; communityReferrerPayout?: string | null; referralPercentBps?: number }> {
  const identity = validateInitData(initData, channelDeps.botToken, channelDeps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const community = await channelDeps.repo.getChannelByCommunityId(communityId);
  if (!community?.active) return { ok: false, message: "This community is unavailable." };
  if (!community.referralEnabled || community.referralPercentBps <= 0) {
    return { ok: true, message: "No community referral on this community.", communityReferrerPayout: null, referralPercentBps: 0 };
  }
  const attribution = await communityRepo.getAttribution(communityId, String(identity.userId));
  if (!attribution) {
    return {
      ok: true,
      message: "No community referral attribution.",
      communityReferrerPayout: null,
      referralPercentBps: community.referralPercentBps,
    };
  }
  const affiliate = await referralDeps.repo.getAffiliateByCode(attribution.referrerCode);
  if (!affiliate?.payoutAccount) {
    return { ok: true, message: "Community referrer has no payout address.", communityReferrerPayout: null, referralPercentBps: community.referralPercentBps };
  }
  if (affiliate.telegramUserId === community.ownerTelegramUserId) {
    return { ok: true, message: "Owner cannot be community referrer.", communityReferrerPayout: null, referralPercentBps: community.referralPercentBps };
  }
  return {
    ok: true,
    message: "Community referrer ready for on-chain split.",
    communityReferrerPayout: affiliate.payoutAccount,
    referralPercentBps: community.referralPercentBps,
  };
}

export async function attributeCommunityReferral(
  channelDeps: ChannelDeps,
  referralDeps: ReferralDeps,
  communityRepo: CommunityReferralRepository,
  initData: string,
  communityId: number,
  codeRaw: string,
): Promise<{ ok: boolean; message: string; result?: string }> {
  const identity = validateInitData(initData, channelDeps.botToken, channelDeps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const code = normalizeCode(codeRaw);
  if (!code || !Number.isSafeInteger(communityId) || communityId < 1) {
    return { ok: false, message: "This community referral link is invalid." };
  }
  const community = await channelDeps.repo.getChannelByCommunityId(communityId);
  if (!community?.active || !community.referralEnabled) {
    return { ok: false, message: "This community does not accept referrals." };
  }
  if (community.ownerTelegramUserId === String(identity.userId)) {
    return { ok: false, message: "You cannot use a referral link for your own community." };
  }
  const existing = await communityRepo.getAttribution(communityId, String(identity.userId));
  if (existing) {
    return { ok: true, message: "Community referral already locked.", result: "already_locked" };
  }
  const affiliate = await referralDeps.repo.getAffiliateByCode(code);
  if (!affiliate) return { ok: false, message: "This community referral code is unknown." };
  if (affiliate.telegramUserId === String(identity.userId)) {
    return { ok: false, message: "You cannot attribute a community referral to yourself." };
  }
  if (affiliate.telegramUserId === community.ownerTelegramUserId) {
    return { ok: false, message: "This referral code belongs to the community owner." };
  }
  const inserted = await communityRepo.insertAttribution({
    communityId,
    subscriberTelegramUserId: String(identity.userId),
    referrerCode: affiliate.code,
    referrerTelegramUserId: affiliate.telegramUserId,
    lockedAt: new Date(channelDeps.now()).toISOString(),
  });
  return {
    ok: true,
    message: inserted === "inserted" ? "Community referral locked." : "Community referral already locked.",
    result: inserted === "inserted" ? "locked" : "already_locked",
  };
}
