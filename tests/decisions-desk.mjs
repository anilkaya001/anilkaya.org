import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeChain } from "./lib/sc-chain.mjs";
import { chainWorld, route } from "./lib/sc-world.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { dividendOutlook, partState } from "../shared/flows-vendor-extras.js";
import { carryOf, chooseForward, deltaBand, exerciseStrike, exFrame, dividendFraction, FWD_LINES } from "../shared/flows-quant-forward.js";
import { shortCallCollateral, SC_DELTA_FLOOR } from "../shared/flows-premium.js";
import { vendorCheck, vendorAnomalies, gatherPages, SC_PAGE_SIZE } from "../server/desk-sc.js";
import { etDayOf } from "../shared/flows-quant-time.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
let salt = 0;

const X = { ok: true, declared: [{ ex: "2026-11-05" }], history: [{ ex: "2026-08-06" }, { ex: "2026-05-07" }, { ex: "2026-02-05" }, { ex: "2025-11-06" }], cadence: "quarterly", gapDays: 91, lastEx: "2026-08-06" };

{
  const o = (over = {}, args = {}) => dividendOutlook({ x: { ...X, ...over }, expiry: "2026-11-06", today: "2026-10-26", ageDays: 1, ...args });
  eq([o().state, o().exDate, o().n, o().g, o().irregular, o().lastExerciseDay], ["declared", "2026-11-05", 1, 91, false, "2026-11-04"], "an ex-date inside the window is declared, with the last day to exercise before it");
  eq(o({ declared: [] }).state, "expected", "none declared but one due on the schedule is expected");
  eq(o({ declared: [] }, { expiry: "2026-11-04" }).state, "none-known", "an expiry before the due date has none");
  eq(o({ declared: [] }, { today: "2026-10-30", expiry: "2026-11-06" }).state, "none-known", "a due date closer than the ten days of notice that a fresh read does not show is not coming");
  eq(o({ declared: [] }, { today: "2026-10-30", expiry: "2026-11-06", ageDays: 9 }).state, "expected", "while an old read cannot rule it out");
  eq(o({ declared: [{ ex: "2026-11-05" }] }, { expiry: "2026-11-05" }).state, "declared", "an ex-date on the expiry day counts");
  eq(o({ declared: [{ ex: "2026-11-09" }] }, { expiry: "2026-11-04" }).state, "none-known", "and one after it does not");
  eq(o({ declared: [{ ex: "2026-10-26" }] }, { expiry: "2026-11-04" }).state, "none-known", "an ex-date of today has already gone");
  eq(o({ declared: [{ ex: "2026-08-20" }, { ex: "2026-11-05" }] }, {}).irregular, false, "an ex-date past the schedule's gap is regular");
  eq(o({ declared: [{ ex: "2026-09-01" }] }, { today: "2026-08-28", expiry: "2026-09-05" }).irregular, true, "an ex-date less than 0.6 of a gap after the last is a special one");
  eq(o({ cadence: "irregular", gapDays: 40 }).g, 91, "with no regular cadence the gap is a quarter");
  eq(dividendOutlook({ x: null, expiry: "2026-11-06", today: "2026-10-26", ageDays: 1 }).state, "unknown", "no calendar is unknown");
  eq(dividendOutlook({ x: X, expiry: "2026-11-06", today: "2026-10-26", ageDays: null }).state, "unknown", "and so is one with no age");
  eq([o({}, { ageDays: 3 }).fresh, o({}, { ageDays: 3.1 }).fresh], [true, false], "a read is fresh for three days");
  eq(etDayOf(Date.parse("2025-03-11T02:00:00+03:00")), "2025-03-10", "the window is dated in New York: 02:00 TRT is the evening of the 10th");
  eq(dividendOutlook({ x: { ...X, declared: [{ ex: "2025-03-11" }] }, expiry: "2025-03-14", today: etDayOf(Date.parse("2025-03-11T02:00:00+03:00")), ageDays: 1 }).state, "declared", "so an ex-date of the 11th is still ahead at that hour");
  eq(dividendOutlook({ x: { ...X, declared: [{ ex: "2025-03-11" }] }, expiry: "2025-03-14", today: etDayOf(Date.parse("2025-03-11T17:00:00+03:00")), ageDays: 1 }).state, "none-known", "and gone at 17:00 TRT");
  eq(partState({ at: 0, rv: 1, x: X }, "dividends", 3 * 86400000), "fresh", "the stored part is fresh for three days");
  eq(partState({ at: 0, rv: 1, x: X }, "dividends", 5 * 86400000), "stale", "stale until seven");
  eq(partState({ at: 0, rv: 1, x: X }, "dividends", 9 * 86400000), "expired", "and then no calendar");
}

