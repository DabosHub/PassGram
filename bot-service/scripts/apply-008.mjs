import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envText = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const match = envText.match(/^DATABASE_URL=(.*)$/m);
if (!match) {
  console.log("NO_URL");
  process.exit(1);
}
let url = match[1].trim();
if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) url = url.slice(1, -1);
const sql = fs.readFileSync(path.join(root, "backend/migrations/008_renewal_reminder.sql"), "utf8");
const remote = /supabase|pooler\.|sslmode=require/i.test(url);
const pool = new pg.Pool({
  connectionString: url,
  ssl: remote ? { rejectUnauthorized: process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY !== "1" } : undefined,
});
try {
  await pool.query(sql);
  const check = await pool.query(
    `select column_name from information_schema.columns where table_name = 'community_memberships' and column_name = 'renewal_reminded_for_expires_at_ms'`,
  );
  console.log(check.rowCount ? "APPLIED" : "MISSING");
} catch (error) {
  console.log("FAILED", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
} finally {
  await pool.end();
}
