import assert from "node:assert/strict";
import test from "node:test";
import { validateInitData } from "./server/initData.ts";

const TOKEN = "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8";
const USER =
  '{"id":279058397,"first_name":"Vladislav","last_name":"Kibenko","username":"vdkfrost","language_code":"ru","is_premium":true}';
const HASH = "c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2";

test("Telegram's published initData sample verifies", () => {
  const params = new URLSearchParams();
  params.set("query_id", "AAHdF6IQAAAAAN0XohDhrOrc");
  params.set("user", USER);
  params.set("auth_date", "1662771648");
  params.set("hash", HASH);
  const identity = validateInitData(params.toString(), TOKEN, 1662771648);
  assert.equal(identity?.userId, 279058397);
  assert.equal(identity?.username, "vdkfrost");
  assert.equal(identity?.displayName, "Vladislav Kibenko");
});
