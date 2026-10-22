import assert from "node:assert/strict";
import test from "node:test";
import { isInsideChannel } from "./channelMember.ts";

test("channel membership ignores removed subscribers", () => {
  assert.equal(isInsideChannel("member"), true);
  assert.equal(isInsideChannel("administrator"), true);
  assert.equal(isInsideChannel("left"), false);
  assert.equal(isInsideChannel("kicked"), false);
  assert.equal(isInsideChannel("restricted", false), false);
  assert.equal(isInsideChannel(undefined), false);
});
