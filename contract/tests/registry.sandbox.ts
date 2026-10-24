import assert from "node:assert/strict";
import test from "node:test";
import { Address, beginCell, Cell, toNano, type Transaction } from "@ton/core";
import { keyPairFromSeed, sign } from "@ton/crypto";
import { Blockchain, type SandboxContract, type TreasuryContract } from "@ton/sandbox";
import { tolkRegistryInit } from "../tolkInit.ts";

const PRICE = 1_000_000n;
const DURATION = 30 * 86_400;
const COMMUNITY = 7n;
const SUBSCRIPTION_PAID = 1258072203;
const PAYMENT_REFUNDED = 0x52464e44;
const EXCESS_RETURNED = 0x45584353;
const JETTON_TRANSFER = 0x0f8a7ea5;

type World = {
  blockchain: Blockchain;
  registry: { address: Address };
  owner: SandboxContract<TreasuryContract>;
  treasury: SandboxContract<TreasuryContract>;
  usdtMaster: SandboxContract<TreasuryContract>;
  jettonWallet: SandboxContract<TreasuryContract>;
  creator: SandboxContract<TreasuryContract>;
  subscriber: SandboxContract<TreasuryContract>;
  marketer: SandboxContract<TreasuryContract>;
  other: SandboxContract<TreasuryContract>;
  replacement: SandboxContract<TreasuryContract>;
  keys: { publicKey: Buffer; secretKey: Buffer };
};

function ownerRotationAuthorization(input: {
  registry: Address;
  newKey: bigint;
  validUntil: number;
  secretKey: Buffer;
}): Buffer {
  const cell = beginCell()
    .storeUint(0x524f574b, 32)
    .storeAddress(input.registry)
    .storeUint(input.newKey, 256)
    .storeUint(input.validUntil, 32)
    .endCell();
  return sign(cell.hash(), input.secretKey);
}

function authorization(input: {
  registry: Address;
  communityId: bigint;
  creator: Address;
  secretKey: Buffer;
  contract?: Address;
  payout?: Address;
  price?: bigint;
  durationSeconds?: number;
  platform?: Address | null;
  communityReferralBps?: number;
  accessMode?: number;
}): Buffer {
  const payout = input.payout ?? input.creator;
  const price = input.price ?? PRICE;
  const durationSeconds = input.durationSeconds ?? DURATION;
  const tail = beginCell().storeAddress(payout).storeCoins(price).storeUint(durationSeconds, 32);
  if (input.platform) tail.storeBit(true).storeAddress(input.platform);
  else tail.storeBit(false);
  tail.storeUint(input.communityReferralBps ?? 0, 16).storeUint(input.accessMode ?? 0, 8);
  const cell = beginCell()
    .storeUint(0x41555448, 32)
    .storeAddress(input.contract ?? input.registry)
    .storeUint(input.communityId, 64)
    .storeAddress(input.creator)
    .storeRef(tail.endCell())
    .endCell();
  return sign(cell.hash(), input.secretKey);
}

const REFERRAL_VALID_UNTIL = 2_000_000_000;

function referralAuthorization(input: {
  registry: Address;
  communityId: bigint;
  subscriber: Address;
  payout?: Address | null;
  validUntil: number;
  secretKey: Buffer;
}): Buffer {
  const builder = beginCell()
    .storeUint(0x43524546, 32)
    .storeAddress(input.registry)
    .storeUint(input.communityId, 64)
    .storeAddress(input.subscriber);
  if (input.payout) builder.storeBit(true).storeAddress(input.payout);
  else builder.storeBit(false);
  builder.storeUint(input.validUntil, 32);
  return sign(builder.endCell().hash(), input.secretKey);
}

function subscribePayload(input: {
  registry: Address;
  communityId: bigint;
  subscriber: Address;
  payout?: Address;
  validUntil?: number;
  secretKey: Buffer;
  authorization?: Buffer;
}) {
  const validUntil = input.validUntil ?? REFERRAL_VALID_UNTIL;
  const signature =
    input.authorization ??
    referralAuthorization({
      registry: input.registry,
      communityId: input.communityId,
      subscriber: input.subscriber,
      payout: input.payout ?? null,
      validUntil,
      secretKey: input.secretKey,
    });
  const builder = beginCell().storeUint(0x53554253, 32).storeUint(input.communityId, 64);
  if (input.payout) builder.storeBit(true).storeAddress(input.payout);
  else builder.storeBit(false);
  builder.storeUint(validUntil, 32).storeBuffer(signature);
  return beginCell().storeBit(true).storeRef(builder.endCell()).endCell().asSlice();
}

