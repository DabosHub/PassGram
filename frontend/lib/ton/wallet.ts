import { setSendAdapter } from "./send";

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
  account?: { address?: string; publicKey?: string } | null;
};

let adapter: TonConnectAdapter | null = null;
let connectedAddress: string | null = null;

/** Register the live TON Connect UI adapter from the React provider tree. */
export function setTonConnectAdapter(next: TonConnectAdapter | null): void {
  adapter = next;
  setSendAdapter(next);
  if (!next) connectedAddress = null;
  else if (next.account?.address) connectedAddress = next.account.address;
}

export function getConnectedTonAddress(): string | null {
  const address = connectedAddress || adapter?.account?.address;
  return address && address.length > 0 ? address : null;
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
  connectedAddress = null;
  await adapter?.disconnect?.();
}

export function tonWalletAvailable(): boolean {
  return Boolean(adapter?.connect);
}