{
  const L = FWD_LINES;
  const ex = { state: "declared", n: 1, g: 91, irregular: false, fresh: true, tEx: 0.5 / 365, tau2: 0.5 / 365 };
  const c = carryOf({ S: 100, r: 0.05, T: 1 / 365, q: 0.013, ex });
  near(c.F, 99.6895, 1e-3, "one day, a 1.3 per cent payer, ex-date declared: the forward drops by the expected dividend");
  near(c.se / c.F * 1e4, 8.3, 0.1, "with 8.3 basis points of error, a quarter of the dividend on top of spot, rate and borrow");
  eq(c.discrete, true, "in the discrete mode");
  near(dividendFraction({ q: 0.013, ex }), 0.013 * 91 / 365, 1e-12, "the expected dividend is the yield over a gap");
  eq(dividendFraction({ q: null, ex }), L.DHAT_UNKNOWN, "or 0.4 per cent when no yield is known");
  const plain = carryOf({ S: 100, r: 0.05, T: 1 / 365, q: 0.013 });
  near(plain.F, 100 * Math.exp((0.05 - 0.013) / 365), 1e-9, "without a calendar the continuous carry stands");
  eq(plain.discrete, false, "and says so");
  const far = carryOf({ S: 100, r: 0.05, T: 120 / 365, q: 0.013, ex });
  eq(far.discrete, false, "an expiry beyond a gap keeps the continuous yield, so the two agree where they meet");
  const sp = carryOf({ S: 100, r: 0.05, T: 1 / 365, q: 0.013, ex: { ...ex, irregular: true } });
  eq(sp.discrete, false, "a special dividend is not shifted");
  near(sp.se / sp.F, Math.sqrt(L.SPOT_SE ** 2 + (L.RATE_SE / 365) ** 2 + (L.BORROW_SE / 365) ** 2 + (L.DIV_SHARE * Math.abs(Math.exp(0.05 / 365) - Math.exp((0.05 - 0.013) / 365))) ** 2 + L.SPECIAL_SE ** 2), 1e-12, "but its error carries two per cent of the price");
  const exp = carryOf({ S: 100, r: 0.05, T: 1 / 365, q: 0.013, ex: { ...ex, state: "expected" } });
  eq(exp.discrete, true, "an expected dividend is shifted too");
  near(exp.se / exp.F, Math.sqrt(L.SPOT_SE ** 2 + (L.RATE_SE / 365) ** 2 + (L.BORROW_SE / 365) ** 2 + (L.EXPECT_SHARE * dividendFraction({ q: 0.013, ex })) ** 2), 1e-12, "half a dividend");
  eq(carryOf({ S: 100, r: 0.05, T: 1 / 365, q: null, ex }).se > c.se, true, "an unknown yield widens it to the whole expected dividend");
  near(exerciseStrike({ S: 100, D: 0.486, sigma: 0.30, r: 0.05, tau: 3 / 8760 }), 99.926, 0.01, "at three hours to expiry the exercise strike is just under the money");
  ok(exerciseStrike({ S: 100, D: 0.486, sigma: 0.30, r: 0.05, tau: 3 / 8760 }) > 99 && exerciseStrike({ S: 100, D: 0.486, sigma: 0.30, r: 0.05, tau: 3 / 8760 }) < 100, "99 is flagged and 100 is not");
  eq(exerciseStrike({ S: 100, D: 0, sigma: 0.3, r: 0.05, tau: 0.01 }), null, "no dividend, no exercise");
  eq(exerciseStrike({ S: 100, D: 0.5, sigma: 0.3, r: 0.05, tau: 0 }), null, "no time after the ex-date, no exercise strike");
  const k1 = exerciseStrike({ S: 100, D: 0.5, sigma: 0.3, r: 0.05, tau: 5 / 365 });
  const k2 = exerciseStrike({ S: 100, D: 1.0, sigma: 0.3, r: 0.05, tau: 5 / 365 });
  ok(k2 > k1, "a larger dividend reaches higher strikes");
  const f = exFrame(dividendOutlook({ x: X, expiry: "2026-11-06", today: "2026-10-26", ageDays: 1 }), { readMs: Date.parse("2026-10-26T16:30:00Z"), expiryMs: Date.parse("2026-11-06T21:00:00Z") });
  ok(f.tEx > 9 / 365 && f.tEx < 10 / 365 && f.tau2 > 1.2 / 365 && f.tau2 < 1.3 / 365, "the ex-date's open splits the time into before and after");
  eq(exFrame(null, { readMs: 1, expiryMs: 2 }), null, "no outlook, no frame");
}

