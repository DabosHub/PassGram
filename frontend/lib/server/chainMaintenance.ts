import { Pool } from "pg";
import { runExpirationCronOnce } from "../../../bot-service/src/cron.ts";
import { runIndexerOnce } from "../../../bot-service/src/indexer.ts";
import { sanitizeError } from "../../../bot-service/src/log.ts";
import { databaseSsl } from "./databaseSsl";

const PASS_INTERVAL_SECONDS = 8;
/** Leaves room inside the 60s route limit for the membership read after a slow TonCenter call. */
export const CHAIN_PASS_WAIT_MS = 25_000;
const pools = globalThis as { passgramChainPool?: Pool; passgramChainActive?: boolean };
let chainInflight: Promise<"ran" | "skipped" | "busy"> | null = null;

export function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function chainPool(): Pool | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;
  if (!pools.passgramChainPool) {
    pools.passgramChainPool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseSsl(databaseUrl),
      max: 3,
    });
  }
  return pools.passgramChainPool;
}

/**
 * One chain pass at a time. The claim is atomic so overlapping Vercel instances
 * do not walk the same registry cursor. The update does not move last_processed_lt.
 */
export function runChainPass(): Promise<"ran" | "skipped" | "busy"> {
  if (chainInflight) return Promise.resolve("busy");
  const work = executeChainPass().finally(() => {
    if (chainInflight === work) chainInflight = null;
  });
  chainInflight = work;
  return work;
}

/**
 * Waits for this instance's chain pass, including one that is already running.
 * A slow pass keeps going after the timeout so the cursor is not abandoned.
 */
export function awaitChainPass(timeoutMs = CHAIN_PASS_WAIT_MS): Promise<"ran" | "skipped" | "busy" | "timeout"> {
  return withTimeout(chainInflight ?? runChainPass(), timeoutMs);
}

async function executeChainPass(): Promise<"ran" | "skipped" | "busy"> {
  const pool = chainPool();
  if (!pool || pools.passgramChainActive) return pools.passgramChainActive ? "busy" : "skipped";
  const claim = await pool.query(
    `insert into indexer_state (singleton, last_processed_lt)
     values (true, 0)
     on conflict (singleton) do update
       set last_updated_at = now()
       where indexer_state.last_updated_at < now() - make_interval(secs => $1)
     returning singleton`,
    [PASS_INTERVAL_SECONDS],
  );
  if (claim.rowCount !== 1) return "skipped";

  pools.passgramChainActive = true;
  try {
    try {
      await runIndexerOnce(pool);
    } catch (error) {
      console.error("indexer pass failed", sanitizeError(error));
    }
    try {
      await runExpirationCronOnce(Date.now(), pool);
    } catch (error) {
      console.error("expiration pass failed", sanitizeError(error));
    }
    return "ran";
  } finally {
    pools.passgramChainActive = false;
  }
}
