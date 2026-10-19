"use client";

import { useEffect, useState } from "react";
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

export function useAppRoute() {
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

  function go(next: AppRoute, replace = false) {
    const path = routeToPath(next);
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
    setRoute(next);
  }

  return { route, ready, go };
}
