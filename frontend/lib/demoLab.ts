import type { AccountPage, AppRoute, TabId } from "./route";
import type {
  AffiliateRecord,
  CommunityRecord,
  PaymentRecord,
  PassgramUser,
  SubscriptionRecord,
} from "./store";
import type { ChannelUiState } from "./channelPolicy";
import type { WalletSendResult } from "./ton/wallet";

/** Localhost (or NEXT_PUBLIC_PASSGRAM_DEMO=1) only — never for production Mini App traffic. */
export function isDemoLabEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_PASSGRAM_DEMO === "1") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export type DemoCreateStage =
  | "not_selected"
  | "safety"
  | "selection_pending"
  | "verification_pending"
  | "permission_missing"
  | "verified"
  | "created";

export type DemoReferralSegment = "leaderboard" | "passgram" | "communities";

export type DemoSceneId =
  | "create.not_selected"
  | "create.safety"
  | "create.selection_pending"
  | "create.verification_pending"
  | "create.permission_missing"
  | "create.verified"
  | "create.created"
  | "dashboard.empty"
  | "dashboard.owner"
  | "dashboard.subscriber"
  | "dashboard.both"
  | "community.purchase"
  | "subscription.active"
  | "subscription.expired"
  | "subscribe.join"
  | "subscribe.invite_blocked"
  | "manage.community"
  | "account.hub"
  | "account.analytics"
  | "account.notifications"
  | "account.policies"
  | "referral.leaderboard"
  | "referral.passgram_register"
  | "referral.passgram_linked"
  | "referral.communities"
  | "tx.submitted";

export type DemoScene = {
  id: DemoSceneId;
  group: string;
  label: string;
  route: AppRoute;
  createStage: DemoCreateStage | null;
  referralSegment: DemoReferralSegment | null;
  lastTx: boolean;
  joinPreview?: "offer" | "blocked";
};

export type DemoLedger = {
  user: PassgramUser;
  communities: CommunityRecord[];
  subscriptions: SubscriptionRecord[];
  affiliates: AffiliateRecord[];
  payments: PaymentRecord[];
};

export type DemoCreateSnapshot = {
  channelState: ChannelUiState;
  channelMessage: string;
  requestId: number | null;
  price: string;
  duration: string;
  payout: string;
  created: boolean;
  shareOpen: boolean;
  safetyOpen: boolean;
  channel: {
    telegramChatId: string;
    communityId?: number | null;
    title: string;
    description: string | null;
    hasPhoto: boolean;
    telegramMemberCount: number | null;
    telegramMemberCountFetchedAt: string | null;
    verificationStatus: ChannelUiState;
    botCanInviteUsers?: boolean;
    botCanRestrictMembers?: boolean;
    botAdded?: boolean;
    ownerTelegramUserId?: string;
    priceUsdt?: string | null;
    durationDays?: number | null;
  } | null;
};

const DEMO_OWNER_TG = 900001;
const DEMO_OTHER_TG = 900002;
export const DEMO_OWNED_COMMUNITY_ID = 9001;
export const DEMO_FOREIGN_COMMUNITY_ID = 9002;

const DEMO_PAYOUT = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

function home(tab: TabId = "dashboard"): AppRoute {
  return {
    tab,
    screen: "home",
    accountPage: "hub",
    communityId: null,
    referralCode: null,
    communityReferralCode: null,
    linkError: null,
  };
}

function account(page: AccountPage): AppRoute {
  return { ...home(), screen: "account", accountPage: page };
}

function community(id: number, screen: AppRoute["screen"] = "community"): AppRoute {
  return {
    ...home(),
    screen,
    communityId: id,
  };
}

