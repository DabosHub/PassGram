export type TonNetwork = "mainnet" | "testnet";

export const USDT_DECIMALS = 6;
export const USDT_BASE = 1_000_000n;
export const MIN_PRICE = 1_000_000n;
/** Cap: 1_000_000 USDT. */
export const MAX_PRICE = 1_000_000_000_000n;
export const PLATFORM_FEE_BPS = 250n;
export const TREASURY_FEE_BPS = 200n;
export const REFERRER_FEE_BPS = 50n;
export const BPS = 10_000n;

/** Current mainnet registry. A stale env value for the retired contract is ignored. */
export const CURRENT_REGISTRY = "EQCZ-KnsXQKxbCl0wlS9C_OcNQvPOdK-w9mYiRA_-kxy0uv6";
const RETIRED_REGISTRY = "EQBkUvELQJXV8iiAkSduh7M3IC1x5FxhrLc1WK_9LHgyHDI2";

export function configuredRegistry(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.NEXT_PUBLIC_PASSGRAM_REGISTRY || env.PASSGRAM_REGISTRY_ADDRESS || "").trim();
  if (!configured || configured === RETIRED_REGISTRY) return CURRENT_REGISTRY;
  return configured;
}

/** Mainnet jUSDT (Tether USD) jetton master. */
export const DEFAULT_USDT_JETTON_MAINNET = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
/** Testnet USDTTT jetton master (IVerhusha / TON demos). */
export const DEFAULT_USDT_JETTON_TESTNET = "kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy";

export const tonConfig = {
  network: (process.env.NEXT_PUBLIC_TON_NETWORK === "testnet" ? "testnet" : "mainnet") as TonNetwork,
  usdtJetton:
    process.env.NEXT_PUBLIC_USDT_JETTON ||
    (process.env.NEXT_PUBLIC_TON_NETWORK === "testnet"
      ? DEFAULT_USDT_JETTON_TESTNET
      : DEFAULT_USDT_JETTON_MAINNET),
  registryAddress: configuredRegistry(),
  manifestUrl:
    process.env.NEXT_PUBLIC_TONCONNECT_MANIFEST_URL ||
    (typeof window !== "undefined" ? `${window.location.origin}/tonconnect-manifest.json` : "/tonconnect-manifest.json"),
};

export function contractIsConfigured(): boolean {
  return tonConfig.registryAddress.length > 0;
}

/** Accepts user-friendly EQ/UQ addresses or raw 0: hex form. */
export function isTonAddress(raw: string): boolean {
  const value = raw.trim();
  if (/^0:[0-9a-fA-F]{64}$/.test(value)) return true;
  if (/^[EU]Q[A-Za-z0-9_-]{46}$/.test(value)) return true;
  return false;
}

export function normalizeTonAddress(raw: string): string | null {
  const value = raw.trim();
  return isTonAddress(value) ? value : null;
}
