"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { TonConnectProvider } from "@/components/TonConnectBridge";
import { StoreProvider, useStore } from "@/lib/store";

function WalletSync({ children }: { children: ReactNode }) {
  const store = useStore();
  return (
    <TonConnectProvider onAddress={(address) => store.syncWalletAccount(address)}>
      {children}
    </TonConnectProvider>
  );
}

export default function HomePage() {
  return (
    <StoreProvider>
      <WalletSync>
        <AppShell />
      </WalletSync>
    </StoreProvider>
  );
}
