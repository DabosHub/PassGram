import { Cell } from "@ton/core";
import { fetchWithTimeout } from "./http.ts";

export type TonTraceEvent = {
  txHash: string;
  lt: string;
  utime: number;
  /** Raw body / comment when available for SubscriptionPaid parsing. */
  bodyBase64?: string;
};

/** Opcode of the registry `SubscriptionPaid` event. */
export const SUBSCRIPTION_PAID_OP = 1258072203;
/** Opcode of the registry `CommunityUpdated` event ("CUPD"). */
export const COMMUNITY_UPDATED_OP = 0x43555044;

export type ParsedSubscriptionPaid = {
  communityId: number;
  amount: string;
  subscriber: string;
  creator: string;
  paidAt: number;
  expiresAt: number;
  hasPlatformReferrer: boolean;
  hasCommunityReferrer: boolean;
  communityAffiliateAmount: string;
  creatorAmount: string;
  treasuryAmount: string;
  platformAffiliateAmount: string;
};

export const TRANSACTIONS_PAGE_LIMIT = 100;

export type RegistryTransactionPage = {
  events: TonTraceEvent[];
  oldest: { lt: string; hash: string } | null;
  maxLt: string | null;
  count: number;
};

export function tonCenterHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { "X-API-Key": apiKey } : {};
}

/** TonCenter returns newest first and walks older until `to_lt`. `lt` + `hash` continue that walk. */
export function buildGetTransactionsUrl(input: {
  apiUrl: string;
  address: string;
  limit?: number;
  toLt?: string;
  lt?: string;
  hash?: string;
}): URL {
  const url = new URL(`${input.apiUrl}/getTransactions`);
  url.searchParams.set("address", input.address);
  url.searchParams.set("limit", String(input.limit ?? TRANSACTIONS_PAGE_LIMIT));
  url.searchParams.set("to_lt", input.toLt && input.toLt !== "0" ? input.toLt : "0");
  url.searchParams.set("archival", "true");
  if (input.lt && input.hash) {
    url.searchParams.set("lt", input.lt);
    url.searchParams.set("hash", input.hash);
  }
  return url;
}

export async function fetchRegistryTransactionPage(input: {
  apiUrl: string;
  apiKey: string;
  address: string;
  limit?: number;
  toLt?: string;
  lt?: string;
  hash?: string;
}): Promise<RegistryTransactionPage> {
  const url = buildGetTransactionsUrl(input);
  const response = await fetchWithTimeout(url, { headers: tonCenterHeaders(input.apiKey) });
  if (!response.ok) {
    throw new Error(`TonCenter getTransactions failed (${response.status}).`);
  }
  const json = (await response.json()) as {
    ok?: boolean;
    result?: Array<{
      transaction_id?: { hash?: string; lt?: string };
      utime?: number;
      in_msg?: { msg_data?: { body?: string } };
      out_msgs?: Array<{ msg_data?: { body?: string }; destination?: string }>;
    }>;
  };
  if (!json.ok || !Array.isArray(json.result)) {
    throw new Error("TonCenter getTransactions returned no transaction list.");
  }

  const events: TonTraceEvent[] = [];
  let oldest: { lt: string; hash: string } | null = null;
  let maxLt: string | null = null;
  for (const row of json.result) {
    const hash = row.transaction_id?.hash || "";
    const lt = row.transaction_id?.lt || "0";
    const txHash = hash || `${lt}:${row.utime || 0}`;
    const utime = row.utime || 0;
    if (maxLt == null || BigInt(lt) > BigInt(maxLt)) maxLt = lt;
    oldest = { lt, hash };
    if (row.in_msg?.msg_data?.body) {
      events.push({ txHash, lt, utime, bodyBase64: row.in_msg.msg_data.body });
    }
    for (const out of row.out_msgs || []) {
      if (out.msg_data?.body) {
        events.push({ txHash: `${txHash}:out`, lt, utime, bodyBase64: out.msg_data.body });
      }
    }
  }
  return { events, oldest, maxLt, count: json.result.length };
}

function compareLt(left: string, right: string): number {
  const delta = BigInt(left) - BigInt(right);
  if (delta < 0n) return -1;
  if (delta > 0n) return 1;
  return 0;
}

/**
 * Walks backward from the chain head (or a saved page) until the stored logical time.
 * Events are returned only when that walk is finished, oldest first.
 * A partial walk keeps a resume point and does not advance the cursor.
 */
