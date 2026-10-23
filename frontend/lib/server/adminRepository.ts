import { Pool } from "pg";
import { databaseSsl } from "./databaseSsl";
import {
  ADMIN_PAGE_SIZE,
  chartWindow,
  fillMonthSeries,
  fillTreasurySeries,
  monthSeriesStartMs,
  periodStartMs,
  type AdminPeriod,
  type AdminQuery,
  type IndexerHealth,
  type MonthPoint,
  type TreasuryPoint,
} from "./adminView";

export class AdminDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminDataError";
  }
}

export type AdminViewer = {
  name: string;
  username: string;
};

export type Overview = {
  gross: bigint;
  paymentCount: number;
  treasury: bigint;
  creator: bigint;
  platformAffiliate: bigint;
  communityAffiliate: bigint | null;
  activeSubscribers: number;
  listed: number;
  paused: number;
  unverified: number;
  series: TreasuryPoint[];
  mmr: MonthPoint[];
  paymentsWithoutMembership: number;
  expiredNotRemoved: number;
  indexer: IndexerHealth;
};

export type CommunityRow = {
  communityId: number;
  title: string;
  ownerTelegramUserId: string;
  price: string | null;
  durationDays: number | null;
  referralEnabled: boolean;
  referralBps: number;
  active: boolean;
  paused: boolean;
  verificationStatus: string;
  memberCount: number | null;
  paidSubscribers: number;
  paymentCount: number;
  gross: bigint;
  treasury: bigint;
};

export type PaymentRow = {
  paidAtMs: number;
  communityId: number;
  title: string;
  gross: bigint;
  creator: bigint;
  treasury: bigint;
  platformAffiliate: bigint;
  communityAffiliate: bigint | null;
  txHash: string;
};

export type MembershipRow = {
  telegramUserId: string;
  name: string;
  username: string;
  expiresAtMs: number | null;
  removedForExpiresAtMs: number | null;
};

export type AttributionRow = {
  subscriberTelegramUserId: string;
  subscriberName: string;
  subscriberUsername: string;
  referrerTelegramUserId: string;
  referrerName: string;
  code: string;
  bps: number;
  lockedAtMs: number | null;
};

export type MarketerLink = {
  code: string;
  telegramUserId: string;
  payoutAccount: string | null;
};

export type CommunityDetail = CommunityRow & {
  description: string;
  payoutAccount: string | null;
  canInvite: boolean;
  canRestrict: boolean;
  payments: PaymentRow[];
  memberships: MembershipRow[];
  links: MarketerLink[];
  attributions: AttributionRow[];
};

export type PlatformMarketer = {
  code: string;
  telegramUserId: string;
  payoutAccount: string;
  attributed: number;
  paymentCount: number;
  paid: bigint;
};

export type CommunityMarketer = {
  communityId: number;
  title: string;
  code: string;
  telegramUserId: string;
  payoutAccount: string | null;
  attributed: number;
  recorded: number;
  paid: bigint;
};

export type UnassignedShare = {
  paymentCount: number;
  paid: bigint;
};

export type OpenPayment = {
  paidAtMs: number;
  communityId: number;
  title: string;
  gross: bigint;
  txHash: string;
};

export type OpenRemoval = {
  communityId: number;
  title: string;
  telegramUserId: string;
  name: string;
  username: string;
  expiresAtMs: number;
};

export type BotRightGap = {
  communityId: number;
  title: string;
  canInvite: boolean;
  canRestrict: boolean;
};

export type StuckSelection = {
  requestId: number;
  ownerTelegramUserId: string;
  status: string;
  createdAtMs: number;
};

export type Operations = {
  indexer: IndexerHealth;
  wallets: number;
  profiles: number;
  paymentsWithoutMembership: number;
  openPayments: OpenPayment[];
  expiredNotRemoved: number;
  openRemovals: OpenRemoval[];
  botGaps: BotRightGap[];
  stuckSelections: StuckSelection[];
};

export type AdminData =
  | { section: "overview"; overview: Overview }
  | { section: "communities"; communities: CommunityRow[]; truncated: boolean; detail: CommunityDetail | null; missingDetail: boolean }
  | { section: "payments"; rows: PaymentRow[]; hasMore: boolean; filterTitle: string | null; missingFilter: boolean }
  | { section: "referrals"; platform: PlatformMarketer[]; unassigned: UnassignedShare | null; community: CommunityMarketer[] }
  | { section: "operations"; operations: Operations };

