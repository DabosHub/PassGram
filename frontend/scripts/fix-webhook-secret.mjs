import crypto from "node:crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = path.join(root, ".env.local");
const text = fs.readFileSync(envPath, "utf8");
const current = (text.match(/^TELEGRAM_WEBHOOK_SECRET=(.*)$/m)?.[1] || "").trim();
const valid = /^[A-Za-z0-9_-]{1,256}$/.test(current);

if (valid) {
  console.log("SECRET_STATUS=ok");
  process.exit(0);
}

const nextSecret = crypto.randomBytes(32).toString("base64url");
const next = text.includes("TELEGRAM_WEBHOOK_SECRET=")
  ? text.replace(/^TELEGRAM_WEBHOOK_SECRET=.*$/m, `TELEGRAM_WEBHOOK_SECRET=${nextSecret}`)
  : `${text.trimEnd()}\nTELEGRAM_WEBHOOK_SECRET=${nextSecret}\n`;

fs.writeFileSync(envPath, next);
console.log("SECRET_STATUS=regenerated");
console.log("REASON=Telegram secret_token allows only A-Z a-z 0-9 _ -");
console.log(`SECRET_LEN=${nextSecret.length}`);
