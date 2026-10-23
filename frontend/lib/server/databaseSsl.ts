import type { PoolConfig } from "pg";

/** Remote Postgres keeps certificate checks on. Set PASSGRAM_DATABASE_SSL_NO_VERIFY=1 only for a local proxy. */
export function databaseSsl(databaseUrl: string): PoolConfig["ssl"] {
  if (!/supabase|pooler\.|sslmode=require/i.test(databaseUrl)) return undefined;
  return { rejectUnauthorized: process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY !== "1" };
}
