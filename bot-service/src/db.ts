import pg from "pg";
import { tonWalletKey } from "./walletKey.ts";

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
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
  telegramUserId?: string | null;
};

export async function upsertPaymentAndSubscription(
  pool: pg.Pool,
  event: SubscriptionPaidEvent,
): Promise<{ paymentId: number; inviteNeeded: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ payment_id: string }>(
      `select payment_id from payments where tx_hash = $1 limit 1`,
      [event.txHash],
    );
    if (existing.rowCount && existing.rows[0]) {
      await client.query("commit");
      return { paymentId: Number(existing.rows[0].payment_id), inviteNeeded: false };
    }

    const paymentIdRes = await client.query<{ id: string }>(
      `select coalesce(max(payment_id), 0) + 1 as id from payments`,
    );
    const paymentId = Number(paymentIdRes.rows[0]?.id || 1);
    const platformBps = 250n;
    const treasuryBps = event.referrer ? 200n : 250n;
    const referrerBps = event.referrer ? 50n : 0n;
    const gross = BigInt(event.amount);
    const treasury = (gross * treasuryBps) / 10_000n;
    const referrerAmt = (gross * referrerBps) / 10_000n;
    const creatorAmt = gross - treasury - referrerAmt;
    void platformBps;

    await client.query(
      `insert into payments (
        payment_id, community_id, subscriber_account_id, creator_account_id, payout_account,
        gross_amount, creator_amount, treasury_amount, referrer_account_id, referrer_amount,
        paid_at_ms, expires_at_ms, tx_hash
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        paymentId,
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

    await client.query(
      `insert into subscriptions (community_id, subscriber_account_id, expires_at_ms, last_payment_id)
       values ($1, $2, $3, $4)
       on conflict (community_id, subscriber_account_id)
       do update set expires_at_ms = excluded.expires_at_ms, last_payment_id = excluded.last_payment_id`,
      [event.communityId, event.subscriber, event.expiresAtMs, paymentId],
    );

    await syncMembership(client, event, creatorAmt.toString(), treasury.toString(), referrerAmt.toString());

    await client.query("commit");
    return { paymentId, inviteNeeded: true };
  } catch (error) {
    await client.query("rollback");
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
         started_at_ms = excluded.started_at_ms,
         expires_at_ms = excluded.expires_at_ms,
         payment_amount = excluded.payment_amount,
         renewal_pending = false`,
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
  } catch {
    await client.query("rollback to savepoint membership_sync");
  }
}

export async function listExpiredSubscriptions(
  pool: pg.Pool,
  nowMs: number,
): Promise<Array<{ communityId: number; subscriberAccountId: string; telegramChatId: string | null; telegramUserId: string | null }>> {
  const result = await pool.query<{
    community_id: string;
    subscriber_account_id: string;
    telegram_chat_id: string | null;
  }>(
    `select s.community_id, s.subscriber_account_id, cc.telegram_chat_id
     from subscriptions s
     left join creator_communities cc on cc.community_id = s.community_id
     where s.expires_at_ms <= $1
     order by s.expires_at_ms asc
     limit 100`,
    [nowMs],
  );
  return result.rows.map((row) => ({
    communityId: Number(row.community_id),
    subscriberAccountId: row.subscriber_account_id,
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.subscriber_account_id.startsWith("tg:")
      ? row.subscriber_account_id.slice(3)
      : null,
  }));
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

export async function storeInviteLink(
  pool: pg.Pool,
  paymentId: number,
  inviteLink: string,
): Promise<void> {
  await pool.query(`update payments set invite_link = $2 where payment_id = $1`, [paymentId, inviteLink]).catch(() => {
    // Column may be added by migration 005; ignore if absent until migrated.
  });
}
