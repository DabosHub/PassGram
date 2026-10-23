import { formatCommunityReferralPercent, formatUsdt } from "../money";

export const ADMIN_SECTIONS = ["overview", "communities", "payments", "referrals", "operations"] as const;
export const ADMIN_PERIODS = ["24h", "7d", "30d", "all"] as const;
export const ADMIN_PAGE_SIZE = 50;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

export type AdminQuery = {
  section: AdminSection;
  period: AdminPeriod;
  communityId: number | null;
  page: number;
  /** Lab preview only. The public console always uses /admin. */
  pathBase?: "/admin" | "/admin/preview";
};

export type TreasuryPoint = {
  startMs: number;
  treasury: bigint;
};

export type MonthPoint = {
  startMs: number;
  label: string;
  treasury: bigint;
};

export type IndexerHealth = {
  hasCursor: boolean;
  position: string;
  backlog: boolean;
  updatedAtMs: number | null;
};

export type IndexerAlert = "missing" | "backlog" | "quiet";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const INDEXER_BACKLOG_STALL_MS = 15 * 60 * 1000;
export const INDEXER_QUIET_MS = 6 * HOUR_MS;

const CHANNEL_LABELS: Record<string, string> = {
  not_selected: "No channel yet",
  selection_pending: "Waiting for Telegram",
  verification_pending: "Checking the channel",
  verified: "Verified",
  permission_missing: "Bot is missing a right",
  not_owner: "Owner was not confirmed",
  public_channel: "Channel is public",
  unsupported_channel: "Channel type is not supported",
  telegram_unavailable: "Telegram was unavailable",
  verification_failed: "Verification failed",
};

export function parseAdminQuery(input: {
  section?: string;
  period?: string;
  community?: string;
  page?: string;
}): AdminQuery {
  const section = ADMIN_SECTIONS.includes(input.section as AdminSection) ? (input.section as AdminSection) : "overview";
  const period = ADMIN_PERIODS.includes(input.period as AdminPeriod) ? (input.period as AdminPeriod) : "30d";
  const communityId = parseCommunityId(input.community);
  const page = parsePage(input.page);
  return {
    section,
    period,
    communityId: section === "communities" || section === "payments" ? communityId : null,
    page: section === "payments" ? page : 1,
  };
}

export function parseCommunityId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

export function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return Math.min(page, 200);
}

export function adminPath(query: AdminQuery): string {
  const base = query.pathBase === "/admin/preview" ? "/admin/preview" : "/admin";
  const params = new URLSearchParams();
  if (query.section !== "overview") params.set("section", query.section);
  if (query.period !== "30d") params.set("period", query.period);
  if (query.communityId && (query.section === "communities" || query.section === "payments")) {
    params.set("community", String(query.communityId));
  }
  if (query.section === "payments" && query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function periodStartMs(period: AdminPeriod, now: number): number | null {
  if (period === "24h") return now - 24 * HOUR_MS;
  if (period === "7d") return now - 7 * DAY_MS;
  if (period === "30d") return now - 30 * DAY_MS;
  return null;
}

export function periodLabel(period: AdminPeriod): string {
  if (period === "24h") return "Past 24 hours";
  if (period === "7d") return "Past 7 days";
  if (period === "30d") return "Past 30 days";
  return "All time";
}

export function chartWindow(period: AdminPeriod, now: number): { fromMs: number; bucketMs: number } {
  if (period === "24h") return { fromMs: now - 24 * HOUR_MS, bucketMs: HOUR_MS };
  if (period === "7d") return { fromMs: now - 7 * DAY_MS, bucketMs: DAY_MS };
  if (period === "30d") return { fromMs: now - 30 * DAY_MS, bucketMs: DAY_MS };
  return { fromMs: now - 90 * DAY_MS, bucketMs: DAY_MS };
}

export function fillTreasurySeries(
  fromMs: number,
  now: number,
  bucketMs: number,
  rows: { bucket: number; treasury: bigint }[],
): TreasuryPoint[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(now) || !Number.isFinite(bucketMs) || bucketMs <= 0) return [];
  const end = Math.floor(now / bucketMs);
  let start = Math.floor(fromMs / bucketMs);
  if (end - start > 89) start = end - 89;
  if (start > end) start = end;
  const amounts = new Map(rows.map((row) => [row.bucket, row.treasury]));
  const points: TreasuryPoint[] = [];
  for (let bucket = start; bucket <= end; bucket += 1) {
    points.push({ startMs: bucket * bucketMs, treasury: amounts.get(bucket) ?? 0n });
  }
  return points;
}

/** Twelve calendar months ending with the current month, in UTC. */
export function fillMonthSeries(now: number, rows: { month: string; treasury: bigint }[]): MonthPoint[] {
  const date = new Date(now);
  const amounts = new Map(rows.map((row) => [row.month, row.treasury]));
  const points: MonthPoint[] = [];
  for (let age = 11; age >= 0; age -= 1) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - age, 1));
    const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    points.push({
      startMs: start.getTime(),
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(start),
      treasury: amounts.get(key) ?? 0n,
    });
  }
  return points;
}

