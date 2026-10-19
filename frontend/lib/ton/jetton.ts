import { Address, beginCell, Cell } from "@ton/core";
import { tonConfig } from "./config";

function toncenterBase(): string {
  return tonConfig.network === "testnet"
    ? "https://testnet.toncenter.com/api/v2"
    : "https://toncenter.com/api/v2";
}

/**
 * Resolves the USDT jetton wallet for `owner` via the jetton master's get_wallet_address.
 */
export async function resolveUsdtJettonWallet(ownerAddress: string): Promise<string | null> {
  try {
    const master = Address.parse(tonConfig.usdtJetton);
    const owner = Address.parse(ownerAddress);
    const stackCell = beginCell().storeAddress(owner).endCell();
    // TonCenter expects stack as JSON array of typed items
    const body = {
      address: master.toString(),
      method: "get_wallet_address",
      stack: [["tvm.Slice", stackCell.toBoc().toString("base64")]],
    };
    const response = await fetch(`${toncenterBase()}/runGetMethod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      ok?: boolean;
      result?: { stack?: Array<[string, { bytes?: string }] | [string, string]> };
    };
    if (!json.ok || !json.result?.stack?.length) return null;
    const item = json.result.stack[0];
    if (!item) return null;
    // Formats vary: ["cell", { bytes }] or ["slice", { bytes }]
    const bytes =
      typeof item[1] === "object" && item[1] && "bytes" in item[1]
        ? (item[1] as { bytes?: string }).bytes
        : undefined;
    if (!bytes) return null;
    const cell = Cell.fromBase64(bytes);
    const addr = cell.beginParse().loadAddress();
    return addr ? addr.toString() : null;
  } catch {
    return null;
  }
}
