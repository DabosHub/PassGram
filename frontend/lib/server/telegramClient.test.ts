import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramClient } from "./telegramClient.ts";

test("a fresh member lookup skips the cached getChatMember result", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const status = calls === 1 ? "left" : "member";
    return new Response(JSON.stringify({ ok: true, result: { status } }), { status: 200 });
  };
  try {
    const client = createTelegramClient("12345:test-token");
    const chat = { chat_id: "-100777", user_id: 42 };
    const first = (await client.call("getChatMember", chat)) as { status?: string };
    const cached = (await client.call("getChatMember", chat)) as { status?: string };
    const fresh = (await client.call("getChatMember", chat, { fresh: true })) as { status?: string };
    assert.equal(first.status, "left");
    assert.equal(cached.status, "left");
    assert.equal(fresh.status, "member");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