const globalPools = globalThis as { passgramAdminPool?: Pool };

function pool(): Pool {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new AdminDataError("Community storage is not configured.");
  if (!globalPools.passgramAdminPool) {
    globalPools.passgramAdminPool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseSsl(databaseUrl),
      max: 4,
      query_timeout: 8000,
      statement_timeout: 8000,
    });
  }
  return globalPools.passgramAdminPool;
}

export async function loadAdminViewer(userId: number): Promise<AdminViewer> {
  try {
    const rows = await pool().query<{ display_name: string; username: string }>(
      `select display_name, username from telegram_profiles where telegram_user_id = $1`,
      [userId],
    );
    const row = rows.rows[0];
    return { name: row?.display_name?.trim() || "", username: row?.username?.trim() || "" };
  } catch (error) {
    if (error instanceof AdminDataError) throw error;
    logAdminError(error);
    throw new AdminDataError("The ledger could not be loaded.");
  }
}

export async function loadAdminConsole(query: AdminQuery, now = Date.now()): Promise<AdminData> {
  try {
    const from = periodStartMs(query.period, now);
    if (query.section === "overview") return { section: "overview", overview: await loadOverview(query.period, from, now) };
    if (query.section === "communities") return { section: "communities", ...(await loadCommunities(query, from, now)) };
    if (query.section === "payments") return { section: "payments", ...(await loadPayments(query, from)) };
    if (query.section === "referrals") return { section: "referrals", ...(await loadReferrals(from)) };
    return { section: "operations", operations: await loadOperations(now) };
  } catch (error) {
    if (error instanceof AdminDataError) throw error;
    logAdminError(error);
    throw new AdminDataError("The ledger could not be loaded.");
  }
}

async function loadOverview(period: AdminPeriod, from: number | null, now: number): Promise<Overview> {
  const chart = chartWindow(period, now);
  const monthsFrom = monthSeriesStartMs(now);
  const [money, subscribers, communities, series, months, missingMembership, waitingRemoval, indexer] = await Promise.all([
    one<{
      payment_count: string;
      gross: string;
      treasury: string;
      creator: string;
      platform_affiliate: string;
      community_affiliate: string;
      community_affiliate_rows: string;
    }>(
      `select count(*)::text as payment_count,
              coalesce(sum(gross_amount::numeric), 0)::text as gross,
              coalesce(sum(treasury_amount::numeric), 0)::text as treasury,
              coalesce(sum(creator_amount::numeric), 0)::text as creator,
              coalesce(sum(referrer_amount::numeric), 0)::text as platform_affiliate,
              coalesce(sum(community_affiliate_amount::numeric), 0)::text as community_affiliate,
              count(community_affiliate_amount)::text as community_affiliate_rows
       from payments
       where ($1::bigint is null or paid_at_ms >= $1)`,
      [from],
    ),
    one<{ active_subscribers: string }>(
      `select count(*)::text as active_subscribers
       from community_memberships
       where confirmation = 'confirmed' and expires_at_ms > $1`,
      [now],
    ),
    one<{ listed: string; paused: string; unverified: string }>(
      `select count(*) filter (where active and not paused)::text as listed,
              count(*) filter (where paused)::text as paused,
              count(*) filter (where verification_status <> 'verified')::text as unverified
       from creator_communities`,
      [],
    ),
    many<{ bucket: string; treasury: string }>(
      `select (paid_at_ms / $2)::bigint::text as bucket,
              coalesce(sum(treasury_amount::numeric), 0)::text as treasury
       from payments
       where paid_at_ms >= $1
       group by 1
       order by 1`,
      [chart.fromMs, chart.bucketMs],
    ),
    many<{ month: string; treasury: string }>(
      `select to_char((timestamp with time zone 'epoch' + (paid_at_ms / 1000) * interval '1 second') at time zone 'utc', 'YYYY-MM') as month,
              coalesce(sum(treasury_amount::numeric), 0)::text as treasury
       from payments
       where paid_at_ms >= $1
       group by 1
       order by 1`,
      [monthsFrom],
    ),
    one<{ missing: string }>(
      `select count(*)::text as missing
       from payments p
       where not exists (
         select 1 from community_membership_payments m where m.transaction_reference = p.tx_hash
       )`,
      [],
    ),
    one<{ waiting: string }>(removalCountSql(), [now]),
    readIndexer(),
  ]);
  const paymentCount = count(money.payment_count);
  const recordedAffiliate = count(money.community_affiliate_rows);
  return {
    gross: baseUnits(money.gross),
    paymentCount,
    treasury: baseUnits(money.treasury),
    creator: baseUnits(money.creator),
    platformAffiliate: baseUnits(money.platform_affiliate),
    communityAffiliate: paymentCount > 0 && recordedAffiliate === 0 ? null : baseUnits(money.community_affiliate),
    activeSubscribers: count(subscribers.active_subscribers),
    listed: count(communities.listed),
    paused: count(communities.paused),
    unverified: count(communities.unverified),
    series: fillTreasurySeries(
      chart.fromMs,
      now,
      chart.bucketMs,
      series.map((row) => ({ bucket: count(row.bucket), treasury: baseUnits(row.treasury) })),
    ),
    mmr: fillMonthSeries(
      now,
      months.map((row) => ({ month: row.month.trim(), treasury: baseUnits(row.treasury) })),
    ),
    paymentsWithoutMembership: count(missingMembership.missing),
    expiredNotRemoved: count(waitingRemoval.waiting),
    indexer,
  };
}

