/**
 * Deploy PassGramRegistry to TON testnet, bind USDT jetton wallet, fund gas.
 *
 * Required env (contract/.env or repo root .env.local):
 *   DEPLOYER_MNEMONIC="word1 word2 ... word24"
 * Optional:
 *   TREASURY_ADDRESS=...          (defaults to deployer)
 *   USDT_JETTON_MASTER=kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy
 *   TONCENTER_API_KEY=...
 *   DEPLOY_TON_AMOUNT=0.25        (TON attached to deploy)
 *   GAS_RESERVE_TON=0.5           (TON sent after deploy for JettonTransfer outs)
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { Address, beginCell, toNano, SendMode, type TupleItem } from "@ton/core";
import {
  TonClient,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
  internal,
} from "@ton/ton";
import {
  PassGramRegistry,
  storeDeploy,
  storeSetUsdtJettonWallet,
  type Deploy,
  type SetUsdtJettonWallet,
} from "../build/PassGramRegistry_PassGramRegistry.js";

type DeployWallet = WalletContractV5R1 | WalletContractV4 | WalletContractV3R2;

function openDeployerWallet(publicKey: Buffer, expectedOwner?: Address): DeployWallet {
  const candidates: Array<{ name: string; wallet: DeployWallet }> = [
    { name: "v5r1", wallet: WalletContractV5R1.create({ publicKey, workchain: 0 }) },
    {
      name: "v5r1-testnet",
      wallet: WalletContractV5R1.create({
        publicKey,
        workchain: 0,
        walletId: { networkGlobalId: -3 },
      }),
    },
    { name: "v4", wallet: WalletContractV4.create({ publicKey, workchain: 0 }) },
    { name: "v3r2", wallet: WalletContractV3R2.create({ publicKey, workchain: 0 }) },
  ];
  if (expectedOwner) {
    const hit = candidates.find((c) => expectedOwner.equals(c.wallet.address));
    if (!hit) {
      throw new Error(
        `PASSGRAM_OWNER_ADDRESS (${expectedOwner.toString()}) does not match DEPLOYER_MNEMONIC (tried v5r1/v4/v3r2)`,
      );
    }
    console.log("Wallet type:", hit.name);
    return hit.wallet;
  }
  console.log("Wallet type: v5r1 (default)");
  return candidates[0]!.wallet;
}

async function sendWalletTransfer(
  walletContract: { sendTransfer: Function },
  wallet: DeployWallet,
  args: {
    secretKey: Buffer;
    seqno: number;
    messages: ReturnType<typeof internal>[];
  },
) {
  if (wallet instanceof WalletContractV5R1) {
    await walletContract.sendTransfer({
      secretKey: args.secretKey,
      seqno: args.seqno,
      messages: args.messages,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    });
    return;
  }
  await walletContract.sendTransfer({
    secretKey: args.secretKey,
    seqno: args.seqno,
    messages: args.messages,
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../../.env.local") });

/** Canonical testnet USDT (USDTTT) jetton master. */
const DEFAULT_TESTNET_USDT = "kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy";

async function resolveJettonWallet(
  client: TonClient,
  master: Address,
  owner: Address,
): Promise<Address> {
  const stack: TupleItem[] = [
    {
      type: "slice",
      cell: beginCell().storeAddress(owner).endCell(),
    },
  ];
  const result = await client.runMethod(master, "get_wallet_address", stack);
  return result.stack.readAddress();
}