function registryTransaction(transactions: Transaction[], registry: Address): Transaction {
  const found = transactions.find((item) => {
    const info = item.inMessage?.info;
    return info?.type === "internal" && info.dest instanceof Address && info.dest.equals(registry);
  });
  assert.ok(found, "registry transaction missing");
  return found;
}

function exitCode(tx: Transaction): number {
  if (tx.description.type !== "generic" || tx.description.computePhase.type !== "vm") return -1;
  return tx.description.computePhase.exitCode;
}

function externalOps(tx: Transaction): number[] {
  const ops: number[] = [];
  for (const message of tx.outMessages.values()) {
    if (message.info.type !== "external-out") continue;
    const body = message.body.beginParse();
    if (body.remainingBits < 32) continue;
    ops.push(body.loadUint(32));
  }
  return ops;
}

function attachedTon(tx: Transaction): bigint[] {
  const values: bigint[] = [];
  for (const message of tx.outMessages.values()) {
    if (message.info.type !== "internal") continue;
    const body = message.body.beginParse();
    if (body.remainingBits < 32 || body.loadUint(32) !== JETTON_TRANSFER) continue;
    values.push(message.info.value.coins);
  }
  return values;
}

function jettonPayouts(tx: Transaction): { destination: Address; amount: bigint; queryId: bigint }[] {
  const payouts: { destination: Address; amount: bigint; queryId: bigint }[] = [];
  for (const message of tx.outMessages.values()) {
    if (message.info.type !== "internal") continue;
    const body = message.body.beginParse();
    if (body.remainingBits < 32 || body.loadUint(32) !== JETTON_TRANSFER) continue;
    const queryId = body.loadUintBig(64);
    const amount = body.loadCoins();
    const destination = body.loadAddress();
    if (destination) payouts.push({ destination, amount, queryId });
  }
  return payouts;
}

/** The body mainnet jUSDT actually sends: wallet inline, then the owner address in a reference. */
function masterWalletReply(wallet: Address, owner: Address | null) {
  const body = beginCell().storeUint(0xd1735400, 32).storeUint(0, 64).storeAddress(wallet);
  if (!owner) return body.storeBit(false).endCell();
  return body.storeBit(true).storeRef(beginCell().storeAddress(owner).endCell()).endCell();
}

function discoverBody(queryId = 0n): Cell {
  return beginCell().storeUint(0x55534457, 32).storeUint(queryId, 64).endCell();
}

function registerMessage(input: {
  communityId: bigint;
  creator: Address;
  payout: Address;
  price?: bigint;
  durationSeconds?: number;
  platform?: Address | null;
  communityReferralBps?: number;
  accessMode?: number;
  authorization: Buffer;
}): Cell {
  const tail = beginCell();
  if (input.platform) tail.storeAddress(input.platform);
  else tail.storeAddress(null);
  tail
    .storeUint(input.communityReferralBps ?? 0, 16)
    .storeUint(input.accessMode ?? 0, 8)
    .storeBuffer(input.authorization);
  return beginCell()
    .storeUint(0x52454743, 32)
    .storeUint(input.communityId, 64)
    .storeAddress(input.creator)
    .storeAddress(input.payout)
    .storeCoins(input.price ?? PRICE)
    .storeUint(input.durationSeconds ?? DURATION, 32)
    .storeRef(tail.endCell())
    .endCell();
}

function rotateBody(newKey: bigint, validUntil: number, authorization: Buffer): Cell {
  return beginCell()
    .storeUint(0x524f574b, 32)
    .storeUint(newKey, 256)
    .storeUint(validUntil, 32)
    .storeBuffer(authorization)
    .endCell();
}

async function readUsdtWallet(world: World): Promise<Address | null> {
  const result = await world.blockchain.provider(world.registry.address).get("usdtJettonWallet", []);
  return result.stack.readAddressOpt();
}

async function readOwnerKey(world: World): Promise<bigint> {
  const result = await world.blockchain.provider(world.registry.address).get("ownerPublicKey", []);
  return result.stack.readBigNumber();
}