async function loadCommunities(
  query: AdminQuery,
  from: number | null,
  now: number,
): Promise<{ communities: CommunityRow[]; truncated: boolean; detail: CommunityDetail | null; missingDetail: boolean }> {
  if (query.communityId) {
    const detail = await loadCommunityDetail(query.communityId, from, now);
    return { communities: [], truncated: false, detail, missingDetail: detail == null };
  }
  const rows = await many<CommunitySql>(communityListSql(), [from, now]);
  const truncated = rows.length > 200;
  return {
    communities: rows.slice(0, 200).map(mapCommunity),
    truncated,
    detail: null,
    missingDetail: false,
  };
}

async function loadCommunityDetail(communityId: number, from: number | null, now: number): Promise<CommunityDetail | null> {
  const row = await maybe<CommunitySql & { description: string | null; payout_account: string | null; bot_can_invite_users: boolean; bot_can_restrict_members: boolean }>(
    `${communitySelectSql()},
            c.description,
            c.payout_account,
            c.bot_can_invite_users,
            c.bot_can_restrict_members
     ${communityFromSql()}
     where c.community_id = $3`,
    [from, now, communityId],
  );
  if (!row) return null;
  const [payments, memberships, links, attributions] = await Promise.all([
    many<PaymentSql>(paymentSql(), [from, communityId, 20, 0]),
    many<{
      subscriber_telegram_user_id: string;
      display_name: string | null;
      username: string | null;
      expires_at_ms: string | null;
      access_removed_for_expires_at_ms: string | null;
    }>(
      `select m.subscriber_telegram_user_id::text,
              pr.display_name,
              pr.username,
              m.expires_at_ms::text,
              m.access_removed_for_expires_at_ms::text
       from community_memberships m
       left join telegram_profiles pr on pr.telegram_user_id = m.subscriber_telegram_user_id
       where m.community_id = $1
       order by m.expires_at_ms desc nulls last
       limit 100`,
      [communityId],
    ),
    many<{ referrer_code: string; referrer_telegram_user_id: string; payout_account: string | null }>(
      `select referrer_code, referrer_telegram_user_id::text, payout_account
       from community_referral_links
       where community_id = $1
       order by created_at desc
       limit 20`,
      [communityId],
    ),
    many<{
      subscriber_telegram_user_id: string;
      subscriber_name: string | null;
      subscriber_username: string | null;
      referrer_telegram_user_id: string;
      referrer_name: string | null;
      referrer_code: string;
      referral_percent_bps: number | string;
      locked_at: Date | null;
    }>(
      `select a.subscriber_telegram_user_id::text,
              s.display_name as subscriber_name,
              s.username as subscriber_username,
              a.referrer_telegram_user_id::text,
              r.display_name as referrer_name,
              a.referrer_code,
              a.referral_percent_bps,
              a.locked_at
       from community_attributions a
       left join telegram_profiles s on s.telegram_user_id = a.subscriber_telegram_user_id
       left join telegram_profiles r on r.telegram_user_id = a.referrer_telegram_user_id
       where a.community_id = $1
       order by a.locked_at desc
       limit 20`,
      [communityId],
    ),
  ]);
  return {
    ...mapCommunity(row),
    description: row.description?.trim() || "",
    payoutAccount: textOrNull(row.payout_account),
    canInvite: row.bot_can_invite_users === true,
    canRestrict: row.bot_can_restrict_members === true,
    payments: payments.map(mapPayment),
    memberships: memberships.map((item) => ({
      telegramUserId: item.subscriber_telegram_user_id,
      name: item.display_name?.trim() || "",
      username: item.username?.trim() || "",
      expiresAtMs: optionalMs(item.expires_at_ms),
      removedForExpiresAtMs: optionalMs(item.access_removed_for_expires_at_ms),
    })),
    links: links.map((item) => ({
      code: item.referrer_code,
      telegramUserId: item.referrer_telegram_user_id,
      payoutAccount: textOrNull(item.payout_account),
    })),
    attributions: attributions.map((item) => ({
      subscriberTelegramUserId: item.subscriber_telegram_user_id,
      subscriberName: item.subscriber_name?.trim() || "",
      subscriberUsername: item.subscriber_username?.trim() || "",
      referrerTelegramUserId: item.referrer_telegram_user_id,
      referrerName: item.referrer_name?.trim() || "",
      code: item.referrer_code,
      bps: optionalInt(item.referral_percent_bps) ?? 0,
      lockedAtMs: item.locked_at instanceof Date ? item.locked_at.getTime() : null,
    })),
  };
}

