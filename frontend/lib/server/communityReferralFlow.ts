import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { databaseSsl } from "./databaseSsl";
import { creatorReferralLinkNoticeText, communityReferralNoticeUrl } from "../communityReferralNotice";
import { formatCommunityReferralLink } from "../domain";
import { formatCommunityReferralPercent, normalizeCode } from "../money";
import { COMMUNITY_REFERRAL_AUTHORIZATION_TTL_SECONDS } from "../ton/communityAuthorization";
import { normalizeTonAddress } from "../ton/config";
import { PAYOUT_PROOF_COMMUNITY, type PayoutWalletProof } from "../ton/walletProof";
import { verifyPayoutWalletProof } from "./walletProof";
import type { ChannelDeps } from "./channelFlow";
import { signCommunityReferralAuthorization } from "./communityAuthorization";
import { requireCurrentRegistry } from "./registryCode";
import { validateInitData } from "./initData";

export type CommunityAttributionRecord = {
  communityId: number;
  subscriberTelegramUserId: string;
  referrerCode: string;
  referrerTelegramUserId: string;
  lockedAt: string;
  /** Rate in basis points captured when this subscriber was registered. Later community edits do not change it. */
  referralPercentBps: number;
};

export type CommunityReferralLinkRecord = {
  communityId: number;
  referrerTelegramUserId: string;
  code: string;
  /** Address paid for this community only. Empty when an older row has no address. */
  payoutAccount: string;
};

export type CommunityReferralRepository = {
  getAttribution: (communityId: number, subscriberTelegramUserId: string) => Promise<CommunityAttributionRecord | null>;
  insertAttribution: (row: CommunityAttributionRecord) => Promise<"inserted" | "exists">;
  getReferralLinkByUser: (communityId: number, referrerTelegramUserId: string) => Promise<CommunityReferralLinkRecord | null>;
  getReferralLinkByCode: (communityId: number, code: string) => Promise<CommunityReferralLinkRecord | null>;
  recordReferralLink: (row: CommunityReferralLinkRecord) => Promise<"inserted" | "exists" | "code_taken">;
};

type LinkResult = {
  ok: boolean;
  message: string;
  link?: string;
  code?: string;
  payoutAccount?: string;
};

export function createMemoryCommunityReferralRepository(): CommunityReferralRepository {
  const attributions = new Map<string, CommunityAttributionRecord>();
  const byUser = new Map<string, CommunityReferralLinkRecord>();
  const byCode = new Map<string, CommunityReferralLinkRecord>();
  return {
    async getAttribution(communityId, subscriberTelegramUserId) {
      return attributions.get(`${communityId}:${subscriberTelegramUserId}`) ?? null;
    },
    async insertAttribution(row) {
      const key = `${row.communityId}:${row.subscriberTelegramUserId}`;
      if (attributions.has(key)) return "exists";
      attributions.set(key, row);
      return "inserted";
    },
    async getReferralLinkByUser(communityId, referrerTelegramUserId) {
      return byUser.get(`${communityId}:${referrerTelegramUserId}`) ?? null;
    },
    async getReferralLinkByCode(communityId, code) {
      return byCode.get(`${communityId}:${code}`) ?? null;
    },
    async recordReferralLink(row) {
      const userKey = `${row.communityId}:${row.referrerTelegramUserId}`;
      if (byUser.has(userKey)) return "exists";
      const codeKey = `${row.communityId}:${row.code}`;
      if (byCode.has(codeKey)) return "code_taken";
      byUser.set(userKey, row);
      byCode.set(codeKey, row);
      return "inserted";
    },
  };
}

export const memoryCommunityReferralRepository = createMemoryCommunityReferralRepository();

let postgresPromise: Promise<CommunityReferralRepository> | null = null;

export function getCommunityReferralRepository(): Promise<CommunityReferralRepository> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return Promise.resolve(memoryCommunityReferralRepository);
  postgresPromise ??= postgresCommunityReferralRepository(databaseUrl);
  return postgresPromise;
}

function linkFromRow(row: Record<string, unknown>): CommunityReferralLinkRecord {
  return {
    communityId: Number(row.community_id),
    referrerTelegramUserId: String(row.referrer_telegram_user_id),
    code: String(row.referrer_code),
    payoutAccount: row.payout_account == null ? "" : String(row.payout_account),
  };
}