async function acceptUsdtWallet(world: World, wallet: Address) {
  const discovered = await world.owner.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: discoverBody(),
  });
  assert.equal(exitCode(registryTransaction(discovered.transactions, world.registry.address)), 0);
  const accepted = await world.usdtMaster.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: masterWalletReply(wallet, world.registry.address),
  });
  const acceptedTx = registryTransaction(accepted.transactions, world.registry.address);
  assert.equal(exitCode(acceptedTx), 0);
  assert.ok(externalOps(acceptedTx).includes(0x57534554));
}

async function boot(input: { bindUsdt?: boolean } = {}): Promise<World> {
  const blockchain = await Blockchain.create();
  const owner = await blockchain.treasury("owner");
  const treasury = await blockchain.treasury("treasury");
  const usdtMaster = await blockchain.treasury("usdt-master");
  const jettonWallet = await blockchain.treasury("usdt-wallet");
  const creator = await blockchain.treasury("creator");
  const subscriber = await blockchain.treasury("subscriber");
  const marketer = await blockchain.treasury("marketer");
  const other = await blockchain.treasury("other");
  const replacement = await blockchain.treasury("replacement");
  const keys = keyPairFromSeed(Buffer.alloc(32, 9));
  const init = tolkRegistryInit({
    owner: owner.address,
    treasury: treasury.address,
    usdtMaster: usdtMaster.address,
    ownerPublicKey: BigInt(`0x${keys.publicKey.toString("hex")}`),
  });
  const registry = { address: init.address };
  const deployed = await owner.send({
    to: registry.address,
    value: toNano("0.5"),
    init,
    body: beginCell().endCell(),
  });
  assert.equal(exitCode(registryTransaction(deployed.transactions, registry.address)), 0);
  const world = {
    blockchain,
    registry,
    owner,
    treasury,
    usdtMaster,
    jettonWallet,
    creator,
    subscriber,
    marketer,
    other,
    replacement,
    keys,
  };
  if (input.bindUsdt !== false) {
    await acceptUsdtWallet(world, jettonWallet.address);
  }
  const funded = await owner.send({ to: registry.address, value: toNano("5"), body: beginCell().endCell() });
  assert.equal(exitCode(registryTransaction(funded.transactions, registry.address)), 0);
  return world;
}

async function register(world: World, input: { communityId?: bigint; accessMode?: bigint; creator?: SandboxContract<TreasuryContract>; platform?: Address | null; contract?: Address } = {}) {
  const creator = input.creator ?? world.creator;
  const communityId = input.communityId ?? COMMUNITY;
  return creator.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: registerMessage({
      communityId,
      creator: creator.address,
      payout: creator.address,
      platform: input.platform === undefined ? null : input.platform,
      accessMode: Number(input.accessMode ?? 0n),
      authorization: authorization({
        registry: world.registry.address,
        communityId,
        creator: creator.address,
        secretKey: world.keys.secretKey,
        contract: input.contract,
        payout: creator.address,
        price: PRICE,
        durationSeconds: DURATION,
        platform: input.platform === undefined ? null : input.platform,
        accessMode: Number(input.accessMode ?? 0n),
      }),
    }),
  });
}

async function pay(
  world: World,
  input: {
    amount: bigint;
    subscriber?: SandboxContract<TreasuryContract>;
    payout?: Address;
    communityId?: bigint;
    validUntil?: number;
    authorization?: Buffer;
  },
) {
  const subscriber = input.subscriber ?? world.subscriber;
  return world.jettonWallet.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: beginCell()
      .storeUint(0x7362d09c, 32)
      .storeUint(1, 64)
      .storeCoins(input.amount)
      .storeAddress(subscriber.address)
      .storeSlice(
        subscribePayload({
          registry: world.registry.address,
          communityId: input.communityId ?? COMMUNITY,
          subscriber: subscriber.address,
          payout: input.payout,
          validUntil: input.validUntil,
          secretKey: world.keys.secretKey,
          authorization: input.authorization,
        }),
      )
      .endCell(),
  });
}

