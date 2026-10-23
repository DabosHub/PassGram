import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { beginCell } from "@ton/core";
import {
  PASSGRAM_REGISTRY_CODE_HASH,
  codeHashOfBoc,
  registryCodeDecision,
  REGISTRY_CODE_MISMATCH,
} from "./registryCode.ts";

test("the app accepts only the registry code hash recorded with the contract", () => {
  const file = readFileSync(new URL("../../../contract/registry.codehash", import.meta.url), "utf8").trim();
  assert.equal(PASSGRAM_REGISTRY_CODE_HASH, file);
});

test("a different code hash is rejected", () => {
  const rejected = registryCodeDecision("ab".repeat(32));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.message, REGISTRY_CODE_MISMATCH);
  assert.deepEqual(registryCodeDecision(PASSGRAM_REGISTRY_CODE_HASH), { ok: true });
});

test("a code cell hash is hex", () => {
  const hash = codeHashOfBoc(beginCell().storeUint(1, 8).endCell().toBoc());
  assert.match(hash || "", /^[0-9a-f]{64}$/);
});