async function loadPayments(
  query: AdminQuery,
  from: number | null,
): Promise<{ rows: PaymentRow[]; hasMore: boolean; filterTitle: string | null; missingFilter: boolean }> {
  const limit = ADMIN_PAGE_SIZE + 1;
  const offset = (query.page - 1) * ADMIN_PAGE_SIZE;
  let filterTitle: string | null = null;
  let missingFilter = false;
  if (query.communityId) {
    const found = await maybe<{ title: string }>(`select title from creator_communities where community_id = $1`, [query.communityId]);
    if (!found) missingFilter = true;
    else filterTitle = found.title?.trim() || "Untitled";
  }
  const rows = missingFilter
    ? []
    : await many<PaymentSql>(paymentSql(), [from, query.communityId, limit, offset]);
  return {
    rows: rows.slice(0, ADMIN_PAGE_SIZE).map(mapPayment),
    hasMore: rows.length > ADMIN_PAGE_SIZE,
    filterTitle,
    missingFilter,
  };
}

async function loadReferrals(from: number | null): Promise<{
  platform: PlatformMarketer[];
  unassigned: UnassignedShare | null;
  community: CommunityMarketer[];
}> {
  const [platform, unassigned, community] = await Promise.all([
    many<{
      code: string;
      telegram_user_id: string;
      payout_account: string;
      attributed: string;
      payment_count: string;
      paid: string;
    }>(
      `select a.code,
              a.telegram_user_id::text,
              a.payout_account,
              (select count(*)::text from referral_attributions r where r.referrer_code = a.code) as attributed,
              count(p.payment_id)::text as payment_count,
              coalesce(sum(p.referrer_amount::numeric), 0)::text as paid
       from affiliates a
       left join payments p
         on p.referrer_account_id = a.payout_account
        and ($1::bigint is null or p.paid_at_ms >= $1)
       group by a.code, a.telegram_user_id, a.payout_account
       order by coalesce(sum(p.referrer_amount::numeric), 0) desc, a.code`,
      [from],
    ),
    one<{ payment_count: string; paid: string }>(
      `select count(*)::text as payment_count,
              coalesce(sum(referrer_amount::numeric), 0)::text as paid
       from payments
       where referrer_account_id is null
         and referrer_amount::numeric > 0
         and ($1::bigint is null or paid_at_ms >= $1)`,
      [from],
    ),
    many<{
      community_id: string;
      title: string;
      referrer_code: string;
      referrer_telegram_user_id: string;
      payout_account: string | null;
      attributed: string;
      recorded: string;
      paid: string;
    }>(
      `select l.community_id::text,
              c.title,
              l.referrer_code,
              l.referrer_telegram_user_id::text,
              l.payout_account,
              (select count(*)::text
               from community_attributions a
               where a.community_id = l.community_id
                 and a.referrer_telegram_user_id = l.referrer_telegram_user_id) as attributed,
              count(p.community_affiliate_amount)::text as recorded,
              coalesce(sum(p.community_affiliate_amount::numeric), 0)::text as paid
       from community_referral_links l
       join creator_communities c on c.community_id = l.community_id
       left join payments p
         on p.community_id = l.community_id
        and l.payout_account is not null
        and p.community_referrer_account_id = l.payout_account
        and ($1::bigint is null or p.paid_at_ms >= $1)
       group by l.community_id, c.title, l.referrer_code, l.referrer_telegram_user_id, l.payout_account
       order by c.title, l.referrer_code`,
      [from],
    ),
  ]);
  const unassignedCount = count(unassigned.payment_count);
  return {
    platform: platform.map((row) => ({
      code: row.code,
      telegramUserId: row.telegram_user_id,
      payoutAccount: row.payout_account,
      attributed: count(row.attributed),
      paymentCount: count(row.payment_count),
      paid: baseUnits(row.paid),
    })),
    unassigned: unassignedCount > 0 ? { paymentCount: unassignedCount, paid: baseUnits(unassigned.paid) } : null,
    community: community.map((row) => ({
      communityId: count(row.community_id),
      title: row.title?.trim() || "Untitled",
      code: row.referrer_code,
      telegramUserId: row.referrer_telegram_user_id,
      payoutAccount: textOrNull(row.payout_account),
      attributed: count(row.attributed),
      recorded: count(row.recorded),
      paid: baseUnits(row.paid),
    })),
  };
}

