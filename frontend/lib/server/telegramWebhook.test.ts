import assert from "node:assert/strict";
import test from "node:test";
import { recoverUndeliveredUpdates, resetWebhookRecovery, webhookOrigin, webhookSecret } from "./telegramWebhook.ts";

test("webhook origin stays on the public app", () => {
  assert.equal(webhookOrigin("https://passgram.io/api/telegram/selections/1"), "https://passgram.io");
  assert.equal(webhookOrigin("https://preview-abc.vercel.app/api/telegram/selections/1"), "https://passgram.io");
  assert.equal(webhookSecret({ TELEGRAM_WEBHOOK_SECRET: "\"abc_DEF-1\"" }), "abc_DEF-1");
});

test("a rejected webhook queue is applied before the bot is registered again", async () => {
  resetWebhookRecovery();
  const calls: string[] = [];
  const ingested: unknown[] = [];
  const outcome = await recoverUndeliveredUpdates(
    {
      telegram: {
        async call(method, body) {
          calls.push(method);
          if (method === "getWebhookInfo") {
            return { url: "https://pass-gram.vercel.app/api/telegram/webhook", pending_update_count: 1 };
          }
          if (method === "getUpdates" && !body?.offset) {
            return [{ update_id: 5, message: { from: { id: 42 }, chat_shared: { request_id: 7, chat_id: -100 } } }];
          }
          if (method === "setWebhook") {
            assert.equal(body?.url, "https://passgram.io/api/telegram/webhook");
            assert.equal(body?.secret_token, "server-secret");
            assert.equal(body?.drop_pending_updates, false);
          }
          return true;
        },
      },
      ingest: async (update) => {
        ingested.push(update);
      },
    },
    { secret: "server-secret", webhookUrl: "https://passgram.io/api/telegram/webhook", force: true },
  );
  assert.equal(outcome, "recovered");
  assert.deepEqual(calls, ["getWebhookInfo", "deleteWebhook", "getUpdates", "getUpdates", "setWebhook"]);
  assert.equal(ingested.length, 1);
});

test("a healthy webhook is left alone", async () => {
  resetWebhookRecovery();
  const calls: string[] = [];
  const outcome = await recoverUndeliveredUpdates(
    {
      telegram: {
        async call(method) {
          calls.push(method);
          return { url: "https://passgram.io/api/telegram/webhook", pending_update_count: 0 };
        },
      },
      ingest: async () => {
        throw new Error("should not ingest");
      },
    },
    { secret: "server-secret", webhookUrl: "https://passgram.io/api/telegram/webhook", force: true },
  );
  assert.equal(outcome, "healthy");
  assert.deepEqual(calls, ["getWebhookInfo"]);
});