export const DEMO_SCENES: DemoScene[] = [
  { id: "create.not_selected", group: "Create", label: "1 · Select channel", route: home("create"), createStage: "not_selected", referralSegment: null, lastTx: false },
  { id: "create.safety", group: "Create", label: "1b · Safety modal", route: home("create"), createStage: "safety", referralSegment: null, lastTx: false },
  { id: "create.selection_pending", group: "Create", label: "2 · Waiting for Telegram", route: home("create"), createStage: "selection_pending", referralSegment: null, lastTx: false },
  { id: "create.verification_pending", group: "Create", label: "3 · Verifying", route: home("create"), createStage: "verification_pending", referralSegment: null, lastTx: false },
  { id: "create.permission_missing", group: "Create", label: "4 · Verified · add bot", route: home("create"), createStage: "permission_missing", referralSegment: null, lastTx: false },
  { id: "create.verified", group: "Create", label: "5 · Verified · bot added", route: home("create"), createStage: "verified", referralSegment: null, lastTx: false },
  { id: "create.created", group: "Create", label: "6 · Share link modal", route: home("create"), createStage: "created", referralSegment: null, lastTx: false },
  { id: "dashboard.empty", group: "Dashboard", label: "Empty", route: home(), createStage: null, referralSegment: null, lastTx: false },
  { id: "dashboard.owner", group: "Dashboard", label: "My communities", route: home(), createStage: null, referralSegment: null, lastTx: false },
  { id: "dashboard.subscriber", group: "Dashboard", label: "My subscriptions", route: home(), createStage: null, referralSegment: null, lastTx: false },
  { id: "dashboard.both", group: "Dashboard", label: "Both sections", route: home(), createStage: null, referralSegment: null, lastTx: false },
  { id: "community.purchase", group: "Subscribe", label: "Purchase page", route: community(DEMO_FOREIGN_COMMUNITY_ID), createStage: null, referralSegment: null, lastTx: false },
  { id: "subscription.active", group: "Subscribe", label: "Active subscription", route: community(DEMO_FOREIGN_COMMUNITY_ID, "subscription"), createStage: null, referralSegment: null, lastTx: false },
  { id: "subscription.expired", group: "Subscribe", label: "Expired subscription", route: community(DEMO_FOREIGN_COMMUNITY_ID, "subscription"), createStage: null, referralSegment: null, lastTx: false },
  { id: "subscribe.join", group: "Subscribe", label: "Join community", route: community(DEMO_FOREIGN_COMMUNITY_ID), createStage: null, referralSegment: null, lastTx: false, joinPreview: "offer" },
  { id: "subscribe.invite_blocked", group: "Subscribe", label: "Invite unavailable", route: community(DEMO_FOREIGN_COMMUNITY_ID), createStage: null, referralSegment: null, lastTx: false, joinPreview: "blocked" },
  { id: "manage.community", group: "Manage", label: "Owner manage", route: community(DEMO_OWNED_COMMUNITY_ID, "manage"), createStage: null, referralSegment: null, lastTx: false },
  { id: "account.hub", group: "Account", label: "Hub", route: account("hub"), createStage: null, referralSegment: null, lastTx: false },
  { id: "account.analytics", group: "Account", label: "Analytics", route: account("analytics"), createStage: null, referralSegment: null, lastTx: false },
  { id: "account.notifications", group: "Account", label: "Notifications", route: account("notifications"), createStage: null, referralSegment: null, lastTx: false },
  { id: "account.policies", group: "Account", label: "Policies", route: account("policies"), createStage: null, referralSegment: null, lastTx: false },
  { id: "referral.leaderboard", group: "Referral", label: "Leaderboard", route: home("referral"), createStage: null, referralSegment: "leaderboard", lastTx: false },
  { id: "referral.passgram_register", group: "Referral", label: "PassGram · register", route: home("referral"), createStage: null, referralSegment: "passgram", lastTx: false },
  { id: "referral.passgram_linked", group: "Referral", label: "PassGram · linked", route: home("referral"), createStage: null, referralSegment: "passgram", lastTx: false },
  { id: "referral.communities", group: "Referral", label: "Communities referral", route: home("referral"), createStage: null, referralSegment: "communities", lastTx: false },
  { id: "tx.submitted", group: "Overlays", label: "Tx submitted toast", route: community(DEMO_FOREIGN_COMMUNITY_ID), createStage: null, referralSegment: null, lastTx: true },
];

export function demoSceneById(id: DemoSceneId): DemoScene {
  const scene = DEMO_SCENES.find((item) => item.id === id);
  if (!scene) throw new Error(`Unknown demo scene ${id}`);
  return scene;
}

function demoUser(overrides?: Partial<PassgramUser>): PassgramUser {
  return {
    id: `tg:${DEMO_OWNER_TG}`,
    displayName: "Demo Creator",
    username: "democreator",
    telegramUserId: DEMO_OWNER_TG,
    avatarUrl: "",
    createdAt: Date.now() - 86_400_000,
    payoutAddress: DEMO_PAYOUT,
    referralCode: null,
    referralLocked: false,
    ...overrides,
  };
}

