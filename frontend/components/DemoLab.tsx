"use client";

import { useMemo } from "react";
import { DEMO_SCENES, type DemoSceneId } from "@/lib/demoLab";
import { useDemoLab } from "@/lib/demoLabContext";
import { useAppRoute } from "@/lib/useRoute";

export function DemoLab() {
  const lab = useDemoLab();
  const { go } = useAppRoute();
  const groups = useMemo(() => {
    const map = new Map<string, typeof DEMO_SCENES>();
    for (const scene of DEMO_SCENES) {
      const list = map.get(scene.group) || [];
      list.push(scene);
      map.set(scene.group, list);
    }
    return [...map.entries()];
  }, []);

  if (!lab.enabled) return null;

  if (!lab.open) {
    return (
      <button
        type="button"
        className="fixed bottom-20 right-3 z-40 rounded-full border border-[var(--pg-line)] bg-[var(--pg-card)] px-3 py-2 text-xs font-medium text-[var(--pg-blue)] shadow-[var(--pg-shadow-float)]"
        onClick={() => lab.setOpen(true)}
      >
        UI Lab
      </button>
    );
  }

  return (
    <aside className="fixed bottom-20 right-3 z-40 flex max-h-[70vh] w-[min(100%-1.5rem,280px)] flex-col overflow-hidden rounded-2xl border border-[var(--pg-line)] bg-[var(--pg-card)] shadow-[var(--pg-shadow-float)]">
      <div className="flex items-center justify-between border-b border-[var(--pg-line)] px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-[var(--pg-text)]">UI Lab</p>
          <p className="text-[10px] text-[var(--pg-hint)]">Local demo · not production</p>
        </div>
        <button type="button" className="text-xs text-[var(--pg-hint)]" onClick={() => lab.setOpen(false)}>
          Hide
        </button>
      </div>
      <div className="space-y-2 overflow-y-auto px-3 py-2">
        <button
          type="button"
          className="w-full rounded-xl bg-[var(--pg-blue)] px-3 py-2 text-xs font-medium text-white"
          onClick={() => lab.advanceCreateFlow(go)}
        >
          Play create flow →
        </button>
        {groups.map(([group, scenes]) => (
          <div key={group} className="space-y-1">
            <p className="pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--pg-hint)]">{group}</p>
            {scenes.map((scene) => {
              const active = lab.sceneId === scene.id;
              return (
                <button
                  key={scene.id}
                  type="button"
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-xs ${
                    active
                      ? "bg-[var(--pg-tag)] text-[var(--pg-blue-press)]"
                      : "text-[var(--pg-text)] hover:bg-[var(--pg-bg)]"
                  }`}
                  onClick={() => lab.applyScene(scene.id as DemoSceneId, go)}
                >
                  {scene.label}
                </button>
              );
            })}
          </div>
        ))}
        <button
          type="button"
          className="w-full rounded-xl border border-[var(--pg-line)] px-3 py-2 text-xs text-[var(--pg-hint)]"
          onClick={() => {
            lab.clearScene();
            lab.applyScene("dashboard.empty", go);
          }}
        >
          Reset to empty dashboard
        </button>
      </div>
    </aside>
  );
}
