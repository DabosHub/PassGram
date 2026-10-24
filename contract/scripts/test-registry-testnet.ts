/**
 * Live testnet coverage for PassGramRegistry receivers + getters.
 * Uses DEPLOYER_MNEMONIC / NEXT_PUBLIC_PASSGRAM_REGISTRY from .env.local
 */
import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mnemonicToPrivateKey, sign } from "@ton/crypto";
import { Address, beginCell, toNano, SendMode } from "@ton/core";
import {
  TonClient,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
  internal,
} from "@ton/ton";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../../.env.local") });

type DeployWallet = WalletContractV5R1 | WalletContractV4 | WalletContractV3R2;

type CaseResult = { name: string; ok: boolean; detail: string };

const results: CaseResult[] = [];
const COMMUNITY_ID = 900001n;
const PRICE = 1_000_000n; // 1 USDT (6 decimals)
const DURATION = 30 * 24 * 60 * 60; // 30d

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 10): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status =
        (err as { response?: { status?: number } })?.response?.status ??
        (err as { status?: number })?.status;
      const msg = String((err as Error)?.message || err);
      if ((status !== 429 && !/ratelimit|too many/i.test(msg)) || i === attempts - 1) throw err;
      const waitMs = 2500 * (i + 1);
      console.log(`  [${label}] 429 → wait ${waitMs / 1000}s`);
      await sleep(waitMs);
    }
  }
  throw last;
}

function openDeployerWallet(publicKey: Buffer, expectedOwner?: Address): DeployWallet {
  const candidates: DeployWallet[] = [
    WalletContractV5R1.create({ publicKey, workchain: 0 }),
    WalletContractV5R1.create({ publicKey, workchain: 0, walletId: { networkGlobalId: -3 } }),
    WalletContractV4.create({ publicKey, workchain: 0 }),
    WalletContractV3R2.create({ publicKey, workchain: 0 }),
  ];
  if (expectedOwner) {
    const hit = candidates.find((w) => expectedOwner.equals(w.address));
    if (!hit) throw new Error("Owner address does not match mnemonic wallet versions");
    return hit;
  }
  return candidates[0]!;
}

