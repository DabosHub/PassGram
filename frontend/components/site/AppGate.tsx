"use client";

import { useEffect, useState, type ComponentType } from "react";

export function AppGate() {
  const [App, setApp] = useState<ComponentType | null>(null);

  useEffect(() => {
    let active = true;
    let started = false;
    function load() {
      if (!active || started || document.documentElement.dataset.surface !== "app") return;
      started = true;
      void import("@/components/MiniApp").then((mod) => {
        if (active) setApp(() => mod.MiniApp);
      });
    }
    load();
    const observer = new MutationObserver(load);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-surface"] });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  if (!App) return null;
  return (
    <div className="pg-app pg-app-ready">
      <App />
    </div>
  );
}
