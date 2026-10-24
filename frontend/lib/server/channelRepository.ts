import { Pool } from "pg";
import { databaseSsl } from "./databaseSsl";
import {
  nextActivation,
  nextVerification,
  type ChannelSnapshot,
  type ChannelUiState,
  type SubscriptionDuration,
} from "../channelPolicy";

export class ChannelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelConfigError";
  }
}

export type SelectionRecord = {
  requestId: number;
  ownerTelegramUserId: string;
  preparedButtonId: string;
  status: ChannelUiState;
  message: string | null;
  telegramChatId: string | null;
};

export interface ChannelRepository {
  insertSelection(row: SelectionRecord): Promise<void>;
  getSelection(requestId: number): Promise<SelectionRecord | null>;
  saveSelection(row: SelectionRecord): Promise<void>;
  getChannel(telegramChatId: string): Promise<ChannelSnapshot | null>;
  getChannelByCommunityId(communityId: number): Promise<ChannelSnapshot | null>;
  listChannelsByOwner(ownerTelegramUserId: string): Promise<ChannelSnapshot[]>;
  listReferralEnabledCommunities(): Promise<ChannelSnapshot[]>;
  saveVerifiedChannel(row: ChannelSnapshot): Promise<"saved" | "conflict">;
  activateChannel(input: {
    telegramChatId: string;
    ownerTelegramUserId: string;
    priceUsdt: string;
    durationDays: SubscriptionDuration;
    payoutAccount: string;
  }): Promise<{ result: "created" | "exists" | "missing" | "not_verified" | "conflict"; row: ChannelSnapshot | null }>;
  saveChannel(row: ChannelSnapshot): Promise<void>;
  recordRegistration(input: {
    communityId: number;
    ownerTelegramUserId: string;
    signatureHash: string;
  }): Promise<{ row: ChannelSnapshot; newlyActive: boolean } | null>;
}

type MemoryState = {
  selections: Map<number, SelectionRecord>;
  channels: Map<string, ChannelSnapshot>;
  nextCommunityId: number;
};

export class MemoryChannelRepository implements ChannelRepository {
  private readonly state: MemoryState;

  constructor(state?: MemoryState) {
    this.state = state ?? { selections: new Map(), channels: new Map(), nextCommunityId: 1 };
  }

  async insertSelection(row: SelectionRecord): Promise<void> {
    if (this.state.selections.has(row.requestId)) throw new Error("Selection request already exists.");
    this.state.selections.set(row.requestId, { ...row });
  }

  async getSelection(requestId: number): Promise<SelectionRecord | null> {
    const row = this.state.selections.get(requestId);
    return row ? { ...row } : null;
  }

  async saveSelection(row: SelectionRecord): Promise<void> {
    this.state.selections.set(row.requestId, { ...row });
  }

  async getChannel(telegramChatId: string): Promise<ChannelSnapshot | null> {
    const row = this.state.channels.get(telegramChatId);
    return row ? { ...row } : null;
  }

  async getChannelByCommunityId(communityId: number): Promise<ChannelSnapshot | null> {
    for (const row of this.state.channels.values()) {
      if (row.communityId === communityId) return { ...row };
    }
    return null;
  }

  async listChannelsByOwner(ownerTelegramUserId: string): Promise<ChannelSnapshot[]> {
    return [...this.state.channels.values()]
      .filter((row) => row.ownerTelegramUserId === ownerTelegramUserId && row.active)
      .map((row) => ({ ...row }))
      .sort((a, b) => (b.communityId ?? 0) - (a.communityId ?? 0));
  }

  async saveVerifiedChannel(row: ChannelSnapshot): Promise<"saved" | "conflict"> {
    const decision = nextVerification(this.state.channels.get(row.telegramChatId) ?? null, row.ownerTelegramUserId);
    if (decision === "conflict") return "conflict";
    const current = this.state.channels.get(row.telegramChatId);
    this.state.channels.set(row.telegramChatId, {
      ...row,
      communityId: current?.communityId ?? row.communityId ?? null,
      payoutAccount: current?.payoutAccount ?? null,
      priceUsdt: current?.priceUsdt ?? null,
      durationDays: current?.durationDays ?? null,
      referrerCode: row.referrerCode ?? current?.referrerCode ?? null,
      referrerTelegramUserId: row.referrerTelegramUserId ?? current?.referrerTelegramUserId ?? null,
      referralEnabled: current?.referralEnabled ?? row.referralEnabled ?? false,
      referralPercentBps: current?.referralPercentBps ?? row.referralPercentBps ?? 0,
      registrationSignatureHash: current?.registrationSignatureHash ?? row.registrationSignatureHash ?? null,
      active: current?.active ?? false,
      paused: current?.paused ?? row.paused ?? false,
    });
    return "saved";
  }

