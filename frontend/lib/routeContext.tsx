"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveRoute, routeToPath, type AppRoute } from "./route";

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
    const start = window.Telegram?.WebApp?.initDataUnsafe.start_param;
    const initial = resolveRoute(window.location.search, window.location.search ? null : start);
    if (!window.location.search && start) history.replaceState(null, "", routeToPath(initial));
    setRoute(initial);
    setReady(true);
    const onPop = () => setRoute(resolveRoute(window.location.search, null));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
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
