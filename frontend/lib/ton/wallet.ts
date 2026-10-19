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
  account?: { address?: string } | null;
};

let adapter: TonConnectAdapter | null = null;

/** Register the live TON Connect UI adapter from the React provider tree. */
export function setTonConnectAdapter(next: TonConnectAdapter | null): void {
  adapter = next;
  setSendAdapter(next);
}

export function getConnectedTonAddress(): string | null {
  const address = adapter?.account?.address;
  return address && address.length > 0 ? address : null;
}

export async function connectTonWallet(): Promise<string | null> {
  if (!adapter?.connect) return null;
  return adapter.connect();
}

export async function disconnectTonWallet(): Promise<void> {
  await adapter?.disconnect?.();
}

export function tonWalletAvailable(): boolean {
  return Boolean(adapter?.connect);
}
