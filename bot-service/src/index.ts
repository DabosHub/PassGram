/**
 * Lightweight PassGram bot-service: TON event indexing + subscription expiration cron.
 * Channel verify / referral / webhook APIs stay in the Next.js Mini App.
 */
import { loadConfig } from "./config.ts";
import { runExpirationCronOnce } from "./cron.ts";
import { runIndexerOnce } from "./indexer.ts";

async function main() {
  const config = loadConfig();
  console.log("PassGram bot-service starting");
  console.log("registry", config.registryAddress);
  console.log("ton api", config.tonApiUrl);

  void (async () => {
    for (;;) {
      try {
        await runIndexerOnce();
      } catch (error) {
        console.error("indexer", error);
      }
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  })();

  void (async () => {
    for (;;) {
      try {
        await runExpirationCronOnce();
      } catch (error) {
        console.error("cron", error);
      }
      await new Promise((r) => setTimeout(r, config.cronIntervalMs));
    }
  })();
}

void main();
