import assert from "node:assert/strict";
import test from "node:test";
import { listExpiredSubscriptions, markAccessRemoved } from "./db.ts";

test("expired access uses the Telegram membership id, not the TON address", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return {
        rows: [
          {
            community_id: "7",
            subscriber_telegram_user_id: "279058397",
            telegram_chat_id: "-100123",
            expires_at_ms: "1000",
          },
        ],
      };
    },
  };
  const rows = await listExpiredSubscriptions(pool as never, 2_000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.telegramUserId, "279058397");
  assert.equal(rows[0]?.telegramChatId, "-100123");
  assert.equal(rows[0]?.expiresAtMs, 1000);
  assert.match(queries[0]?.sql ?? "", /community_memberships/);
  assert.match(queries[0]?.sql ?? "", /subscriber_telegram_user_id/);
  assert.doesNotMatch(queries[0]?.sql ?? "", /subscriber_account_id/);
  assert.deepEqual(queries[0]?.params, [2_000]);
});

test("a successful removal is recorded for that paid period only", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  await markAccessRemoved(pool as never, 7, "279058397", 1000);
  assert.match(queries[0]?.sql ?? "", /access_removed_for_expires_at_ms/);
  assert.deepEqual(queries[0]?.params, [7, "279058397", 1000]);
});
