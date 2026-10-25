import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sanitizeError } from "./log.ts";
import { tonWalletKey } from "./walletKey.ts";

function supabaseRootCa(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../certs/prod-ca-2021.crt"), "utf8");
}

export function createPool(databaseUrl: string): pg.Pool {
  const remote = /supabase|pooler\.|sslmode=require/i.test(databaseUrl);
  const ssl = !remote
    ? undefined
    : process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY === "1"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true, ca: supabaseRootCa() };
  return new pg.Pool({
    connectionString: databaseUrl,
    ssl,
  });
}

export type SubscriptionPaidEvent = {
  txHash: string;
  subscriber: string;
  creator: string;
  communityId: number;
  amount: string;
  paidAtMs: number;
  expiresAtMs: number;
  referrer: string | null;
  hasPlatformReferrer?: boolean;
  telegramUserId?: string | null;
};

/** A confirmed payment arrived before its community row. The indexer skips it and keeps moving. */
export class UnknownCommunityError extends Error {
  readonly communityId: number;
  readonly txHash: string;

  constructor(communityId: number, txHash: string) {
    super("Payment names a community that is not listed.");
    this.name = "UnknownCommunityError";
    this.communityId = communityId;
    this.txHash = txHash;
  }
}

export async function upsertPaymentAndSubscription(
  pool: pg.Pool,
  event: SubscriptionPaidEvent,
): Promise<{ paymentId: number; inviteNeeded: boolean }> {
  const client = await pool.connect();
  let started = false;
  try {
    const listed = await client.query(`select 1 from creator_communities where community_id = $1 limit 1`, [
      event.communityId,
    ]);
    if (listed.rows.length < 1) throw new UnknownCommunityError(event.communityId, event.txHash);
    await client.query("begin");
    started = true;
    if (!event.txHash.trim()) throw new Error("Payment is missing a transaction hash.");
    const platformBps = 250n;
    const platformReferral = event.hasPlatformReferrer === true;
    const treasuryBps = platformReferral ? 200n : 250n;
    const referrerBps = platformReferral ? 50n : 0n;
    const gross = BigInt(event.amount);
    const treasury = (gross * treasuryBps) / 10_000n;
    const referrerAmt = (gross * referrerBps) / 10_000n;
    const creatorAmt = gross - treasury - referrerAmt;
    void platformBps;

    const saved = await client.query<{ payment_id: string; inserted: boolean }>(
      `insert into payments (
        community_id, subscriber_account_id, creator_account_id, payout_account,
        gross_amount, creator_amount, treasury_amount, referrer_account_id, referrer_amount,
        paid_at_ms, expires_at_ms, tx_hash
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      on conflict (tx_hash) do update set
        invite_link = coalesce(payments.invite_link, excluded.invite_link)
      returning payment_id, (xmax = 0) as inserted`,
      [
        event.communityId,
        event.subscriber,
        event.creator,
        event.creator,
        event.amount,
        creatorAmt.toString(),
        treasury.toString(),
        event.referrer,
        referrerAmt.toString(),
        event.paidAtMs,
        event.expiresAtMs,
        event.txHash,
      ],
    );
    const payment = saved.rows[0];
    if (!payment) throw new Error("Payment could not be recorded.");
    const paymentId = Number(payment.payment_id);
    if (!payment.inserted) {
      await client.query("commit");
      return { paymentId, inviteNeeded: false };
    }

    await client.query(
      `insert into subscriptions (community_id, subscriber_account_id, expires_at_ms, last_payment_id)
       values ($1, $2, $3, $4)
       on conflict (community_id, subscriber_account_id)
       do update set
         expires_at_ms = greatest(subscriptions.expires_at_ms, excluded.expires_at_ms),
         last_payment_id = case
           when excluded.expires_at_ms >= subscriptions.expires_at_ms then excluded.last_payment_id
           else subscriptions.last_payment_id
         end`,
      [event.communityId, event.subscriber, event.expiresAtMs, paymentId],
    );

    await syncMembership(client, event, creatorAmt.toString(), treasury.toString(), referrerAmt.toString());

    await client.query("commit");
    return { paymentId, inviteNeeded: true };
  } catch (error) {
    if (started) await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function syncMembership(
  client: pg.PoolClient,
  event: SubscriptionPaidEvent,
  creatorAmount: string,
  platformFee: string,
  affiliateAmount: string,
): Promise<void> {
  const telegramUserId = Number(event.telegramUserId);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return;
  await client.query("savepoint membership_sync");
  try {
    await client.query(
      `insert into telegram_profiles (telegram_user_id) values ($1) on conflict (telegram_user_id) do nothing`,
      [telegramUserId],
    );
    await client.query(
      `insert into community_memberships (
         community_id, subscriber_telegram_user_id, confirmation, started_at_ms, expires_at_ms,
         payment_amount, renewal_pending, created_at_ms
       ) values ($1, $2, 'confirmed', $3, $4, $5, false, $3)
       on conflict (community_id, subscriber_telegram_user_id) do update set
         confirmation = 'confirmed',
         expires_at_ms = greatest(coalesce(community_memberships.expires_at_ms, 0), excluded.expires_at_ms),
         started_at_ms = case
           when excluded.expires_at_ms >= coalesce(community_memberships.expires_at_ms, 0) then excluded.started_at_ms
           else community_memberships.started_at_ms
         end,
         payment_amount = case
           when excluded.expires_at_ms >= coalesce(community_memberships.expires_at_ms, 0) then excluded.payment_amount
           else community_memberships.payment_amount
         end,
         renewal_pending = case
           when excluded.expires_at_ms >= coalesce(community_memberships.expires_at_ms, 0) then false
           else community_memberships.renewal_pending
         end`,
      [event.communityId, telegramUserId, event.paidAtMs, event.expiresAtMs, event.amount],
    );
    await client.query(
      `insert into community_membership_payments (
         community_id, subscriber_telegram_user_id, gross_amount, creator_amount, platform_fee,
         affiliate_amount, community_affiliate_amount, status, transaction_reference, paid_at_ms
       ) values ($1, $2, $3, $4, $5, $6, '0', 'confirmed', $7, $8)
       on conflict (transaction_reference) do nothing`,
      [
        event.communityId,
        telegramUserId,
        event.amount,
        creatorAmount,
        platformFee,
        affiliateAmount,
        event.txHash,
        event.paidAtMs,
      ],
    );
    await client.query("release savepoint membership_sync");
  } catch (error) {
    await client.query("rollback to savepoint membership_sync");
    console.error("membership sync failed", {
      communityId: event.communityId,
      txHash: event.txHash,
      message: sanitizeError(error),
    });
    throw error;
  }
}

export type ExpiredMembership = {
  communityId: number;
  telegramUserId: string;
  telegramChatId: string;
  expiresAtMs: number;
};

/** Confirmed memberships whose paid period has ended and have not been removed for that period. */
export async function listExpiredSubscriptions(pool: pg.Pool, nowMs: number): Promise<ExpiredMembership[]> {
  const result = await pool.query<{
    community_id: string;
    subscriber_telegram_user_id: string;
    telegram_chat_id: string;
    expires_at_ms: string;
  }>(
    `select m.community_id, m.subscriber_telegram_user_id, m.expires_at_ms, c.telegram_chat_id
     from community_memberships m
     join creator_communities c on c.community_id = m.community_id
     where m.confirmation = 'confirmed'
       and m.expires_at_ms <= $1
       and m.expires_at_ms > 0
       and c.telegram_chat_id is not null
       and m.access_removed_for_expires_at_ms is distinct from m.expires_at_ms
     order by m.expires_at_ms asc
     limit 100`,
    [nowMs],
  );
  return result.rows.map((row) => ({
    communityId: Number(row.community_id),
    telegramUserId: String(row.subscriber_telegram_user_id),
    telegramChatId: row.telegram_chat_id,
    expiresAtMs: Number(row.expires_at_ms),
  }));
}

export async function markAccessRemoved(
  pool: pg.Pool,
  communityId: number,
  telegramUserId: string,
  expiresAtMs: number,
): Promise<void> {
  await pool.query(
    `update community_memberships
     set access_removed_for_expires_at_ms = $3
     where community_id = $1
       and subscriber_telegram_user_id = $2
       and expires_at_ms = $3`,
    [communityId, telegramUserId, expiresAtMs],
  );
}

export type RenewalReminder = {
  communityId: number;
  telegramUserId: string;
  expiresAtMs: number;
  title: string;
};

export async function listDueRenewalReminders(
  pool: pg.Pool,
  nowMs: number,
  untilMs: number,
): Promise<RenewalReminder[]> {
  const result = await pool.query<{
    community_id: string;
    subscriber_telegram_user_id: string;
    expires_at_ms: string;
    title: string;
  }>(
    `select m.community_id, m.subscriber_telegram_user_id, m.expires_at_ms, c.title
     from community_memberships m
     join creator_communities c on c.community_id = m.community_id
     where m.confirmation = 'confirmed'
       and m.expires_at_ms > $1
       and m.expires_at_ms <= $2
       and m.renewal_reminded_for_expires_at_ms is distinct from m.expires_at_ms
     order by m.expires_at_ms asc
     limit 50`,
    [nowMs, untilMs],
  );
  return result.rows.map((row) => ({
    communityId: Number(row.community_id),
    telegramUserId: String(row.subscriber_telegram_user_id),
    expiresAtMs: Number(row.expires_at_ms),
    title: row.title,
  }));
}

export async function markRenewalReminded(
  pool: pg.Pool,
  communityId: number,
  telegramUserId: string,
  expiresAtMs: number,
): Promise<void> {
  await pool.query(
    `update community_memberships
     set renewal_reminded_for_expires_at_ms = $3
     where community_id = $1
       and subscriber_telegram_user_id = $2
       and expires_at_ms = $3`,
    [communityId, telegramUserId, expiresAtMs],
  );
}

export async function platformReferrerPayout(pool: pg.Pool, telegramUserId: string): Promise<string | null> {
  const id = Number(telegramUserId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const result = await pool.query<{ payout_account: string | null }>(
    `select a.payout_account
     from referral_attributions r
     join affiliates a on a.code = r.referrer_code
     where r.telegram_user_id = $1
     limit 1`,
    [id],
  );
  const payout = result.rows[0]?.payout_account?.trim();
  return payout || null;
}

export async function telegramUserIdForTonWallet(pool: pg.Pool, address: string): Promise<string | null> {
  const key = tonWalletKey(address);
  const candidates = [key, address.trim()].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  if (!candidates.length) return null;
  const result = await pool.query<{ telegram_user_id: string }>(
    `select telegram_user_id from telegram_wallets where ton_address = any($1::text[]) limit 1`,
    [candidates],
  );
  const id = result.rows[0]?.telegram_user_id;
  return id == null ? null : String(id);
}

export async function communityChatId(pool: pg.Pool, communityId: number): Promise<string | null> {
  const result = await pool.query<{ telegram_chat_id: string | null }>(
    `select telegram_chat_id from creator_communities where community_id = $1 limit 1`,
    [communityId],
  );
  return result.rows[0]?.telegram_chat_id ?? null;
}

export async function storeMembershipInvite(pool: pg.Pool, txHash: string, inviteLink: string): Promise<void> {
  await pool
    .query(`update community_membership_payments set invite_link = $2 where transaction_reference = $1`, [txHash, inviteLink])
    .catch(() => undefined);
}

export type CommunityReferralConversion = {
  referrerTelegramUserId: string;
  title: string;
  actorName: string;
  referralPercentBps: number;
};

/** The community-program referrer locked for this subscriber, if one was registered. */
export async function communityReferralConversion(
  pool: pg.Pool,
  communityId: number,
  subscriberTelegramUserId: string,
): Promise<CommunityReferralConversion | null> {
  const subscriberId = Number(subscriberTelegramUserId);
  if (!Number.isSafeInteger(communityId) || communityId < 1) return null;
  if (!Number.isSafeInteger(subscriberId) || subscriberId <= 0) return null;
  const result = await pool.query<{
    referrer_telegram_user_id: string;
    bps: string;
    title: string;
    actor_name: string | null;
  }>(
    `select a.referrer_telegram_user_id,
            case when a.referral_percent_bps > 0 then a.referral_percent_bps else c.referral_percent_bps end as bps,
            c.title,
            p.display_name as actor_name
     from community_attributions a
     join creator_communities c on c.community_id = a.community_id
     left join telegram_profiles p on p.telegram_user_id = a.subscriber_telegram_user_id
     where a.community_id = $1 and a.subscriber_telegram_user_id = $2
     limit 1`,
    [communityId, subscriberId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const bps = Number(row.bps);
  return {
    referrerTelegramUserId: String(row.referrer_telegram_user_id),
    title: row.title,
    actorName: row.actor_name?.trim() || "",
    referralPercentBps: Number.isFinite(bps) && bps > 0 ? Math.trunc(bps) : 0,
  };
}

export type IndexerState = {
  lastProcessedLt: string;
  scanLt: string | null;
  scanHash: string | null;
};

export async function readIndexerState(pool: pg.Pool): Promise<IndexerState> {
  const result = await pool.query<{ last_processed_lt: string; scan_lt: string | null; scan_hash: string | null }>(
    `select last_processed_lt::text, scan_lt::text, scan_hash from indexer_state where singleton limit 1`,
  );
  const row = result.rows[0];
  if (!row) return { lastProcessedLt: "0", scanLt: null, scanHash: null };
  return {
    lastProcessedLt: row.last_processed_lt || "0",
    scanLt: row.scan_lt,
    scanHash: row.scan_hash,
  };
}

export async function saveIndexerScan(
  pool: pg.Pool,
  cursorLt: string,
  resume: { lt: string; hash: string },
): Promise<void> {
  await pool.query(
    `insert into indexer_state (singleton, last_processed_lt, scan_lt, scan_hash, last_updated_at)
     values (true, $1, $2, $3, now())
     on conflict (singleton) do update set
       scan_lt = excluded.scan_lt,
       scan_hash = excluded.scan_hash,
       last_updated_at = now()`,
    [cursorLt, resume.lt, resume.hash],
  );
}

export async function saveIndexerCursor(pool: pg.Pool, lastProcessedLt: string): Promise<void> {
  await pool.query(
    `insert into indexer_state (singleton, last_processed_lt, scan_lt, scan_hash, last_updated_at)
     values (true, $1, null, null, now())
     on conflict (singleton) do update set
       last_processed_lt = greatest(indexer_state.last_processed_lt, excluded.last_processed_lt),
       scan_lt = null,
       scan_hash = null,
       last_updated_at = now()`,
    [lastProcessedLt],
  );
}

export async function applyCommunityTerms(
  pool: pg.Pool,
  terms: { communityId: number; price: string; durationDays: number },
): Promise<boolean> {
  const result = await pool.query(
    `update creator_communities
     set price = $2, duration_days = $3
     where community_id = $1`,
    [terms.communityId, terms.price, terms.durationDays],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function storeInviteLink(
  pool: pg.Pool,
  paymentId: number,
  inviteLink: string,
): Promise<void> {
  await pool.query(`update payments set invite_link = $2 where payment_id = $1`, [paymentId, inviteLink]);
}