test("registration requires this contract in the owner signature and accepts the USDT wallet once", async () => {
  const world = await boot();
  const again = await world.owner.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: discoverBody(1n),
  });
  assert.equal(exitCode(registryTransaction(again.transactions, world.registry.address)), 101);

  const otherContract = world.other.address;
  const foreign = await register(world, { contract: otherContract });
  assert.equal(exitCode(registryTransaction(foreign.transactions, world.registry.address)), 105);

  const gated = await register(world, { accessMode: 1n });
  assert.equal(exitCode(registryTransaction(gated.transactions, world.registry.address)), 111);

  const wrongPrice = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: registerMessage({
      communityId: COMMUNITY,
      creator: world.creator.address,
      payout: world.creator.address,
      authorization: authorization({
        registry: world.registry.address,
        communityId: COMMUNITY,
        creator: world.creator.address,
        secretKey: world.keys.secretKey,
        price: PRICE + 1n,
      }),
    }),
  });
  assert.equal(exitCode(registryTransaction(wrongPrice.transactions, world.registry.address)), 105);

  const wrongMarketer = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: registerMessage({
      communityId: COMMUNITY,
      creator: world.creator.address,
      payout: world.creator.address,
      platform: world.marketer.address,
      authorization: authorization({
        registry: world.registry.address,
        communityId: COMMUNITY,
        creator: world.creator.address,
        secretKey: world.keys.secretKey,
        platform: null,
      }),
    }),
  });
  assert.equal(exitCode(registryTransaction(wrongMarketer.transactions, world.registry.address)), 105);

  const created = await register(world);
  const createdTx = registryTransaction(created.transactions, world.registry.address);
  assert.equal(exitCode(createdTx), 0);
  assert.equal(externalOps(createdTx).includes(0x43524547), true);
  const duplicate = await register(world);
  assert.equal(exitCode(registryTransaction(duplicate.transactions, world.registry.address)), 110);
});

test("only the USDT master can bind this contract's jetton wallet", async () => {
  const world = await boot({ bindUsdt: false });
  assert.equal(await readUsdtWallet(world), null);

  const forged = await world.other.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: masterWalletReply(world.other.address, world.registry.address),
  });
  assert.notEqual(exitCode(registryTransaction(forged.transactions, world.registry.address)), 0);
  assert.equal(await readUsdtWallet(world), null);

  const otherOwner = await world.usdtMaster.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: masterWalletReply(world.other.address, world.other.address),
  });
  assert.notEqual(exitCode(registryTransaction(otherOwner.transactions, world.registry.address)), 0);
  assert.equal(await readUsdtWallet(world), null);

  await acceptUsdtWallet(world, world.jettonWallet.address);
  const bound = await readUsdtWallet(world);
  assert.ok(bound?.equals(world.jettonWallet.address));
});

test("the owner wallet can replace the server key, and the old key stops working", async () => {
  const world = await boot();
  const now = Math.floor(Date.now() / 1000) + 60;
  world.blockchain.now = now;
  const next = keyPairFromSeed(Buffer.alloc(32, 4));
  const nextKey = BigInt(`0x${next.publicKey.toString("hex")}`);
  const validUntil = now + 600;
  const signature = ownerRotationAuthorization({
    registry: world.registry.address,
    newKey: nextKey,
    validUntil,
    secretKey: world.keys.secretKey,
  });

  const stranger = await world.other.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: rotateBody(nextKey, validUntil, signature),
  });
  assert.notEqual(exitCode(registryTransaction(stranger.transactions, world.registry.address)), 0);

  const unsigned = await world.owner.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: rotateBody(nextKey, validUntil, Buffer.alloc(64, 7)),
  });
  assert.notEqual(exitCode(registryTransaction(unsigned.transactions, world.registry.address)), 0);
  assert.equal(await readOwnerKey(world), BigInt(`0x${world.keys.publicKey.toString("hex")}`));

  const rotated = await world.owner.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: rotateBody(nextKey, validUntil, signature),
  });
  const rotatedTx = registryTransaction(rotated.transactions, world.registry.address);
  assert.equal(exitCode(rotatedTx), 0);
  assert.ok(externalOps(rotatedTx).includes(0x4f4b5254));
  assert.equal(await readOwnerKey(world), nextKey);

  const stale = await register(world);
  assert.notEqual(exitCode(registryTransaction(stale.transactions, world.registry.address)), 0);

  const creator = world.creator;
  const fresh = await creator.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: registerMessage({
      communityId: COMMUNITY,
      creator: creator.address,
      payout: creator.address,
      authorization: authorization({
        registry: world.registry.address,
        communityId: COMMUNITY,
        creator: creator.address,
        secretKey: next.secretKey,
        payout: creator.address,
        price: PRICE,
        durationSeconds: DURATION,
        platform: null,
      }),
    }),
  });
  assert.equal(exitCode(registryTransaction(fresh.transactions, world.registry.address)), 0);
});

