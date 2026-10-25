import assert from "node:assert/strict";
import test from "node:test";
import { cronRequestAuthorized } from "./cronAuth.ts";

test("the chain cron rejects a missing or wrong secret", () => {
  const request = new Request("https://passgram.io/api/cron/passgram", {
    headers: { authorization: "Bearer wrong" },
  });
  assert.equal(cronRequestAuthorized(request, {}), false);
  assert.equal(cronRequestAuthorized(request, { CRON_SECRET: "expected" }), false);
  assert.equal(
    cronRequestAuthorized(new Request("https://passgram.io/api/cron/passgram"), { CRON_SECRET: "expected" }),
    false,
  );
});

test("the chain cron accepts the configured bearer secret", () => {
  const request = new Request("https://passgram.io/api/cron/passgram", {
    headers: { authorization: "Bearer expected" },
  });
  assert.equal(cronRequestAuthorized(request, { CRON_SECRET: "expected" }), true);
});
