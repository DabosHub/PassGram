"use client";

import { useEffect } from "react";
import { TonConnectUIProvider, useTonConnectUI, useTonWallet } from "@tonconnect/ui-react";
import { tonConfig } from "@/lib/ton/config";
import { setTonConnectAdapter } from "@/lib/ton/wallet";

function TonConnectAdapterSync({ onAddress }: { onAddress?: (address: string | null) => void }) {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();

  useEffect(() => {
    setTonConnectAdapter({
      connect: async () => {
        if (tonConnectUI.connected && tonConnectUI.account?.address) {
          return tonConnectUI.account.address;
        }
        await tonConnectUI.openModal();
        if (tonConnectUI.account?.address) return tonConnectUI.account.address;
        return await new Promise<string | null>((resolve) => {
          const unsub = tonConnectUI.onStatusChange((w) => {
            if (w?.account?.address) {
              unsub();
              resolve(w.account.address);
            }
          });
          setTimeout(() => {
            unsub();
            resolve(tonConnectUI.account?.address ?? null);
          }, 120_000);
        });
      },
      disconnect: async () => {
        await tonConnectUI.disconnect();
      },
      sendTransaction: async (tx) => {
        const result = await tonConnectUI.sendTransaction(tx);
        return result ? { boc: result.boc } : null;
      },
      signData: async (data) => {
        const result = await tonConnectUI.signData(data);
        return {
          signature: result.signature,
          address: result.address,
          timestamp: result.timestamp,
          domain: result.domain,
        };
      },
      account: {
        address: tonConnectUI.account?.address,
        publicKey: tonConnectUI.account?.publicKey,
      },
    });
    onAddress?.(wallet?.account.address ?? null);
    return () => setTonConnectAdapter(null);
  }, [tonConnectUI, wallet, onAddress]);

  return null;
}

export function TonConnectProvider({
  children,
  onAddress,
}: {
  children: React.ReactNode;
  onAddress?: (address: string | null) => void;
}) {
  const manifestUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/tonconnect-manifest.json`
      : tonConfig.manifestUrl;

  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <TonConnectAdapterSync onAddress={onAddress} />
      {children}
    </TonConnectUIProvider>
  );
}
