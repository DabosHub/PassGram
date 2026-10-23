import assert from "node:assert/strict";
import test from "node:test";
import { databaseSsl } from "./databaseSsl.ts";

test("supabase connections verify the published root", () => {
  const previous = process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY;
  delete process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY;
  try {
    const ssl = databaseSsl("postgresql://postgres.example:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres");
    assert.equal(typeof ssl, "object");
    if (!ssl || typeof ssl === "boolean") throw new Error("expected an ssl config");
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(String(ssl.ca), /BEGIN CERTIFICATE/);
    assert.match(String(ssl.ca), /MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYw/);
    assert.equal(databaseSsl("postgres://local/passgram"), undefined);
  } finally {
    if (previous === undefined) delete process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY;
    else process.env.PASSGRAM_DATABASE_SSL_NO_VERIFY = previous;
  }
});