export async function walkRegistryTransactions(input: {
  loadPage: (query: { limit: number; toLt: string; lt?: string; hash?: string }) => Promise<RegistryTransactionPage>;
  cursorLt: string;
  resume?: { lt: string; hash: string } | null;
  maxPages?: number;
}): Promise<{ events: TonTraceEvent[]; done: boolean; resume: { lt: string; hash: string } | null; maxLt: string }> {
  const cursor = BigInt(input.cursorLt || "0");
  const maxPages = input.maxPages ?? 30;
  let resume = input.resume ?? null;
  const events: TonTraceEvent[] = [];
  let maxLt = cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const batch = await input.loadPage({
      limit: TRANSACTIONS_PAGE_LIMIT,
      toLt: cursor.toString(),
      lt: resume?.lt,
      hash: resume?.hash,
    });
    for (const event of batch.events) {
      if (BigInt(event.lt) > cursor) events.push(event);
    }
    if (batch.maxLt && BigInt(batch.maxLt) > maxLt) maxLt = BigInt(batch.maxLt);
    const reached = batch.count < TRANSACTIONS_PAGE_LIMIT || (batch.oldest != null && BigInt(batch.oldest.lt) <= cursor);
    if (reached || !batch.oldest) {
      events.sort((left, right) => compareLt(left.lt, right.lt));
      return { events, done: true, resume: null, maxLt: maxLt.toString() };
    }
    if (!batch.oldest.hash) {
      throw new Error("TonCenter transaction is missing a hash, so indexing cannot continue.");
    }
    resume = batch.oldest;
  }
  return { events: [], done: false, resume, maxLt: cursor.toString() };
}

/** Listed price and duration. Whole days only, matching the contract's 1–366 day range. */
export function parseCommunityUpdated(bodyBase64: string | undefined): {
  communityId: number;
  price: string;
  durationDays: number;
} | null {
  if (!bodyBase64) return null;
  try {
    const slice = Cell.fromBase64(bodyBase64).beginParse();
    if (slice.remainingBits < 32 || slice.preloadUint(32) !== COMMUNITY_UPDATED_OP) return null;
    slice.loadUint(32);
    const communityId = Number(slice.loadUintBig(64));
    const price = slice.loadCoins().toString();
    const durationSeconds = Number(slice.loadUint(32));
    const durationDays = durationSeconds / 86_400;
    if (!Number.isSafeInteger(communityId) || communityId <= 0) return null;
    if (!/^[1-9][0-9]*$/.test(price)) return null;
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366) return null;
    return { communityId, price, durationDays };
  } catch {
    return null;
  }
}

export function subscriptionExpiryMs(expiresAt: number | undefined): number | null {
  if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return expiresAt * 1000;
}

/**
 * Decode SubscriptionPaid from a BOC body, or a local JSON fixture for tests.
 */
export function parseSubscriptionHint(bodyBase64: string | undefined): {
  communityId: number;
  amount: string;
  hasReferrer: boolean;
  hasPlatformReferrer: boolean;
  subscriber?: string;
  creator?: string;
  paidAt?: number;
  expiresAt?: number;
} | null {
  if (!bodyBase64) return null;

  const paid = tryParseSubscriptionPaidBoc(bodyBase64);
  if (paid) {
    return {
      communityId: paid.communityId,
      amount: paid.amount,
      hasReferrer: paid.hasPlatformReferrer || paid.hasCommunityReferrer,
      hasPlatformReferrer: paid.hasPlatformReferrer,
      subscriber: paid.subscriber,
      creator: paid.creator,
      paidAt: paid.paidAt,
      expiresAt: paid.expiresAt,
    };
  }

  // Local tests may pass a JSON fixture. A production message body is a cell, not this shortcut.
  if (process.env.NODE_ENV === "production") return null;
  try {
    const text = Buffer.from(bodyBase64, "base64").toString("utf8");
    if (!text.startsWith("{")) return null;
    const parsed = JSON.parse(text) as {
      communityId?: number;
      amount?: string;
      hasReferrer?: boolean;
    };
    if (typeof parsed.communityId !== "number" || typeof parsed.amount !== "string") return null;
    return {
      communityId: parsed.communityId,
      amount: parsed.amount,
      hasReferrer: Boolean(parsed.hasReferrer),
      hasPlatformReferrer: Boolean(parsed.hasReferrer),
    };
  } catch {
    return null;
  }
}

export function tryParseSubscriptionPaidBoc(bodyBase64: string): ParsedSubscriptionPaid | null {
  try {
    const cell = Cell.fromBase64(bodyBase64);
    const s = cell.beginParse();
    if (s.remainingBits < 32) return null;
    if (s.preloadUint(32) !== SUBSCRIPTION_PAID_OP) return null;
    s.loadUint(32);
    const subscriber = s.loadAddress();
    const creator = s.loadAddress();
    const communityId = Number(s.loadUintBig(64));
    const amount = s.loadCoins();
    const paidAt = Number(s.loadUint(32));
    const expiresAt = Number(s.loadUint(32));
    const hasPlatformReferrer = s.loadBit();
    const hasCommunityReferrer = s.loadBit();
    const communityAffiliateAmount = s.loadCoins();
    const rest = s.loadRef().beginParse();
    const creatorAmount = rest.loadCoins();
    const treasuryAmount = rest.loadCoins();
    const platformAffiliateAmount = rest.loadCoins();
    if (!subscriber || !creator) return null;
    return {
      communityId,
      amount: amount.toString(),
      subscriber: subscriber.toString(),
      creator: creator.toString(),
      paidAt,
      expiresAt,
      hasPlatformReferrer,
      hasCommunityReferrer,
      communityAffiliateAmount: communityAffiliateAmount.toString(),
      creatorAmount: creatorAmount.toString(),
      treasuryAmount: treasuryAmount.toString(),
      platformAffiliateAmount: platformAffiliateAmount.toString(),
    };
  } catch {
    return null;
  }
}
