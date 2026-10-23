import { isInsideChannel } from "./channelMember.ts";
import { loadConfig } from "./config.ts";
import { applyCommunityTerms, communityChatId, communityReferralConversion, createPool, platformReferrerPayout, readIndexerState, saveIndexerCursor, saveIndexerScan, storeInviteLink, storeMembershipInvite, telegramUserIdForTonWallet, UnknownCommunityError, upsertPaymentAndSubscription } from "./db.ts";
import { createShutdown, sleep } from "./lifecycle.ts";
import { sanitizeError } from "./log.ts";
import { notifyCommunityReferralPaid } from "./referralNotice.ts";
import { createTelegramClient } from "./telegram.ts";
import { fetchRegistryTransactionPage, parseCommunityUpdated, parseSubscriptionHint, subscriptionExpiryMs, walkRegistryTransactions } from "./tonApi.ts";
import { liveRegistryMatches, PASSGRAM_REGISTRY_CODE_HASH, REGISTRY_CODE_MISMATCH } from "./registryCode.ts";
import type { Pool } from "pg";

export async function runIndexerOnce(sharedPool?: Pool): Promise<number> {
  const config = loadConfig();
  const pool = sharedPool ?? createPool(config.databaseUrl);
  const telegram = createTelegramClient(config.telegramBotToken);
  try {
    if (config.registryCodeHash !== PASSGRAM_REGISTRY_CODE_HASH) {
      throw new Error("PASSGRAM_REGISTRY_CODE_HASH must match this source. Use the hash printed by the deploy script.");
    }
    const current = await liveRegistryMatches({
      apiUrl: config.tonApiUrl,
      apiKey: config.tonApiKey,
      address: config.registryAddress,
      expectedHash: PASSGRAM_REGISTRY_CODE_HASH,
    });
    if (!current) throw new Error(REGISTRY_CODE_MISMATCH);
    const state = await readIndexerState(pool);
    const walked = await walkRegistryTransactions({
      cursorLt: state.lastProcessedLt,
      resume: state.scanLt && state.scanHash ? { lt: state.scanLt, hash: state.scanHash } : null,
      loadPage: (query) =>
        fetchRegistryTransactionPage({
          apiUrl: config.tonApiUrl,
          apiKey: config.tonApiKey,
          address: config.registryAddress,
          ...query,
        }),
    });
    if (!walked.done) {
      if (walked.resume) await saveIndexerScan(pool, state.lastProcessedLt, walked.resume);
      return 0;
    }
    const seen = new Set<string>();
    let handled = 0;
    for (const tx of walked.events) {
      const eventKey = `${tx.txHash}:${tx.bodyBase64 ?? ""}`;
      if (seen.has(eventKey)) continue;
      const updated = parseCommunityUpdated(tx.bodyBase64);
      if (updated) {
        const applied = await applyCommunityTerms(pool, updated);
        if (!applied) console.warn("community update matched no listing", updated.communityId);
        seen.add(eventKey);
        handled += 1;
        continue;
      }
      const hint = parseSubscriptionHint(tx.bodyBase64);
      if (!hint) {
        seen.add(eventKey);
        continue;
      }
      const paidAtMs = hint.paidAt
        ? hint.paidAt * 1000
        : (tx.utime || Math.floor(Date.now() / 1000)) * 1000;
      const expiresAtMs = subscriptionExpiryMs(hint.expiresAt);
      if (expiresAtMs == null) {
        console.warn("subscription event has no expiry", tx.txHash);
        seen.add(eventKey);
        continue;
      }
      const telegramUserId = await telegramUserIdForTonWallet(pool, hint.subscriber || "");
      const referrer = hint.hasPlatformReferrer && telegramUserId
        ? await platformReferrerPayout(pool, telegramUserId)
        : null;
      const event = {
        txHash: tx.txHash.replace(/:out$/, ""),
        subscriber: hint.subscriber || "unknown",
        creator: hint.creator || "unknown",
        communityId: hint.communityId,
        amount: hint.amount,
        paidAtMs,
        expiresAtMs,
        referrer,
        hasPlatformReferrer: hint.hasPlatformReferrer,
      };
      let paymentId: number;
      let inviteNeeded: boolean;
      try {
        const saved = await upsertPaymentAndSubscription(pool, { ...event, telegramUserId });
        paymentId = saved.paymentId;
        inviteNeeded = saved.inviteNeeded;
      } catch (error) {
        if (!(error instanceof UnknownCommunityError)) throw error;
        console.warn("skipped payment for an unlisted community", {
          communityId: hint.communityId,
          txHash: event.txHash,
          amount: hint.amount,
        });
        seen.add(eventKey);
        continue;
      }
      seen.add(eventKey);
      handled += 1;
      if (inviteNeeded && telegramUserId) {
        try {
          const conversion = await communityReferralConversion(pool, hint.communityId, telegramUserId);
          await notifyCommunityReferralPaid({
            lookup: conversion,
            subscriberTelegramUserId: telegramUserId,
            communityId: hint.communityId,
            send: (userId, text, button) => telegram.sendDirectMessage(userId, text, button),
          });
        } catch (error) {
          console.error("referral conversion notice failed", sanitizeError(error));
        }
      }
      if (inviteNeeded) {
        const chatId = await communityChatId(pool, hint.communityId);
        if (chatId) {
          let inside = false;
          if (telegramUserId) {
            const member = await telegram.chatMember(chatId, telegramUserId);
            inside = isInsideChannel(member?.status, member?.is_member);
          }
          if (!inside) {
            const link = await telegram.createChatInviteLink(chatId, Math.floor(event.expiresAtMs / 1000));
            if (link) {
              await storeInviteLink(pool, paymentId, link);
              await storeMembershipInvite(pool, event.txHash, link);
            }
          }
        }
      }
    }
    if (BigInt(walked.maxLt) > BigInt(state.lastProcessedLt)) {
      await saveIndexerCursor(pool, walked.maxLt);
    }
    return handled;
  } finally {
    if (!sharedPool) await pool.end();
  }
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const shutdown = createShutdown();
  console.log("PassGram indexer watching", config.registryAddress);
  try {
    while (!shutdown.signal.aborted) {
      try {
        const n = await runIndexerOnce(pool);
        if (n > 0) console.log("indexed", n, "payments");
      } catch (error) {
        console.error("indexer tick failed", sanitizeError(error));
      }
      await sleep(config.pollIntervalMs, shutdown.signal);
    }
  } finally {
    await pool.end();
  }
}

const isDirect = process.argv[1]?.includes("indexer");
if (isDirect) {
  void main();
}
