import { readFileSync } from "node:fs";
import { Address, beginCell, Cell, contractAddress } from "@ton/core";

/** Code cell produced by Tolk 1.5.0. The verifier recompiles this same source. */
export function tolkRegistryCode(): Cell {
  const compiled = JSON.parse(readFileSync(new URL("./build/tolk-registry.json", import.meta.url), "utf8")) as {
    codeBoc64: string;
  };
  return Cell.fromBase64(compiled.codeBoc64);
}

/**
 * Initial data for a new registry. Fees match the live contract:
 * 250 bps platform, 2000 bps of that fee to a platform marketer, 5000 bps community cap.
 */
export function tolkRegistryData(
  owner: Address,
  treasury: Address,
  usdtMaster: Address,
  ownerPublicKey: bigint,
): Cell {
  const head = beginCell()
    .storeAddress(owner)
    .storeAddress(treasury)
    .storeUint(250, 16)
    .storeUint(2000, 16)
    .storeUint(5000, 16)
    .storeAddress(usdtMaster)
    .endCell();
  const tail = beginCell()
    .storeUint(ownerPublicKey, 256)
    .storeAddress(null)
    .storeUint(1, 64)
    .storeUint(0, 64)
    .storeUint(0, 64)
    .endCell();
  const empty = beginCell().storeBit(false).endCell();
  const books = beginCell().storeRef(empty).storeRef(empty).storeRef(empty).endCell();
  return beginCell().storeRef(head).storeRef(tail).storeRef(books).endCell();
}

export function tolkRegistryInit(input: {
  owner: Address;
  treasury: Address;
  usdtMaster: Address;
  ownerPublicKey: bigint;
}): { code: Cell; data: Cell; address: Address } {
  const code = tolkRegistryCode();
  const data = tolkRegistryData(input.owner, input.treasury, input.usdtMaster, input.ownerPublicKey);
  return { code, data, address: contractAddress(0, { code, data }) };
}
