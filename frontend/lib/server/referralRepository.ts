import { Pool } from "pg";
import type { AffiliateRecord, AttributionRecord } from "../referralPolicy";
import { ChannelConfigError } from "./channelRepository";

export interface ReferralRepository {
  getAffiliateByCode(code: string): Promise<AffiliateRecord | null>;
  getAffiliateByTelegramUserId(telegramUserId: string): Promise<AffiliateRecord | null>;
  saveAffiliate(row: AffiliateRecord): Promise<AffiliateRecord>;
  getAttribution(telegramUserId: string): Promise<AttributionRecord | null>;
  insertAttribution(row: AttributionRecord): Promise<"inserted" | "exists">;
}

export class MemoryReferralRepository implements ReferralRepository {
  private readonly affiliatesByCode = new Map<string, AffiliateRecord>();
  private readonly affiliatesByUser = new Map<string, string>();
  private readonly attributions = new Map<string, AttributionRecord>();

  async getAffiliateByCode(code: string): Promise<AffiliateRecord | null> {
    return this.affiliatesByCode.get(code) ?? null;
  }

  async getAffiliateByTelegramUserId(telegramUserId: string): Promise<AffiliateRecord | null> {
    const code = this.affiliatesByUser.get(telegramUserId);
    return code ? (this.affiliatesByCode.get(code) ?? null) : null;
  }

  async saveAffiliate(row: AffiliateRecord): Promise<AffiliateRecord> {
    const existingUser = this.affiliatesByUser.get(row.telegramUserId);
    if (existingUser && existingUser !== row.code) {
      throw new Error("This Telegram account already has an affiliate code.");
    }
    const existingCode = this.affiliatesByCode.get(row.code);
    if (existingCode && existingCode.telegramUserId !== row.telegramUserId) {
      throw new Error("Referral code is already taken.");
    }
    this.affiliatesByCode.set(row.code, row);
    this.affiliatesByUser.set(row.telegramUserId, row.code);
    return row;
  }

  async getAttribution(telegramUserId: string): Promise<AttributionRecord | null> {
    return this.attributions.get(telegramUserId) ?? null;
  }

  async insertAttribution(row: AttributionRecord): Promise<"inserted" | "exists"> {
    if (this.attributions.has(row.telegramUserId)) return "exists";
    this.attributions.set(row.telegramUserId, row);
    return "inserted";
  }
}

let postgresPromise: Promise<ReferralRepository> | null = null;

export function getReferralRepository(): Promise<ReferralRepository> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Promise.reject(
      new ChannelConfigError(
        "Referral storage is not configured. Set DATABASE_URL and apply backend/migrations/003_referral_attribution.sql.",
      ),
    );
  }
  postgresPromise ??= postgresRepository(databaseUrl);
  return postgresPromise;
}

async function postgresRepository(databaseUrl: string): Promise<ReferralRepository> {
  return new PostgresReferralRepository(new Pool({ connectionString: databaseUrl }));
}

class PostgresReferralRepository implements ReferralRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getAffiliateByCode(code: string): Promise<AffiliateRecord | null> {
    const result = await this.pool.query(`select * from affiliates where code = $1`, [code]);
    return result.rows[0] ? mapAffiliate(result.rows[0]) : null;
  }

  async getAffiliateByTelegramUserId(telegramUserId: string): Promise<AffiliateRecord | null> {
    const result = await this.pool.query(`select * from affiliates where telegram_user_id = $1`, [telegramUserId]);
    return result.rows[0] ? mapAffiliate(result.rows[0]) : null;
  }

  async saveAffiliate(row: AffiliateRecord): Promise<AffiliateRecord> {
    await this.pool.query(
      `insert into affiliates (code, telegram_user_id, payout_account, created_at)
       values ($1, $2, $3, $4)
       on conflict (telegram_user_id) do update set payout_account = excluded.payout_account
       returning *`,
      [row.code, row.telegramUserId, row.payoutAccount, row.createdAt],
    );
    const saved = await this.getAffiliateByTelegramUserId(row.telegramUserId);
    if (!saved) throw new Error("Affiliate could not be saved.");
    return saved;
  }

  async getAttribution(telegramUserId: string): Promise<AttributionRecord | null> {
    const result = await this.pool.query(`select * from referral_attributions where telegram_user_id = $1`, [telegramUserId]);
    return result.rows[0] ? mapAttribution(result.rows[0]) : null;
  }

  async insertAttribution(row: AttributionRecord): Promise<"inserted" | "exists"> {
    const result = await this.pool.query(
      `insert into referral_attributions
        (telegram_user_id, referrer_code, referrer_telegram_user_id, source, locked_at)
       values ($1, $2, $3, $4, $5)
       on conflict (telegram_user_id) do nothing`,
      [row.telegramUserId, row.referrerCode, row.referrerTelegramUserId, row.source, row.lockedAt],
    );
    return (result.rowCount ?? 0) > 0 ? "inserted" : "exists";
  }
}

function mapAffiliate(row: Record<string, unknown>): AffiliateRecord {
  return {
    code: String(row.code),
    telegramUserId: String(row.telegram_user_id),
    payoutAccount: String(row.payout_account),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapAttribution(row: Record<string, unknown>): AttributionRecord {
  return {
    telegramUserId: String(row.telegram_user_id),
    referrerCode: String(row.referrer_code),
    referrerTelegramUserId: String(row.referrer_telegram_user_id),
    source: String(row.source) as AttributionRecord["source"],
    lockedAt: new Date(String(row.locked_at)).toISOString(),
  };
}
