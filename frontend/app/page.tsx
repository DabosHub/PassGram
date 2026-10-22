"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { DemoLab } from "@/components/DemoLab";
import { TonConnectProvider } from "@/components/TonConnectBridge";
import { DemoLabProvider } from "@/lib/demoLabContext";
import { RouteProvider } from "@/lib/routeContext";
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
      <RouteProvider>
        <DemoLabProvider>
          <WalletSync>
            <AppShell />
            <DemoLab />
          </WalletSync>
        </DemoLabProvider>
      </RouteProvider>
    </StoreProvider>
  );
}
