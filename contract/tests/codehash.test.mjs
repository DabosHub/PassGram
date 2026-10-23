import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Cell } from "@ton/core";

test("the built registry code is the hash the app accepts", () => {
  const expected = readFileSync(new URL("../registry.codehash", import.meta.url), "utf8").trim().toLowerCase();
  const cell = Cell.fromBoc(readFileSync(new URL("../build/PassGramRegistry_PassGramRegistry.code.boc", import.meta.url)))[0];
  assert.ok(cell);
  assert.equal(cell.hash().toString("hex"), expected);
});