async function loadOperations(now: number): Promise<Operations> {
  const [indexer, counts, missing, openPayments, waiting, openRemovals, botGaps, stuck] = await Promise.all([
    readIndexer(),
    one<{ wallets: string; profiles: string }>(
      `select (select count(*)::text from telegram_wallets) as wallets,
              (select count(*)::text from telegram_profiles) as profiles`,
      [],
    ),
    one<{ missing: string }>(
      `select count(*)::text as missing
       from payments p
       where not exists (
         select 1 from community_membership_payments m where m.transaction_reference = p.tx_hash
       )`,
      [],
    ),
    many<{ paid_at_ms: string; community_id: string; title: string | null; gross_amount: string; tx_hash: string }>(
      `select p.paid_at_ms::text, p.community_id::text, c.title, p.gross_amount, p.tx_hash
       from payments p
       left join creator_communities c on c.community_id = p.community_id
       where not exists (
         select 1 from community_membership_payments m where m.transaction_reference = p.tx_hash
       )
       order by p.paid_at_ms desc
       limit 20`,
      [],
    ),
    one<{ waiting: string }>(removalCountSql(), [now]),
    many<{
      community_id: string;
      title: string;
      subscriber_telegram_user_id: string;
      display_name: string | null;
      username: string | null;
      expires_at_ms: string;
    }>(
      `select m.community_id::text, c.title, m.subscriber_telegram_user_id::text,
              pr.display_name, pr.username, m.expires_at_ms::text
       from community_memberships m
       join creator_communities c on c.community_id = m.community_id
       left join telegram_profiles pr on pr.telegram_user_id = m.subscriber_telegram_user_id
       where m.confirmation = 'confirmed'
         and m.expires_at_ms <= $1
         and m.expires_at_ms > 0
         and c.telegram_chat_id is not null
         and m.access_removed_for_expires_at_ms is distinct from m.expires_at_ms
       order by m.expires_at_ms asc
       limit 20`,
      [now],
    ),
    many<{ community_id: string; title: string; bot_can_invite_users: boolean; bot_can_restrict_members: boolean }>(
      `select community_id::text, title, bot_can_invite_users, bot_can_restrict_members
       from creator_communities
       where verification_status = 'verified'
         and (bot_can_invite_users = false or bot_can_restrict_members = false)
       order by title
       limit 50`,
      [],
    ),
    many<{ request_id: number | string; owner_telegram_user_id: string; status: string; created_at: Date }>(
      `select request_id, owner_telegram_user_id::text, status, created_at
       from channel_selection_requests
       where status in ('selection_pending', 'verification_pending')
         and created_at < now() - interval '15 minutes'
       order by created_at
       limit 50`,
      [],
    ),
  ]);
  return {
    indexer,
    wallets: count(counts.wallets),
    profiles: count(counts.profiles),
    paymentsWithoutMembership: count(missing.missing),
    openPayments: openPayments.map((row) => ({
      paidAtMs: count(row.paid_at_ms),
      communityId: count(row.community_id),
      title: row.title?.trim() || "Untitled",
      gross: baseUnits(row.gross_amount),
      txHash: row.tx_hash,
    })),
    expiredNotRemoved: count(waiting.waiting),
    openRemovals: openRemovals.map((row) => ({
      communityId: count(row.community_id),
      title: row.title?.trim() || "Untitled",
      telegramUserId: row.subscriber_telegram_user_id,
      name: row.display_name?.trim() || "",
      username: row.username?.trim() || "",
      expiresAtMs: count(row.expires_at_ms),
    })),
    botGaps: botGaps.map((row) => ({
      communityId: count(row.community_id),
      title: row.title?.trim() || "Untitled",
      canInvite: row.bot_can_invite_users === true,
      canRestrict: row.bot_can_restrict_members === true,
    })),
    stuckSelections: stuck.map((row) => ({
      requestId: count(row.request_id),
      ownerTelegramUserId: row.owner_telegram_user_id,
      status: row.status,
      createdAtMs: row.created_at instanceof Date ? row.created_at.getTime() : 0,
    })),
  };
}