async function postgresCommunityReferralRepository(databaseUrl: string): Promise<CommunityReferralRepository> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseSsl(databaseUrl) });
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
        referralPercentBps: Number(row.referral_percent_bps ?? 0),
      };
    },
    async insertAttribution(row) {
      try {
        await pool.query(
          `insert into community_attributions (
            community_id, subscriber_telegram_user_id, referrer_code, referrer_telegram_user_id, locked_at, referral_percent_bps
          ) values ($1,$2,$3,$4,$5,$6)`,
          [
            row.communityId,
            row.subscriberTelegramUserId,
            row.referrerCode,
            row.referrerTelegramUserId,
            row.lockedAt,
            row.referralPercentBps,
          ],
        );
        return "inserted";
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        if (code === "23505") return "exists";
        throw error;
      }
    },
    async getReferralLinkByUser(communityId, referrerTelegramUserId) {
      const result = await pool.query(
        `select * from community_referral_links
         where community_id = $1 and referrer_telegram_user_id = $2`,
        [communityId, referrerTelegramUserId],
      );
      return result.rows[0] ? linkFromRow(result.rows[0]) : null;
    },
    async getReferralLinkByCode(communityId, code) {
      const result = await pool.query(
        `select * from community_referral_links
         where community_id = $1 and referrer_code = $2`,
        [communityId, code],
      );
      return result.rows[0] ? linkFromRow(result.rows[0]) : null;
    },
    async recordReferralLink(row) {
      try {
        await pool.query(
          `insert into telegram_profiles (telegram_user_id) values ($1)
           on conflict (telegram_user_id) do nothing`,
          [row.referrerTelegramUserId],
        );
        const result = await pool.query(
          `insert into community_referral_links (
            community_id, referrer_telegram_user_id, referrer_code, payout_account
          ) values ($1, $2, $3, $4)
          on conflict (community_id, referrer_telegram_user_id) do nothing
          returning community_id`,
          [row.communityId, row.referrerTelegramUserId, row.code, row.payoutAccount],
        );
        return result.rows[0] ? "inserted" : "exists";
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
        if (code === "23505") return "code_taken";
        throw error;
      }
    },
  };
}

function newCommunityReferralCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(10);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

function existingLinkResult(communityId: number, row: CommunityReferralLinkRecord, origin: string | null): LinkResult {
  return {
    ok: true,
    message: "This community referral link is already active. The receiving wallet stays as first confirmed.",
    link: formatCommunityReferralLink(communityId, row.code, origin),
    code: row.code,
    payoutAccount: row.payoutAccount,
  };
}

/**
 * Creates one community referral link. The receiving wallet is the wallet that signed
 * this link for this community. It is never read from, or written to, the PassGram affiliate record.
 */
export async function createCommunityReferralLink(
  channelDeps: ChannelDeps,
  initData: string,
  communityId: number,
  proof: PayoutWalletProof,
  communityRepo?: CommunityReferralRepository,
): Promise<LinkResult> {
  const identity = validateInitData(initData, channelDeps.botToken, channelDeps.now() / 1000);
  if (!identity) return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  const community = await channelDeps.repo.getChannelByCommunityId(communityId);
  if (!community?.active || community.paused || !community.referralEnabled || community.referralPercentBps <= 0) {
    return { ok: false, message: "This community is not accepting new referral links." };
  }
  if (community.ownerTelegramUserId === String(identity.userId)) {
    return { ok: false, message: "You cannot create a referral link for your own community." };
  }
  const origin = process.env.PASSGRAM_PUBLIC_URL || null;
  const links = communityRepo ?? (await getCommunityReferralRepository());
  const existing = await links.getReferralLinkByUser(communityId, String(identity.userId));
  if (existing) return existingLinkResult(communityId, existing, origin);

  const proven = verifyPayoutWalletProof(proof, {
    purpose: PAYOUT_PROOF_COMMUNITY,
    communityId,
    telegramUserId: String(identity.userId),
    nowSeconds: Math.floor(channelDeps.now() / 1000),
  });
  if (!proven.ok) return { ok: false, message: proven.message };
  const payout = normalizeTonAddress(proven.address);
  if (!payout) return { ok: false, message: "This wallet proof is not valid. No link was created." };
  const status = await channelDeps.accountStatus(payout);
  if (status === "missing") return { ok: false, message: "That wallet cannot receive payments. No link was created." };
  if (status === "unknown") return { ok: false, message: "The wallet could not be confirmed. No link was created." };

  let recorded: "inserted" | "exists" | "code_taken" = "code_taken";
  let code = "";
  for (let attempt = 0; attempt < 5 && recorded === "code_taken"; attempt += 1) {
    code = newCommunityReferralCode();
    recorded = await links.recordReferralLink({
      communityId,
      referrerTelegramUserId: String(identity.userId),
      code,
      payoutAccount: payout,
    });
  }
  if (recorded === "code_taken") {
    return { ok: false, message: "A community referral link could not be prepared. Try again." };
  }
  if (recorded === "exists") {
    const current = await links.getReferralLinkByUser(communityId, String(identity.userId));
    if (!current) return { ok: false, message: "Could not create this community referral link." };
    return existingLinkResult(communityId, current, origin);
  }
  if (/^[1-9]\d{0,18}$/.test(community.ownerTelegramUserId)) {
    try {
      await channelDeps.telegram.call("sendMessage", {
        chat_id: Number(community.ownerTelegramUserId),
        text: creatorReferralLinkNoticeText({
          title: community.title,
          percentLabel: formatCommunityReferralPercent(community.referralPercentBps),
          code,
        }),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "Open community", url: communityReferralNoticeUrl(communityId) }]],
        },
      });
    } catch {
      /* The link is ready even when the creator's chat cannot be reached. */
    }
  }
  return {
    ok: true,
    message: "Community referral link ready.",
    link: formatCommunityReferralLink(communityId, code, origin),
    code,
    payoutAccount: payout,
  };
}

