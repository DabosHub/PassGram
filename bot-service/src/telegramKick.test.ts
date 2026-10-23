import assert from "node:assert/strict";
import test from "node:test";
import { unbanAfterKick } from "./telegram.ts";

test("unban is retried and a final failure is not treated as removal", async () => {
  const waits: number[] = [];
  let attempts = 0;
  await unbanAfterKick(
    async () => {
      attempts += 1;
      return attempts === 2;
    },
    "-100",
    "42",
    [0, 1_000, 5_000],
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1_000]);

  await assert.rejects(
    unbanAfterKick(async () => false, "-100", "42", [0, 10], async () => {}),
    /unban failed for 42 in -100/,
  );
});
