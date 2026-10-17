import assert from "node:assert/strict";
import { fitEvents, EVENTS_PAYLOAD_BUDGET } from "../shared/flows-events.js";
import { CALL_COST, callModel, NOMINAL_SHAPE } from "../scripts/flows-nightly/vendor-params.mjs";
import { runSigmaLedger, readLedger, writeLedger, SIGMA_ROTATE } from "../scripts/flows-legs/sigma-ledger.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

eq(CALL_COST.sigmaLedger, SIGMA_ROTATE, "the call model prices exactly the ledger's nightly rotation");
eq(callModel(NOMINAL_SHAPE).legs.sigmaLedger, SIGMA_ROTATE, "and the nominal night counts those calls in its own leg");

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

const rows = Array.from({ length: 400 }, (_, i) => ({
  t: "T" + i, d: addDays("2026-10-19", Math.floor(i / 20)), st: i % 2 ? "liquid" : "gated", rv: i % 3 ? 0.4 : null, ev: i % 5 ? 0.05 : null,
  pad: "x".repeat(400),
}));
const payload = { v: 1, rows, shown: rows.length, beyondCap: 0, capBound: false, byStage: {}, lastShownDate: rows[rows.length - 1].d };
const big = JSON.stringify(payload).length;
ok(big > EVENTS_PAYLOAD_BUDGET, "fixture exceeds the budget");
const fitted = fitEvents(payload);
ok(JSON.stringify(fitted).length <= EVENTS_PAYLOAD_BUDGET, "fitted payload is under the budget");
ok(fitted.shedRows > 0 && fitted.shedRows < rows.length, "some rows shed, not all");
eq(fitted.shown + fitted.shedRows, rows.length, "shown plus shed is the whole");
eq(fitted.beyondCap, fitted.shedRows, "beyondCap counts the shed rows");
eq(fitted.capBound, true, "capBound says the cap bit");
eq(fitted.lastShownDate, fitted.rows[fitted.rows.length - 1].d, "lastShownDate follows the rows");
ok(fitted.rows.every((r, i) => r === rows[i]), "the nearest dates are kept, the far ones shed");
eq(Object.values(fitted.byStage).reduce((a, b) => a + b, 0), fitted.shown, "byStage sums to shown");
const small = fitEvents({ ...payload, rows: rows.slice(0, 5) });
ok(!("shedRows" in small), "a small payload gains no key");
eq(small.rows.length, 5, "a small payload keeps its rows");
const shuffled = fitEvents({ ...payload, rows: rows.slice().reverse() });
eq(shuffled.lastShownDate, fitted.lastShownDate, "rows given in descending date order shed the same far dates");
ok(shuffled.rows.every((r, i, a) => i === 0 || a[i - 1].d <= r.d), "and the kept rows come back date-ascending");

const wd = (start, n) => {
  const out = [];
  let d = start;
  while (out.length < n) {
    const w = new Date(d + "T00:00:00Z").getUTCDay();
    if (w !== 0 && w !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
};
const days = wd("2025-09-01", 260);
const bars = (seed) => days.map((d, i) => {
  const c = 100 * Math.exp(0.01 * Math.sin(i * seed) + 0.002 * i * 0.01);
  return { d, h: c * 1.01, l: c * 0.99, c };
});

const names = Array.from({ length: 300 }, (_, i) => "N" + String(i).padStart(3, "0"));
const universe = new Set(names);
const fresh = new Map(names.slice(0, 40).map((t) => [t, { ok: true, s: 0.01, n: 250, f2: 10, f3: 3 }]));
const asked = [];
const fetchBars = async (t) => { asked.push(t); return t === "N299" ? null : { bars: t === "N298" ? bars(1.3).slice(0, 50) : bars(1 + (t.charCodeAt(3) % 7) / 10), breaks: [] }; };

const first = await runSigmaLedger({ sessionDate: "2026-10-16", universe, fresh, prior: null, fetchBars });
eq(asked.length, SIGMA_ROTATE, "a night reads at most the rotation");
eq(first.basis.fresh, 40, "fresh names counted");
ok(!asked.some((t) => fresh.has(t)), "a fresh name is never re-read");
eq(first.basis.covered, first.sigma.size, "covered matches the map");
ok(first.basis.covered > 40, "rotation adds coverage");
ok(first.sigma.get("N000").s === 0.01, "fresh value wins");

const second = await runSigmaLedger({ sessionDate: "2026-10-19", universe, fresh, prior: { sigmaLedger: first.ledger }, fetchBars: async (t) => { asked.push(t); return { bars: bars(1.1), breaks: [] }; } });
ok(second.basis.covered > first.basis.covered, "the second night adds more names");
ok(second.basis.covered <= universe.size, "never above the universe");
ok(readLedger({ sigmaLedger: second.ledger }).size === second.basis.covered, "ledger round-trips");

const third = await runSigmaLedger({ sessionDate: "2026-10-20", universe, fresh, prior: { sigmaLedger: first.ledger }, fetchBars: null });
eq(third.basis.rotated, 0, "no fetcher reads nothing");
eq(third.basis.covered, first.basis.covered, "the ledger carries without reads");

const old = await runSigmaLedger({ sessionDate: "2026-12-30", universe, fresh: new Map(), prior: { sigmaLedger: first.ledger }, fetchBars: null });
eq(old.basis.covered, 0, "an entry past its age limit is dropped, not shown");

const shortRun = await runSigmaLedger({ sessionDate: "2026-10-16", universe: new Set(["N298"]), fresh: new Map(), prior: null, fetchBars });
eq(shortRun.basis.short, 1, "a short-history name is counted");
const shortAgain = [];
await runSigmaLedger({ sessionDate: "2026-10-19", universe: new Set(["N298"]), fresh: new Map(), prior: { sigmaLedger: shortRun.ledger }, fetchBars: async (t) => { shortAgain.push(t); return null; } });
eq(shortAgain.length, 0, "a short-history name is not retried for 20 days");

{
  const big = new Map();
  for (let i = 0; i < 1000; i++) big.set("T" + String(i).padStart(4, "0"), { s: 0.0123 + i * 1e-5, n: 251, f2: 12, f3: 3, d: "2026-10-16" });
  const bytes = JSON.stringify(writeLedger(big)).length;
  ok(bytes < 40000, "a thousand-name ledger stays under 40 KB (" + bytes + ")");
  ok(bytes + 64 * 1024 < 128 * 1024, "and with the regime's own 64 KiB it clears the 128 KiB ingest cap");
}

console.log(`flows-data-fixes: ${checks} checks passed`);