{
  const L = FWD_LINES;
  const band = (over) => deltaBand({ F: 100, se: 0.01, K: 100, sigma: 0.3, T: 1 / 365, held: "C", ...over });
  eq(band({}).band, "plain", "a tight forward prints a plain delta");
  const capped = band({ capPm: true });
  eq([capped.band, capped.half, capped.reason], ["pm", L.CAP_PM_FLOOR, "capped"], "a carry-only chain under two days prints at least plus or minus three hundredths");
  const wide = band({ se: 0.1, capPm: true });
  ok(wide.band === "pm" && wide.half > L.CAP_PM_FLOOR && wide.reason === null, "a wider band keeps its own half");
  eq(band({ se: 3, capPm: true }).band, "dash", "and a very wide one is a dash as before");
  eq(band({ exercise: true }).reason, "exercise", "a call an exercise can reach prints no delta");
  eq(band({ exercise: true, veto: true }).reason, "exercise", "whatever the forward says");
  const rows = [{ K: 98, cb: 3.05, ca: 3.15, pb: 1.1, pa: 1.2 }, { K: 99, cb: 2.45, ca: 2.55, pb: 1.5, pa: 1.6 }, { K: 100, cb: 1.9, ca: 2.0, pb: 1.95, pa: 2.05 }, { K: 101, cb: 1.45, ca: 1.55, pb: 2.5, pa: 2.6 }, { K: 102, cb: 1.05, ca: 1.15, pb: 3.1, pa: 3.2 }];
  const base = { quotes: rows.slice(1, 3), S: 100, r: 0.04, T: 1 / 365, q: 0.013 };
  const none = chooseForward(base);
  const fresh = chooseForward({ ...base, ex: { state: "none-known", n: 0, g: 91, fresh: true } });
  const stale = chooseForward({ ...base, ex: { state: "none-known", n: 0, g: 91, fresh: false } });
  eq([none.cap, fresh.cap, stale.cap], [true, false, true], "the cap holds under two days unless a fresh calendar rules a dividend out");
  eq(chooseForward({ ...base, T: 3 / 365 }).cap, false, "and not beyond");
  const pair5 = chooseForward({ ...base, quotes: rows, ex: null });
  ok(pair5.n >= 3 && pair5.cap === false, "a chain with three pairs is never capped");
  const declared = chooseForward({ ...base, ex: { state: "declared", n: 1, g: 91, irregular: false, fresh: true, tEx: 0.5 / 365, tau2: 0.5 / 365 } });
  eq([declared.discrete, declared.exState, Number.isFinite(declared.exK), Number.isFinite(declared.exKSoft)], [true, "declared", true, true], "a declared dividend moves the carry and sets the exercise strikes");
  ok(declared.exKSoft >= declared.exK, "the soft strike is not under the hard one");
  ok(declared.Fc < none.Fc, "the carry forward drops by the dividend");
  eq(chooseForward({ ...base, ex: null }).exState, "none", "no calendar says none");
}