async function sendWalletTransfer(
  walletContract: { sendTransfer: Function },
  wallet: DeployWallet,
  args: { secretKey: Buffer; seqno: number; messages: ReturnType<typeof internal>[] },
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

async function waitSeqno(walletContract: { getSeqno: () => Promise<number> }, prev: number) {
  for (let i = 0; i < 40; i++) {
    await sleep(2500);
    try {
      const next = await walletContract.getSeqno();
      if (next > prev) return next;
    } catch {
      /* rate limit */
    }
  }
  throw new Error("Timed out waiting for seqno");
}

function pass(name: string, detail: string) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name} — ${detail}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL  ${name} — ${detail}`);
}

async function main() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC?.trim();
  const registryRaw =
    process.env.NEXT_PUBLIC_PASSGRAM_REGISTRY?.trim() ||
    process.env.PASSGRAM_REGISTRY_ADDRESS?.trim();
  if (!mnemonic || !registryRaw) {
    throw new Error("Need DEPLOYER_MNEMONIC and NEXT_PUBLIC_PASSGRAM_REGISTRY");
  }

  let endpoint =
    process.env.TON_API_URL?.replace(/\/$/, "") ||
    "https://testnet.toncenter.com/api/v2/jsonRPC";
  if (!endpoint.endsWith("/jsonRPC")) endpoint = `${endpoint}/jsonRPC`;

  const client = new TonClient({
    endpoint,
    apiKey: process.env.TONCENTER_API_KEY || undefined,
  });

  const keyPair = await mnemonicToPrivateKey(mnemonic.split(/\s+/));
  const expectedOwner = process.env.PASSGRAM_OWNER_ADDRESS?.trim()
    ? Address.parse(process.env.PASSGRAM_OWNER_ADDRESS.trim())
    : undefined;
  const wallet = openDeployerWallet(keyPair.publicKey, expectedOwner);
  const walletContract = client.open(wallet);
  const owner = walletContract.address;
  const treasury = Address.parse(process.env.TREASURY_ADDRESS!.trim());
  const registryAddr = Address.parse(registryRaw);
  const readInt = async (method: string, args: { type: "int"; value: bigint }[] = []) =>
    (await client.runMethod(registryAddr, method, args)).stack.readBigNumber();
  const readAddress = async (method: string) => (await client.runMethod(registryAddr, method)).stack.readAddress();
  const readAddressOpt = async (method: string) =>
    (await client.runMethod(registryAddr, method)).stack.readAddressOpt();

  // Secondary address for community-referrer / fake-sender tests (treasury)
  const communityReferrer = treasury;

  console.log("Registry", registryAddr.toString());
  console.log("Owner   ", owner.toString());
  console.log("");

  // ── Getters ──────────────────────────────────────────────
  {
    const fee = await withRetry("platformFeeBps", () => readInt("platformFeeBps"));
    fee === 250n
      ? pass("get platformFeeBps", `${fee}`)
      : fail("get platformFeeBps", `expected 250 got ${fee}`);
  }
  {
    const v = await withRetry("affiliateShare", () => readInt("affiliateShareOfPlatformBps"));
    v === 2000n
      ? pass("get affiliateShareOfPlatformBps", `${v}`)
      : fail("get affiliateShareOfPlatformBps", `expected 2000 got ${v}`);
  }
  {
    const v = await withRetry("maxCommunityReferralBps", () => readInt("maxCommunityReferralBps"));
    v === 5000n
      ? pass("get maxCommunityReferralBps", `${v}`)
      : fail("get maxCommunityReferralBps", `expected 5000 got ${v}`);
  }
  {
    const v = await withRetry("treasury", () => readAddress("treasury"));
    v.equals(treasury)
      ? pass("get treasury", v.toString())
      : fail("get treasury", `expected ${treasury} got ${v}`);
  }
  {
    const master = await withRetry("usdtMaster", () => readAddress("usdtJettonMaster"));
    const envMaster = Address.parse(
      process.env.NEXT_PUBLIC_USDT_JETTON ||
        process.env.USDT_JETTON_MASTER ||
        "kQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPsyy",
    );
    master.equals(envMaster)
      ? pass("get usdtJettonMaster", master.toString())
      : fail("get usdtJettonMaster", `expected ${envMaster} got ${master}`);
  }
  {
    const w = await withRetry("usdtWallet", () => readAddressOpt("usdtJettonWallet"));
    w
      ? pass("get usdtJettonWallet", w.toString())
      : fail("get usdtJettonWallet", "null — not bound");
  }
  {
    const before = await withRetry("communityReferralBps(unknown)", () =>
      readInt("communityReferralBps", [{ type: "int", value: 999999999n }]),
    );
    before === 0n
      ? pass("get communityReferralBps (unknown)", "0")
      : fail("get communityReferralBps (unknown)", `expected 0 got ${before}`);
  }

  // ── receive() empty TON deposit ──────────────────────────
  {
    const name = "receive() empty (gas top-up)";
    try {
      let seqno = await withRetry("seqno", () => walletContract.getSeqno());
      await withRetry("emptyTon", () =>
        sendWalletTransfer(walletContract, wallet, {
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            internal({
              to: registryAddr,
              value: toNano("0.05"),
              body: beginCell().endCell(),
              bounce: true,
            }),
          ],
        }),
      );
      seqno = await waitSeqno(walletContract, seqno);
      pass(name, "accepted 0.05 TON");
    } catch (e) {
      fail(name, String((e as Error).message || e));
    }
  }

  // ── RegisterCommunity ────────────────────────────────────
  {
    const name = "RegisterCommunity";
    try {
      const terms = beginCell()
        .storeAddress(owner)
        .storeCoins(PRICE)
        .storeUint(DURATION, 32)
        .storeBit(false)
        .storeUint(0, 16)
        .storeUint(0, 8)
        .endCell();
      const approved = beginCell()
        .storeUint(0x41555448, 32)
        .storeAddress(registryAddr)
        .storeUint(COMMUNITY_ID, 64)
        .storeAddress(owner)
        .storeRef(terms)
        .endCell();
      const signature = sign(approved.hash(), keyPair.secretKey);
      const tail = beginCell().storeAddress(null).storeUint(0, 16).storeUint(0, 8).storeBuffer(signature).endCell();
      const body = beginCell()
        .storeUint(0x52454743, 32)
        .storeUint(COMMUNITY_ID, 64)
        .storeAddress(owner)
        .storeAddress(owner)
        .storeCoins(PRICE)
        .storeUint(DURATION, 32)
        .storeRef(tail)
        .endCell();
      let seqno = await withRetry("seqno", () => walletContract.getSeqno());
      await withRetry("register", () =>
        sendWalletTransfer(walletContract, wallet, {
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            internal({
              to: registryAddr,
              value: toNano("0.08"),
              body,
              bounce: true,
            }),
          ],
        }),
      );
      await waitSeqno(walletContract, seqno);
      const bps = await withRetry("readBps", () =>
        readInt("communityReferralBps", [{ type: "int", value: COMMUNITY_ID }]),
      );
      bps === 0n
        ? pass(name, `community ${COMMUNITY_ID} registered, referralBps=${bps}`)
        : fail(name, `registered but bps=${bps}`);
    } catch (e) {
      fail(name, String((e as Error).message || e));
    }
  }

  // ── SetCommunityReferral ─────────────────────────────────
  {
    const name = "SetCommunityReferral (1000 bps)";
    try {
      const body = beginCell()
        .storeUint(0x53435246, 32)
        .storeUint(1, 64)
        .storeUint(COMMUNITY_ID, 64)
        .storeUint(1000, 16)
        .endCell();
      let seqno = await withRetry("seqno", () => walletContract.getSeqno());
      await withRetry("setRef", () =>
        sendWalletTransfer(walletContract, wallet, {
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            internal({
              to: registryAddr,
              value: toNano("0.05"),
              body,
              bounce: true,
            }),
          ],
        }),
      );
      await waitSeqno(walletContract, seqno);
      const bps = await withRetry("readBps", () =>
        readInt("communityReferralBps", [{ type: "int", value: COMMUNITY_ID }]),
      );
      bps === 1000n
        ? pass(name, `communityReferralBps=${bps}`)
        : fail(name, `expected 1000 got ${bps}`);
    } catch (e) {
      fail(name, String((e as Error).message || e));
    }
  }

  // ── DiscoverUsdtJettonWallet does not replace a bound wallet ─
  {
    const name = "DiscoverUsdtJettonWallet (already bound)";
    try {
      const current = await withRetry("usdtWallet", () => readAddressOpt("usdtJettonWallet"));
      if (!current) {
        fail(name, "wallet is null");
      } else {
        let seqno = await withRetry("seqno", () => walletContract.getSeqno());
        await withRetry("rebind", () =>
          sendWalletTransfer(walletContract, wallet, {
            secretKey: keyPair.secretKey,
            seqno,
            messages: [
              internal({
                to: registryAddr,
                value: toNano("0.1"),
                body: beginCell().storeUint(0x55534457, 32).storeUint(0, 64).endCell(),
                bounce: true,
              }),
            ],
          }),
        );
        await waitSeqno(walletContract, seqno);
        const after = await withRetry("usdtWallet2", () => readAddressOpt("usdtJettonWallet"));
        after && after.equals(current)
          ? pass(name, after.toString())
          : fail(name, "wallet changed unexpectedly");
      }
    } catch (e) {
      fail(name, String((e as Error).message || e));
    }
  }

  // ── JettonTransferNotification reject (wrong sender) ─────
  {
    const name = "JettonTransferNotification reject (not USDT wallet)";
    try {
      // Build a valid-looking subscribe payload, but send from owner (not jetton wallet).
      // Contract must reject; bounce returns TON → seqno still advances.
      const body = beginCell()
        .storeUint(0x7362d09c, 32)
        .storeUint(42, 64)
        .storeCoins(PRICE)
        .storeAddress(owner)
        .storeBit(false)
        .storeUint(0x53554253, 32)
        .storeUint(COMMUNITY_ID, 64)
        .storeBit(true)
        .storeAddress(communityReferrer)
        .endCell();

      const balBefore = await withRetry("bal", () => walletContract.getBalance());
      let seqno = await withRetry("seqno", () => walletContract.getSeqno());
      await withRetry("fakeNotify", () =>
        sendWalletTransfer(walletContract, wallet, {
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            internal({
              to: registryAddr,
              value: toNano("0.1"),
              body,
              bounce: true,
            }),
          ],
        }),
      );
      await waitSeqno(walletContract, seqno);
      await sleep(5000);
      const balAfter = await withRetry("bal2", () => walletContract.getBalance());
      // Bounce should return most of the 0.1 TON; balance drop should be << 0.1 (only fees)
      const spent = balBefore - balAfter;
      spent < toNano("0.08")
        ? pass(name, `rejected/bounced (spent ~${Number(spent) / 1e9} TON fees only)`)
        : fail(name, `possible accept? spent ${spent} nanotons`);
    } catch (e) {
      fail(name, String((e as Error).message || e));
    }
  }

  // ── Summary ──────────────────────────────────────────────
  console.log("\n========== SUMMARY ==========");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  }
  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