test("underpayment is returned and an exact payment splits only the price", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);

  const under = await pay(world, { amount: PRICE - 1n });
  const underTx = registryTransaction(under.transactions, world.registry.address);
  assert.equal(exitCode(underTx), 0);
  assert.equal(externalOps(underTx).includes(PAYMENT_REFUNDED), true);
  assert.equal(externalOps(underTx).includes(SUBSCRIPTION_PAID), false);
  const refund = jettonPayouts(underTx);
  assert.equal(refund.length, 1);
  assert.equal(refund[0].amount, PRICE - 1n);
  assert.equal(refund[0].destination.equals(world.subscriber.address), true);

  const exact = await pay(world, { amount: PRICE });
  const exactTx = registryTransaction(exact.transactions, world.registry.address);
  assert.equal(exitCode(exactTx), 0);
  assert.equal(externalOps(exactTx).includes(SUBSCRIPTION_PAID), true);
  const paid = jettonPayouts(exactTx);
  const creator = paid.find((item) => item.destination.equals(world.creator.address));
  const treasury = paid.find((item) => item.destination.equals(world.treasury.address));
  assert.equal(creator?.amount, 975_000n);
  assert.equal(treasury?.amount, 25_000n);
  assert.equal(paid.reduce((sum, item) => sum + item.amount, 0n), PRICE);
  for (const value of attachedTon(exactTx)) assert.ok(value > toNano("0.14"));
});

test("an amount above the price returns the extra and splits the price", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const result = await pay(world, { amount: PRICE + 400_000n });
  const tx = registryTransaction(result.transactions, world.registry.address);
  assert.equal(exitCode(tx), 0);
  assert.equal(externalOps(tx).includes(SUBSCRIPTION_PAID), true);
  assert.equal(externalOps(tx).includes(EXCESS_RETURNED), true);
  assert.equal(externalOps(tx).includes(PAYMENT_REFUNDED), false);
  const payouts = jettonPayouts(tx);
  const back = payouts.find((item) => item.destination.equals(world.subscriber.address));
  assert.equal(back?.amount, 400_000n);
  const settled = payouts.filter((item) => !item.destination.equals(world.subscriber.address));
  assert.equal(settled.reduce((sum, item) => sum + item.amount, 0n), PRICE);
});

test("the payer cannot collect the community commission, and a renewal keeps the lock", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const opened = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: beginCell().storeUint(0x53435246, 32).storeUint(0, 64).storeUint(COMMUNITY, 64).storeUint(1000, 16).endCell(),
  });
  assert.equal(exitCode(registryTransaction(opened.transactions, world.registry.address)), 0);

  const selfPaid = await pay(world, { amount: PRICE, payout: world.subscriber.address });
  const selfTx = registryTransaction(selfPaid.transactions, world.registry.address);
  const selfPayouts = jettonPayouts(selfTx);
  assert.equal(selfPayouts.some((item) => item.destination.equals(world.subscriber.address)), false);
  assert.equal(selfPayouts.find((item) => item.destination.equals(world.creator.address))?.amount, 975_000n);

  const renewal = await pay(world, { amount: PRICE, payout: world.marketer.address });
  const renewalPayouts = jettonPayouts(registryTransaction(renewal.transactions, world.registry.address));
  assert.equal(renewalPayouts.some((item) => item.destination.equals(world.marketer.address)), false);
  assert.equal(renewalPayouts.find((item) => item.destination.equals(world.creator.address))?.amount, 975_000n);

  const first = await pay(world, { amount: PRICE, subscriber: world.other, payout: world.marketer.address });
  const firstPayouts = jettonPayouts(registryTransaction(first.transactions, world.registry.address));
  assert.equal(firstPayouts.find((item) => item.destination.equals(world.marketer.address))?.amount, 97_500n);
  assert.equal(firstPayouts.find((item) => item.destination.equals(world.creator.address))?.amount, 877_500n);

  const switched = await pay(world, { amount: PRICE, subscriber: world.other, payout: world.subscriber.address });
  const switchedPayouts = jettonPayouts(registryTransaction(switched.transactions, world.registry.address));
  assert.equal(switchedPayouts.find((item) => item.destination.equals(world.marketer.address))?.amount, 97_500n);
  assert.equal(switchedPayouts.some((item) => item.destination.equals(world.subscriber.address) && item.amount === 97_500n), false);
});

