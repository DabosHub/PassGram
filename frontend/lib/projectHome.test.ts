import assert from "node:assert/strict";
import test from "node:test";
import {
  announceOnProjectChannel,
  communityLaunchText,
  joinedMemberNames,
  presentProjectHome,
  projectChatKind,
  projectWelcomeText,
  publicCreatorLabel,
  referralLaunchText,
  resetProjectHomeProfile,
} from "./projectHome.ts";

test("project chats are only the official channel and group", () => {
  assert.equal(projectChatKind({ username: "PassGramOfficial", type: "channel" }), "channel");
  assert.equal(projectChatKind({ username: "passgramchat", type: "supergroup" }), "group");
  assert.equal(projectChatKind({ username: "SomePaidChannel", id: -1005, type: "channel" }), null);
});

test("launch copy names the creator and keeps the referral rate on the creator share", () => {
  assert.equal(publicCreatorLabel("Ada Lovelace", "ada"), "Ada Lovelace");
  assert.equal(publicCreatorLabel("", "ada"), "@ada");
  assert.match(communityLaunchText("Ada", "Alpha"), /Ada/);
  assert.match(communityLaunchText("Ada", "Alpha"), /Alpha/);
  assert.match(referralLaunchText("Ada", "Alpha", "12.5"), /12\.5%/);
  assert.match(referralLaunchText("Ada", "Alpha", "12.5"), /creator's share/);
  assert.match(projectWelcomeText(["Ada"]), /Welcome/);
  assert.match(projectWelcomeText(["Ada"]), /Ada/);
  assert.deepEqual(joinedMemberNames({ new_chat_members: [{ is_bot: true, first_name: "PassGramBot" }, { first_name: "Ada" }] }), ["Ada"]);
});

test("a new group member is welcomed and a paid channel is not", async () => {
  resetProjectHomeProfile();
  const calls: { method: string; chat?: unknown; text?: unknown }[] = [];
  const telegram = {
    call: async (method: string, body?: Record<string, unknown>) => {
      calls.push({ method, chat: body?.chat_id, text: body?.text });
      return { message_id: 1 };
    },
  };
  await presentProjectHome(telegram, {
    message: {
      chat: { id: -1009, username: "PassGramChat", type: "supergroup" },
      new_chat_members: [{ id: 7, first_name: "Ada", is_bot: false }],
    },
  });
  await presentProjectHome(telegram, {
    message: {
      chat: { id: -1005, username: "AlphaSignals", type: "channel" },
      new_chat_members: [{ id: 8, first_name: "Bea" }],
    },
  });
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  assert.equal(calls[0]?.chat, "@PassGramChat");
  assert.match(String(calls[0]?.text), /Welcome/);
  assert.match(String(calls[0]?.text), /Ada/);
});

test("adding the bot pins Open PassGram once", async () => {
  resetProjectHomeProfile();
  const methods: string[] = [];
  const telegram = {
    call: async (method: string) => {
      methods.push(method);
      if (method === "getChat") return {};
      return { message_id: 4 };
    },
  };
  await presentProjectHome(telegram, {
    my_chat_member: {
      chat: { id: -1001, username: "PassGramOfficial", type: "channel" },
      new_chat_member: { status: "administrator" },
    },
  });
  assert.ok(methods.includes("setChatMenuButton"));
  assert.ok(methods.includes("sendMessage"));
  assert.ok(methods.includes("pinChatMessage"));

  const sent = await announceOnProjectChannel(telegram, communityLaunchText("Ada", "Alpha"), "Join community", "https://t.me/PassGramBot/passgram?startapp=c_7");
  assert.equal(sent, undefined);
  assert.ok(methods.filter((method) => method === "sendMessage").length >= 2);
});
