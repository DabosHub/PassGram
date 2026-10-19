import { parseStartParam, type DeepLink } from "./domain";

export type TabId = "dashboard" | "create" | "referral";
export type AccountPage = "hub" | "analytics" | "notifications" | "policies";

export type AppRoute = {
  tab: TabId;
  screen: "home" | "account" | "community" | "subscription" | "manage";
  accountPage: AccountPage;
  communityId: number | null;
  referralCode: string | null;
  communityReferralCode: string | null;
  linkError: DeepLink["error"];
};

const ACCOUNT_PAGES = new Set<AccountPage>(["hub", "analytics", "notifications", "policies"]);

const TABS = new Set<TabId>(["dashboard", "create", "referral"]);

export function resolveRoute(search: string, startParam?: string | null): AppRoute {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const explicit = ["account", "manage", "subscription", "community", "tab"].some((key) => params.has(key));
  const start = explicit
    ? {
        communityId: null,
        referralCode: null,
        communityReferralCode: null,
        error: null as DeepLink["error"],
      }
    : parseStartParam(startParam);
  const tab = readTab(params.get("tab"));
  const referralCode = readCode(params.get("ref")) ?? start.referralCode;
  const communityReferralCode = readCode(params.get("cref")) ?? start.communityReferralCode;
  const linkError = referralError(params.get("ref")) ?? referralError(params.get("cref")) ?? start.error;

  const accountPage = readAccountPage(params.get("account"));
  if (accountPage) {
    return {
      tab,
      screen: "account",
      accountPage,
      communityId: null,
      referralCode,
      communityReferralCode,
      linkError,
    };
  }

  const manage = readId(params.get("manage"));
  if (manage.error) {
    return {
      tab: "dashboard",
      screen: "community",
      accountPage: "hub",
      communityId: null,
      referralCode,
      communityReferralCode,
      linkError: "invalid_community",
    };
  }
  if (manage.id) {
    return {
      tab: "dashboard",
      screen: "manage",
      accountPage: "hub",
      communityId: manage.id,
      referralCode,
      communityReferralCode,
      linkError,
    };
  }

  const subscription = readId(params.get("subscription"));
  if (subscription.error) {
    return {
      tab: "dashboard",
      screen: "community",
      accountPage: "hub",
      communityId: null,
      referralCode,
      communityReferralCode,
      linkError: "invalid_community",
    };
  }
  if (subscription.id) {
    return {
      tab: "dashboard",
      screen: "subscription",
      accountPage: "hub",
      communityId: subscription.id,
      referralCode,
      communityReferralCode,
      linkError,
    };
  }

  const community = readId(params.get("community"));
  if (community.error || (!params.has("community") && start.error === "invalid_community" && !params.has("tab"))) {
    return {
      tab: "dashboard",
      screen: "community",
      accountPage: "hub",
      communityId: null,
      referralCode,
      communityReferralCode,
      linkError: "invalid_community",
    };
  }
  const communityId = community.id ?? (params.has("community") ? null : start.communityId);
  if (communityId) {
    return {
      tab: "dashboard",
      screen: "community",
      accountPage: "hub",
      communityId,
      referralCode,
      communityReferralCode,
      linkError,
    };
  }

  if (start.error === "invalid_referral" && !params.has("ref") && !params.has("cref")) {
    return {
      tab,
      screen: "home",
      accountPage: "hub",
      communityId: null,
      referralCode: null,
      communityReferralCode: null,
      linkError: "invalid_referral",
    };
  }

  return {
    tab,
    screen: "home",
    accountPage: "hub",
    communityId: null,
    referralCode,
    communityReferralCode,
    linkError,
  };
}

export function routeToPath(route: AppRoute): string {
  const params = new URLSearchParams();
  if (route.screen === "account") {
    params.set("account", route.accountPage === "hub" ? "1" : route.accountPage);
  } else if (route.screen === "manage" && route.communityId) params.set("manage", String(route.communityId));
  else if (route.screen === "subscription" && route.communityId) params.set("subscription", String(route.communityId));
  else if (route.screen === "community" && route.communityId) params.set("community", String(route.communityId));
  else if (route.tab !== "dashboard") params.set("tab", route.tab);
  if (route.referralCode) params.set("ref", route.referralCode);
  if (route.communityReferralCode) params.set("cref", route.communityReferralCode);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function readAccountPage(value: string | null): AccountPage | null {
  if (!value) return null;
  if (value === "1") return "hub";
  return ACCOUNT_PAGES.has(value as AccountPage) ? (value as AccountPage) : null;
}

function readTab(value: string | null): TabId {
  return value && TABS.has(value as TabId) ? (value as TabId) : "dashboard";
}

function readCode(value: string | null): string | null {
  if (!value) return null;
  return /^[a-z0-9_-]{4,32}$/.test(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null;
}

function referralError(value: string | null): DeepLink["error"] {
  if (!value) return null;
  return readCode(value) ? null : "invalid_referral";
}

function readId(value: string | null): { id: number | null; error: boolean } {
  if (value == null) return { id: null, error: false };
  if (!/^[1-9]\d{0,11}$/.test(value)) return { id: null, error: true };
  return { id: Number(value), error: false };
}