type CommunitySql = {
  community_id: string;
  title: string;
  owner_telegram_user_id: string;
  price: string | null;
  duration_days: number | string | null;
  referral_enabled: boolean;
  referral_percent_bps: number | string;
  active: boolean;
  paused: boolean;
  verification_status: string;
  telegram_member_count: number | string | null;
  paid_subscribers: string;
  payment_count: string;
  gross: string;
  treasury: string;
};

type PaymentSql = {
  paid_at_ms: string;
  community_id: string;
  title: string | null;
  gross_amount: string;
  creator_amount: string;
  treasury_amount: string;
  referrer_amount: string;
  community_affiliate_amount: string | null;
  tx_hash: string;
};

function communitySelectSql(): string {
  return `select c.community_id::text,
            c.title,
            c.owner_telegram_user_id::text,
            c.price,
            c.duration_days,
            c.referral_enabled,
            c.referral_percent_bps,
            c.active,
            c.paused,
            c.verification_status,
            c.telegram_member_count,
            coalesce(members.paid_count, 0)::text as paid_subscribers,
            coalesce(pay.payment_count, 0)::text as payment_count,
            coalesce(pay.gross, 0)::text as gross,
            coalesce(pay.treasury, 0)::text as treasury`;
}

function communityFromSql(): string {
  return `from creator_communities c
     left join (
       select community_id, count(*) as paid_count
       from community_memberships
       where confirmation = 'confirmed' and expires_at_ms > $2
       group by community_id
     ) members on members.community_id = c.community_id
     left join (
       select community_id,
              count(*) as payment_count,
              coalesce(sum(gross_amount::numeric), 0) as gross,
              coalesce(sum(treasury_amount::numeric), 0) as treasury
       from payments
       where ($1::bigint is null or paid_at_ms >= $1)
       group by community_id
     ) pay on pay.community_id = c.community_id`;
}

function communityListSql(): string {
  return `${communitySelectSql()}
     ${communityFromSql()}
     order by coalesce(pay.treasury, 0) desc, c.title
     limit 201`;
}

