import { isInsideChannel } from "./channelMember.ts";
import { loadConfig } from "./config.ts";
import { communityChatId, communityReferralConversion, createPool, storeInviteLink, storeMembershipInvite, telegramUserIdForTonWallet, upsertPaymentAndSubscription } from "./db.ts";
import { notifyCommunityReferralPaid } from "./referralNotice.ts";
import { createTelegramClient } from "./telegram.ts";
import { fetchRegistryTransactions, parseSubscriptionHint } from "./tonApi.ts";

const seen = new Set<string>();

export async function runIndexerOnce(): Promise<number> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const telegram = createTelegramClient(config.telegramBotToken);
  try {
    const txs = await fetchRegistryTransactions({
      apiUrl: config.tonApiUrl,
      apiKey: config.tonApiKey,
      address: config.registryAddress,
    });
    let handled = 0;
    for (const tx of txs) {
      if (seen.has(tx.txHash)) continue;
      const hint = parseSubscriptionHint(tx.bodyBase64);
      if (!hint) {
        seen.add(tx.txHash);
        continue;
      }
      const paidAtMs = hint.paidAt
        ? hint.paidAt * 1000
        : (tx.utime || Math.floor(Date.now() / 1000)) * 1000;
      const expiresAtMs = hint.expiresAt
        ? hint.expiresAt * 1000
        : paidAtMs + 30 * 24 * 60 * 60 * 1000;
      const event = {
        txHash: tx.txHash.replace(/:out$/, ""),
        subscriber: hint.subscriber || "unknown",
        creator: hint.creator || "unknown",
        communityId: hint.communityId,
        amount: hint.amount,
        paidAtMs,
        expiresAtMs,
        referrer: hint.hasReferrer ? "referrer" : null,
      };
      const telegramUserId = await telegramUserIdForTonWallet(pool, event.subscriber);
      const { paymentId, inviteNeeded } = await upsertPaymentAndSubscription(pool, { ...event, telegramUserId });
      seen.add(tx.txHash);
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
          console.error("referral conversion notice failed", error);
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
    return handled;
  } finally {
    await pool.end();
  }
}

async function main() {
  const config = loadConfig();
  console.log("PassGram indexer watching", config.registryAddress);
  for (;;) {
    try {
      const n = await runIndexerOnce();
      if (n > 0) console.log("indexed", n, "payments");
    } catch (error) {
      console.error("indexer tick failed", error);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

const isDirect = process.argv[1]?.includes("indexer");
if (isDirect) {
  void main();
}
