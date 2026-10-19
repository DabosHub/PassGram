import nextEnv from "@next/env";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const { loadEnvConfig } = nextEnv;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..", "..");

loadEnvConfig(rootDir);

const url = (process.env.DATABASE_URL || "").trim();
if (!url) {
  console.log("STATUS=missing");
  process.exit(1);
}

if (/^https?:\/\//i.test(url)) {
  console.log("STATUS=wrong_format");
  console.log("HINT=DATABASE_URL must be a postgresql:// URI from Supabase Database settings, not the project https URL.");
  process.exit(1);
}

let host = "parse_error";
try {
  host = new URL(url.replace(/^postgresql:/i, "http:")).hostname;
} catch {
  /* keep parse_error */
}

console.log("STATUS=present");
console.log(`HOST=${host}`);

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

try {
  const meta = await pool.query(
    "select current_database() as db, count(*)::int as tables from information_schema.tables where table_schema = 'public'",
  );
  console.log(`DB=${meta.rows[0].db}`);
  console.log(`TABLES=${meta.rows[0].tables}`);
  const names = await pool.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log(`NAMES=${names.rows.map((row) => row.table_name).join(",")}`);
  console.log("OK=1");
} catch (error) {
  console.log("OK=0");
  console.log(`ERROR=${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
