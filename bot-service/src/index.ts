/**
 * Lightweight PassGram bot-service: TON event indexing + subscription expiration cron.
 * Channel verify / referral / webhook APIs stay in the Next.js Mini App.
 */
import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { runExpirationCronOnce } from "./cron.ts";
import { createPool } from "./db.ts";
import { runIndexerOnce } from "./indexer.ts";
import { createShutdown, sleep } from "./lifecycle.ts";
import { sanitizeError } from "./log.ts";

function startHealthServer(signal: AbortSignal): void {
  const port = Number(process.env.PASSGRAM_HEALTH_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("error", (error) => console.error("health server", sanitizeError(error)));
  server.listen(port, "0.0.0.0");
  signal.addEventListener("abort", () => server.close(), { once: true });
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const shutdown = createShutdown();
  startHealthServer(shutdown.signal);
  console.log("PassGram bot-service starting");
  console.log("registry", config.registryAddress);
  console.log("ton api", config.tonApiUrl);

  const indexer = (async () => {
    while (!shutdown.signal.aborted) {
      try {
        await runIndexerOnce(pool);
      } catch (error) {
        console.error("indexer", sanitizeError(error));
      }
      await sleep(config.pollIntervalMs, shutdown.signal);
    }
  })();

  const cron = (async () => {
    while (!shutdown.signal.aborted) {
      try {
        await runExpirationCronOnce(Date.now(), pool);
      } catch (error) {
        console.error("cron", sanitizeError(error));
      }
      await sleep(config.cronIntervalMs, shutdown.signal);
    }
  })();

  try {
    await Promise.all([indexer, cron]);
  } finally {
    await pool.end();
  }
}

void main();
