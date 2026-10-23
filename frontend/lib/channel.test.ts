import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  botAdministratorRights,
  channelRequestButton,
  communityFormReady,
  entitlementExpiresAt,
  nextActivation,
  parseCommunityPrice,
  parseDurationDays,
  preparedButtonPayload,
  readChatShared,
  selectorAvailability,
  subscriptionFulfillmentAllowed,
  type ChannelSnapshot,
} from "./channelPolicy.ts";
import {
  createVerifiedCommunity,
  ingestTelegramUpdate,
  prepareChannelSelection,
  recheckChannelAccess,
  type ChannelDeps,
} from "./server/channelFlow.ts";
import { MemoryChannelRepository } from "./server/channelRepository.ts";
import { validateInitData } from "./server/initData.ts";
import { TelegramApiError, type TelegramClient } from "./server/telegramClient.ts";

const token = "test-token";
const day = 24 * 60 * 60 * 1000;

function sign(userId: number, authDate = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = { auth_date: String(authDate), user: JSON.stringify({ id: userId }) };
  const dataCheck = Object.entries(fields)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

test("USDT prices stay integers and durations expire from the payment time", () => {
  assert.equal(parseCommunityPrice("1.5"), "1500000");
  assert.equal(parseCommunityPrice("0.5"), null);
  assert.equal(parseCommunityPrice("0"), null);
  assert.equal(parseCommunityPrice("1e2"), null);
  assert.equal(entitlementExpiresAt(1_000, 30), 1_000 + 30 * day);
  assert.equal(parseDurationDays("45"), 45);
  assert.equal(parseDurationDays("0"), null);
  assert.equal(parseDurationDays("367"), null);
  assert.equal(
    communityFormReady({ channelState: "verified", botAdded: true, price: "1", durationDays: 45 }),
    true,
  );
  assert.equal(
    communityFormReady({ channelState: "permission_missing", botAdded: true, price: "1", durationDays: 45 }),
    true,
  );
  assert.equal(
    communityFormReady({ channelState: "verified", botAdded: false, price: "1", durationDays: 45 }),
    false,
  );
  assert.equal(
    communityFormReady({ channelState: "not_owner", botAdded: true, price: "1", durationDays: 7 }),
    false,
  );
});

test("the selector requests only invite and restrict rights", () => {
  const rights = botAdministratorRights();
  assert.deepEqual(
    Object.entries(rights).filter(([, enabled]) => enabled).map(([key]) => key).sort(),
    ["can_invite_users", "can_restrict_members"],
  );
  const button = channelRequestButton(7).request_chat;
  assert.equal(button.chat_is_channel, true);
  assert.equal(button.chat_has_username, false);
  assert.equal(button.chat_is_created, true);
  assert.equal(button.request_title, true);
  assert.equal(button.request_photo, true);
  assert.equal("bot_administrator_rights" in button, false);
  assert.deepEqual(button.user_administrator_rights, rights);
  assert.equal(preparedButtonPayload(42, 7).user_id, 42);
  assert.equal(selectorAvailability(null), "telegram_unavailable");
  assert.equal(selectorAvailability({ initData: "x", requestChat() {}, isVersionAtLeast: () => false }), "telegram_unavailable");
  assert.equal(readChatShared({ chat_id: "-100" }), null);
});

test("initData rejects a tampered user id and an expired session", () => {
  const valid = sign(42);
  assert.equal(validateInitData(valid, token)?.userId, 42);
  const tampered = valid.replace("42", "99");
  assert.equal(validateInitData(tampered, token), null);
  assert.equal(validateInitData(sign(42, 1), token), null);
});

test("verification uses Telegram's chat, owner, and bot rights before a community can be active", async () => {
  const repo = new MemoryChannelRepository();
  const mode = { kind: "private" as "private" | "public" | "group" | "admin" | "rights" | "down" };
  let accountsChecked = 0;
  const telegram: TelegramClient = {
    async call(method, body) {
      if (method === "savePreparedKeyboardButton") return { id: "prepared-button" };
      if (method === "getChat") {
        if (mode.kind === "down") throw new TelegramApiError("unavailable", 503);
        return {
          type: mode.kind === "group" ? "supergroup" : "channel",
          title: "Alpha",
          description: "Private notes",
          username: mode.kind === "public" ? "alpha" : undefined,
        };
      }
      if (method === "getChatMember") {
        if (body?.user_id === 42) return { status: mode.kind === "admin" ? "administrator" : "creator" };
        return {
          status: "administrator",
          can_invite_users: true,
          can_restrict_members: mode.kind !== "rights",
        };
      }
      if (method === "getChatMemberCount") return 12;
      throw new Error(`unexpected ${method}`);
    },
  };
  const deps: ChannelDeps = {
    repo,
    telegram,
    botToken: token,
    botUserId: "555",
    now: () => Date.now(),
    accountStatus: async () => {
      accountsChecked += 1;
      return "exists";
    },
  };

  const prepared = await prepareChannelSelection(deps, sign(42));
  assert.equal(prepared.preparedButtonId, "prepared-button");
  const requestId = prepared.requestId || 0;
  await ingestTelegramUpdate(deps, { message: { from: { id: 99 }, chat_shared: { request_id: requestId, chat_id: -100123, title: "Wrong" } } });
  assert.equal(await repo.getChannel("-100123"), null);

  mode.kind = "public";
  await ingestTelegramUpdate(deps, { message: { from: { id: 42 }, chat_shared: { request_id: requestId, chat_id: -100123 } } });
  assert.equal((await repo.getSelection(requestId))?.status, "public_channel");
  assert.equal(await repo.getChannel("-100123"), null);

  const again = await prepareChannelSelection(deps, sign(42));
  mode.kind = "admin";
  await ingestTelegramUpdate(deps, { message: { from: { id: 42 }, chat_shared: { request_id: again.requestId, chat_id: -100123 } } });
  assert.equal((await repo.getSelection(again.requestId || 0))?.status, "not_owner");

  const pendingBot = await prepareChannelSelection(deps, sign(42));
  mode.kind = "rights";
  await ingestTelegramUpdate(deps, {
    message: { from: { id: 42 }, chat_shared: { request_id: pendingBot.requestId, chat_id: -100123 } },
  });
  assert.equal((await repo.getSelection(pendingBot.requestId || 0))?.status, "permission_missing");
  const waiting = await repo.getChannel("-100123");
  assert.equal(waiting?.verificationStatus, "verified");
  assert.equal(waiting?.botCanInviteUsers, false);
  assert.equal(waiting?.botCanRestrictMembers, false);

  const blockedCreate = await createVerifiedCommunity(deps, sign(42), {
    requestId: pendingBot.requestId || 0,
    price: "1.5",
    durationDays: 30,
    creatorWallet: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  });
  assert.equal(blockedCreate.ok, false);
  assert.equal(blockedCreate.state, "permission_missing");

  const owned = await prepareChannelSelection(deps, sign(42));
  mode.kind = "private";
  await ingestTelegramUpdate(deps, { message: { from: { id: 42 }, chat_shared: { request_id: owned.requestId, chat_id: -100123 } } });
  const draft = await repo.getChannel("-100123");
  assert.equal(draft?.title, "Alpha");
  assert.equal(draft?.description, "Private notes");
  assert.equal(draft?.telegramMemberCount, 12);
  assert.equal(draft?.botCanInviteUsers, true);
  assert.equal(draft?.active, false);
  assert.notEqual(draft?.telegramMemberCount, 0);

  const created = await createVerifiedCommunity(deps, sign(42), {
    requestId: owned.requestId || 0,
    price: "1.5",
    durationDays: 30,
    creatorWallet: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  });
  assert.equal(created.ok, true);
  assert.equal(created.channel?.telegramMemberCount, 12);
  assert.ok(created.communityId && created.communityId > 0);
  assert.equal(created.channel?.communityId, created.communityId);
  const active = await repo.getChannel("-100123");
  assert.equal(active?.active, true);
  assert.equal(active?.communityId, created.communityId);
  assert.equal((await repo.getChannelByCommunityId(created.communityId!))?.title, "Alpha");
  assert.equal(active?.priceUsdt, parseCommunityPrice("1.5"));
  assert.equal(active?.durationDays, 30);

  const duplicate = await createVerifiedCommunity(deps, sign(42), {
    requestId: owned.requestId || 0,
    price: "9",
    durationDays: 7,
    creatorWallet: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  });
  assert.equal(duplicate.alreadyExists, true);
  assert.equal((await repo.getChannel("-100123"))?.priceUsdt, parseCommunityPrice("1.5"));

  const implicit = "a".repeat(64);
  const before = accountsChecked;
  await createVerifiedCommunity(deps, sign(42), {
    requestId: owned.requestId || 0,
    price: "1",
    durationDays: 90,
    creatorWallet: implicit,
  });
  assert.equal(accountsChecked, before);

  mode.kind = "rights";
  const blocked = await recheckChannelAccess(deps, sign(42), "-100123");
  assert.equal(blocked.allowed, false);
  assert.equal(subscriptionFulfillmentAllowed((await repo.getChannel("-100123")) as ChannelSnapshot), false);

  mode.kind = "private";
  const restored = await createVerifiedCommunity(deps, sign(42), {
    requestId: owned.requestId || 0,
    price: "1.5",
    durationDays: 30,
    creatorWallet: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs",
  });
  assert.equal(restored.ok, true);
  mode.kind = "down";
  const outage = await recheckChannelAccess(deps, sign(42), "-100123");
  assert.equal(outage.allowed, false);
  assert.equal((await repo.getChannel("-100123"))?.active, true);
});

test("a second owner cannot register the same channel", async () => {
  const repo = new MemoryChannelRepository();
  const deps: ChannelDeps = {
    repo,
    telegram: {
      async call(method, body) {
        if (method === "savePreparedKeyboardButton") return { id: "prepared-button" };
        if (method === "getChat") return { type: "channel", title: "Alpha" };
        if (method === "getChatMember" && body?.user_id === 555) {
          return { status: "administrator", can_invite_users: true, can_restrict_members: true };
        }
        if (method === "getChatMember") return { status: "creator" };
        if (method === "getChatMemberCount") return 1;
        throw new Error(method);
      },
    },
    botToken: token,
    botUserId: "555",
    now: () => Date.now(),
    accountStatus: async () => "exists",
  };
  const first = await prepareChannelSelection(deps, sign(42));
  await ingestTelegramUpdate(deps, { message: { from: { id: 42 }, chat_shared: { request_id: first.requestId, chat_id: -1005 } } });
  const second = await prepareChannelSelection(deps, sign(99));
  await ingestTelegramUpdate(deps, { message: { from: { id: 99 }, chat_shared: { request_id: second.requestId, chat_id: -1005 } } });
  assert.equal((await repo.getSelection(second.requestId || 0))?.status, "verification_failed");
  assert.equal((await repo.getChannel("-1005"))?.ownerTelegramUserId, "42");
  const missing = nextActivation(null, { ownerTelegramUserId: "42", priceUsdt: "1500000", durationDays: 7, payoutAccount: "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs" });
  assert.equal(missing.result, "missing");
});