export function monthSeriesStartMs(now: number): number {
  return fillMonthSeries(now, [])[0]?.startMs ?? now;
}

/** Change from the previous month. Null when last month had no income. */
export function monthChangeLabel(current: bigint, previous: bigint): string | null {
  if (previous <= 0n) return null;
  if (current === previous) return "Same as last month";
  const percent = Number(((current - previous) * 1000n) / previous) / 10;
  const text = Number.isInteger(percent) ? String(Math.abs(percent)) : Math.abs(percent).toFixed(1);
  return current > previous ? `${text}% above last month` : `${text}% below last month`;
}

export function barPercent(part: bigint, total: bigint): number {
  if (total <= 0n || part <= 0n) return 0;
  if (part >= total) return 100;
  return Number((part * 1000n) / total) / 10;
}

export function indexerAlert(health: IndexerHealth, now: number): IndexerAlert | null {
  if (!health.hasCursor || health.updatedAtMs == null) return "missing";
  const age = now - health.updatedAtMs;
  if (health.backlog && age > INDEXER_BACKLOG_STALL_MS) return "backlog";
  if (age > INDEXER_QUIET_MS) return "quiet";
  return null;
}

export function formatUsdtGrouped(amount: bigint | string): string {
  const text = formatUsdt(amount);
  const negative = text.startsWith("-");
  const [whole, frac] = text.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac ? `${grouped}.${frac}` : grouped;
  return negative ? `-${body}` : body;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

export function formatAdminWhen(ms: number): string {
  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(ms))} UTC`;
}

export function bucketLabel(startMs: number, bucketMs: number): string {
  if (bucketMs <= HOUR_MS) {
    return new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }).format(new Date(startMs));
  }
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(startMs));
}

export function shortenAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

export function txUrl(hash: string, network: "mainnet" | "testnet"): string | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) return null;
  const host = network === "testnet" ? "https://testnet.tonviewer.com" : "https://tonviewer.com";
  return `${host}/transaction/${hash}`;
}

export function referralLabel(enabled: boolean, bps: number): string {
  if (!enabled || bps <= 0) return "Off";
  return `${formatCommunityReferralPercent(bps)}%`;
}

export function channelStateLabel(state: string): string {
  return CHANNEL_LABELS[state] ?? "Needs review";
}

export function communityStatus(row: { active: boolean; paused: boolean }): "Listed" | "Paused" | "Inactive" {
  if (row.paused) return "Paused";
  if (row.active) return "Listed";
  return "Inactive";
}

export function personLabel(name: string, username: string): string {
  const clean = name.trim();
  const handle = username.trim().replace(/^@/, "");
  if (clean && handle) return `${clean} (@${handle})`;
  if (clean) return clean;
  if (handle) return `@${handle}`;
  return "—";
}

export function removalLabel(expiresAtMs: number | null, removedFor: number | null, now: number): string {
  if (expiresAtMs == null || expiresAtMs <= 0) return "—";
  if (expiresAtMs > now) return "Active";
  if (removedFor === expiresAtMs) return "Removed";
  return "Waiting for removal";
}

export function formatPrice(price: string | null): string {
  if (!price || !/^\d+$/.test(price)) return "Not set";
  return `${formatUsdtGrouped(price)} USDT`;
}

export function formatDuration(days: number | null): string {
  if (days == null) return "Not set";
  if (days === 1) return "1 day";
  return `${days} days`;
}