function ownedCommunity(overrides?: Partial<CommunityRecord>): CommunityRecord {
  return {
    id: DEMO_OWNED_COMMUNITY_ID,
    ownerUserId: `tg:${DEMO_OWNER_TG}`,
    name: "Alpha Signals",
    telegramUsername: "",
    telegramChatId: "-1009000000001",
    description: "Private market notes for paid members.",
    imageUrl: "",
    price: "1500000",
    periodSeconds: 30 * 24 * 60 * 60,
    payoutAddress: DEMO_PAYOUT,
    accessMode: "subscription",
    automationMode: "full",
    automationReady: false,
    confirmation: "confirmed",
    status: "active",
    createdAt: Date.now() - 7 * 86_400_000,
    referralEnabled: false,
    referralPercentBps: 0,
    ...overrides,
  };
}

function foreignCommunity(): CommunityRecord {
  return {
    id: DEMO_FOREIGN_COMMUNITY_ID,
    ownerUserId: `tg:${DEMO_OTHER_TG}`,
    name: "Builder Lounge",
    telegramUsername: "",
    telegramChatId: "-1009000000002",
    description: "Weekly builder updates behind a USDT pass.",
    imageUrl: "",
    price: "2500000",
    periodSeconds: 30 * 24 * 60 * 60,
    payoutAddress: DEMO_PAYOUT,
    accessMode: "subscription",
    automationMode: "full",
    automationReady: false,
    confirmation: "confirmed",
    status: "active",
    createdAt: Date.now() - 14 * 86_400_000,
    referralEnabled: false,
    referralPercentBps: 0,
    telegramMemberCount: 128,
    ownerDisplayName: "Karim Fadel",
    ownerUsername: "karimfadel",
    ownerAvatarUrl: "",
  };
}

function activeSubscription(expiresInDays: number): SubscriptionRecord {
  const started = Date.now() - 10 * 86_400_000;
  return {
    id: 9101,
    subscriberUserId: `tg:${DEMO_OWNER_TG}`,
    communityId: DEMO_FOREIGN_COMMUNITY_ID,
    confirmation: "confirmed",
    startedAt: started,
    expiresAt: Date.now() + expiresInDays * 86_400_000,
    paymentAmount: "2500000",
    paymentAsset: "USDT",
    transactionReference: demoTxHash(9101),
    renewalPending: false,
    createdAt: started,
  };
}

function expiredSubscription(): SubscriptionRecord {
  const started = Date.now() - 60 * 86_400_000;
  return {
    id: 9102,
    subscriberUserId: `tg:${DEMO_OWNER_TG}`,
    communityId: DEMO_FOREIGN_COMMUNITY_ID,
    confirmation: "confirmed",
    startedAt: started,
    expiresAt: Date.now() - 3 * 86_400_000,
    paymentAmount: "2500000",
    paymentAsset: "USDT",
    transactionReference: demoTxHash(9102),
    renewalPending: false,
    createdAt: started,
  };
}

function demoTxHash(id: number): string {
  return `${id.toString(16)}c0ffee`.padEnd(64, "a").slice(0, 64);
}

