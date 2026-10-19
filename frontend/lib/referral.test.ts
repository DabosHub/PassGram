import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  decideAttribution,
  parseReferralStartPayload,
  readStartFromUpdate,
} from "./referralPolicy.ts";
import {
  attributeFromWebhook,
  attributeReferral,
  registerAffiliate,
  type ReferralDeps,
} from "./server/referralFlow.ts";
import { MemoryReferralRepository } from "./server/referralRepository.ts";

const token = "test-token";

function sign(userId: number, authDate = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = { auth_date: String(authDate), user: JSON.stringify({ id: userId }) };
  const dataCheck = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

test("start payloads extract referral codes", () => {
  assert.equal(parseReferralStartPayload("/start ref_mira"), "mira");
  assert.equal(parseReferralStartPayload("/start@PassGramBot ref_mira"), "mira");
  assert.equal(parseReferralStartPayload("ref_pass_gram"), "pass_gram");
  assert.equal(parseReferralStartPayload("/start"), null);
  assert.equal(readStartFromUpdate({ message: { from: { id: 9 }, text: "/start ref_mira" } })?.code, "mira");
});

test("first-touch attribution locks on Start and ignores later invites", async () => {
  const repo = new MemoryReferralRepository();
  const deps: ReferralDeps = {
    repo,
    botToken: token,
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const marketer = await registerAffiliate(deps, sign(1), "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs", "mira");
  assert.equal(marketer.ok, true);
  assert.ok(marketer.affiliate?.code);

  const fromStart = await attributeFromWebhook(deps, {
    message: { from: { id: 42 }, text: `/start ref_${marketer.affiliate?.code}` },
  });
  assert.equal(fromStart.handled, true);
  assert.equal((await repo.getAttribution("42"))?.referrerTelegramUserId, "1");

  const second = await attributeReferral(deps, sign(42), "other", "mini_app");
  assert.equal(second.result, "already_locked");
  assert.equal((await repo.getAttribution("42"))?.referrerTelegramUserId, "1");

  const self = await attributeReferral(deps, sign(1), marketer.affiliate!.code, "mini_app");
  assert.equal(self.result, "self");
});

test("attribution decision rejects unknown and self codes", () => {
  const affiliate = {
    code: "mira",
    telegramUserId: "1",
    payoutAccount: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
    createdAt: new Date().toISOString(),
  };
  assert.equal(
    decideAttribution({
      inviteeTelegramUserId: "2",
      code: "mira",
      existing: null,
      affiliate: null,
      source: "mini_app",
      nowIso: new Date().toISOString(),
    }).result,
    "unknown",
  );
  assert.equal(
    decideAttribution({
      inviteeTelegramUserId: "1",
      code: "mira",
      existing: null,
      affiliate,
      source: "mini_app",
      nowIso: new Date().toISOString(),
    }).result,
    "self",
  );
});
