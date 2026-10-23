import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGetTransactionsUrl,
  TRANSACTIONS_PAGE_LIMIT,
  walkRegistryTransactions,
  type RegistryTransactionPage,
} from "./tonApi.ts";

function page(newestFirst: string[], count = newestFirst.length): RegistryTransactionPage {
  const oldest = newestFirst[newestFirst.length - 1];
  return {
    events: newestFirst.map((lt) => ({ txHash: lt, lt, utime: 1 })),
    oldest: oldest ? { lt: oldest, hash: `h${oldest}` } : null,
    maxLt: newestFirst[0] ?? null,
    count,
  };
}

test("TonCenter is asked for a full page down to the saved logical time", () => {
  const url = buildGetTransactionsUrl({
    apiUrl: "https://toncenter.com/api/v2",
    address: "EQ_registry",
    toLt: "150",
    lt: "400",
    hash: "abc",
  });
  assert.equal(url.searchParams.get("limit"), String(TRANSACTIONS_PAGE_LIMIT));
  assert.equal(url.searchParams.get("to_lt"), "150");
  assert.equal(url.searchParams.get("lt"), "400");
  assert.equal(url.searchParams.get("hash"), "abc");
  assert.equal(url.searchParams.get("archival"), "true");
  assert.equal(url.searchParams.get("api_key"), null);
});

test("a finished walk returns payments oldest first and keeps the newest logical time", async () => {
  const walked = await walkRegistryTransactions({
    cursorLt: "15",
    loadPage: async () => page(["30", "20", "10"]),
  });
  assert.equal(walked.done, true);
  assert.deepEqual(walked.events.map((event) => event.lt), ["20", "30"]);
  assert.equal(walked.maxLt, "30");
});

test("a backlog longer than one page keeps a resume point and does not skip ahead", async () => {
  const calls: Array<{ lt?: string; hash?: string }> = [];
  const first = await walkRegistryTransactions({
    cursorLt: "0",
    maxPages: 1,
    loadPage: async (query) => {
      calls.push({ lt: query.lt, hash: query.hash });
      return page(["300", "200"], TRANSACTIONS_PAGE_LIMIT);
    },
  });
  assert.equal(first.done, false);
  assert.deepEqual(first.events, []);
  assert.deepEqual(first.resume, { lt: "200", hash: "h200" });
  assert.equal(first.maxLt, "0");

  const second = await walkRegistryTransactions({
    cursorLt: "0",
    resume: first.resume,
    loadPage: async (query) => {
      calls.push({ lt: query.lt, hash: query.hash });
      return page(["90", "80"]);
    },
  });
  assert.equal(second.done, true);
  assert.deepEqual(second.events.map((event) => event.lt), ["80", "90"]);
  assert.equal(second.maxLt, "90");
  assert.deepEqual(calls[1], { lt: "200", hash: "h200" });
});
