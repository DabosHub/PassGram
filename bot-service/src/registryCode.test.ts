import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PASSGRAM_REGISTRY_CODE_HASH, registryCodeDecision } from "./registryCode.ts";

test("indexer accepts only the registry code hash recorded with the contract", () => {
  const file = readFileSync(new URL("../../contract/registry.codehash", import.meta.url), "utf8").trim();
  assert.equal(PASSGRAM_REGISTRY_CODE_HASH, file);
  assert.equal(registryCodeDecision(file, PASSGRAM_REGISTRY_CODE_HASH), true);
  assert.equal(registryCodeDecision("ab".repeat(32), PASSGRAM_REGISTRY_CODE_HASH), false);
  assert.equal(registryCodeDecision(null, PASSGRAM_REGISTRY_CODE_HASH), false);
});
