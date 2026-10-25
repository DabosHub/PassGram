import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, registryApiUrl } from "./config.ts";

const base = {
  DATABASE_URL: "postgres://local/passgram",
  TELEGRAM_BOT_TOKEN: "token",
  PASSGRAM_REGISTRY_ADDRESS: "EQ_registry",
};

test("a bad poll interval falls back instead of spinning the indexer", () => {
  const config = loadConfig({ ...base, INDEXER_POLL_MS: "abc", CRON_INTERVAL_MS: "-5" });
  assert.equal(config.pollIntervalMs, 15_000);
  assert.equal(config.cronIntervalMs, 60_000);
});

test("a stale or empty code hash still selects the current registry source", () => {
  const current = "db8965a9ee8210beaa92285488794ba6cf39940dbf84c8ef17bfdba67c1c8961";
  assert.equal(loadConfig({ ...base, PASSGRAM_REGISTRY_CODE_HASH: "" }).registryCodeHash, current);
  assert.equal(
    loadConfig({
      ...base,
      PASSGRAM_REGISTRY_CODE_HASH: "39446c74dc43c8b824b03d9495d7ee9251c6ac03b7fec1834332507ab7d19294",
    }).registryCodeHash,
    current,
  );
  assert.equal(loadConfig({ ...base, PASSGRAM_REGISTRY_CODE_HASH: current }).registryCodeHash, current);
});
test("the retired registry address is not indexed", () => {
  const config = loadConfig({
    ...base,
    PASSGRAM_REGISTRY_ADDRESS: "EQBkUvELQJXV8iiAkSduh7M3IC1x5FxhrLc1WK_9LHgyHDI2",
  });
  assert.equal(config.registryAddress, "EQCZ-KnsXQKxbCl0wlS9C_OcNQvPOdK-w9mYiRA_-kxy0uv6");
});

test("a mainnet registry is not indexed through the testnet API", () => {
  assert.equal(
    registryApiUrl("EQBkUvELQJXV8iiAkSduh7M3IC1x5FxhrLc1WK_9LHgyHDI2", "https://testnet.toncenter.com/api/v2"),
    "https://toncenter.com/api/v2",
  );
  assert.equal(registryApiUrl("kQexample", "https://toncenter.com/api/v2"), "https://testnet.toncenter.com/api/v2");
});

test("a usable interval is kept as whole milliseconds", () => {
  const config = loadConfig({ ...base, INDEXER_POLL_MS: "2500.9", CRON_INTERVAL_MS: "5000" });
  assert.equal(config.pollIntervalMs, 2_500);
  assert.equal(config.cronIntervalMs, 5_000);
});
