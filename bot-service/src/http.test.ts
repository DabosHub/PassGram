import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { fetchWithTimeout } from "./http.ts";

test("a quiet connection is aborted instead of waiting forever", async () => {
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    const started = Date.now();
    await assert.rejects(fetchWithTimeout(`http://127.0.0.1:${port}/`, {}, 200));
    assert.ok(Date.now() - started < 2_000);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
