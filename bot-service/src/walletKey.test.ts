import assert from "node:assert/strict";
import test from "node:test";
import { Address } from "@ton/core";
import { tonWalletKey } from "./walletKey.ts";

test("wallet keys match the raw and friendly forms", () => {
  const raw = "0:" + "ab".repeat(32);
  const friendly = Address.parse(raw).toString();
  assert.equal(tonWalletKey(friendly), tonWalletKey(raw));
  assert.equal(tonWalletKey("nope"), null);
});
