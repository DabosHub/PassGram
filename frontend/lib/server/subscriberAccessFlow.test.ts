import assert from "node:assert/strict";
import test from "node:test";
import { INVITE_ADMIN_ERROR } from "../subscriberAccess.ts";
import type { MembershipRepository } from "./membershipRepository.ts";
import { readSubscriberAccess, resetInviteRecoveryForTests } from "./subscriberAccessFlow.ts";

function repo(saved: { link: string | null }): MembershipRepository {
  return {
    async listSubscriberChannels() {
      return [{ communityId: 7, title: "Builder Lounge", telegramChatId: "-1007" }];
    },
    async listSubscriberInvites() {
      return [];
    },
    async missingSubscriberInvite() {
      return { transactionReference: "abc", expiresAtMs: Date.now() + 86_400_000 };
    },
    async saveSubscriberInvite(_userId: number, _communityId: number, _reference: string, inviteLink: string) {
      saved.link = inviteLink;
    },
  } as unknown as MembershipRepository;
}

test("a subscriber outside the channel sees an invite error when the bot cannot invite", async () => {
  resetInviteRecoveryForTests();
  const previousBot = process.env.PASSGRAM_BOT_USER_ID;
  delete process.env.PASSGRAM_BOT_USER_ID;
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop() || "";
    methods.push(method);
    const body = JSON.parse(String(init?.body || "{}")) as { user_id?: number };
    if (method === "getChatMember" && body.user_id === 5) return json({ status: "left" });
    if (method === "getChatMember") return json({ status: "member" });
    return json({});
  };
  try {
    const access = await readSubscriberAccess("999:test", 5, repo({ link: null }), { recoverInvites: true });
    assert.equal(access[0]?.inviteLink, null);
    assert.equal(access[0]?.inviteError, INVITE_ADMIN_ERROR);
    assert.equal(methods.includes("createChatInviteLink"), false);
  } finally {
    if (previousBot == null) delete process.env.PASSGRAM_BOT_USER_ID;
    else process.env.PASSGRAM_BOT_USER_ID = previousBot;
    globalThis.fetch = original;
    resetInviteRecoveryForTests();
  }
});

test("a missing invite is created when the bot can invite and the payer is outside", async () => {
  resetInviteRecoveryForTests();
  const previousBot = process.env.PASSGRAM_BOT_USER_ID;
  delete process.env.PASSGRAM_BOT_USER_ID;
  const original = globalThis.fetch;
  const saved = { link: null as string | null };
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop() || "";
    const body = JSON.parse(String(init?.body || "{}")) as { user_id?: number; member_limit?: number };
    if (method === "getChatMember" && body.user_id === 5) return json({ status: "left" });
    if (method === "getChatMember") return json({ status: "administrator", can_invite_users: true });
    assert.equal(method, "createChatInviteLink");
    assert.equal(body.member_limit, 1);
    return json({ invite_link: "https://t.me/+one" });
  };
  try {
    const access = await readSubscriberAccess("999:test", 5, repo(saved), { recoverInvites: true });
    assert.equal(access[0]?.inviteLink, "https://t.me/+one");
    assert.equal(access[0]?.inviteError, null);
    assert.equal(saved.link, "https://t.me/+one");
  } finally {
    if (previousBot == null) delete process.env.PASSGRAM_BOT_USER_ID;
    else process.env.PASSGRAM_BOT_USER_ID = previousBot;
    globalThis.fetch = original;
    resetInviteRecoveryForTests();
  }
});

test("a timed-out chain pass does not create a second invite", async () => {
  resetInviteRecoveryForTests();
  const original = globalThis.fetch;
  const previousBot = process.env.PASSGRAM_BOT_USER_ID;
  delete process.env.PASSGRAM_BOT_USER_ID;
  let created = 0;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop() || "";
    const body = JSON.parse(String(init?.body || "{}")) as { user_id?: number };
    if (method === "createChatInviteLink") {
      created += 1;
      return json({ invite_link: "https://t.me/+two" });
    }
    if (method === "getChatMember" && body.user_id === 8) return json({ status: "left" });
    return json({ status: "administrator", can_invite_users: true });
  };
  try {
    const access = await readSubscriberAccess("888:test", 8, repo({ link: null }), { recoverInvites: false });
    assert.equal(access[0]?.inviteLink, null);
    assert.equal(access[0]?.inviteError, null);
    assert.equal(created, 0);
  } finally {
    if (previousBot == null) delete process.env.PASSGRAM_BOT_USER_ID;
    else process.env.PASSGRAM_BOT_USER_ID = previousBot;
    globalThis.fetch = original;
    resetInviteRecoveryForTests();
  }
});

function json(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}
