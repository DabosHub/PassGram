import { Address } from "@ton/core";

/** Stable TON wallet key so a friendly EQ address and its raw form match. */
export function tonWalletKey(address: string): string | null {
  try {
    return Address.parse(address.trim()).toRawString();
  } catch {
    return null;
  }
}