type CommunitySettlement = {
  ok: boolean;
  message: string;
  communityReferrerPayout?: string | null;
  referralPercentBps?: number;
  referralAuthorization?: string;
  referralAuthorizationValidUntil?: number;
};

/**
 * Payment settlement. The payout address is the one stored on this community's referral link.
 * The PassGram affiliate address is a different program and is not read here.
 * When the paying wallet is supplied, the registry owner signs that payout for that wallet.
 */
export async function resolveCommunityReferrerPayout(
  channelDeps: ChannelDeps,
  communityRepo: CommunityReferralRepository,
  initData: string,
  communityId: number,
  payerWallet?: string,
): Promise<CommunitySettlement> {
  const finish = async (result: CommunitySettlement): Promise<CommunitySettlement> => {
    if (payerWallet === undefined || !result.ok) return result;
    const current = await requireCurrentRegistry();
    if (!current.ok) return { ok: false, message: current.message };
    const subscriber = normalizeTonAddress(payerWallet);
    if (!subscriber) return { ok: false, message: "Connect your TON wallet before paying." };
    const validUntil = Math.floor(channelDeps.now() / 1000) + COMMUNITY_REFERRAL_AUTHORIZATION_TTL_SECONDS;
    const signed = signCommunityReferralAuthorization({
      communityId,
      subscriber,
      payout: result.communityReferrerPayout ?? null,
      validUntil,
    });
    if (!signed.ok) return { ok: false, message: signed.message };
    return {
      ...result,
      referralAuthorization: signed.signature,
      referralAuthorizationValidUntil: validUntil,
    };
  };
  const identity = validateInitData(initData, channelDeps.botToken, channelDeps.now() / 1000);
  if (!identity) return await finish({ ok: false, message: "Open PassGram from Telegram so your account can be confirmed." });
  const community = await channelDeps.repo.getChannelByCommunityId(communityId);
  if (!community?.active) return await finish({ ok: false, message: "This community is unavailable." });
  if (community.paused) {
    return await finish({
      ok: true,
      message: "This community is deactivated.",
      communityReferrerPayout: null,
      referralPercentBps: 0,
    });
  }
  const attribution = await communityRepo.getAttribution(communityId, String(identity.userId));
  if (!attribution) {
    return await finish({
      ok: true,
      message: "No community referral attribution.",
      communityReferrerPayout: null,
      referralPercentBps: 0,
    });
  }
  // A stopped program keeps paying the rate locked on this attribution.
  const lockedBps = attribution.referralPercentBps > 0 ? attribution.referralPercentBps : community.referralPercentBps;
  if (lockedBps <= 0) {
    return await finish({ ok: true, message: "No community referral on this community.", communityReferrerPayout: null, referralPercentBps: 0 });
  }
  const link = await communityRepo.getReferralLinkByUser(communityId, attribution.referrerTelegramUserId);
  if (!link?.payoutAccount) {
    return await finish({ ok: true, message: "Community referrer has no payout address.", communityReferrerPayout: null, referralPercentBps: lockedBps });
  }
  if (link.referrerTelegramUserId === community.ownerTelegramUserId) {
    return await finish({ ok: true, message: "Owner cannot be community referrer.", communityReferrerPayout: null, referralPercentBps: lockedBps });
  }
  return await finish({
    ok: true,
    message: "Community referrer ready for on-chain split.",
    communityReferrerPayout: link.payoutAccount,
    referralPercentBps: lockedBps,
  });
}

export async function attributeCommunityReferral(
  channelDeps: ChannelDeps,
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
  if (!community?.active || community.paused || !community.referralEnabled || community.referralPercentBps <= 0) {
    return { ok: false, message: "This referral link no longer works." };
  }
  if (community.ownerTelegramUserId === String(identity.userId)) {
    return { ok: false, message: "You cannot use a referral link for your own community." };
  }
  const existing = await communityRepo.getAttribution(communityId, String(identity.userId));
  if (existing) {
    return { ok: true, message: "Community referral already locked.", result: "already_locked" };
  }
  const link = await communityRepo.getReferralLinkByCode(communityId, code);
  if (!link?.payoutAccount) return { ok: false, message: "This community referral code is unknown." };
  if (link.referrerTelegramUserId === String(identity.userId)) {
    return { ok: false, message: "You cannot attribute a community referral to yourself." };
  }
  if (link.referrerTelegramUserId === community.ownerTelegramUserId) {
    return { ok: false, message: "This referral code belongs to the community owner." };
  }
  const inserted = await communityRepo.insertAttribution({
    communityId,
    subscriberTelegramUserId: String(identity.userId),
    referrerCode: link.code,
    referrerTelegramUserId: link.referrerTelegramUserId,
    lockedAt: new Date(channelDeps.now()).toISOString(),
    referralPercentBps: community.referralPercentBps,
  });
  return {
    ok: true,
    message: inserted === "inserted" ? "Community referral locked." : "Community referral already locked.",
    result: inserted === "inserted" ? "locked" : "already_locked",
  };
}
