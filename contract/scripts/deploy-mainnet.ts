/**
 * Deploy the current PassGramRegistry source to TON mainnet.
 * Refuses to run unless PASSGRAM_DEPLOY_MAINNET=1.
 * The app accepts only the code hash in contract/registry.codehash.
 */
process.env.DEPLOY_NETWORK = "mainnet";

await import("./deploy-testnet.ts");
