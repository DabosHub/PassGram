import { Pool } from "pg";
import { databaseSsl } from "./databaseSsl";
import { ChannelConfigError } from "./channelRepository";

export type OwnedCommunityRow = {
  communityId: number;
  title: string;
  description: string | null;
  price: string | null;
  durationDays: number | null;
  active: boolean;
  paused: boolean;
  telegramChatId: string;
  hasPhoto: boolean;
  ownerTelegramUserId: string;
  referralEnabled: boolean;
  referralPercentBps: number;
};

export type MembershipRow = {
  communityId: number;
  subscriberTelegramUserId: number;
  displayName: string;
  username: string;
  photoUrl: string;
  confirmation: "unconfirmed" | "confirmed";
  startedAtMs: number | null;
  expiresAtMs: number | null;
  paymentAmount: string;
  renewalPending: boolean;
  createdAtMs: number;
};

export type MembershipPaymentRow = {
  paymentId: number;
  communityId: number;
  subscriberTelegramUserId: number;
  grossAmount: string;
  creatorAmount: string;
  platformFee: string;
  affiliateAmount: string;
  communityAffiliateAmount: string;
  status: "unconfirmed" | "confirmed" | "failed";
  transactionReference: string | null;
  paidAtMs: number;
};

export type SubscriberChannelRow = {
  communityId: number;
  title: string;
  telegramChatId: string;
};

export type SubscriberInviteRow = {
  communityId: number;
  inviteLink: string;
};

export type MissingInviteRow = {
  transactionReference: string;
  expiresAtMs: number;
};

export type TelegramProfileInput = {
  telegramUserId: number;
  displayName: string;
  username: string;
  photoUrl: string;
};

export interface MembershipRepository {
  listOwnedCommunities(ownerTelegramUserId: string): Promise<OwnedCommunityRow[]>;
  listMemberships(communityIds: number[]): Promise<MembershipRow[]>;
  listPayments(communityIds: number[]): Promise<MembershipPaymentRow[]>;
  listSubscriberMemberships(telegramUserId: number): Promise<MembershipRow[]>;
  listSubscriberPayments(telegramUserId: number): Promise<MembershipPaymentRow[]>;
  listSubscriberChannels(telegramUserId: number): Promise<SubscriberChannelRow[]>;
  listSubscriberInvites(telegramUserId: number): Promise<SubscriberInviteRow[]>;
  missingSubscriberInvite(telegramUserId: number, communityId: number): Promise<MissingInviteRow | null>;
  saveSubscriberInvite(telegramUserId: number, communityId: number, transactionReference: string, inviteLink: string): Promise<void>;
  linkTonWallet(telegramUserId: number, tonAddress: string): Promise<"linked" | "taken">;
  getLinkedWallet(telegramUserId: number): Promise<string | null>;
  upsertProfile(profile: TelegramProfileInput): Promise<void>;
  getProfile(telegramUserId: number): Promise<TelegramProfileInput | null>;
  listCurrentSubscriberIds(communityId: number, nowMs: number): Promise<string[]>;
}

let postgresPromise: Promise<MembershipRepository> | null = null;

export function getMembershipRepository(): Promise<MembershipRepository> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Promise.reject(
      new ChannelConfigError(
        "Community storage is not configured. Set DATABASE_URL and apply backend/migrations/007_community_memberships.sql.",
      ),
    );
  }
  postgresPromise ??= postgresRepository(databaseUrl);
  return postgresPromise;
}

async function postgresRepository(databaseUrl: string): Promise<MembershipRepository> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseSsl(databaseUrl) });
  return new PostgresMembershipRepository(pool);
}