async function main() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error("Set DEPLOYER_MNEMONIC (24 words) in contract/.env");
  }
  const words = mnemonic.split(/\s+/);
  if (words.length < 12) {
    throw new Error("DEPLOYER_MNEMONIC looks invalid");
  }

  const usdtMaster = Address.parse(
    process.env.USDT_JETTON_MASTER?.trim() || DEFAULT_TESTNET_USDT,
  );
  const deployAmount = toNano(process.env.DEPLOY_TON_AMOUNT || "0.25");
  const gasReserve = toNano(process.env.GAS_RESERVE_TON || "0.5");

  let endpoint =
    process.env.TON_API_URL?.replace(/\/$/, "") ||
    "https://testnet.toncenter.com/api/v2/jsonRPC";
  if (!endpoint.endsWith("/jsonRPC")) {
    endpoint = `${endpoint}/jsonRPC`;
  }
  const client = new TonClient({
    endpoint,
    apiKey: process.env.TONCENTER_API_KEY || undefined,
  });

  const keyPair = await mnemonicToPrivateKey(words);
  const expectedOwner = process.env.PASSGRAM_OWNER_ADDRESS?.trim()
    ? Address.parse(process.env.PASSGRAM_OWNER_ADDRESS.trim())
    : undefined;
  const wallet = openDeployerWallet(keyPair.publicKey, expectedOwner);
  const walletContract = client.open(wallet);
  const deployer = walletContract.address;

  const treasuryRaw = process.env.TREASURY_ADDRESS?.trim();
  if (!treasuryRaw) {
    throw new Error("Set TREASURY_ADDRESS in .env.local (treasury wallet for platform fees)");
  }
  const treasury = Address.parse(treasuryRaw);

  console.log("Network:     testnet");
  console.log("Owner:      ", deployer.toString());
  console.log("Treasury:   ", treasury.toString());
  console.log("USDT master:", usdtMaster.toString());

  if (!process.env.TONCENTER_API_KEY?.trim()) {
    console.log("Tip: set TONCENTER_API_KEY in .env.local to avoid 429 (https://toncenter.com)");
  }

  const balance = await withRetry("getBalance", () => walletContract.getBalance());
  if (balance < deployAmount + gasReserve + toNano("0.1")) {
    throw new Error(
      `Deployer balance too low (${balance}). Fund testnet TON via @testgiver_ton_bot`,
    );
  }

  const registry = await PassGramRegistry.fromInit(deployer, treasury, usdtMaster);
  console.log("Registry:   ", registry.address.toString());

  const opened = client.open(registry);
  const already = await withRetry("isDeployed", () => client.isContractDeployed(registry.address));
  let seqno = await withRetry("getSeqno", () => walletContract.getSeqno());

  if (!already) {
    console.log("Deploying PassGramRegistry…");
    await withRetry("deploy", () =>
      sendWalletTransfer(walletContract, wallet, {
        secretKey: keyPair.secretKey,
        seqno,
        messages: [
          internal({
            to: registry.address,
            value: deployAmount,
            init: registry.init,
            body: beginCell()
              .store(
                storeDeploy({
                  $$type: "Deploy",
                  queryId: 0n,
                } satisfies Deploy),
              )
              .endCell(),
            bounce: false,
          }),
        ],
      }),
    );
    await waitSeqno(walletContract, seqno);
    seqno = await withRetry("getSeqno", () => walletContract.getSeqno());
    console.log("Deployed.");
  } else {
    console.log("Already deployed — skipping deploy message.");
  }

  // Gas reserve for outbound JettonTransfer messages
  console.log("Funding gas reserve…");
  await withRetry("fundGas", () =>
    sendWalletTransfer(walletContract, wallet, {
      secretKey: keyPair.secretKey,
      seqno,
      messages: [
        internal({
          to: registry.address,
          value: gasReserve,
          body: beginCell().endCell(),
          bounce: false,
        }),
      ],
    }),
  );
  await waitSeqno(walletContract, seqno);
  seqno = await withRetry("getSeqno", () => walletContract.getSeqno());

  const jettonWallet = await withRetry("jettonWallet", () =>
    resolveJettonWallet(client, usdtMaster, registry.address),
  );
  console.log("USDT wallet:", jettonWallet.toString());

  const bound = await withRetry("getUsdtWallet", () => opened.getUsdtJettonWallet());
  if (!bound || !bound.equals(jettonWallet)) {
    console.log("Binding SetUsdtJettonWallet…");
    const msg: SetUsdtJettonWallet = {
      $$type: "SetUsdtJettonWallet",
      wallet: jettonWallet,
    };
    await withRetry("bindUsdt", () =>
      sendWalletTransfer(walletContract, wallet, {
        secretKey: keyPair.secretKey,
        seqno,
        messages: [
          internal({
            to: registry.address,
            value: toNano("0.05"),
            body: beginCell().store(storeSetUsdtJettonWallet(msg)).endCell(),
            bounce: true,
          }),
        ],
      }),
    );
    await waitSeqno(walletContract, seqno);
    console.log("USDT jetton wallet bound.");
  } else {
    console.log("USDT jetton wallet already bound.");
  }

  console.log("\n--- copy into .env.local ---");
  console.log("NEXT_PUBLIC_TON_NETWORK=testnet");
  console.log(`NEXT_PUBLIC_USDT_JETTON=${usdtMaster.toString()}`);
  console.log(`NEXT_PUBLIC_PASSGRAM_REGISTRY=${registry.address.toString()}`);
  console.log(`PASSGRAM_REGISTRY_ADDRESS=${registry.address.toString()}`);
  console.log("TON_API_URL=https://testnet.toncenter.com/api/v2");
}

async function waitSeqno(walletContract: { getSeqno: () => Promise<number> }, prev: number) {
  for (let i = 0; i < 60; i++) {
    await sleep(2500);
    try {
      const next = await walletContract.getSeqno();
      if (next > prev) return;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        console.log("waitSeqno: rate-limited, continuing…");
        continue;
      }
      throw err;
    }
  }
  throw new Error("Timed out waiting for wallet seqno");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = (err as { response?: { status?: number }; status?: number })?.response?.status
        ?? (err as { status?: number })?.status;
      const msg = String((err as Error)?.message || err);
      const rateLimited = status === 429 || /ratelimit|too many requests/i.test(msg);
      if (!rateLimited || i === attempts - 1) throw err;
      const waitMs = 3000 * (i + 1);
      console.log(`${label}: rate-limited, retry in ${waitMs / 1000}s…`);
      await sleep(waitMs);
    }
  }
  throw last;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
