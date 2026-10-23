import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adminPath,
  barPercent,
  fillTreasurySeries,
  formatUsdtGrouped,
  indexerAlert,
  monthChangeLabel,
  monthSeriesStartMs,
  parseAdminQuery,
  periodStartMs,
  removalLabel,
  fillMonthSeries,
} from "./adminView.ts";

const NOW = 1_700_000_000_000;

test("admin query keeps a community filter only on communities and payments", () => {
  const parsed = parseAdminQuery({ section: "payments", period: "7d", community: "12", page: "2" });
  assert.deepEqual(parsed, { section: "payments", period: "7d", communityId: 12, page: 2 });
  assert.equal(parseAdminQuery({ section: "overview", community: "12" }).communityId, null);
  assert.equal(parseAdminQuery({ section: "nope", period: "nope", page: "9999" }).section, "overview");
  assert.equal(parseAdminQuery({ page: "9999", section: "payments" }).page, 200);
  assert.equal(parseAdminQuery({ community: "0" }).communityId, null);
});

test("admin paths omit the default period and ignore a community on overview", () => {
  assert.equal(adminPath({ section: "overview", period: "30d", communityId: 4, page: 1 }), "/admin");
  assert.equal(
    adminPath({ section: "payments", period: "all", communityId: 4, page: 2 }),
    "/admin?section=payments&period=all&community=4&page=2",
  );
  assert.equal(
    adminPath({ section: "communities", period: "30d", communityId: 9001, page: 1, pathBase: "/admin/preview" }),
    "/admin/preview?section=communities&community=9001",
  );
});

test("period start and treasury chart use the selected window", () => {
  assert.equal(periodStartMs("all", NOW), null);
  assert.equal(periodStartMs("24h", NOW), NOW - 24 * 60 * 60 * 1000);
  const points = fillTreasurySeries(NOW - 24 * 60 * 60 * 1000, NOW, 60 * 60 * 1000, [
    { bucket: Math.floor(NOW / (60 * 60 * 1000)), treasury: 5n },
  ]);
  assert.ok(points.length >= 24 && points.length <= 25);
  assert.equal(points.at(-1)?.treasury, 5n);
  assert.equal(barPercent(5n, 10n), 50);
  assert.equal(barPercent(0n, 10n), 0);
});

test("grouped USDT keeps six-decimal base units readable", () => {
  assert.equal(formatUsdtGrouped(1_234_567_890n), "1,234.56789");
  assert.equal(formatUsdtGrouped(0n), "0");
});

test("indexer alert distinguishes a missing cursor, a stalled backlog, and a long silence", () => {
  assert.equal(indexerAlert({ hasCursor: false, position: "0", backlog: false, updatedAtMs: null }, NOW), "missing");
  assert.equal(
    indexerAlert({ hasCursor: true, position: "9", backlog: true, updatedAtMs: NOW - 16 * 60 * 1000 }, NOW),
    "backlog",
  );
  assert.equal(
    indexerAlert({ hasCursor: true, position: "9", backlog: false, updatedAtMs: NOW - 20 * 60 * 1000 }, NOW),
    null,
  );
  assert.equal(
    indexerAlert({ hasCursor: true, position: "9", backlog: false, updatedAtMs: NOW - 7 * 60 * 60 * 1000 }, NOW),
    "quiet",
  );
});

test("MMR fills twelve UTC months and compares the latest two", () => {
  const now = Date.UTC(2026, 9, 23);
  const series = fillMonthSeries(now, [
    { month: "2026-09", treasury: 100n },
    { month: "2026-10", treasury: 110n },
  ]);
  assert.equal(series.length, 12);
  assert.equal(series[0]?.label, "Nov");
  assert.equal(series.at(-2)?.treasury, 100n);
  assert.equal(series.at(-1)?.treasury, 110n);
  assert.equal(series[1]?.treasury, 0n);
  assert.equal(monthChangeLabel(110n, 100n), "10% above last month");
  assert.equal(monthChangeLabel(100n, 100n), "Same as last month");
  assert.equal(monthChangeLabel(90n, 100n), "10% below last month");
  assert.equal(monthChangeLabel(5n, 0n), null);
  assert.equal(monthSeriesStartMs(now), series[0]?.startMs);
});
test("removal label follows the saved expiry", () => {
  assert.equal(removalLabel(NOW + 1000, null, NOW), "Active");
  assert.equal(removalLabel(NOW - 1000, NOW - 1000, NOW), "Removed");
  assert.equal(removalLabel(NOW - 1000, null, NOW), "Waiting for removal");
});

test("admin queries stay read-only and do not read invite links", () => {
  const source = readFileSync(new URL("./adminRepository.ts", import.meta.url), "utf8");
  assert.equal(source.includes("invite_link"), false);
  assert.doesNotMatch(source, /\b(insert|update|delete|alter|drop)\b/i);
});
