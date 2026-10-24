"use client";

import { useEffect, useState, type ComponentType } from "react";

export function AppGate() {
  const [App, setApp] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (document.documentElement.dataset.surface !== "app") return;
    let active = true;
    void import("@/components/MiniApp").then((mod) => {
      if (active) setApp(() => mod.MiniApp);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!App) return null;
  return (
    <div className="pg-app pg-app-ready">
      <App />
    </div>
  );
}
