import { setSendAdapter } from "./send";
import {
  ACCOUNT_LINK_PURPOSE,
  ACCOUNT_WALLET_SCHEMA,
  buildPayoutWalletCell,
  PAYOUT_WALLET_SCHEMA,
  type PayoutProofPurpose,
  type PayoutWalletProof,
} from "./walletProof";

export type WalletSendResult = {
  status: "sent" | "prepared";
  hash?: string;
  intent: {
    kind: "jetton_subscribe";
    communityId: number;
    amount: string;
    to: string;
    hasPlatformReferrer?: boolean;
    hasCommunityReferrer?: boolean;
  };
};

export type TonConnectAdapter = {
  connect: () => Promise<string | null>;
  disconnect?: () => Promise<void>;
  sendTransaction?: (tx: {
    validUntil: number;
    messages: Array<{ address: string; amount: string; payload?: string }>;
  }) => Promise<{ boc?: string } | null>;
  signData?: (data: {
    type: "cell";
    schema: string;
    cell: string;
  }) => Promise<{ signature: string; address: string; timestamp: number; domain: string }>;
  currentAccount?: () => { address?: string; publicKey?: string; walletStateInit?: string };
};

let adapter: TonConnectAdapter | null = null;
let connectedAddress: string | null = null;

/** Register the live TON Connect UI adapter from the React provider tree. */
export function setTonConnectAdapter(next: TonConnectAdapter | null): void {
  adapter = next;
  setSendAdapter(next);
  if (!next) connectedAddress = null;
  else connectedAddress = next.currentAccount?.().address || null;
}

export function getConnectedTonAddress(): string | null {
  const address = connectedAddress || adapter?.currentAccount?.().address;
  return address && address.length > 0 ? address : null;
}

/**
 * Asks the connected wallet to sign, without a transaction, that it will receive
 * commissions for this referral link. The server stores that wallet only after the signature checks.
 */
export async function signReceivingWallet(input: {
  purpose: PayoutProofPurpose;
  communityId: number;
  telegramUserId: string;
  schema?: string;
}): Promise<{ ok: true; proof: PayoutWalletProof } | { ok: false; message: string }> {
  if (!/^[1-9]\d{0,19}$/.test(input.telegramUserId)) {
    return { ok: false, message: "Open PassGram from Telegram so your account can be confirmed." };
  }
  const current = getTonConnectAdapter();
  if (!current?.signData || !current.currentAccount) {
    return { ok: false, message: "Connect a TON wallet that can confirm ownership. No link was created." };
  }
  let address = getConnectedTonAddress();
  if (!address) address = await connectTonWallet();
  if (!address) return { ok: false, message: "Connect your TON wallet. No link was created." };
  const account = current.currentAccount();
  if (!account.walletStateInit) {
    return { ok: false, message: "This wallet did not share a proof PassGram can check. No link was created." };
  }
  const schema = input.schema ?? PAYOUT_WALLET_SCHEMA;
  try {
    const cell = buildPayoutWalletCell({
      purpose: input.purpose,
      communityId: input.communityId,
      telegramUserId: input.telegramUserId,
      address,
      tag: schema === ACCOUNT_WALLET_SCHEMA ? 0x41636374 : 0x50724757,
    });
    const signed = await current.signData({
      type: "cell",
      schema,
      cell: cell.toBoc().toString("base64"),
    });
    return {
      ok: true,
      proof: {
        signature: signed.signature,
        address: signed.address || address,
        timestamp: signed.timestamp,
        domain: signed.domain,
        schema,
        cell: cell.toBoc().toString("base64"),
        walletStateInit: account.walletStateInit,
      },
    };
  } catch {
    return { ok: false, message: "The wallet did not confirm. No link was created." };
  }
}

/** Asks the connected wallet to prove it belongs to this Telegram account. There is no network fee. */
export async function signLinkedWallet(telegramUserId: string) {
  return signReceivingWallet({
    purpose: ACCOUNT_LINK_PURPOSE,
    communityId: 0,
    telegramUserId,
    schema: ACCOUNT_WALLET_SCHEMA,
  });
}

export function getTonConnectAdapter(): TonConnectAdapter | null {
  return adapter;
}

export async function connectTonWallet(): Promise<string | null> {
  if (!adapter?.connect) return null;
  const address = await adapter.connect();
  connectedAddress = address;
  return address;
}

export async function disconnectTonWallet(): Promise<void> {
  try {
    await adapter?.disconnect?.();
  } finally {
    connectedAddress = null;
  }
}

export function tonWalletAvailable(): boolean {
  return Boolean(adapter?.connect);
}