function paymentSql(): string {
  return `select p.paid_at_ms::text,
            p.community_id::text,
            c.title,
            p.gross_amount,
            p.creator_amount,
            p.treasury_amount,
            p.referrer_amount,
            p.community_affiliate_amount,
            p.tx_hash
     from payments p
     left join creator_communities c on c.community_id = p.community_id
     where ($1::bigint is null or p.paid_at_ms >= $1)
       and ($2::bigint is null or p.community_id = $2)
     order by p.paid_at_ms desc
     limit $3 offset $4`;
}

function removalCountSql(): string {
  return `select count(*)::text as waiting
     from community_memberships m
     join creator_communities c on c.community_id = m.community_id
     where m.confirmation = 'confirmed'
       and m.expires_at_ms <= $1
       and m.expires_at_ms > 0
       and c.telegram_chat_id is not null
       and m.access_removed_for_expires_at_ms is distinct from m.expires_at_ms`;
}

function mapCommunity(row: CommunitySql): CommunityRow {
  const price = row.price?.trim() || null;
  return {
    communityId: count(row.community_id),
    title: row.title?.trim() || "Untitled",
    ownerTelegramUserId: row.owner_telegram_user_id,
    price: price && /^\d+$/.test(price) ? price : null,
    durationDays: optionalInt(row.duration_days),
    referralEnabled: row.referral_enabled === true,
    referralBps: optionalInt(row.referral_percent_bps) ?? 0,
    active: row.active === true,
    paused: row.paused === true,
    verificationStatus: row.verification_status || "verification_failed",
    memberCount: optionalInt(row.telegram_member_count),
    paidSubscribers: count(row.paid_subscribers),
    paymentCount: count(row.payment_count),
    gross: baseUnits(row.gross),
    treasury: baseUnits(row.treasury),
  };
}

function mapPayment(row: PaymentSql): PaymentRow {
  return {
    paidAtMs: count(row.paid_at_ms),
    communityId: count(row.community_id),
    title: row.title?.trim() || "Untitled",
    gross: baseUnits(row.gross_amount),
    creator: baseUnits(row.creator_amount),
    treasury: baseUnits(row.treasury_amount),
    platformAffiliate: baseUnits(row.referrer_amount),
    communityAffiliate: row.community_affiliate_amount == null ? null : baseUnits(row.community_affiliate_amount),
    txHash: row.tx_hash,
  };
}

async function readIndexer(): Promise<IndexerHealth> {
  const row = await maybe<{ last_processed_lt: string; scan_lt: string | null; last_updated_at: Date }>(
    `select last_processed_lt::text, scan_lt::text, last_updated_at
     from indexer_state
     where singleton
     limit 1`,
    [],
  );
  if (!row) return { hasCursor: false, position: "0", backlog: false, updatedAtMs: null };
  return {
    hasCursor: true,
    position: row.last_processed_lt || "0",
    backlog: row.scan_lt != null && row.scan_lt !== "",
    updatedAtMs: row.last_updated_at instanceof Date ? row.last_updated_at.getTime() : null,
  };
}

async function one<T>(sql: string, params: unknown[]): Promise<T> {
  const rows = await many<T>(sql, params);
  const row = rows[0];
  if (!row) throw new AdminDataError("The ledger could not be loaded.");
  return row;
}

async function maybe<T>(sql: string, params: unknown[]): Promise<T | null> {
  const rows = await many<T>(sql, params);
  return rows[0] ?? null;
}

async function many<T>(sql: string, params: unknown[]): Promise<T[]> {
  const result = await pool().query(sql, params);
  return result.rows as T[];
}

function count(value: unknown): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) throw new AdminDataError("The ledger could not be loaded.");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new AdminDataError("The ledger could not be loaded.");
  return parsed;
}

function baseUnits(value: unknown): bigint {
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!/^\d+(\.0+)?$/.test(text)) throw new AdminDataError("The ledger could not be loaded.");
  return BigInt(text.split(".")[0] || "0");
}

function optionalInt(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function optionalMs(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function textOrNull(value: string | null): string | null {
  const text = value?.trim() || "";
  return text || null;
}

function logAdminError(error: unknown): void {
  const message = error instanceof Error ? error.message : "unknown";
  if (/postgres(ql)?:|password|token|secret/i.test(message)) {
    console.error("admin ledger failed");
    return;
  }
  console.error("admin ledger failed", message.slice(0, 300));
}