class PostgresMembershipRepository implements MembershipRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listOwnedCommunities(ownerTelegramUserId: string): Promise<OwnedCommunityRow[]> {
    const result = await this.pool.query<{
      community_id: string;
      title: string;
      description: string | null;
      price: string | null;
      duration_days: number | null;
      active: boolean;
      paused: boolean | null;
      telegram_chat_id: string;
      photo_file_id: string | null;
      owner_telegram_user_id: string;
      referral_enabled: boolean | null;
      referral_percent_bps: number | null;
    }>(
      `select community_id, title, description, price, duration_days, active, paused, telegram_chat_id,
              photo_file_id, owner_telegram_user_id, referral_enabled, referral_percent_bps
       from creator_communities
       where owner_telegram_user_id = $1 and community_id is not null
       order by created_at asc`,
      [ownerTelegramUserId],
    );
    return result.rows.map((row) => ({
      communityId: Number(row.community_id),
      title: row.title,
      description: row.description,
      price: row.price,
      durationDays: row.duration_days,
      active: row.active,
      paused: Boolean(row.paused),
      telegramChatId: row.telegram_chat_id,
      hasPhoto: row.photo_file_id != null,
      ownerTelegramUserId: String(row.owner_telegram_user_id),
      referralEnabled: Boolean(row.referral_enabled),
      referralPercentBps: row.referral_percent_bps == null ? 0 : Number(row.referral_percent_bps),
    }));
  }

  async listMemberships(communityIds: number[]): Promise<MembershipRow[]> {
    if (!communityIds.length) return [];
    const result = await this.pool.query<{
      community_id: string;
      subscriber_telegram_user_id: string;
      display_name: string;
      username: string;
      photo_url: string;
      confirmation: "unconfirmed" | "confirmed";
      started_at_ms: string | null;
      expires_at_ms: string | null;
      payment_amount: string;
      renewal_pending: boolean;
      created_at_ms: string;
    }>(
      `select m.community_id, m.subscriber_telegram_user_id, p.display_name, p.username, p.photo_url,
              m.confirmation, m.started_at_ms, m.expires_at_ms, m.payment_amount, m.renewal_pending, m.created_at_ms
       from community_memberships m
       join telegram_profiles p on p.telegram_user_id = m.subscriber_telegram_user_id
       where m.community_id = any($1::bigint[])
       order by m.created_at_ms desc`,
      [communityIds],
    );
    return result.rows.map((row) => ({
      communityId: Number(row.community_id),
      subscriberTelegramUserId: Number(row.subscriber_telegram_user_id),
      displayName: row.display_name,
      username: row.username,
      photoUrl: row.photo_url,
      confirmation: row.confirmation,
      startedAtMs: row.started_at_ms == null ? null : Number(row.started_at_ms),
      expiresAtMs: row.expires_at_ms == null ? null : Number(row.expires_at_ms),
      paymentAmount: row.payment_amount,
      renewalPending: row.renewal_pending,
      createdAtMs: Number(row.created_at_ms),
    }));
  }

  async listPayments(communityIds: number[]): Promise<MembershipPaymentRow[]> {
    if (!communityIds.length) return [];
    const result = await this.pool.query<{
      payment_id: string;
      community_id: string;
      subscriber_telegram_user_id: string;
      gross_amount: string;
      creator_amount: string;
      platform_fee: string;
      affiliate_amount: string;
      community_affiliate_amount: string;
      status: "unconfirmed" | "confirmed" | "failed";
      transaction_reference: string | null;
      paid_at_ms: string;
    }>(
      `select payment_id, community_id, subscriber_telegram_user_id, gross_amount, creator_amount,
              platform_fee, affiliate_amount, community_affiliate_amount, status, transaction_reference, paid_at_ms
       from community_membership_payments
       where community_id = any($1::bigint[])
       order by paid_at_ms desc`,
      [communityIds],
    );
    return result.rows.map((row) => ({
      paymentId: Number(row.payment_id),
      communityId: Number(row.community_id),
      subscriberTelegramUserId: Number(row.subscriber_telegram_user_id),
      grossAmount: row.gross_amount,
      creatorAmount: row.creator_amount,
      platformFee: row.platform_fee,
      affiliateAmount: row.affiliate_amount,
      communityAffiliateAmount: row.community_affiliate_amount,
      status: row.status,
      transactionReference: row.transaction_reference,
      paidAtMs: Number(row.paid_at_ms),
    }));
  }

  async listSubscriberMemberships(telegramUserId: number): Promise<MembershipRow[]> {
    const result = await this.pool.query<{
      community_id: string;
      subscriber_telegram_user_id: string;
      display_name: string;
      username: string;
      photo_url: string;
      confirmation: "unconfirmed" | "confirmed";
      started_at_ms: string | null;
      expires_at_ms: string | null;
      payment_amount: string;
      renewal_pending: boolean;
      created_at_ms: string;
    }>(
      `select m.community_id, m.subscriber_telegram_user_id, p.display_name, p.username, p.photo_url,
              m.confirmation, m.started_at_ms, m.expires_at_ms, m.payment_amount, m.renewal_pending, m.created_at_ms
       from community_memberships m
       join telegram_profiles p on p.telegram_user_id = m.subscriber_telegram_user_id
       where m.subscriber_telegram_user_id = $1
       order by m.created_at_ms desc`,
      [telegramUserId],
    );
    return result.rows.map((row) => ({
      communityId: Number(row.community_id),
      subscriberTelegramUserId: Number(row.subscriber_telegram_user_id),
      displayName: row.display_name,
      username: row.username,
      photoUrl: row.photo_url,
      confirmation: row.confirmation,
      startedAtMs: row.started_at_ms == null ? null : Number(row.started_at_ms),
      expiresAtMs: row.expires_at_ms == null ? null : Number(row.expires_at_ms),
      paymentAmount: row.payment_amount,
      renewalPending: row.renewal_pending,
      createdAtMs: Number(row.created_at_ms),
    }));
  }

  async listSubscriberPayments(telegramUserId: number): Promise<MembershipPaymentRow[]> {
    const result = await this.pool.query<{
      payment_id: string;
      community_id: string;
      subscriber_telegram_user_id: string;
      gross_amount: string;
      creator_amount: string;
      platform_fee: string;
      affiliate_amount: string;
      community_affiliate_amount: string;
      status: "unconfirmed" | "confirmed" | "failed";
      transaction_reference: string | null;
      paid_at_ms: string;
    }>(
      `select payment_id, community_id, subscriber_telegram_user_id, gross_amount, creator_amount,
              platform_fee, affiliate_amount, community_affiliate_amount, status, transaction_reference, paid_at_ms
       from community_membership_payments
       where subscriber_telegram_user_id = $1
       order by paid_at_ms desc`,
      [telegramUserId],
    );
    return result.rows.map((row) => ({
      paymentId: Number(row.payment_id),
      communityId: Number(row.community_id),
      subscriberTelegramUserId: Number(row.subscriber_telegram_user_id),
      grossAmount: row.gross_amount,
      creatorAmount: row.creator_amount,
      platformFee: row.platform_fee,
      affiliateAmount: row.affiliate_amount,
      communityAffiliateAmount: row.community_affiliate_amount,
      status: row.status,
      transactionReference: row.transaction_reference,
      paidAtMs: Number(row.paid_at_ms),
    }));
  }

  async listCurrentSubscriberIds(communityId: number, nowMs: number): Promise<string[]> {
    const result = await this.pool.query<{ subscriber_telegram_user_id: string }>(
      `select subscriber_telegram_user_id
       from community_memberships
       where community_id = $1
         and confirmation = 'confirmed'
         and expires_at_ms > $2`,
      [communityId, nowMs],
    );
    return result.rows.map((row) => String(row.subscriber_telegram_user_id));
  }

  async listSubscriberChannels(telegramUserId: number): Promise<SubscriberChannelRow[]> {
    const result = await this.pool.query<{ community_id: string; title: string; telegram_chat_id: string }>(
      `select m.community_id, c.title, c.telegram_chat_id
       from community_memberships m
       join creator_communities c on c.community_id = m.community_id
       where m.subscriber_telegram_user_id = $1
         and m.confirmation = 'confirmed'
         and coalesce(m.expires_at_ms, 0) > (extract(epoch from clock_timestamp()) * 1000)`,
      [telegramUserId],
    );
    return result.rows.map((row) => ({
      communityId: Number(row.community_id),
      title: row.title,
      telegramChatId: row.telegram_chat_id,
    }));
  }

  async listSubscriberInvites(telegramUserId: number): Promise<SubscriberInviteRow[]> {
    const result = await this.pool.query<{ community_id: string; invite_link: string }>(
      `select distinct on (p.community_id) p.community_id, p.invite_link
       from community_membership_payments p
       join community_memberships m
         on m.community_id = p.community_id
        and m.subscriber_telegram_user_id = p.subscriber_telegram_user_id
       where p.subscriber_telegram_user_id = $1
         and p.status = 'confirmed'
         and m.confirmation = 'confirmed'
         and coalesce(m.expires_at_ms, 0) > (extract(epoch from clock_timestamp()) * 1000)
         and p.invite_link is not null
         and p.invite_link <> ''
       order by p.community_id, p.paid_at_ms desc`,
      [telegramUserId],
    );
    return result.rows.map((row) => ({
      communityId: Number(row.community_id),
      inviteLink: row.invite_link,
    }));
  }

  async missingSubscriberInvite(telegramUserId: number, communityId: number): Promise<MissingInviteRow | null> {
    const result = await this.pool.query<{ transaction_reference: string | null; expires_at_ms: string }>(
      `select p.transaction_reference, m.expires_at_ms
       from community_membership_payments p
       join community_memberships m
         on m.community_id = p.community_id
        and m.subscriber_telegram_user_id = p.subscriber_telegram_user_id
       where p.subscriber_telegram_user_id = $1
         and p.community_id = $2
         and p.status = 'confirmed'
         and m.confirmation = 'confirmed'
         and coalesce(m.expires_at_ms, 0) > (extract(epoch from clock_timestamp()) * 1000)
         and (p.invite_link is null or p.invite_link = '')
         and p.transaction_reference is not null
         and p.transaction_reference <> ''
       order by p.paid_at_ms desc
       limit 1`,
      [telegramUserId, communityId],
    );
    const row = result.rows[0];
    if (!row?.transaction_reference) return null;
    const expiresAtMs = Number(row.expires_at_ms);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
    return { transactionReference: row.transaction_reference, expiresAtMs };
  }

  async saveSubscriberInvite(
    telegramUserId: number,
    communityId: number,
    transactionReference: string,
    inviteLink: string,
  ): Promise<void> {
    await this.pool.query(
      `update community_membership_payments
       set invite_link = $4
       where subscriber_telegram_user_id = $1
         and community_id = $2
         and transaction_reference = $3
         and status = 'confirmed'
         and (invite_link is null or invite_link = '')`,
      [telegramUserId, communityId, transactionReference, inviteLink],
    );
    await this.pool.query(
      `update payments
       set invite_link = $2
       where tx_hash = $1
         and (invite_link is null or invite_link = '')`,
      [transactionReference, inviteLink],
    );
  }

  async linkTonWallet(telegramUserId: number, tonAddress: string): Promise<"linked" | "taken"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from telegram_wallets
         where telegram_user_id <> $2
           and ton_address = $1`,
        [tonAddress, telegramUserId],
      );
      await client.query(
        `insert into telegram_wallets (telegram_user_id, ton_address)
         values ($1, $2)
         on conflict (telegram_user_id) do update set
           ton_address = excluded.ton_address,
           linked_at = now()`,
        [telegramUserId, tonAddress],
      );
      await client.query("commit");
      return "linked";
    } catch (error) {
      await client.query("rollback");
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "23505") return "taken";
      throw error;
    } finally {
      client.release();
    }
  }

  async getLinkedWallet(telegramUserId: number): Promise<string | null> {
    const result = await this.pool.query<{ ton_address: string | null }>(
      `select ton_address from telegram_wallets where telegram_user_id = $1`,
      [telegramUserId],
    );
    return result.rows[0]?.ton_address ?? null;
  }

  async getProfile(telegramUserId: number): Promise<TelegramProfileInput | null> {
    const result = await this.pool.query<{ display_name: string; username: string; photo_url: string }>(
      `select display_name, username, photo_url from telegram_profiles where telegram_user_id = $1`,
      [telegramUserId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      telegramUserId,
      displayName: row.display_name || "",
      username: row.username || "",
      photoUrl: row.photo_url || "",
    };
  }

  async upsertProfile(profile: TelegramProfileInput): Promise<void> {
    await this.pool.query(
      `insert into telegram_profiles (telegram_user_id, display_name, username, photo_url, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (telegram_user_id) do update set
         display_name = excluded.display_name,
         username = excluded.username,
         photo_url = case when excluded.photo_url = '' then telegram_profiles.photo_url else excluded.photo_url end,
         updated_at = now()`,
      [profile.telegramUserId, profile.displayName, profile.username, profile.photoUrl],
    );
  }
}
