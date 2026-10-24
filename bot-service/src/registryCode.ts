import { Cell } from "@ton/core";
import { fetchWithTimeout } from "./http.ts";

/** Must match contract/registry.codehash and the Mini App constant. */
export const PASSGRAM_REGISTRY_CODE_HASH = "39446c74dc43c8b824b03d9495d7ee9251c6ac03b7fec1834332507ab7d19294";

export const REGISTRY_CODE_MISMATCH =
  "This registry is not the current PassGram contract. Indexing stays closed until this source is deployed.";

export function registryCodeDecision(actual: string | null | undefined, expected: string): boolean {
  const live = (actual || "").trim().toLowerCase();
  const wanted = expected.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(live) && live === wanted;
}

export function codeHashOfBoc(bytes: Buffer): string | null {
  try {
    const cell = Cell.fromBoc(bytes)[0];
    return cell ? cell.hash().toString("hex") : null;
  } catch {
    return null;
  }
}

export async function liveRegistryMatches(input: {
  apiUrl: string;
  apiKey: string;
  address: string;
  expectedHash: string;
}): Promise<boolean> {
  const url = new URL(`${input.apiUrl.replace(/\/$/, "")}/getAddressInformation`);
  url.searchParams.set("address", input.address);
  const headers: Record<string, string> = {};
  if (input.apiKey) headers["X-API-Key"] = input.apiKey;
  const response = await fetchWithTimeout(url, { headers });
  if (!response.ok) return false;
  const json = (await response.json()) as { ok?: boolean; result?: { code?: string } };
  const code = json.ok ? json.result?.code : undefined;
  if (!code) return false;
  return registryCodeDecision(codeHashOfBoc(Buffer.from(code, "base64")), input.expectedHash);
}
