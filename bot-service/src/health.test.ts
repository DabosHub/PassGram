import assert from "node:assert/strict";
import test from "node:test";
import { healthReport, noteIndexerTick } from "./health.ts";

test("health stays ready until an indexer pass throws", () => {
  assert.deepEqual(healthReport(), { status: 200, body: { ok: true, indexer: "starting" } });
  noteIndexerTick(true);
  assert.deepEqual(healthReport(), { status: 200, body: { ok: true, indexer: "ok" } });
  noteIndexerTick(false);
  assert.deepEqual(healthReport(), { status: 503, body: { ok: false, indexer: "failed" } });
  noteIndexerTick(true);
  assert.equal(healthReport().status, 200);
});
