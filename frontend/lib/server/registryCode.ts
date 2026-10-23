import { Address, Cell } from "@ton/core";
import { isTonAddress, tonConfig } from "../ton/config";

/** Code hash of contract/build PassGramRegistry. Must match contract/registry.codehash. */
export const PASSGRAM_REGISTRY_CODE_HASH = "afc38a5ea84e3696c2d9dc4e9dfa8020242528cd6415926c454bcf5994d0b2fb";

export const REGISTRY_CODE_MISMATCH =
  "This registry is not the current PassGram contract. Registration and payments stay closed until this source is deployed.";

export const REGISTRY_CODE_UNCONFIRMED =
  "The registry contract could not be confirmed, so this action was not sent.";

export function registryCodeDecision(
  actual: string | null | undefined,
  expected = PASSGRAM_REGISTRY_CODE_HASH,
): { ok: true } | { ok: false; message: string } {
  const live = (actual || "").trim().toLowerCase();
  const wanted = expected.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(live) || live !== wanted) {
    return { ok: false, message: REGISTRY_CODE_MISMATCH };
  }
  return { ok: true };
}

export function codeHashOfBoc(bytes: Buffer): string | null {
  try {
    const cell = Cell.fromBoc(bytes)[0];
    return cell ? cell.hash().toString("hex") : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, { hash: string; at: number }>();

function toncenterBase(): string {
  const configured = (process.env.TON_API_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured.replace(/\/jsonRPC$/, "");
  return tonConfig.network === "testnet" ? "https://testnet.toncenter.com/api/v2" : "https://toncenter.com/api/v2";
}

async function liveRegistryCodeHash(address: string): Promise<string | null> {
  const key = Address.parse(address).toRawString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.hash;
  const url = new URL(`${toncenterBase()}/getAddressInformation`);
  url.searchParams.set("address", Address.parse(address).toString());
  const headers: Record<string, string> = {};
  const apiKey = (process.env.TONCENTER_API_KEY || process.env.TON_API_KEY || "").trim();
  if (apiKey) headers["X-API-Key"] = apiKey;
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const json = (await response.json()) as { ok?: boolean; result?: { code?: string } };
  const code = json.ok ? json.result?.code : undefined;
  if (!code) return null;
  const hash = codeHashOfBoc(Buffer.from(code, "base64"));
  if (!hash) return null;
  cache.set(key, { hash, at: Date.now() });
  return hash;
}

/** Refuses registration and payment signatures for any registry that is not this source. */
export async function requireCurrentRegistry(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (process.env.NODE_ENV !== "production" && process.env.PASSGRAM_REGISTRY_CODE_CHECK === "off") {
    return { ok: true };
  }
  const registry = (process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY || process.env.PASSGRAM_REGISTRY_ADDRESS || "").trim();
  if (!registry || !isTonAddress(registry)) {
    return { ok: false, message: "The registry contract is not configured, so this action was not sent." };
  }
  try {
    const hash = await liveRegistryCodeHash(registry);
    if (!hash) return { ok: false, message: REGISTRY_CODE_UNCONFIRMED };
    return registryCodeDecision(hash);
  } catch {
    return { ok: false, message: REGISTRY_CODE_UNCONFIRMED };
  }
}