  async listReferralEnabledCommunities(): Promise<ChannelSnapshot[]> {
    return [...this.state.channels.values()]
      .filter((row) => row.active && !row.paused && row.referralEnabled && row.referralPercentBps > 0 && row.communityId != null)
      .map((row) => ({ ...row }))
      .sort((a, b) => (b.communityId ?? 0) - (a.communityId ?? 0));
  }

  async activateChannel(input: {
    telegramChatId: string;
    ownerTelegramUserId: string;
    priceUsdt: string;
    durationDays: SubscriptionDuration;
    payoutAccount: string;
  }): Promise<{ result: "created" | "exists" | "missing" | "not_verified" | "conflict"; row: ChannelSnapshot | null }> {
    const decision = nextActivation(this.state.channels.get(input.telegramChatId) ?? null, input);
    if (decision.row && decision.result === "created") {
      const communityId = decision.row.communityId ?? this.state.nextCommunityId++;
      const row = { ...decision.row, communityId };
      this.state.channels.set(input.telegramChatId, row);
      return { ...decision, row };
    }
    if (decision.row && decision.result === "exists" && decision.row.registrationSignatureHash) {
      this.state.channels.set(input.telegramChatId, decision.row);
    }
    return decision;
  }

  async saveChannel(row: ChannelSnapshot): Promise<void> {
    this.state.channels.set(row.telegramChatId, { ...row });
  }

  async recordRegistration(input: {
    communityId: number;
    ownerTelegramUserId: string;
    signatureHash: string;
  }): Promise<{ row: ChannelSnapshot; newlyActive: boolean } | null> {
    for (const [chatId, row] of this.state.channels) {
      if (row.communityId !== input.communityId) continue;
      if (row.ownerTelegramUserId !== input.ownerTelegramUserId) return null;
      if (row.registrationSignatureHash && row.registrationSignatureHash !== input.signatureHash) return null;
      const newlyActive = !row.active;
      const next = { ...row, active: true, registrationSignatureHash: input.signatureHash };
      this.state.channels.set(chatId, next);
      return { row: next, newlyActive };
    }
    return null;
  }
}

let postgresPromise: Promise<ChannelRepository> | null = null;

export function getChannelRepository(): Promise<ChannelRepository> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Promise.reject(
      new ChannelConfigError(
        "Community storage is not configured. Set DATABASE_URL and apply backend/migrations/002_channel_verification.sql.",
      ),
    );
  }
  postgresPromise ??= postgresRepository(databaseUrl);
  return postgresPromise;
}

async function postgresRepository(databaseUrl: string): Promise<ChannelRepository> {
  // Static import — dynamic `import("pg")` fails under Next/webpack on Vercel.
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseSsl(databaseUrl) });
  return new PostgresChannelRepository(pool);
}

