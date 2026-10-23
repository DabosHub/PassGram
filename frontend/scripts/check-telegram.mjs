import nextEnv from "@next/env";
import path from "path";
import { fileURLToPath } from "url";

const { loadEnvConfig } = nextEnv;
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnvConfig(rootDir);

function present(name) {
  const value = (process.env[name] || "").trim();
  return { name, ok: Boolean(value), length: value.length };
}

const required = [
  "TELEGRAM_BOT_TOKEN",
  "PASSGRAM_BOT_USER_ID",
  "TELEGRAM_WEBHOOK_SECRET",
  "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME",
  "DATABASE_URL",
].map(present);

for (const item of required) {
  console.log(`${item.name}=${item.ok ? "set" : "MISSING"} len=${item.length}`);
}

const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const expectedUsername = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
const expectedBotId = (process.env.PASSGRAM_BOT_USER_ID || "").trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

if (!token) {
  console.log("BOT_OK=0");
  process.exit(1);
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

const me = await telegram("getMe");
if (!me.ok) {
  console.log("BOT_OK=0");
  console.log(`GETME_ERROR=${me.description || "unknown"}`);
  process.exit(1);
}

const bot = me.result;
console.log(`BOT_OK=1`);
console.log(`BOT_ID=${bot.id}`);
console.log(`BOT_USERNAME=${bot.username || ""}`);
console.log(`BOT_ID_MATCH=${String(bot.id) === expectedBotId ? 1 : 0}`);
console.log(`BOT_USERNAME_MATCH=${(bot.username || "").toLowerCase() === expectedUsername.toLowerCase() ? 1 : 0}`);
console.log(`CAN_JOIN_GROUPS=${bot.can_join_groups ? 1 : 0}`);
console.log(`CAN_READ_MESSAGES=${bot.can_read_all_group_messages ? 1 : 0}`);

const hook = await telegram("getWebhookInfo");
if (!hook.ok) {
  console.log("WEBHOOK_OK=0");
  console.log(`WEBHOOK_ERROR=${hook.description || "unknown"}`);
  process.exitCode = 1;
} else {
  const info = hook.result;
  console.log(`WEBHOOK_URL_SET=${info.url ? 1 : 0}`);
  console.log(`WEBHOOK_URL_HOST=${info.url ? new URL(info.url).host : ""}`);
  console.log(`WEBHOOK_PENDING=${info.pending_update_count ?? 0}`);
  console.log(`WEBHOOK_LAST_ERROR=${info.last_error_message || ""}`);
  console.log(`WEBHOOK_HAS_CUSTOM_CERT=${info.has_custom_certificate ? 1 : 0}`);
}

const publicBase = (process.env.PASSGRAM_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
console.log(`PUBLIC_URL_SET=${publicBase ? 1 : 0}`);
if (publicBase) {
  const webhookUrl = `${publicBase}/api/telegram/webhook`;
  const set = await telegram("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    // Same list as set-telegram-webhook.mjs. chat_shared arrives inside message.
    // chat_member is a flood and this bot does not read it.
    allowed_updates: ["message", "my_chat_member"],
    drop_pending_updates: false,
  });
  console.log(`SET_WEBHOOK_OK=${set.ok ? 1 : 0}`);
  if (!set.ok) console.log(`SET_WEBHOOK_ERROR=${set.description || "unknown"}`);
} else {
  console.log("SET_WEBHOOK_OK=skipped");
  console.log("HINT=Set PASSGRAM_PUBLIC_URL to a public https origin to register the webhook.");
}
