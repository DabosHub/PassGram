import nextEnv from "@next/env";
import path from "path";
import { fileURLToPath } from "url";

const { loadEnvConfig } = nextEnv;
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnvConfig(rootDir);

const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const publicBase = (process.env.PASSGRAM_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");

if (!token || !secret || !publicBase) {
  console.log("OK=0");
  console.log(`TOKEN_SET=${token ? 1 : 0}`);
  console.log(`SECRET_SET=${secret ? 1 : 0}`);
  console.log(`PUBLIC_URL_SET=${publicBase ? 1 : 0}`);
  console.log("HINT=Set PASSGRAM_PUBLIC_URL=https://your-public-host in .env.local then rerun.");
  process.exit(1);
}

if (!/^https:\/\//i.test(publicBase)) {
  console.log("OK=0");
  console.log("HINT=PASSGRAM_PUBLIC_URL must be https://...");
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.log("OK=0");
  console.log("HINT=TELEGRAM_WEBHOOK_SECRET must match [A-Za-z0-9_-]{1,256}");
  process.exit(1);
}

const webhookUrl = `${publicBase}/api/telegram/webhook`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "chat_shared", "my_chat_member", "chat_member"],
    drop_pending_updates: false,
  }),
});
const payload = await response.json();
console.log(`OK=${payload.ok ? 1 : 0}`);
console.log(`HOST=${new URL(webhookUrl).host}`);
if (!payload.ok) {
  console.log(`ERROR=${payload.description || "unknown"}`);
  process.exit(1);
}

const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const info = await infoRes.json();
console.log(`URL_SET=${info.result?.url ? 1 : 0}`);
console.log(`PENDING=${info.result?.pending_update_count ?? 0}`);