class PostgresChannelRepository implements ChannelRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insertSelection(row: SelectionRecord): Promise<void> {
    await this.pool.query(
      `insert into channel_selection_requests
        (request_id, owner_telegram_user_id, prepared_button_id, status, failure_message, telegram_chat_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [row.requestId, row.ownerTelegramUserId, row.preparedButtonId, row.status, row.message, row.telegramChatId],
    );
  }

  async getSelection(requestId: number): Promise<SelectionRecord | null> {
    const result = await this.pool.query(`select * from channel_selection_requests where request_id = $1`, [requestId]);
    return result.rows[0] ? mapSelection(result.rows[0]) : null;
  }

  async saveSelection(row: SelectionRecord): Promise<void> {
    await this.pool.query(
      `update channel_selection_requests
       set status = $2, failure_message = $3, telegram_chat_id = $4, completed_at = now()
       where request_id = $1`,
      [row.requestId, row.status, row.message, row.telegramChatId],
    );
  }

  async getChannel(telegramChatId: string): Promise<ChannelSnapshot | null> {
    const result = await this.pool.query(`select * from creator_communities where telegram_chat_id = $1`, [telegramChatId]);
    return result.rows[0] ? mapChannel(result.rows[0]) : null;
  }

  async saveVerifiedChannel(row: ChannelSnapshot): Promise<"saved" | "conflict"> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(`select * from creator_communities where telegram_chat_id = $1 for update`, [row.telegramChatId]);
      const decision = nextVerification(current.rows[0] ? mapChannel(current.rows[0]) : null, row.ownerTelegramUserId);
      if (decision === "conflict") {
        await client.query("rollback");
        return "conflict";
      }
      const existing = current.rows[0] ? mapChannel(current.rows[0]) : null;
      const stored: ChannelSnapshot = {
        ...row,
        communityId: existing?.communityId ?? row.communityId ?? null,
        payoutAccount: existing?.payoutAccount ?? null,
        priceUsdt: existing?.priceUsdt ?? null,
        durationDays: existing?.durationDays ?? null,
        referrerCode: row.referrerCode ?? existing?.referrerCode ?? null,
        referrerTelegramUserId: row.referrerTelegramUserId ?? existing?.referrerTelegramUserId ?? null,
        referralEnabled: existing?.referralEnabled ?? row.referralEnabled ?? false,
        referralPercentBps: existing?.referralPercentBps ?? row.referralPercentBps ?? 0,
        active: existing?.active ?? false,
        paused: existing?.paused ?? row.paused ?? false,
      };
      await writeChannel(client, stored);
      await client.query("commit");
      return "saved";
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getChannelByCommunityId(communityId: number): Promise<ChannelSnapshot | null> {
    const result = await this.pool.query(`select * from creator_communities where community_id = $1`, [communityId]);
    return result.rows[0] ? mapChannel(result.rows[0]) : null;
  }

  async listChannelsByOwner(ownerTelegramUserId: string): Promise<ChannelSnapshot[]> {
    const result = await this.pool.query(
      `select * from creator_communities
       where owner_telegram_user_id = $1 and active = true
       order by community_id desc`,
      [ownerTelegramUserId],
    );
    return result.rows.map(mapChannel);
  }

  async listReferralEnabledCommunities(): Promise<ChannelSnapshot[]> {
    const result = await this.pool.query(
      `select * from creator_communities
       where active = true
         and coalesce(paused, false) = false
         and coalesce(referral_enabled, false) = true
         and coalesce(referral_percent_bps, 0) > 0
         and community_id is not null
         and price is not null
         and duration_days is not null
       order by community_id desc`,
    );
    return result.rows.map(mapChannel);
  }

  async activateChannel(input: {
    telegramChatId: string;
    ownerTelegramUserId: string;
    priceUsdt: string;
    durationDays: SubscriptionDuration;
    payoutAccount: string;
  }): Promise<{ result: "created" | "exists" | "missing" | "not_verified" | "conflict"; row: ChannelSnapshot | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(`select * from creator_communities where telegram_chat_id = $1 for update`, [input.telegramChatId]);
      const existing = current.rows[0] ? mapChannel(current.rows[0]) : null;
      const decision = nextActivation(existing, input);
      if (decision.row && decision.result === "exists" && decision.row.registrationSignatureHash && !existing?.active) {
        await writeChannel(client, decision.row);
        await client.query("commit");
        return decision;
      }
      if (decision.result === "created" && decision.row) {
        const withId = {
          ...decision.row,
          communityId: decision.row.communityId ?? existing?.communityId ?? null,
        };
        await writeChannel(client, withId);
        if (withId.communityId == null) {
          const allocated = await client.query(
            `update creator_communities
             set community_id = coalesce(community_id, nextval('creator_communities_community_id_seq'))
             where telegram_chat_id = $1
             returning *`,
            [input.telegramChatId],
          );
          await client.query("commit");
          return { ...decision, row: allocated.rows[0] ? mapChannel(allocated.rows[0]) : withId };
        }
        const refreshed = await client.query(`select * from creator_communities where telegram_chat_id = $1`, [input.telegramChatId]);
        await client.query("commit");
        return { ...decision, row: refreshed.rows[0] ? mapChannel(refreshed.rows[0]) : withId };
      }
      await client.query("commit");
      return decision;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveChannel(row: ChannelSnapshot): Promise<void> {
    await writeChannel(this.pool, row);
  }

  async recordRegistration(input: {
    communityId: number;
    ownerTelegramUserId: string;
    signatureHash: string;
  }): Promise<{ row: ChannelSnapshot; newlyActive: boolean } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query(
        `select * from creator_communities where community_id = $1 for update`,
        [input.communityId],
      );
      const existing = current.rows[0] ? mapChannel(current.rows[0]) : null;
      if (!existing || existing.ownerTelegramUserId !== input.ownerTelegramUserId) {
        await client.query("rollback");
        return null;
      }
      if (existing.registrationSignatureHash && existing.registrationSignatureHash !== input.signatureHash) {
        await client.query("rollback");
        return null;
      }
      const saved = await client.query(
        `update creator_communities
         set registration_signature_hash = $2, active = true
         where community_id = $1
         returning *`,
        [input.communityId, input.signatureHash],
      );
      await client.query("commit");
      const row = saved.rows[0] ? mapChannel(saved.rows[0]) : null;
      if (!row) return null;
      return { row, newlyActive: !existing.active };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function writeChannel(db: { query: Pool["query"] }, row: ChannelSnapshot): Promise<void> {
  await db.query(
    `insert into creator_communities (
      telegram_chat_id, community_id, owner_telegram_user_id, title, description, photo_file_id,
      telegram_member_count, telegram_member_count_fetched_at,
      bot_can_invite_users, bot_can_restrict_members, verification_status, verified_at,
      payout_account, price, duration_days, referrer_code, referrer_telegram_user_id,
      referral_enabled, referral_percent_bps, active, paused
    ) values (
      $1,
      coalesce($2, nextval('creator_communities_community_id_seq')),
      $3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
    )
    on conflict (telegram_chat_id) do update set
      owner_telegram_user_id = excluded.owner_telegram_user_id,
      title = excluded.title,
      description = excluded.description,
      photo_file_id = excluded.photo_file_id,
      telegram_member_count = excluded.telegram_member_count,
      telegram_member_count_fetched_at = excluded.telegram_member_count_fetched_at,
      bot_can_invite_users = excluded.bot_can_invite_users,
      bot_can_restrict_members = excluded.bot_can_restrict_members,
      verification_status = excluded.verification_status,
      verified_at = excluded.verified_at,
      payout_account = excluded.payout_account,
      price = excluded.price,
      duration_days = excluded.duration_days,
      referrer_code = coalesce(excluded.referrer_code, creator_communities.referrer_code),
      referrer_telegram_user_id = coalesce(excluded.referrer_telegram_user_id, creator_communities.referrer_telegram_user_id),
      referral_enabled = excluded.referral_enabled,
      referral_percent_bps = excluded.referral_percent_bps,
      active = excluded.active,
      paused = excluded.paused,
      community_id = coalesce(creator_communities.community_id, excluded.community_id)`,
    [
      row.telegramChatId,
      row.communityId,
      row.ownerTelegramUserId,
      row.title,
      row.description,
      row.photoFileId,
      row.telegramMemberCount,
      row.telegramMemberCountFetchedAt,
      row.botCanInviteUsers,
      row.botCanRestrictMembers,
      row.verificationStatus,
      row.verifiedAt,
      row.payoutAccount,
      row.priceUsdt,
      row.durationDays,
      row.referrerCode,
      row.referrerTelegramUserId,
      row.referralEnabled,
      row.referralPercentBps,
      row.active,
      Boolean(row.paused),
    ],
  );
}

function mapSelection(row: Record<string, unknown>): SelectionRecord {
  return {
    requestId: Number(row.request_id),
    ownerTelegramUserId: String(row.owner_telegram_user_id),
    preparedButtonId: String(row.prepared_button_id),
    status: String(row.status) as ChannelUiState,
    message: row.failure_message == null ? null : String(row.failure_message),
    telegramChatId: row.telegram_chat_id == null ? null : String(row.telegram_chat_id),
  };
}

function mapChannel(row: Record<string, unknown>): ChannelSnapshot {
  return {
    telegramChatId: String(row.telegram_chat_id),
    communityId: row.community_id == null ? null : Number(row.community_id),
    ownerTelegramUserId: String(row.owner_telegram_user_id),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    photoFileId: row.photo_file_id == null ? null : String(row.photo_file_id),
    telegramMemberCount: row.telegram_member_count == null ? null : Number(row.telegram_member_count),
    telegramMemberCountFetchedAt: row.telegram_member_count_fetched_at == null ? null : new Date(String(row.telegram_member_count_fetched_at)).toISOString(),
    botCanInviteUsers: Boolean(row.bot_can_invite_users),
    botCanRestrictMembers: Boolean(row.bot_can_restrict_members),
    verificationStatus: String(row.verification_status) as ChannelUiState,
    verifiedAt: row.verified_at == null ? null : new Date(String(row.verified_at)).toISOString(),
    payoutAccount: row.payout_account == null ? null : String(row.payout_account),
    priceUsdt: row.price == null ? null : String(row.price),
    durationDays: row.duration_days == null ? null : (Number(row.duration_days) as SubscriptionDuration),
    referrerCode: row.referrer_code == null ? null : String(row.referrer_code),
    referrerTelegramUserId: row.referrer_telegram_user_id == null ? null : String(row.referrer_telegram_user_id),
    referralEnabled: Boolean(row.referral_enabled),
    referralPercentBps: row.referral_percent_bps == null ? 0 : Number(row.referral_percent_bps),
    active: Boolean(row.active),
    paused: Boolean(row.paused),
    registrationSignatureHash: row.registration_signature_hash == null ? null : String(row.registration_signature_hash),
  };
}