{
  const size = SC_PAGE_SIZE;
  const mk = (expiry, type, K, oi) => ({ option_symbol: "ZQZA" + expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10) + type + String(K * 1000).padStart(8, "0"), open_interest: String(oi), nbbo_bid: "1.00", nbbo_ask: "1.10" });
  const expiry = (e, oi, n = 20, zeroEvery = 0) => Array.from({ length: n }, (_, i) => mk(e, i % 2 ? "P" : "C", 40 + i, zeroEvery && i % zeroEvery === 0 ? 0 : oi));
  const live = [...expiry("2026-11-06", 300), ...expiry("2026-11-13", 300), ...expiry("2026-11-20", 300)];
  const rows200 = (extra = []) => [...live, ...extra, ...Array.from({ length: 200 }, (_, i) => mk("2026-12-18", i % 2 ? "P" : "C", 20 + (i % 60), 400))];
  const c1 = vendorCheck(rows200(), { spot: 50 });
  eq([c1.honoured, c1.zeroOi, c1.order], [true, 0, "asc"], "no zero-open-interest row in two hundred or more is the filter honoured");
  const c2 = vendorCheck([...expiry("2026-11-06", 300, 20, 5), ...expiry("2026-11-13", 300)], { spot: 50 });
  eq([c2.honoured, c2.zeroOi > 0, c2.zeroExpiries], [null, true, 0], "zero-open-interest rows inside a live expiry do not say the filter was ignored");
  const c3 = vendorCheck([...expiry("2026-11-06", 300), ...expiry("2026-11-13", 0)], { spot: 50 });
  eq([c3.honoured, c3.zeroExpiries], [false, 1], "a fully read expiry with no open interest anywhere, strikes on both sides of the price, is");
  const c4 = vendorCheck([...expiry("2026-11-06", 300), ...expiry("2026-11-13", 0)], { spot: 50, truncated: true });
  eq([c4.honoured, c4.partial], [null, "2026-11-13"], "a last, partly read expiry with none is not");
  const c5 = vendorCheck([...expiry("2026-11-06", 300), ...expiry("2026-11-13", 0, 8)], { spot: 44 });
  eq(c5.honoured, null, "nor is an expiry of under ten rows");
  const c6 = vendorCheck([...expiry("2026-11-06", 0), ...expiry("2026-11-13", 300)], { spot: 500 });
  eq(c6.zeroExpiries, 0, "nor one whose strikes are all on one side of the price");
  const asc = vendorCheck(live, { truncated: true });
  eq([asc.order, asc.unseen, asc.partial], ["asc", "after", "2026-11-20"], "ascending order truncated: the later expiries are the unread ones");
  const desc = vendorCheck([...expiry("2026-11-20", 300), ...expiry("2026-11-13", 300), ...expiry("2026-11-06", 300)], { truncated: true });
  eq([desc.order, desc.unseen, desc.partial], ["desc", "before", "2026-11-06"], "descending: the near expiries, which matter most, are the unread ones");
  const byStrike = [];
  for (let k = 40; k < 60; k++) for (const e of ["2026-11-06", "2026-11-13", "2026-11-20"]) byStrike.push(mk(e, "C", k, 300));
  const bs = vendorCheck(byStrike, { truncated: true });
  eq([bs.order, bs.unseen, bs.aboveStrike], ["strike", "strikes-above", 59], "strike order: the high strikes of every expiry are the unread ones");
  const mixed = vendorCheck([...expiry("2026-11-13", 300, 5), ...expiry("2026-11-06", 300, 5), ...expiry("2026-11-20", 300, 5), ...expiry("2026-11-06", 300, 5).reverse()], { truncated: true });
  eq([mixed.order, mixed.unseen], ["mixed", "unknown"], "any other order leaves what is missing unknown");
  eq(vendorCheck([...live, live[0]], {}).dups, 1, "a symbol seen twice is a shifted page");
  eq(vendorCheck(live, { failed: 1 }).holes, 1, "a failed middle page is a hole");
  eq(vendorCheck(live, { spot: 50 }).expiries, 3, "expiries are counted");
  eq(vendorCheck([{ option_symbol: "garbage" }, null, undefined], {}).rows, 0, "unreadable rows are not counted");
  eq(vendorAnomalies(c3), ["zero-oi-filter-ignored"], "the ignored filter is an anomaly");
  eq(vendorAnomalies(mixed).includes("order-mixed"), true, "and so is an order we cannot name");
  eq(vendorAnomalies(null), [], "nothing, nothing");
  const fullPages = async (pages, last) => {
    const got = await gatherPages({
      first: Array.from({ length: size }, () => ({})), maxPages: pages, size,
      page: async (n) => Array.from({ length: n < pages ? size : last }, () => ({})), unwrap: (x) => x, refused: () => false,
    });
    return got;
  };
  const exact = await fullPages(3, size);
  eq([exact.pages, exact.truncated, exact.failed], [3, true, 0], "a read that ends on a full page at its ceiling is truncated: there may be more");
  const short = await fullPages(3, size - 1);
  eq(short.truncated, false, "one that ends on a short page is not");
  const failedPage = await gatherPages({ first: Array.from({ length: size }, () => ({})), maxPages: 5, size, page: async (n) => { if (n === 3) throw new Error("x"); return Array.from({ length: size }, () => ({})); }, unwrap: (x) => x, refused: () => false });
  eq(failedPage.failed, 1, "a failed page is counted");
  const mutants = [
    ["any zero-open-interest row says the filter was ignored", [["if (zeroExpiries > 0) honoured = false;", "if (zeroOi > 0) honoured = false;"]]],
    ["the partly read expiry counts", [["if (expiry === boundary || g.n < VENDOR_MIN_EXPIRY_ROWS", "if (g.n < VENDOR_MIN_EXPIRY_ROWS"]]],
    ["descending order is read as ascending", [["order = up ? \"asc\" : down ? \"desc\" : \"mixed\";", "order = up || down ? \"asc\" : \"mixed\";"]]],
    ["a thin expiry counts", [["g.n < VENDOR_MIN_EXPIRY_ROWS", "g.n < 1"]]],
    ["a short sample is called honoured", [["parsed >= VENDOR_MIN_ROWS_FOR_ROW_LEVEL && zeroOi === 0", "zeroOi === 0"]]],
    ["strike order is called mixed", [["order = rising >= 0.95 * (sequence.length - 1) ? \"strike\" : \"mixed\";", "order = \"mixed\";"]]],
  ];
  const probe = (mod) => JSON.stringify([mod.vendorCheck([...expiry("2026-11-06", 300, 20, 5), ...expiry("2026-11-13", 300)], { spot: 50 }), mod.vendorCheck([...expiry("2026-11-06", 300), ...expiry("2026-11-13", 0)], { spot: 50, truncated: true }),
    mod.vendorCheck([...expiry("2026-11-20", 300), ...expiry("2026-11-13", 300), ...expiry("2026-11-06", 300)], { truncated: true }), mod.vendorCheck(live.slice(0, 30), { spot: 50 }), mod.vendorCheck(byStrike, { truncated: true }),
    mod.vendorCheck([...expiry("2026-11-06", 300), ...expiry("2026-11-13", 0, 8)], { spot: 44 })]);
  const want = probe({ vendorCheck });
  for (const [name, transforms] of mutants) {
    const mod = await loadMutated("server/desk-sc.js", transforms, { salt: ++salt });
    ok(probe(mod) !== want, `planted wrong build must fail the vendor battery: ${name}`);
  }
}

