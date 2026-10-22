import assert from "node:assert/strict";
import test from "node:test";
import { renewalMiniAppUrl, renewalReminderText } from "./cron.ts";

test("last-day reminder names the community and opens its Mini App", () => {
  assert.equal(
    renewalReminderText("  Builder   Lounge  "),
    "1 day left on your subscription to Builder Lounge. Renew before it ends, or your access to the channel will be removed.",
  );
  assert.equal(
    renewalMiniAppUrl(9002, { TELEGRAM_BOT_USERNAME: "@PassGramBot" }),
    "https://t.me/PassGramBot/passgram?startapp=c_9002",
  );
});
