import { contractIsConfigured, tonConfig } from "./config";
import { resolveUsdtJettonWallet } from "./jetton";
import { buildSubscribeForwardPayload } from "./registry";
import { sendViaAdapter } from "./send";
import { getConnectedTonAddress, type WalletSendResult } from "./wallet";

export type SubscribeIntent = {
  kind: "jetton_subscribe";
  communityId: number;
  amount: string;
  to: string;
  hasPlatformReferrer: boolean;
  hasCommunityReferrer: boolean;
};

/**
 * Builds / sends a USDT Jetton transfer to the PassGram registry with a subscribe payload.
 * Community referrer (if any) is included so the contract can take R% from the creator share on-chain.
 */
export async function sendSubscriptionPayment(input: {
  communityId: number;
  amount: string;
  jettonWalletAddress?: string;
  hasPlatformReferrer?: boolean;
  communityReferrerAddress?: string | null;
}): Promise<WalletSendResult> {
  const hasCommunityReferrer = Boolean(input.communityReferrerAddress?.trim());
  const intent: SubscribeIntent = {
    kind: "jetton_subscribe",
    communityId: input.communityId,
    amount: input.amount,
    to: tonConfig.registryAddress || "unconfigured",
    hasPlatformReferrer: Boolean(input.hasPlatformReferrer),
    hasCommunityReferrer,
  };

  const responseAddress = getConnectedTonAddress();
  if (!contractIsConfigured() || !responseAddress) {
    return { status: "prepared", intent };
  }

  const jettonWalletAddress =
    input.jettonWalletAddress || (await resolveUsdtJettonWallet(responseAddress));
  if (!jettonWalletAddress) {
    return { status: "prepared", intent };
  }

  const forwardPayload = buildSubscribeForwardPayload({
    communityId: input.communityId,
    hasPlatformReferrer: Boolean(input.hasPlatformReferrer),
    communityReferrerAddress: input.communityReferrerAddress,
  });
  const boc = await sendViaAdapter({
    jettonWalletAddress,
    registryAddress: tonConfig.registryAddress,
    amount: input.amount,
    responseAddress,
    forwardPayload,
  });
  if (!boc) return { status: "prepared", intent };
  return { status: "sent", hash: boc.slice(0, 64), intent };
}

/** @deprecated use buildSubscribeForwardPayload */
export function buildSubscribePayload(
  communityId: number,
  hasReferrer = false,
  communityReferrerAddress?: string | null,
): string {
  return buildSubscribeForwardPayload({
    communityId,
    hasPlatformReferrer: hasReferrer,
    communityReferrerAddress,
  });
}

export function shortenTonAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