test("RegisterCommunity rejects a receiving wallet that is not the creator", async () => {
  const world = await boot();
  const rejected = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.08"),
    body: registerMessage({
      communityId: COMMUNITY,
      creator: world.creator.address,
      payout: world.replacement.address,
      authorization: authorization({
        registry: world.registry.address,
        communityId: COMMUNITY,
        creator: world.creator.address,
        secretKey: world.keys.secretKey,
        payout: world.replacement.address,
      }),
    }),
  });
  assert.notEqual(exitCode(registryTransaction(rejected.transactions, world.registry.address)), 0);
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
});

test("UpdateCommunity changes the price and keeps paying the registering wallet", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const first = await pay(world, { amount: PRICE });
  const firstTx = registryTransaction(first.transactions, world.registry.address);
  assert.equal(jettonPayouts(firstTx).find((item) => item.destination.equals(world.creator.address))?.amount, 975_000n);

  const updateBody = beginCell()
    .storeUint(0x55504443, 32)
    .storeUint(0, 64)
    .storeUint(COMMUNITY, 64)
    .storeCoins(2_000_000n)
    .storeUint(DURATION, 32)
    .endCell();
  const stranger = await world.subscriber.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: updateBody,
  });
  assert.equal(exitCode(registryTransaction(stranger.transactions, world.registry.address)), 118);

  const updated = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: updateBody,
  });
  const updatedTx = registryTransaction(updated.transactions, world.registry.address);
  assert.equal(exitCode(updatedTx), 0);
  assert.equal(externalOps(updatedTx).includes(0x43555044), true);
  const renewal = await pay(world, { amount: 2_000_000n });
  const renewalPayouts = jettonPayouts(registryTransaction(renewal.transactions, world.registry.address));
  assert.equal(renewalPayouts.find((item) => item.destination.equals(world.creator.address))?.amount, 1_950_000n);
  assert.equal(renewalPayouts.some((item) => item.destination.equals(world.replacement.address)), false);
});

test("a paused community returns the payment", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const paused = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: beginCell().storeUint(0x53435053, 32).storeUint(0, 64).storeUint(COMMUNITY, 64).storeBit(true).endCell(),
  });
  assert.equal(exitCode(registryTransaction(paused.transactions, world.registry.address)), 0);
  const result = await pay(world, { amount: PRICE });
  const tx = registryTransaction(result.transactions, world.registry.address);
  assert.equal(externalOps(tx).includes(PAYMENT_REFUNDED), true);
  assert.equal(externalOps(tx).includes(SUBSCRIPTION_PAID), false);
  assert.equal(jettonPayouts(tx)[0]?.amount, PRICE);
});

test("a first payment without the owner referral signature is returned and does not lock", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const opened = await world.creator.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: beginCell().storeUint(0x53435246, 32).storeUint(0, 64).storeUint(COMMUNITY, 64).storeUint(1000, 16).endCell(),
  });
  assert.equal(exitCode(registryTransaction(opened.transactions, world.registry.address)), 0);

  const forged = await pay(world, {
    amount: PRICE,
    payout: world.marketer.address,
    authorization: Buffer.alloc(64, 1),
  });
  const forgedTx = registryTransaction(forged.transactions, world.registry.address);
  assert.equal(exitCode(forgedTx), 0);
  assert.equal(externalOps(forgedTx).includes(PAYMENT_REFUNDED), true);
  assert.equal(externalOps(forgedTx).includes(SUBSCRIPTION_PAID), false);
  assert.equal(jettonPayouts(forgedTx)[0]?.amount, PRICE);

  const expired = await pay(world, { amount: PRICE, payout: world.marketer.address, validUntil: 1 });
  const expiredTx = registryTransaction(expired.transactions, world.registry.address);
  assert.equal(externalOps(expiredTx).includes(PAYMENT_REFUNDED), true);
  assert.equal(externalOps(expiredTx).includes(SUBSCRIPTION_PAID), false);

  const swapped = await pay(world, {
    amount: PRICE,
    payout: world.other.address,
    authorization: referralAuthorization({
      registry: world.registry.address,
      communityId: COMMUNITY,
      subscriber: world.subscriber.address,
      payout: world.marketer.address,
      validUntil: REFERRAL_VALID_UNTIL,
      secretKey: world.keys.secretKey,
    }),
  });
  const swappedTx = registryTransaction(swapped.transactions, world.registry.address);
  assert.equal(externalOps(swappedTx).includes(PAYMENT_REFUNDED), true);
  assert.equal(externalOps(swappedTx).includes(SUBSCRIPTION_PAID), false);

  const honest = await pay(world, { amount: PRICE, payout: world.marketer.address });
  const honestPayouts = jettonPayouts(registryTransaction(honest.transactions, world.registry.address));
  assert.equal(honestPayouts.find((item) => item.destination.equals(world.marketer.address))?.amount, 97_500n);
  assert.equal(honestPayouts.find((item) => item.destination.equals(world.creator.address))?.amount, 877_500n);
});

