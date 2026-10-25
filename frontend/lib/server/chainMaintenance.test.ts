import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withTimeout } from "./chainMaintenance.ts";

test("a chain pass wait returns at the timeout and leaves the pass running", async () => {
  let finished = false;
  const work = new Promise<"ran">((resolve) => {
    setTimeout(() => {
      finished = true;
      resolve("ran");
    }, 50);
  });
  const result = await withTimeout(work, 15);
  assert.equal(result, "timeout");
  assert.equal(finished, false);
  assert.equal(await work, "ran");
  assert.equal(finished, true);
});

test("a fast chain pass is returned before the timeout", async () => {
  assert.equal(await withTimeout(Promise.resolve("skipped" as const), 1_000), "skipped");
});

test("the indexer claim does not move last_processed_lt", () => {
  const source = readFileSync(new URL("./chainMaintenance.ts", import.meta.url), "utf8");
  const update = source.slice(source.indexOf("on conflict"), source.indexOf("returning singleton"));
  assert.equal(update.includes("last_processed_lt"), false);
  assert.match(update, /set last_updated_at = now\(\)/);
});

test("the signed-in membership read waits for the chain pass before loading rows", () => {
  const source = readFileSync(new URL("../../app/api/telegram/memberships/route.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function GET"));
  const wait = body.indexOf("await awaitChainPass");
  const read = body.indexOf("readSubscriberLedger");
  assert.ok(wait !== -1 && read !== -1 && wait < read);
  assert.equal(body.includes("scheduleChainPass"), false);
});