{
  const m = (o) => shortCallCollateral({ convention: "delta", spot: 100, strike: 105, haircut: 0.3, floor: 0.1, ...o });
  eq(SC_DELTA_FLOOR, 0.05, "the stated delta floor is five hundredths");
  eq(m({ delta: 0.02 }).m1C, 100000, "a delta of 0.02 is held at the 10 per cent floor: 1,000 a contract");
  eq(m({ delta: 1 / 3 }).m1C, 100000, "a third is where the haircut meets the floor");
  eq(m({ delta: 0.5 }).m1C, 150000, "half is 1,500");
  eq(m({ delta: 0.01, floor: 0 }).m1C, 15000, "with no floor a delta of 0.01 is read as 0.05: 150");
  eq(m({ delta: 0.01, floor: 0 }).binding, "delta", "and the delta binds");
  eq(m({ delta: 0.02 }).binding, "floor", "at the default terms the floor binds first");
  eq(m({ delta: null }).why, "no-delta", "no delta is a named reason, never a guess");
}

{
  const pages = readFileSync(new URL("../shared/flows-pages.js", import.meta.url), "utf8");
  const rows = new Map();
  for (const mm of pages.matchAll(/<p data-k="([a-z0-9.-]+)">([^<]*)<\/p>/g)) if (!rows.has(mm[1])) rows.set(mm[1], mm[2]);
  const keys = ["t-pp", "t-ev", "ev-measure", "ev-implied", "ev-market", "law-none", "law-card", "nrf", "c-edge.small", "c-edge.none", "c-edge.sign-flips", "c-model.none", "c-event.q-equals-p", "band-cap", "band-exercise", "band-pm", "band-dash", "band-veto", "sc-cut-after", "sc-cut-before", "sc-cut-strikes-above", "sc-cut-unknown", "sc-cut-filter"];
  const banned = /\b(will|should|likely|unlikely|forecast\w*|predict\w*|expect\w*|outlook|recommend\w*|advi[cs]e\w*|opportunit\w*|attractive|edge|real-world|real world|tape)\b/i;
  for (const k of keys) {
    ok(rows.has(k), `the desk copy row ${k} exists`);
    const text = rows.get(k).replace(/&#39;/g, "'");
    if (k === "c-edge.small" || k === "c-edge.none" || k === "c-edge.sign-flips") continue;
    const stripped = text.replace(/Not a forecast\./g, "").replace(/\bexpected (profit|value)\b/gi, "EV");
    ok(!banned.test(stripped), `${k} uses no forecast, advice or retired word: ${stripped}`);
  }
  ok(/model vol|volatility model/.test(rows.get("t-ev")) && !/real-world/.test(rows.get("t-ev")), "EV is described by its model");
  ok(/risk premium/.test(rows.get("ev-market")) && /differ/.test(rows.get("ev-market")), "and the market sentence says why the two chances differ");
  for (const f of ["../assets/js/flows-desk.js", "../assets/js/flows-desk-calls.js"]) {
    const text = readFileSync(new URL(f, import.meta.url), "utf8");
    ok(!/real[- ]world/i.test(text), `${f} prints no real-world label`);
    ok(/EV \(model vol\)|Expected value \(model vol\)|EV model vol|model vol/.test(text), `${f} names the model`);
  }
}

const SYM = "SYA101";
const baseWorld = (ch) => chainWorld(ch).world;
const dbWith = (rows) => ({
  prepare(sql) {
    let bound = [];
    const st = {
      bind: (...a) => { bound = a; return st; },
      first: async () => (/FROM flows_payload WHERE id = \?/.test(sql) ? rows.get(bound[0]) || null : null),
      all: async () => ({ results: [] }),
      run: async () => ({ meta: {} }),
    };
    return st;
  },
  batch: async (list) => list.map(() => ({ results: [] })),
});
const stored = (payload) => ({ payload: JSON.stringify(payload), updated_at: 1, session: payload.sessionDate || null, read_iso: null });
const withCard = (ch, part) => {
  const rows = new Map();
  rows.set("card:" + ch.ticker, stored({ ticker: ch.ticker, sessionDate: ch.asOf, engine: { status: "split", key: "card-x:" + ch.ticker } }));
  const x = { sessionDate: ch.asOf, engine: { asOf: new Date(ch.readMs).toISOString(), facts: [{ id: "carry.implied", v: 0.015 }], rate: { r: 0.04, method: "given" }, expiries: [] } };
  if (part) x.vx = { dividends: part };
  rows.set("card-x:" + ch.ticker, stored(x));
  return dbWith(rows);
};

{
  const ch = makeChain(11, { rows: 3000, expiries: ["2026-10-27", "2026-10-30", "2026-11-06", "2026-11-20"], oiBase: 600 });
  const worker = (await import("../worker.js?decisions-desk=1")).default;
  const path = `/api/flows/chain?t=${ch.ticker}&strategy=sc&refresh=1`;
  const env = (db) => ({ UW_NOW: new Date(ch.readMs).toISOString(), DB: db });
  const part = (over = {}, at = ch.readMs - 86400000) => ({ at, rv: 1, x: { ...X, ...over } });
  const run = async (db) => {
    const { world } = chainWorld(ch);
    const out = await route(await freshWorker(), path, world, env(db));
    eq(out.res.status, 200, "the Short calls route answers");
    return out.body;
  };
  const freshWorker = async () => (await import(`../worker.js?decisions-desk=${++salt}`)).default;
  const byExpiry = (body) => new Map(body.fwd.map((f) => [f.expiry, f]));
  const noCal = byExpiry(await run(withCard(ch, null)));
  const cal = byExpiry(await run(withCard(ch, part())));
  const stale = byExpiry(await run(withCard(ch, part({}, ch.readMs - 5 * 86400000))));
  const expired = byExpiry(await run(withCard(ch, part({}, ch.readMs - 9 * 86400000))));
  ok(noCal.size >= 2, `the answer carries forward records (${noCal.size})`);
  for (const [e, rec] of noCal) eq([rec.exState, rec.discrete], ["none", false], `no stored calendar: ${e} says none and shifts nothing`);
  const decl = cal.get("2026-11-06");
  if (decl) {
    eq([decl.exState, decl.exDate, decl.discrete], ["declared", "2026-11-05", true], "a declared ex-date before the expiry moves the carry and is named");
    const plain = noCal.get("2026-11-06");
    const d = 0.015 * 91 / 365, T = decl.T;
    near(decl.Fc / plain.Fc - 1, Math.exp(0.015 * T) * (1 - d) - 1, 1e-4, "by the expected dividend less the continuous yield it replaces");
    ok(Number.isFinite(decl.exK) && decl.exKSoft >= decl.exK, "with its exercise strikes");
  }
  const day1 = cal.get("2026-10-27");
  if (day1) {
    eq([day1.exState, day1.cap], ["none-known", false], "an expiry a day out, with a fresh calendar that shows no dividend, is not capped");
    eq(noCal.get("2026-10-27").cap, true, "without one it is");
    eq(stale.get("2026-10-27").cap, true, "a five-day-old calendar cannot rule a dividend out");
    eq(expired.get("2026-10-27").exState, "none", "and a nine-day-old one is not used at all");
  }
  ok([...cal.values()].some((r) => r.exState === "declared"), "some expiry carries a declared ex-date");
}

{
  const ch = makeChain(12, { rows: 3000, expiries: ["2026-10-30", "2026-11-06", "2026-11-20"], oiBase: 600 });
  const zeroExpiry = { ...ch, rows: ch.rows.map((r) => (/ZQ|SYA10126/.test(r.option_symbol) && r.option_symbol.includes("261106") ? { ...r, open_interest: "0" } : r)) };
  const worker = (await import("../worker.js?decisions-desk=vendor")).default;
  const { world } = chainWorld(zeroExpiry);
  const out = await route(worker, `/api/flows/chain?t=${ch.ticker}&strategy=sc&refresh=1`, world, { UW_NOW: new Date(ch.readMs).toISOString() });
  eq(out.res.status, 200, "a chain whose live expiry has no open interest anywhere still answers");
  const v = out.body.cut.vendor;
  ok(v && v.honoured === false && v.zeroExpiries >= 1, "and the cut says the filter was ignored");
  const clean = chainWorld(ch);
  const ok2 = await route(await (async () => (await import("../worker.js?decisions-desk=vendor2")).default)(), `/api/flows/chain?t=${ch.ticker}&strategy=sc&refresh=1`, clean.world, { UW_NOW: new Date(ch.readMs).toISOString() });
  ok(ok2.body.cut.vendor && ok2.body.cut.vendor.honoured !== false, "while a clean chain does not");
  const cut = chainWorld(ch);
  const trunc = await route((await import("../worker.js?decisions-desk=vendor3")).default, `/api/flows/chain?t=${ch.ticker}&strategy=sc&refresh=1`, cut.world, { UW_NOW: new Date(ch.readMs).toISOString(), FLOWS_DESK_SC_PAGES: "1" });
  ok(trunc.body.cut.truncated === true && trunc.body.cut.vendor.unseen !== undefined && typeof trunc.body.cut.vendor.order === "string", "a read cut at its ceiling names what it did not see");
}

console.log(`decisions-desk: ${checks} checks`);
