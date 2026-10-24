"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { launchStartParam, resolveRoute, routeToPath, type AppRoute } from "./route";

const home: AppRoute = {
  tab: "dashboard",
  screen: "home",
  accountPage: "hub",
  communityId: null,
  referralCode: null,
  communityReferralCode: null,
  linkError: null,
};

type RouteApi = {
  route: AppRoute;
  ready: boolean;
  go: (next: AppRoute, replace?: boolean) => void;
};

const RouteContext = createContext<RouteApi | null>(null);

export function RouteProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<AppRoute>(home);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer = 0;

    const readStart = () =>
      launchStartParam({
        search: window.location.search,
        hash: window.location.hash,
        sdkStart: window.Telegram?.WebApp?.initDataUnsafe?.start_param,
      });

    const settle = () => {
      if (cancelled) return;
      const initial = resolveRoute(window.location.search, readStart());
      const target = routeToPath(initial);
      const current = `${window.location.pathname}${window.location.search}`;
      if (target !== current) history.replaceState(null, "", `${target}${window.location.hash}`);
      setRoute(initial);
      setReady(true);
    };

    const tick = () => {
      if (cancelled) return;
      const webApp = window.Telegram?.WebApp;
      const openedFromTelegram =
        /tgWebApp/.test(`${window.location.hash}${window.location.search}`) ||
        Boolean(webApp?.initData) ||
        Boolean(webApp?.platform && webApp.platform !== "unknown");
      const explicit = ["account", "manage", "subscription", "community", "settings", "tab"].some((key) =>
        new URLSearchParams(window.location.search.slice(1)).has(key),
      );
      if (readStart() || explicit || !openedFromTelegram || attempts >= 20) {
        settle();
        return;
      }
      attempts += 1;
      timer = window.setTimeout(tick, 100);
    };

    tick();
    const onPop = () => setRoute(resolveRoute(window.location.search, readStart()));
    window.addEventListener("popstate", onPop);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const api = useMemo<RouteApi>(
    () => ({
      route,
      ready,
      go: (next, replace = false) => {
        const path = routeToPath(next);
        if (replace) history.replaceState(null, "", path);
        else history.pushState(null, "", path);
        setRoute(next);
      },
    }),
    [route, ready],
  );

  return <RouteContext.Provider value={api}>{children}</RouteContext.Provider>;
}

export function useAppRoute(): RouteApi {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error("RouteProvider missing");
  return ctx;
}
