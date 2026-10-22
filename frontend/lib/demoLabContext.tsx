"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CREATE_FLOW_ORDER,
  buildDemoCreateSnapshot,
  buildDemoLastTx,
  buildDemoLedger,
  demoSceneById,
  isDemoLabEnabled,
  type DemoCreateSnapshot,
  type DemoReferralSegment,
  type DemoSceneId,
} from "./demoLab";

const DEMO_WALLET = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
import type { AppRoute } from "./route";
import { useStore } from "./store";

type DemoLabApi = {
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  sceneId: DemoSceneId | null;
  createSnapshot: DemoCreateSnapshot | null;
  referralSegment: DemoReferralSegment | null;
  applyScene: (id: DemoSceneId, go: (route: AppRoute, replace?: boolean) => void) => void;
  advanceCreateFlow: (go: (route: AppRoute, replace?: boolean) => void) => void;
  clearScene: () => void;
};

const DemoLabContext = createContext<DemoLabApi | null>(null);

export function DemoLabProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [sceneId, setSceneId] = useState<DemoSceneId | null>(null);
  const [createSnapshot, setCreateSnapshot] = useState<DemoCreateSnapshot | null>(null);
  const [referralSegment, setReferralSegment] = useState<DemoReferralSegment | null>(null);

  useEffect(() => {
    setEnabled(isDemoLabEnabled());
  }, []);

  const applyScene = useCallback(
    (id: DemoSceneId, go: (route: AppRoute, replace?: boolean) => void) => {
      if (!isDemoLabEnabled()) return;
      const scene = demoSceneById(id);
      const ledger = buildDemoLedger(id);
      store.replaceLedger(ledger);
      store.syncWalletAccount(DEMO_WALLET);
      store.setDemoLastTx(scene.lastTx ? buildDemoLastTx() : null);
      setSceneId(id);
      setReferralSegment(scene.referralSegment);
      setCreateSnapshot(scene.createStage ? buildDemoCreateSnapshot(scene.createStage) : null);
      go(scene.route, true);
      setOpen(true);
    },
    [store],
  );

  const advanceCreateFlow = useCallback(
    (go: (route: AppRoute, replace?: boolean) => void) => {
      const index = sceneId && CREATE_FLOW_ORDER.includes(sceneId) ? CREATE_FLOW_ORDER.indexOf(sceneId) : -1;
      const next = CREATE_FLOW_ORDER[Math.min(index + 1, CREATE_FLOW_ORDER.length - 1)] || CREATE_FLOW_ORDER[0];
      applyScene(next, go);
    },
    [applyScene, sceneId],
  );

  const clearScene = useCallback(() => {
    setSceneId(null);
    setCreateSnapshot(null);
    setReferralSegment(null);
    store.setDemoLastTx(null);
  }, [store]);

  const api = useMemo<DemoLabApi>(
    () => ({
      enabled,
      open,
      setOpen,
      sceneId,
      createSnapshot,
      referralSegment,
      applyScene,
      advanceCreateFlow,
      clearScene,
    }),
    [enabled, open, sceneId, createSnapshot, referralSegment, applyScene, advanceCreateFlow, clearScene],
  );

  return <DemoLabContext.Provider value={api}>{children}</DemoLabContext.Provider>;
}

export function useDemoLab(): DemoLabApi {
  const ctx = useContext(DemoLabContext);
  if (!ctx) {
    return {
      enabled: false,
      open: false,
      setOpen: () => undefined,
      sceneId: null,
      createSnapshot: null,
      referralSegment: null,
      applyScene: () => undefined,
      advanceCreateFlow: () => undefined,
      clearScene: () => undefined,
    };
  }
  return ctx;
}
