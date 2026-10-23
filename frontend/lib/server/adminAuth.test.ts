import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  SESSION_TTL_SECONDS,
  adminTelegramIds,
  allowAdminSignIn,
  readAdminSession,
  requestFromThisSite,
  signAdminSession,
  validateTelegramLogin,
} from "./adminAuth.ts";

const TOKEN = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";

test("Telegram Login hash accepts the fields Telegram signed", () => {
  const authDate = 1_700_000_000;
  const fields = {
    auth_date: String(authDate),
    first_name: "Ada",
    id: "42",
    username: "ada",
  };
  const identity = validateTelegramLogin(
    { id: 42, first_name: "Ada", username: "ada", auth_date: authDate, hash: loginHash(fields, TOKEN) },
    TOKEN,
    authDate,
  );
  assert.equal(identity?.userId, 42);
  assert.equal(identity?.displayName, "Ada");
  assert.equal(identity?.username, "ada");
});

test("Telegram Login rejects a payload whose id changed after signing", () => {
  const authDate = 1_700_000_000;
  const hash = loginHash({ auth_date: String(authDate), id: "42" }, TOKEN);
  assert.equal(validateTelegramLogin({ id: 43, auth_date: authDate, hash }, TOKEN, authDate), null);
});

test("Telegram Login rejects an old or future auth date", () => {
  const authDate = 1_700_000_000;
  const hash = loginHash({ auth_date: String(authDate), id: "42" }, TOKEN);
  const payload = { id: 42, auth_date: authDate, hash };
  assert.equal(validateTelegramLogin(payload, TOKEN, authDate + 24 * 60 * 60 + 1), null);
  assert.equal(validateTelegramLogin(payload, TOKEN, authDate - 61), null);
});

test("admin session stays valid only for an allowlisted user inside the lifetime", () => {
  const now = 1_700_000_000;
  const token = signAdminSession(42, TOKEN, now);
  assert.equal(readAdminSession(token, TOKEN, new Set([42]), now + 10)?.userId, 42);
  assert.equal(readAdminSession(token, TOKEN, new Set([7]), now + 10), null);
  assert.equal(readAdminSession(token, "other-token", new Set([42]), now + 10), null);
  assert.equal(readAdminSession(token, TOKEN, new Set([42]), now + SESSION_TTL_SECONDS + 1), null);
  const [payload, signature] = token.split(".");
  assert.equal(readAdminSession(`${payload}x.${signature}`, TOKEN, new Set([42]), now), null);
});

test("admin allowlist keeps positive ids", () => {
  assert.deepEqual([...adminTelegramIds(" 42, no, 0, -3, 7 ")], [42, 7]);
  assert.equal(adminTelegramIds("").size, 0);
});

test("sign-in must come from this site", () => {
  assert.equal(requestFromThisSite({ headers: header("https://passgram.app", "passgram.app") }), true);
  assert.equal(requestFromThisSite({ headers: header("https://evil.example", "passgram.app") }), false);
  assert.equal(requestFromThisSite({ headers: header(null, "passgram.app") }), false);
});

test("admin sign-in allows ten attempts in a minute", () => {
  const previous = process.env.PASSGRAM_RATE_LIMIT;
  process.env.PASSGRAM_RATE_LIMIT = "on";
  try {
    const start = 9_000_000_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) assert.equal(allowAdminSignIn(start), true);
    assert.equal(allowAdminSignIn(start), false);
    assert.equal(allowAdminSignIn(start + 60_000), true);
  } finally {
    if (previous == null) delete process.env.PASSGRAM_RATE_LIMIT;
    else process.env.PASSGRAM_RATE_LIMIT = previous;
  }
});

function loginHash(fields: Record<string, string>, token: string): string {
  const dataCheck = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = crypto.createHash("sha256").update(token).digest();
  return crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
}

function header(origin: string | null, host: string | null): { get(name: string): string | null } {
  return {
    get(name: string) {
      if (name === "origin") return origin;
      if (name === "host") return host;
      return null;
    },
  };
}
