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
  hasCommunityReferrer: boolean;
  communityReferralBps?: number;
};

/**
 * Builds / sends a USDT Jetton transfer to the PassGram registry with a subscribe payload.
 * The optional address is the community referrer's payout wallet. PassGram's affiliate is paid from the address stored on the community.
 */
export async function sendSubscriptionPayment(input: {
  communityId: number;
  amount: string;
  jettonWalletAddress?: string;
  /** Community referrer payout wallet from the database. */
  communityReferrerAddress?: string | null;
  communityReferralBps?: number | null;
  /** Base64 owner signature of the referral authorization cell. */
  referralAuthorization?: string | null;
  referralAuthorizationValidUntil?: number | null;
}): Promise<WalletSendResult> {
  const hasCommunityReferrer = Boolean(input.communityReferrerAddress?.trim());
  const intent: SubscribeIntent = {
    kind: "jetton_subscribe",
    communityId: input.communityId,
    amount: input.amount,
    to: tonConfig.registryAddress || "unconfigured",
    hasCommunityReferrer,
    communityReferralBps: input.communityReferralBps ?? undefined,
  };

  const responseAddress = getConnectedTonAddress();
  if (!contractIsConfigured() || !responseAddress || !input.referralAuthorization || !input.referralAuthorizationValidUntil) {
    return { status: "prepared", intent };
  }

  const jettonWalletAddress =
    input.jettonWalletAddress || (await resolveUsdtJettonWallet(responseAddress));
  if (!jettonWalletAddress) {
    return { status: "prepared", intent };
  }

  const forwardPayload = buildSubscribeForwardPayload({
    communityId: input.communityId,
    communityReferrerAddress: input.communityReferrerAddress,
    validUntil: input.referralAuthorizationValidUntil,
    authorization: input.referralAuthorization,
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
  communityReferrerAddress: string | null | undefined,
  validUntil: number,
  authorization: string,
): string {
  return buildSubscribeForwardPayload({
    communityId,
    communityReferrerAddress,
    validUntil,
    authorization,
  });
}

export function shortenTonAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
