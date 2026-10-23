import type { PoolConfig } from "pg";
import { SUPABASE_ROOT_CA } from "./supabaseRootCa";

/**
 * Remote Postgres stays encrypted. The Supabase pooler chains to the Supabase
 * Root 2021 CA, which Node does not trust by default, so verification uses that root.
 * Set PASSGRAM_DATABASE_SSL_NO_VERIFY=1 only for a local proxy.
 */
export function databaseSsl(databaseUrl: string): PoolConfig["ssl"] {
  if (!/supabase|pooler\.|sslmode=require/i.test(databaseUrl)) return undefined;
  if (process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY === "1") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, ca: SUPABASE_ROOT_CA };
}
