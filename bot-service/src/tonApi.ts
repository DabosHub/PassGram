import { Cell } from "@ton/core";

export type TonTraceEvent = {
  txHash: string;
  lt: string;
  utime: number;
  /** Raw body / comment when available for SubscriptionPaid parsing. */
  bodyBase64?: string;
};

/** Opcode of Tact `SubscriptionPaid` event (see contract ABI). */
export const SUBSCRIPTION_PAID_OP = 1258072203;

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

/**
 * Polls TonCenter for recent transactions on the PassGram registry.
 * Collects inbound bodies and outbound external emits (`SubscriptionPaid`).
 */
export async function fetchRegistryTransactions(input: {
  apiUrl: string;
  apiKey: string;
  address: string;
  limit?: number;
}): Promise<TonTraceEvent[]> {
  const url = new URL(`${input.apiUrl}/getTransactions`);
  url.searchParams.set("address", input.address);
  url.searchParams.set("limit", String(input.limit ?? 20));
  if (input.apiKey) url.searchParams.set("api_key", input.apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    console.error("ton api", response.status, await response.text());
    return [];
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
  if (!json.ok || !Array.isArray(json.result)) return [];

  const events: TonTraceEvent[] = [];
  for (const row of json.result) {
    const txHash = row.transaction_id?.hash || `${row.transaction_id?.lt || "0"}:${row.utime || 0}`;
    const lt = row.transaction_id?.lt || "0";
    const utime = row.utime || 0;
    if (row.in_msg?.msg_data?.body) {
      events.push({ txHash, lt, utime, bodyBase64: row.in_msg.msg_data.body });
    }
    for (const out of row.out_msgs || []) {
      if (out.msg_data?.body) {
        events.push({
          txHash: `${txHash}:out`,
          lt,
          utime,
          bodyBase64: out.msg_data.body,
        });
      }
    }
  }
  return events;
}

/**
 * Decode SubscriptionPaid from a BOC body, or a local JSON fixture for tests.
 */
export function parseSubscriptionHint(bodyBase64: string | undefined): {
  communityId: number;
  amount: string;
  hasReferrer: boolean;
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
      subscriber: paid.subscriber,
      creator: paid.creator,
      paidAt: paid.paidAt,
      expiresAt: paid.expiresAt,
    };
  }

  // Debug JSON fixture used in local tests
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
