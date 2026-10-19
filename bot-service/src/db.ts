import pg from "pg";

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

    await client.query("commit");
    return { paymentId, inviteNeeded: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
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

export async function communityChatId(pool: pg.Pool, communityId: number): Promise<string | null> {
  const result = await pool.query<{ telegram_chat_id: string | null }>(
    `select telegram_chat_id from creator_communities where community_id = $1 limit 1`,
    [communityId],
  );
  return result.rows[0]?.telegram_chat_id ?? null;
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
