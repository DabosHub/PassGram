import assert from "node:assert/strict";
import test from "node:test";
import { renewalMiniAppUrl, renewalReminderText } from "./cron.ts";

test("last-day reminder names the community and opens its Mini App", () => {
  assert.match(renewalReminderText("  Builder   Lounge  "), /1 day left/);
  assert.match(renewalReminderText("  Builder   Lounge  "), /Builder Lounge/);
  assert.equal(
    renewalMiniAppUrl(9002, { TELEGRAM_BOT_USERNAME: "@PassGramBot" }),
    "https://t.me/PassGramBot/passgram?startapp=c_9002",
  );
});
