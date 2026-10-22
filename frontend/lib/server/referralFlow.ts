import { normalizeTonAddress } from "../ton/config";
import {
  buildAffiliateCode,
  decideAttribution,
  parseReferralStartPayload,
  readStartFromUpdate,
  type AffiliateRecord,
  type AttributionRecord,
} from "../referralPolicy";
import { normalizeCode } from "../money";
import { validateInitData } from "./initData";
import type { ReferralRepository } from "./referralRepository";

export type ReferralDeps = {
  repo: ReferralRepository;
  botToken: string;
  now: () => number;
  accountStatus: (accountId: string) => Promise<"exists" | "missing" | "implicit" | "unknown">;
};

export type ReferralResult = {
  ok: boolean;
  message: string;
  result?: string;
  affiliate?: AffiliateRecord;
  attribution?: AttributionRecord;
  linkPath?: string;
};

export async function registerAffiliate(
  deps: ReferralDeps,
  initData: string,
  payoutAccount: string,
  telegramUsername?: string | null,
  signerAddress?: string | null,
): Promise<ReferralResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("Open PassGram from Telegram so your account can be confirmed.");
  const payout = normalizeTonAddress(payoutAccount);
  if (!payout) return fail("Enter a TON payout address (EQ… / UQ… or 0:…).");
  const signer = signerAddress ? normalizeTonAddress(signerAddress) : null;
  if (signerAddress && !signer) return fail("The signing wallet could not be read.");
  const status = await deps.accountStatus(payout);
  if (status === "missing") return fail("That TON address is invalid. No payment was sent.");
  if (status === "unknown") return fail("The TON address could not be confirmed. No payment was sent.");
  const existing = await deps.repo.getAffiliateByTelegramUserId(String(identity.userId));
  if (existing) {
    return {
      ok: true,
      message: "This referral link is already active. The payout address stays as first recorded.",
      result: "exists",
      affiliate: existing,
      linkPath: `ref_${existing.code}`,
    };
  }
  let code = buildAffiliateCode({ telegramUsername, telegramUserId: identity.userId });
  if (await deps.repo.getAffiliateByCode(code)) {
    code = buildAffiliateCode({ telegramUsername: null, telegramUserId: identity.userId });
  }
  if (await deps.repo.getAffiliateByCode(code)) {
    code = `u${identity.userId.toString(36)}${Math.floor(deps.now() % 36).toString(36)}`.slice(0, 32);
  }
  const normalized = normalizeCode(code);
  if (!normalized) return fail("A referral code could not be prepared for this account.");
  const affiliate = await deps.repo.saveAffiliate({
    code: normalized,
    telegramUserId: String(identity.userId),
    payoutAccount: payout,
    signerAddress: signer,
    createdAt: new Date(deps.now()).toISOString(),
  });
  return {
    ok: true,
    message: "Referral link created.",
    result: "created",
    affiliate,
    linkPath: `ref_${affiliate.code}`,
  };
}

export async function attributeReferral(
  deps: ReferralDeps,
  initData: string,
  rawCode: string,
  source: AttributionRecord["source"] = "mini_app",
): Promise<ReferralResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("Open PassGram from Telegram so your account can be confirmed.");
  return attributeForUser(deps, String(identity.userId), rawCode, source);
}

export async function attributeFromWebhook(deps: ReferralDeps, update: unknown): Promise<{ handled: boolean }> {
  const start = readStartFromUpdate(update);
  if (!start) return { handled: false };
  await attributeForUser(deps, start.telegramUserId, start.code, "start_webhook");
  return { handled: true };
}

export async function readReferralState(deps: ReferralDeps, initData: string): Promise<ReferralResult> {
  const identity = validateInitData(initData, deps.botToken, deps.now() / 1000);
  if (!identity) return fail("Open PassGram from Telegram so your account can be confirmed.");
  const affiliate = await deps.repo.getAffiliateByTelegramUserId(String(identity.userId));
  const attribution = await deps.repo.getAttribution(String(identity.userId));
  return {
    ok: true,
    message: "ok",
    affiliate: affiliate ?? undefined,
    attribution: attribution ?? undefined,
    linkPath: affiliate ? `ref_${affiliate.code}` : undefined,
  };
}

export async function attributionForCreator(
  deps: ReferralDeps,
  creatorTelegramUserId: string,
): Promise<AttributionRecord | null> {
  return deps.repo.getAttribution(creatorTelegramUserId);
}

async function attributeForUser(
  deps: ReferralDeps,
  inviteeTelegramUserId: string,
  rawCode: string,
  source: AttributionRecord["source"],
): Promise<ReferralResult> {
  const code = parseReferralStartPayload(rawCode) || normalizeCode(rawCode);
  if (!code) return { ok: false, message: "This referral code is invalid.", result: "invalid" };
  const existing = await deps.repo.getAttribution(inviteeTelegramUserId);
  const affiliate = await deps.repo.getAffiliateByCode(code);
  const decision = decideAttribution({
    inviteeTelegramUserId,
    code,
    existing,
    affiliate,
    source,
    nowIso: new Date(deps.now()).toISOString(),
  });
  if (decision.result === "already_locked") {
    return { ok: true, message: "Referral already locked.", result: "already_locked", attribution: decision.attribution };
  }
  if (decision.result === "invalid") return { ok: false, message: "This referral code is invalid.", result: "invalid" };
  if (decision.result === "unknown") {
    return { ok: false, message: "This referral code is not registered.", result: "unknown" };
  }
  if (decision.result === "self") {
    return { ok: false, message: "You cannot use your own referral code.", result: "self" };
  }
  const inserted = await deps.repo.insertAttribution(decision.attribution);
  if (inserted === "exists") {
    const current = await deps.repo.getAttribution(inviteeTelegramUserId);
    return {
      ok: true,
      message: "Referral already locked.",
      result: "already_locked",
      attribution: current ?? decision.attribution,
    };
  }
  return {
    ok: true,
    message: "Referral locked from this invite.",
    result: "locked",
    attribution: decision.attribution,
  };
}

function fail(message: string): ReferralResult {
  return { ok: false, message };
}
