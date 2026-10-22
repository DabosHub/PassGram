import assert from "node:assert/strict";
import test from "node:test";
import { communityOpenUrl, communityReferralPaidNotice, notifyCommunityReferralPaid } from "./referralNotice.ts";

test("a confirmed community referral payment messages the referrer once per call", async () => {
  assert.equal(
    communityReferralPaidNotice({ title: "  Alpha   Signals ", actorName: "Lina Nasser", percentLabel: "10" }),
    "Lina Nasser subscribed to Alpha Signals through your community referral. You earn 10% of that payment.",
  );
  assert.match(communityReferralPaidNotice({ title: "", actorName: "", percentLabel: "" }), /^Someone you referred subscribed/);
  assert.equal(communityOpenUrl(7, { TELEGRAM_BOT_USERNAME: "@PassGramBot" }), "https://t.me/PassGramBot/passgram?startapp=c_7");

  const sent: string[] = [];
  const notified = await notifyCommunityReferralPaid({
    communityId: 7,
    subscriberTelegramUserId: "12",
    env: { TELEGRAM_BOT_USERNAME: "PassGramBot" },
    lookup: {
      referrerTelegramUserId: "9",
      title: "Alpha Signals",
      actorName: "Lina Nasser",
      referralPercentBps: 1500,
    },
    send: async (userId, text) => {
      sent.push(`${userId}:${text}`);
    },
  });
  const self = await notifyCommunityReferralPaid({
    communityId: 7,
    subscriberTelegramUserId: "9",
    lookup: { referrerTelegramUserId: "9", title: "Alpha", actorName: "", referralPercentBps: 1000 },
    send: async () => {
      sent.push("self");
    },
  });
  const missing = await notifyCommunityReferralPaid({
    communityId: 7,
    subscriberTelegramUserId: "12",
    lookup: null,
    send: async () => {
      sent.push("missing");
    },
  });
  assert.equal(notified, true);
  assert.equal(self, false);
  assert.equal(missing, false);
  assert.deepEqual(sent, ["9:Lina Nasser subscribed to Alpha Signals through your community referral. You earn 15% of that payment."]);
});