function ownedAudience(): { subscriptions: SubscriptionRecord[]; payments: PaymentRecord[] } {
  const day = 86_400_000;
  const now = Date.now();
  const members = [
    { id: 9201, userId: 900011, startedDaysAgo: 8, expiresInDays: 22, displayName: "Layla Haddad", username: "laylahaddad" },
    { id: 9202, userId: 900012, startedDaysAgo: 28, expiresInDays: 2, displayName: "Omar Nasser", username: "omarnasser" },
    { id: 9203, userId: 900013, startedDaysAgo: 45, expiresInDays: -4, displayName: "Nora Saleh", username: "norasaleh" },
  ];
  const subscriptions = members.map((member) => {
    const started = now - member.startedDaysAgo * day;
    return {
      id: member.id,
      subscriberUserId: `tg:${member.userId}`,
      communityId: DEMO_OWNED_COMMUNITY_ID,
      confirmation: "confirmed" as const,
      startedAt: started,
      expiresAt: now + member.expiresInDays * day,
      paymentAmount: "1500000",
      paymentAsset: "USDT" as const,
      transactionReference: demoTxHash(member.id),
      renewalPending: false,
      createdAt: started,
      subscriberDisplayName: member.displayName,
      subscriberUsername: member.username,
      subscriberAvatarUrl: "",
    };
  });
  const currentPayments = members.map((member) => ({
    id: member.id,
    communityId: DEMO_OWNED_COMMUNITY_ID,
    subscriberUserId: `tg:${member.userId}`,
    gross: "1500000",
    creatorAmount: "1350000",
    platformFee: "150000",
    affiliateAmount: "0",
    communityAffiliateAmount: "0",
    status: "confirmed" as const,
    transactionReference: demoTxHash(member.id),
    at: now - member.startedDaysAgo * day,
  }));
  const earlierPayments = [
    { id: 9212, userId: 900012, daysAgo: 58 },
    { id: 9222, userId: 900012, daysAgo: 88 },
    { id: 9213, userId: 900013, daysAgo: 75 },
  ].map((payment) => ({
    id: payment.id,
    communityId: DEMO_OWNED_COMMUNITY_ID,
    subscriberUserId: `tg:${payment.userId}`,
    gross: "1500000",
    creatorAmount: "1350000",
    platformFee: "150000",
    affiliateAmount: "0",
    communityAffiliateAmount: "0",
    status: "confirmed" as const,
    transactionReference: demoTxHash(payment.id),
    at: now - payment.daysAgo * day,
  }));
  return { subscriptions, payments: [...currentPayments, ...earlierPayments] };
}

function affiliateLinked(): AffiliateRecord {
  return {
    userId: `tg:${DEMO_OWNER_TG}`,
    code: "democreator",
    payoutAddress: DEMO_PAYOUT,
    confirmation: "confirmed",
    createdAt: Date.now() - 3 * 86_400_000,
  };
}

export function buildDemoLedger(sceneId: DemoSceneId): DemoLedger {
  const empty: DemoLedger = {
    user: demoUser(),
    communities: [],
    subscriptions: [],
    affiliates: [],
    payments: [],
  };

  switch (sceneId) {
    case "dashboard.empty":
    case "create.not_selected":
    case "create.safety":
    case "create.selection_pending":
    case "create.verification_pending":
    case "create.permission_missing":
    case "create.verified":
      return empty;
    case "create.created":
      return {
        ...empty,
        communities: [ownedCommunity()],
      };
    case "dashboard.owner":
      return {
        ...empty,
        communities: [ownedCommunity()],
        affiliates: [affiliateLinked()],
      };
    case "manage.community": {
      const audience = ownedAudience();
      return {
        ...empty,
        communities: [ownedCommunity()],
        affiliates: [affiliateLinked()],
        subscriptions: audience.subscriptions,
        payments: audience.payments,
      };
    }
    case "referral.communities":
      return {
        ...empty,
        communities: [ownedCommunity({ referralEnabled: true, referralPercentBps: 1000 })],
        affiliates: [affiliateLinked()],
      };
    case "dashboard.subscriber":
    case "subscription.active":
      return {
        ...empty,
        communities: [foreignCommunity()],
        subscriptions: [activeSubscription(20)],
      };
    case "subscription.expired":
      return {
        ...empty,
        communities: [foreignCommunity()],
        subscriptions: [expiredSubscription()],
      };
    case "subscribe.join":
    case "subscribe.invite_blocked":
      return {
        ...empty,
        communities: [foreignCommunity()],
        subscriptions: [activeSubscription(20)],
      };
    case "dashboard.both":
      return {
        ...empty,
        communities: [ownedCommunity(), foreignCommunity()],
        subscriptions: [activeSubscription(12)],
      };
    case "community.purchase":
    case "tx.submitted":
      return {
        ...empty,
        communities: [foreignCommunity()],
      };
    case "referral.passgram_linked":
      return {
        ...empty,
        affiliates: [affiliateLinked()],
      };
    case "referral.passgram_register":
    case "referral.leaderboard":
    case "account.hub":
    case "account.analytics":
    case "account.notifications":
    case "account.policies":
      return empty;
    default:
      return empty;
  }
}