test("a forged JettonExcesses cannot delete a bounced payout", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const paid = await pay(world, { amount: PRICE });
  const creator = jettonPayouts(registryTransaction(paid.transactions, world.registry.address)).find((item) =>
    item.destination.equals(world.creator.address),
  );
  assert.ok(creator);

  const bounced = await world.blockchain.sendMessage({
    info: {
      type: "internal",
      ihrDisabled: true,
      bounce: false,
      bounced: true,
      src: world.jettonWallet.address,
      dest: world.registry.address,
      value: { coins: toNano("0.02") },
      ihrFee: 0n,
      forwardFee: 0n,
      createdLt: 0n,
      createdAt: 0,
    },
    body: beginCell()
      .storeUint(0xffffffff, 32)
      .storeUint(JETTON_TRANSFER, 32)
      .storeUint(creator.queryId, 64)
      .storeCoins(creator.amount)
      .endCell(),
  });
  assert.equal(exitCode(registryTransaction(bounced.transactions, world.registry.address)), 0);

  const forged = await world.subscriber.send({
    to: world.registry.address,
    value: toNano("0.02"),
    body: beginCell().storeUint(0xd53276db, 32).storeUint(creator.queryId, 64).endCell(),
  });
  assert.notEqual(exitCode(registryTransaction(forged.transactions, world.registry.address)), 0);

  const retried = await world.owner.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: beginCell().storeUint(0x52545259, 32).storeUint(0, 64).endCell(),
  });
  const again = jettonPayouts(registryTransaction(retried.transactions, world.registry.address));
  assert.equal(again.find((item) => item.destination.equals(world.creator.address))?.amount, creator.amount);
});

test("a bounced payout is sent again without charging the subscriber", async () => {
  const world = await boot();
  assert.equal(exitCode(registryTransaction((await register(world)).transactions, world.registry.address)), 0);
  const paid = await pay(world, { amount: PRICE });
  const paidTx = registryTransaction(paid.transactions, world.registry.address);
  const creator = jettonPayouts(paidTx).find((item) => item.destination.equals(world.creator.address));
  const treasury = jettonPayouts(paidTx).find((item) => item.destination.equals(world.treasury.address));
  assert.ok(creator);
  assert.ok(treasury);

  const accepted = await world.jettonWallet.send({
    to: world.registry.address,
    value: toNano("0.02"),
    body: beginCell().storeUint(0xd53276db, 32).storeUint(treasury.queryId, 64).endCell(),
  });
  assert.equal(exitCode(registryTransaction(accepted.transactions, world.registry.address)), 0);

  const bounced = await world.blockchain.sendMessage({
    info: {
      type: "internal",
      ihrDisabled: true,
      bounce: false,
      bounced: true,
      src: world.jettonWallet.address,
      dest: world.registry.address,
      value: { coins: toNano("0.02") },
      ihrFee: 0n,
      forwardFee: 0n,
      createdLt: 0n,
      createdAt: 0,
    },
    body: beginCell()
      .storeUint(0xffffffff, 32)
      .storeUint(JETTON_TRANSFER, 32)
      .storeUint(creator.queryId, 64)
      .storeCoins(creator.amount)
      .endCell(),
  });
  assert.equal(exitCode(registryTransaction(bounced.transactions, world.registry.address)), 0);

  const retried = await world.owner.send({
    to: world.registry.address,
    value: toNano("0.05"),
    body: beginCell().storeUint(0x52545259, 32).storeUint(0, 64).endCell(),
  });
  const retryTx = registryTransaction(retried.transactions, world.registry.address);
  assert.equal(exitCode(retryTx), 0);
  const again = jettonPayouts(retryTx);
  assert.equal(again.find((item) => item.destination.equals(world.creator.address))?.amount, creator.amount);
  assert.equal(again.some((item) => item.destination.equals(world.treasury.address)), false);
  assert.equal(externalOps(retryTx).includes(SUBSCRIPTION_PAID), false);
});
