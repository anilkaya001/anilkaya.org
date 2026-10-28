import assert from "node:assert/strict";
import {
  AI_CAP_WORST_WRITES, CAPS, COLD_START, D1_USERS, ENGINE_CEILINGS, MEMBERS, MEASURED_CEILINGS, NIGHTLY, PLANNED, RAIL, TIER2,
  UPSERT_READS_PER_WRITE, cronStrings, dayFirings, firingCounts, ledger, railLoads, totals, WEEKDAY, WEEKEND,
} from "./lib/d1-budget.mjs";
import { closure, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const crons = cronStrings();
eq(crons.length, 5, "wrangler.toml declares five cron strings");
const counts = firingCounts(crons);
eq(counts.weekday, { rth: 108, focus: 108, funds: 108, housekeeping: 48, summary: 48 }, "a weekday is 108 Tier 1 firings, 108 focus, 108 funds, 48 housekeeping and 48 summary: 420 in all");
eq(counts.weekend, { rth: 0, focus: 0, funds: 0, housekeeping: 48, summary: 48 }, "a weekend day is the housekeeping and the summary only");
eq(dayFirings(crons, WEEKDAY).length, 420, "and the expansion of the cron strings is 420 distinct instants");
eq(new Set(dayFirings(crons, WEEKDAY).map((f) => f.at)).size, 420, "no two of them fall on the same minute");
eq(Object.keys(ENGINE_CEILINGS).sort(), Object.keys(counts.weekday).sort(), "every job a cron string starts has a per-firing ceiling");

const rows = ledger(counts);
const sum = totals(rows);
for (const r of rows) {
  ok(Number.isInteger(r.written) && Number.isInteger(r.read) && r.written >= 0 && r.read >= 0, r.id + ": whole, non-negative row counts");
}
eq(new Set(rows.map((r) => r.id)).size, rows.length, "each declared writer and reader appears once");
for (const r of PLANNED) ok(typeof r.row === "string" && r.row.length > 0 && typeof r.source === "string" && r.source.length >= 10, r.id + " names the row that builds it and the plan line it comes from");
for (const x of [TIER2, NIGHTLY, RAIL, MEMBERS, COLD_START]) ok(typeof x.source === "string" && x.source.length > 20, "a declared quantity says where its number comes from");

const posts = Object.values(NIGHTLY.posts).reduce((a, b) => a + b, 0);
eq(posts, 2303, "a full deepening night writes 2,303 keys: 706 cards, 868 card-x, 694 hist, 27 views and 8 deletes");
eq(railLoads(), 192, "the rail loads its roster 192 times in a 16-hour demanded day");
ok(MEASURED_CEILINGS.rosterRead >= 3 * 60, "and a load is priced for three boards of sixty names, not for the three index lookups of its statement");

const pct = (n, cap) => (100 * n / cap).toFixed(1) + "%";
console.log(`  weekday: ${sum.written} rows written (${pct(sum.written, CAPS.written)} of ${CAPS.written}), ${sum.read} rows read (${pct(sum.read, CAPS.read)} of ${CAPS.read})`);
for (const r of rows) console.log(`    ${r.id.padEnd(24)} written ${String(r.written).padStart(6)}  read ${String(r.read).padStart(8)}`);

ok(sum.written < CAPS.written * 0.5, `THE WEEKDAY'S DECLARED WRITERS SUM TO ${sum.written} ROWS, under half of the ${CAPS.written} a day Workers Free allows`);
ok(sum.read < CAPS.read * 0.5, `AND ITS DECLARED READERS TO ${sum.read} ROWS, under half of the ${CAPS.read} a day`);
const worst = sum.written + AI_CAP_WORST_WRITES;
ok(worst < CAPS.written, `with the model-call cap spent (${AI_CAP_WORST_WRITES} more counter rows) the writers are ${worst}, still under the cap`);

const weekend = Object.entries(counts.weekend).reduce((t, [job, n]) => {
  const c = ENGINE_CEILINGS[job];
  return { written: t.written + n * c.written, read: t.read + n * (c.read + UPSERT_READS_PER_WRITE * c.written) };
}, { written: 96 * COLD_START.written, read: 96 * 4 });
ok(weekend.written < 3000 && weekend.read < 3000, `a weekend day's engines are ${weekend.written} rows written and ${weekend.read} read, with every firing on a fresh isolate`);

const users = Object.fromEntries([...closure("worker.js")].sort().map((f) => {
  const text = moduleSource(f);
  return [f, (text.match(/\.prepare\(/g) || []).length + (text.match(/\.batch\(/g) || []).length];
}).filter(([, n]) => n > 0));
const known = Object.keys(D1_USERS).sort();
eq(Object.keys(users).sort().filter((f) => !known.includes(f)), [],
  "EVERY MODULE IN THE WORKER'S CLOSURE THAT PREPARES OR BATCHES A D1 STATEMENT IS DECLARED in tests/lib/d1-budget.mjs with the writers and readers that price it; a new one fails here until it is priced");
eq(known.filter((f) => !Object.hasOwn(users, f)), [], "and no declared module has stopped touching D1");
ok(Object.keys(users).length >= 9, "the scan found the nine D1 users: " + Object.keys(users).length);
for (const [file, ids] of Object.entries(D1_USERS)) {
  ok(ids.length > 0, file + " names the ledger rows that price it");
  for (const id of ids) {
    ok(rows.some((r) => r.id === id || r.id.startsWith(id + ".")), `${file}: ${id} is a declared writer or reader`);
  }
}

console.log("flows-d1-budget: " + checks + " checks");