export function buildDemoCreateSnapshot(stage: DemoCreateStage): DemoCreateSnapshot {
  const baseChannel = {
    telegramChatId: "-1009000000001",
    communityId: null as number | null,
    title: "Alpha Signals",
    description: "Private market notes for paid members.",
    hasPhoto: false,
    telegramMemberCount: null as number | null,
    telegramMemberCountFetchedAt: null as string | null,
    verificationStatus: "permission_missing" as ChannelUiState,
    botCanInviteUsers: false,
    botCanRestrictMembers: false,
    botAdded: false,
    ownerTelegramUserId: String(DEMO_OWNER_TG),
    priceUsdt: null as string | null,
    durationDays: null as number | null,
  };

  switch (stage) {
    case "not_selected":
      return {
        channelState: "not_selected",
        channelMessage: "",
        requestId: null,
        price: "",
        duration: "",
        payout: "",
        created: false,
        shareOpen: false,
        safetyOpen: false,
        channel: null,
      };
    case "safety":
      return {
        channelState: "not_selected",
        channelMessage: "",
        requestId: null,
        price: "",
        duration: "",
        payout: "",
        created: false,
        shareOpen: false,
        safetyOpen: true,
        channel: null,
      };
    case "selection_pending":
      return {
        channelState: "selection_pending",
        channelMessage: "Waiting for Telegram to deliver the selected channel to PassGramBot…",
        requestId: 424242,
        price: "1.5",
        duration: "30",
        payout: DEMO_PAYOUT,
        created: false,
        shareOpen: false,
        safetyOpen: false,
        channel: null,
      };
    case "verification_pending":
      return {
        channelState: "verification_pending",
        channelMessage: "Verifying channel ownership…",
        requestId: 424242,
        price: "1.5",
        duration: "30",
        payout: DEMO_PAYOUT,
        created: false,
        shareOpen: false,
        safetyOpen: false,
        channel: null,
      };
    case "permission_missing":
      return {
        channelState: "permission_missing",
        channelMessage:
          "Channel ownership is verified. Add @PassGramBot as a channel administrator with Invite users via link and Ban users only, then tap Check bot access.",
        requestId: 424242,
        price: "1.5",
        duration: "30",
        payout: DEMO_PAYOUT,
        created: false,
        shareOpen: false,
        safetyOpen: false,
        channel: { ...baseChannel },
      };
    case "verified":
      return {
        channelState: "verified",
        channelMessage: "PassGramBot is added with invite and ban rights.",
        requestId: 424242,
        price: "1.5",
        duration: "30",
        payout: DEMO_PAYOUT,
        created: false,
        shareOpen: false,
        safetyOpen: false,
        channel: {
          ...baseChannel,
          verificationStatus: "verified",
          botCanInviteUsers: true,
          botCanRestrictMembers: true,
          botAdded: true,
          telegramMemberCount: 128,
          telegramMemberCountFetchedAt: new Date().toISOString(),
        },
      };
    case "created":
      return {
        channelState: "verified",
        channelMessage: "Community created.",
        requestId: 424242,
        price: "1.5",
        duration: "30",
        payout: DEMO_PAYOUT,
        created: true,
        shareOpen: true,
        safetyOpen: false,
        channel: {
          ...baseChannel,
          communityId: DEMO_OWNED_COMMUNITY_ID,
          verificationStatus: "verified",
          botCanInviteUsers: true,
          botCanRestrictMembers: true,
          botAdded: true,
          telegramMemberCount: 128,
          telegramMemberCountFetchedAt: new Date().toISOString(),
          priceUsdt: "1500000",
          durationDays: 30,
        },
      };
  }
}

export function buildDemoLastTx(): WalletSendResult {
  return {
    status: "sent",
    hash: "demo:boc:hash",
    intent: {
      kind: "jetton_subscribe",
      communityId: DEMO_FOREIGN_COMMUNITY_ID,
      amount: "2500000",
      to: "EQCWDE9JzFUQUSSFknz4z6tm-pqaiSCylVW4LlpZnzcty17h",
      hasPlatformReferrer: false,
      hasCommunityReferrer: false,
    },
  };
}

export const CREATE_FLOW_ORDER: DemoSceneId[] = [
  "create.not_selected",
  "create.safety",
  "create.selection_pending",
  "create.verification_pending",
  "create.permission_missing",
  "create.verified",
  "create.created",
];
