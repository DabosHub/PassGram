import assert from "node:assert/strict";
import test from "node:test";
import { upsertPaymentAndSubscription, type SubscriptionPaidEvent } from "./db.ts";

const event: SubscriptionPaidEvent = {
  txHash: "tx-1",
  subscriber: "EQ_subscriber",
  creator: "EQ_creator",
  communityId: 7,
  amount: "1000000",
  paidAtMs: 1_000,
  expiresAtMs: 2_000,
  referrer: null,
  telegramUserId: "42",
};

function poolFor(inserted: boolean) {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("on conflict (tx_hash)")) {
        return { rows: [{ payment_id: "9", inserted }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    queries,
    pool: { connect: async () => client },
  };
}

test("a repeated chain transaction does not create another payment or invite", async () => {
  const { pool, queries } = poolFor(false);
  const result = await upsertPaymentAndSubscription(pool as never, event);
  assert.deepEqual(result, { paymentId: 9, inviteNeeded: false });
  assert.equal(queries.some((sql) => sql.includes("max(payment_id)")), false);
  assert.equal(queries.some((sql) => sql.includes("on conflict (tx_hash)")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into subscriptions")), false);
});

test("a membership failure rolls the payment back so the indexer can retry it", async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("on conflict (tx_hash)")) {
        return { rows: [{ payment_id: "9", inserted: true }], rowCount: 1 };
      }
      if (sql.includes("insert into community_memberships")) {
        throw new Error("community_memberships violates foreign key constraint");
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  await assert.rejects(
    () => upsertPaymentAndSubscription({ connect: async () => client } as never, event),
    /foreign key constraint/,
  );
  assert.equal(queries.includes("commit"), false);
  assert.equal(queries.includes("rollback"), true);
});

test("the first insert of a chain transaction still records the subscription", async () => {
  const { pool, queries } = poolFor(true);
  const result = await upsertPaymentAndSubscription(pool as never, event);
  assert.equal(result.inviteNeeded, true);
  assert.equal(result.paymentId, 9);
  assert.equal(queries.some((sql) => sql.includes("insert into subscriptions")), true);
});
