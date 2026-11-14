import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const LEAF = "shared/flows-transport.js";
const VENDOR = "scripts/flows-nightly/vendor.mjs";
const STORE = "scripts/flows-nightly/store.mjs";
const FAST = [["export const PUBLISH_SPACING_MS = 400;", "export const PUBLISH_SPACING_MS = 1;"]];

const INGEST = "https://ingest.test/api/flows/ingest";
process.env.FLOWS_INGEST_URL = INGEST;
process.env.FLOWS_INGEST_TOKEN = "t";
delete process.env.FLOWS_WRITE_BATCH;
delete process.env.FLOWS_RECONCILE;

const realFetch = globalThis.fetch;
const quiet = { log: console.log, warn: console.warn };
const hush = () => { console.log = () => {}; console.warn = () => {}; };
const loud = () => { console.log = quiet.log; console.warn = quiet.warn; };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function instance(r) {
  const n = 2 + Math.floor(r() * 4);
  const classes = [];
  for (let i = 0; i < n; i++) classes.push({ id: "c" + i, rank: Math.floor(r() * 4), floor: Math.floor(r() * 120) });
  const line = Math.floor(r() * 900);
  const demand = {};
  for (const c of classes) {
    const u = r();
    demand[c.id] = u < 0.15 ? Infinity : u < 0.3 ? 0 : Math.floor(r() * 500);
  }
  return { line, classes, demand };
}

function bruteLex(line, classes, demand) {
  const order = classes.map((c, i) => ({ ...c, i })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  const cap = (c) => Math.min(demand[c.id] === Infinity ? line : demand[c.id], line);
  let left = line;
  const grant = {};
  for (const c of order) {
    const g = Math.min(cap(c), c.floor, left);
    grant[c.id] = g;
    left -= g;
  }
  const out = { ...grant };
  for (const c of order) {
    const more = Math.min(cap(c) - out[c.id], left);
    out[c.id] += more;
    left -= more;
  }
  return out;
}

const allocBattery = (T) => {
  const out = [];
  const t = (name, pass) => out.push([name, !!pass]);
  const base = T.allocate({ line: 500, demand: { member: 60, live: 40, nightly: Infinity } });
  t("a 500 line leaves the nightly 400 once members and the live layer hold their reserves", base.alloc.nightly === 400 && base.alloc.member === 60 && base.alloc.live === 40 && base.spare === 0);
  const idle = T.allocate({ line: 500, demand: { member: 10, live: 0, nightly: Infinity } });
  t("a reserve nobody asks for is not kept idle", idle.alloc.nightly === 490 && idle.alloc.member === 10 && idle.alloc.live === 0);
  const greedy = T.allocate({ line: 500, demand: { member: Infinity, live: 40, nightly: Infinity, background: Infinity } });
  t("a higher class with more to ask is served before a lower one", greedy.alloc.member === 460 && greedy.alloc.live === 40 && greedy.alloc.nightly === 0 && greedy.alloc.background === 0);
  const lowest = T.allocate({ line: 500, demand: { member: 20, live: 20, nightly: 100, background: Infinity } });
  t("the background class takes exactly what the others leave", lowest.alloc.background === 360 && lowest.spare === 0);
  const tight = T.allocate({ line: 80, demand: { member: 60, live: 40, nightly: 50 } });
  t("a line under the reserves serves them in rank order and says it fell short", tight.alloc.member === 60 && tight.alloc.live === 20 && tight.alloc.nightly === 0 && tight.short === true);
  t("the share helper gives the nightly 400 of 500 and 525 of 625", T.shareOf(500, "nightly") === 400 && T.shareOf(625, "nightly") === 525);
  t("and an unknown class nothing", T.shareOf(500, "nobody") === 0);
  t("a pace is its spacing in whole milliseconds, rounded up", T.paceOf(400).spacingMs === 150 && T.paceOf(525).spacingMs === 115 && T.paceOf(0).perMinute === 1);
  let dup = false;
  try { T.allocate({ line: 10, classes: [{ id: "a", rank: 0, floor: 0 }, { id: "a", rank: 1, floor: 0 }] }); } catch { dup = true; }
  t("two classes with one id are refused", dup);

  const r = rng(20261110);
  let feasible = true, floored = true, conserving = true, priority = true, monotone = true, truthful = true, fair = true, lex = true;
  for (let k = 0; k < 2000; k++) {
    const { line, classes, demand } = instance(r);
    const got = T.allocate({ line, demand, classes });
    const a = got.alloc;
    const want = (id) => demand[id];
    for (const c of classes) {
      if (!(Number.isInteger(a[c.id]) && a[c.id] >= 0 && a[c.id] <= want(c.id))) feasible = false;
    }
    if (sum(a) > line) feasible = false;
    const dueAll = classes.reduce((s, c) => s + Math.min(want(c.id), c.floor), 0);
    if (dueAll <= line) {
      for (const c of classes) if (a[c.id] < Math.min(want(c.id), c.floor)) floored = false;
      if (got.short) floored = false;
    } else if (!got.short) floored = false;
    const totalWant = classes.reduce((s, c) => s + want(c.id), 0);
    if (sum(a) !== Math.min(line, totalWant)) conserving = false;
    if (dueAll <= line) {
      for (const hi of classes) {
        if (a[hi.id] >= want(hi.id)) continue;
        for (const lo of classes) {
          if (lo.rank > hi.rank && a[lo.id] > Math.min(want(lo.id), lo.floor)) priority = false;
        }
      }
      for (const x of classes) {
        if (a[x.id] >= want(x.id)) continue;
        for (const y of classes) {
          if (y.rank !== x.rank || y.id === x.id) continue;
          const ex = a[x.id] - Math.min(want(x.id), x.floor);
          const ey = a[y.id] - Math.min(want(y.id), y.floor);
          if (ey > ex + 1) fair = false;
        }
      }
    }
    const who = classes[Math.floor(r() * classes.length)];
    const theta = want(who.id) === Infinity ? 400 : want(who.id);
    const truth = T.allocate({ line, demand: { ...demand, [who.id]: theta }, classes }).alloc[who.id];
    const more = T.allocate({ line, demand: { ...demand, [who.id]: theta + 1 + Math.floor(r() * 300) }, classes }).alloc[who.id];
    if (more < truth) monotone = false;
    for (const lie of [0, Math.floor(theta / 2), theta + 37, theta * 3 + 5, Infinity]) {
      const told = T.allocate({ line, demand: { ...demand, [who.id]: lie }, classes }).alloc[who.id];
      if (Math.min(told, theta) > Math.min(truth, theta)) truthful = false;
    }
    const ranks = new Set(classes.map((c) => c.rank));
    if (ranks.size === classes.length) {
      const brute = bruteLex(line, classes, demand);
      for (const c of classes) if (brute[c.id] !== a[c.id]) lex = false;
    }
  }
  t("no class is given more than it asked and the line is never exceeded", feasible);
  t("every class holds its reserve, up to what it asked", floored);
  t("nothing is left idle while a class still asks", conserving);
  t("a lower class gets more than its reserve only when every higher class is satisfied", priority);
  t("classes of one rank share the excess evenly", fair);
  t("asking for more never yields less", monotone);
  t("no class gains by misstating what it needs", truthful);
  t("the allocation is the lexicographic best by rank among the feasible ones", lex);
  return out;
};

const night = (over = {}) => ({ day: "2026-11-10", calls: 40000, refused: 4, slowed: 600, alloc: 400, peak: 390, ...over });

const lineBattery = (T) => {
  const out = [];
  const t = (name, pass) => out.push([name, !!pass]);
  const first = T.stepLine(null, night({ calls: 0, refused: 0, slowed: 0, peak: 0 }), { working: 500 });
  t("a first night with no evidence starts at the working line", first.verdict === "start" && first.next === 500 && first.state.perMinute === 500);
  const clean = T.stepLine(null, night(), { working: 500 });
  t("a clean night that used its share raises the line by a quarter", clean.verdict === "raise" && clean.next === 625 && clean.state.good === 500);
  const thin = T.stepLine(clean.state, night({ calls: 4999, refused: 0 }), { working: 500 });
  t("a night under the evidence count changes nothing", thin.verdict === "thin" && thin.next === 625);
  const idle = T.stepLine(null, night({ peak: 200 }), { working: 500 });
  t("a clean night that never ran near its share is no evidence", idle.verdict === "idle" && idle.next === 500 && idle.state.good === null);
  const unpaced = T.stepLine(null, night({ alloc: 0 }), { working: 500 });
  t("nor is a night that was not paced at all", unpaced.verdict === "idle" && unpaced.next === 500);
  const dirty = T.stepLine(null, night({ refused: 800 }), { working: 500 });
  t("two per cent refused cuts the line to seven tenths", dirty.verdict === "cut" && dirty.next === 350 && dirty.state.bad === 500 && dirty.state.avoid === true);
  const slowed = T.stepLine(null, night({ refused: 30, slowed: 10000 }), { working: 500 });
  t("a quarter of the calls issued while backed off is a cut too", slowed.verdict === "cut" && slowed.next === 350);
  const heldAt = { perMinute: 562, good: 500, bad: null, avoid: false, since: 3, history: [] };
  const two = T.stepLine(heldAt, night({ calls: 26579, refused: 2, slowed: 2392, alloc: 462, peak: 462 }), { working: 500 });
  t("two refusals do not ease the line, however long the pacer stayed backed off", two.verdict !== "ease" && two.verdict !== "cut" && two.next >= 562);
  const ten = T.stepLine(heldAt, night({ calls: 26579, refused: 10, slowed: 2392, alloc: 462, peak: 462 }), { working: 500 });
  t("ten refusals with the same slowed share do ease it", ten.verdict === "ease" && ten.next === 500);
  const wrong = { perMinute: 500, good: 500, bad: 562, avoid: true, since: 0, history: [{ d: "2026-11-13", l: 562, a: 462, c: 26579, r: 2, s: 2392, p: 462, v: "ease" }] };
  const mend = T.stepLine(wrong, night({ calls: 26000, refused: 0, slowed: 0, alloc: 400, peak: 400 }), { working: 500 });
  t("an ease recorded on under ten refusals is taken back on the next night", mend.verdict === "raise" && mend.next === 625);
  const edgeUnder = T.stepLine(null, night({ refused: 799 }), { working: 500 });
  t("just under two per cent is not a cut", edgeUnder.verdict !== "cut");
  const back = T.stepLine(clean.state, night({ refused: 900, alloc: 525, peak: 520 }), { working: 500 });
  t("a refused night above a line that held returns to that line", back.verdict === "cut" && back.used === 625 && back.next === 500 && back.state.bad === 625 && back.state.good === 500);
  const bisect = T.stepLine(back.state, night(), { working: 500 });
  t("the next clean night tries halfway between the line that held and the one that did not", bisect.verdict === "raise" && bisect.next === 562);
  const settled = T.stepLine(bisect.state, night({ alloc: 462, peak: 460 }), { working: 500 });
  t("once the two are within fifteen per cent the line holds", settled.verdict === "capped" && settled.next === 562 && settled.state.good === 562);
  let st = settled.state;
  let held = true;
  for (let i = 0; i < 11; i++) {
    const s = T.stepLine(st, night({ day: "2026-11-" + String(11 + i).padStart(2, "0"), alloc: 462, peak: 460 }), { working: 500 });
    if (s.next !== 562) held = false;
    st = s.state;
  }
  t("and keeps holding for the nights before a new probe", held);
  const probe = T.stepLine(st, night({ day: "2026-11-23", alloc: 462, peak: 460 }), { working: 500 });
  t("after fourteen clean nights it probes eight per cent higher", probe.verdict === "raise" && probe.next === 607);
  const eased = T.stepLine(probe.state, night({ day: "2026-11-24", refused: 300, alloc: 507, peak: 500 }), { working: 500 });
  t("a probe that draws some refusals goes back to the line that held", eased.verdict === "ease" && eased.next === 562 && eased.state.bad === 607);
  const middleNoGood = T.stepLine(null, night({ refused: 300 }), { working: 500 });
  t("some refusals with no lower line on record hold where they are", middleNoGood.verdict === "hold" && middleNoGood.next === 500);
  const top = T.stepLine({ v: 1, perMinute: 1400, good: 1400, bad: null, avoid: false, since: 3, history: [] }, night({ alloc: 1300, peak: 1290 }), { working: 500 });
  t("the line never passes its ceiling", top.next === 1500);
  const bottom = T.stepLine({ v: 1, perMinute: 300, good: null, bad: null, avoid: true, since: 0, history: [] }, night({ refused: 4000, alloc: 200, peak: 200 }), { working: 500 });
  t("nor falls under its floor", bottom.next === 250);
  let rows = null;
  for (let i = 0; i < 20; i++) rows = T.stepLine(rows ? rows.state : null, night({ day: "2026-10-" + String(i + 1).padStart(2, "0"), calls: 100 }), { working: 500 });
  t("the record keeps the last fourteen nights", rows.state.history.length === 14 && rows.state.history[13].d === "2026-10-20");
  const twice = T.stepLine(rows.state, night({ day: "2026-10-20", calls: 100 }), { working: 500 });
  t("and one row a night", twice.state.history.length === 14 && twice.state.history.filter((h) => h.d === "2026-10-20").length === 1);
  t("a stored line reads back as it was written", JSON.stringify(T.readLine({ line: probe.state })) === JSON.stringify(probe.state));
  t("a line of another version, out of range or malformed is not read",
    T.readLine({ line: { ...probe.state, v: 2 } }) === null && T.readLine({ line: { ...probe.state, perMinute: 5000 } }) === null &&
    T.readLine({ line: { ...probe.state, perMinute: 100 } }) === null && T.readLine({ line: "500" }) === null && T.readLine(null) === null && T.readLine({}) === null);
  t("and a history row that is not a night is dropped", T.readLine({ line: { ...probe.state, history: [{ d: "x" }, ...probe.state.history] } }).history.length === probe.state.history.length);
  t("with no line on record the working line is used, held to the range", T.lineOf(null, 500) === 500 && T.lineOf(null, 90) === 250 && T.lineOf(null, 9000) === 1500 && T.lineOf(null, null) === 500);

  const r = rng(7);
  let bounded = true, noBlindRaise = true;
  for (let k = 0; k < 400; k++) {
    let s = null;
    for (let i = 0; i < 40; i++) {
      const used = T.lineOf(s, 500);
      const alloc = T.shareOf(used, "nightly");
      const u = r();
      const n = u < 0.2 ? night({ calls: Math.floor(r() * 4000) })
        : u < 0.4 ? night({ alloc, peak: Math.floor(alloc * 0.5 * r()) })
          : u < 0.6 ? night({ alloc, peak: alloc, refused: 200 + Math.floor(r() * 500) })
            : u < 0.75 ? night({ alloc, peak: alloc, refused: 900 + Math.floor(r() * 3000) })
              : night({ alloc, peak: alloc, refused: Math.floor(r() * 60), slowed: Math.floor(r() * 3000) });
      n.day = "2026-" + String(1 + Math.floor(i / 28)).padStart(2, "0") + "-" + String(1 + (i % 28)).padStart(2, "0");
      const step = T.stepLine(s, n, { working: 500 });
      if (step.next < 250 || step.next > 1500) bounded = false;
      if (step.next > step.used && step.verdict !== "raise") noBlindRaise = false;
      if (step.next > step.used && (u < 0.4 || (u >= 0.4 && u < 0.75))) noBlindRaise = false;
      s = step.state;
    }
  }
  t("over random nights the line stays inside its range", bounded);
  t("and rises only on a clean night that used its share", noBlindRaise);

  let converges = true;
  const notes = [];
  for (const capacity of [330, 500, 900, 1380, 5000]) {
    let s = null;
    let dirtyNights = 0, lateDirty = 0, served = 0, lateNights = 0;
    for (let i = 0; i < 120; i++) {
      const used = T.lineOf(s, 500);
      const alloc = T.shareOf(used, "nightly");
      const over = alloc > capacity ? (alloc - capacity) / alloc : 0;
      const refused = over > 0 ? Math.round(40000 * over) : 3;
      const slow = over > 0 ? Math.min(40000, Math.round(40000 * Math.min(1, over * 12))) : 400;
      const step = T.stepLine(s, { day: "2027-" + String(1 + Math.floor(i / 28)).padStart(2, "0") + "-" + String(1 + (i % 28)).padStart(2, "0"), calls: 40000, refused, slowed: slow, alloc, peak: alloc }, { working: 500 });
      if (step.verdict === "cut" || step.verdict === "ease") { dirtyNights++; if (i >= 20) lateDirty++; }
      if (i >= 20) { lateNights++; served += Math.min(alloc, capacity); }
      s = step.state;
    }
    const best = Math.min(capacity, T.shareOf(1500, "nightly"));
    const use = served / lateNights / best;
    notes.push(`${capacity}: ${dirtyNights} refused night(s) of 120, ${lateDirty} after the first twenty, ${(use * 100).toFixed(0)}% of what the capacity allows`);
    if (lateDirty > 9 || use < 0.8) converges = false;
  }
  t("against a hidden capacity the line settles near it with few refused nights", converges);
  out.notes = notes;
  return out;
};

const leafReconcileBattery = (T) => {
  const out = [];
  const t = (name, pass) => out.push([name, !!pass]);
  t("live keys, the run record and dated archive keys are not reconciled",
    !T.reconcilable("live:strips") && !T.reconcilable("meta") && !T.reconcilable("board:long:2026-11-09") && !T.reconcilable("scores:2026-11-09") &&
    !T.reconcilable("ideas:2026-11-09:r2") && !T.reconcilable(""));
  t("a card, a board and a global are", T.reconcilable("card:NVDA") && T.reconcilable("board:long") && T.reconcilable("universe") && T.reconcilable("oracle-top"));
  const keys = [];
  for (let i = 0; i < 200; i++) keys.push("card:T" + String(i).padStart(3, "0"));
  const plan = T.reconcilePlan([...keys, "meta", "live:news", "card:T000", "scores:2026-11-09"]);
  t("the plan is the reconcilable keys once each, sorted, ninety a request", plan.keys.length === 200 && plan.chunks.length === 3 && plan.chunks[0].length === 90 && plan.chunks[2].length === 20 &&
    JSON.stringify(plan.keys) === JSON.stringify(keys.slice().sort()));
  t("the verdict says held when nothing differs", T.reconcileVerdict({ asked: 10, need: [] }).ok === true);
  t("repaired when what differed was written again", T.reconcileVerdict({ asked: 10, need: ["a"], resent: 1, still: [] }).ok === true && /written again/.test(T.reconcileVerdict({ asked: 10, need: ["a"], resent: 1, still: [] }).said));
  t("and names what still differs", T.reconcileVerdict({ asked: 10, need: ["a", "b"], resent: 2, still: ["b"] }).ok === false && /\bb\b/.test(T.reconcileVerdict({ asked: 10, need: ["a", "b"], resent: 2, still: ["b"] }).said));
  t("a check that could not run claims nothing", T.reconcileVerdict({ skipped: "the switch is off" }).ok === null && T.reconcileVerdict({ asked: 0 }).ok === null);
  return out;
};

const controllerBattery = (V) => {
  const out = [];
  const t = (name, pass) => out.push([name, !!pass]);
  let s = { delayMs: 150, floorMs: 150, baseMs: 150, streak: 0 };
  s = { ...s, ...V.stepRateController(s, "limited") };
  t("a refusal raises the floor by half and clears the clean count", s.floorMs === 225 && s.streak === 0);
  for (let i = 0; i < 599; i++) s = { ...s, ...V.stepRateController(s, "ok") };
  t("five hundred and ninety-nine clean calls leave it there", s.floorMs === 225 && s.streak === 599);
  s = { ...s, ...V.stepRateController(s, "ok") };
  t("the six hundredth eases it one step", s.floorMs === 180 && s.streak === 0);
  for (let i = 0; i < 600; i++) s = { ...s, ...V.stepRateController(s, "ok") };
  t("and the next six hundred bring it back to the pace, never under it", s.floorMs === 150);
  for (let i = 0; i < 2000; i++) s = { ...s, ...V.stepRateController(s, "ok") };
  t("where it stays", s.floorMs === 150 && s.delayMs === 150);
  let u = { delayMs: 150, floorMs: 150, baseMs: 150, streak: 0 };
  u = { ...u, ...V.stepRateController(u, "limited") };
  for (let i = 0; i < 400; i++) u = { ...u, ...V.stepRateController(u, "ok") };
  u = { ...u, ...V.stepRateController(u, "limited") };
  for (let i = 0; i < 400; i++) u = { ...u, ...V.stepRateController(u, "ok") };
  t("a second refusal starts the count again", u.floorMs === 337.5 && u.streak === 400);
  let e = { delayMs: 150, floorMs: 225, baseMs: 150, streak: 500 };
  e = { ...e, ...V.stepRateController(e, "error") };
  t("a failure that is not a refusal neither counts as clean nor clears the count", e.streak === 500 && e.floorMs === 225);
  let n = { delayMs: 150, floorMs: 225 };
  for (let i = 0; i < 5000; i++) n = { ...n, ...V.stepRateController(n, "ok") };
  t("with no pace set the floor never comes down", n.floorMs === 225);
  return out;
};

const VOLATILE = new Set(["generatedAt", "readAt", "screenerReadAt", "refreshedAt", "producer"]);
function canon(v, depth = 0, parent = null) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => canon(x, depth + 1, "[]")).join(",") + "]";
  const parts = [];
  for (const k of Object.keys(v).sort()) {
    if (depth === 0 && VOLATILE.has(k)) continue;
    if (depth === 1 && parent === "fresh" && k === "readAt") continue;
    parts.push(JSON.stringify(k) + ":" + canon(v[k], depth + 1, depth === 0 ? k : "."));
  }
  return "{" + parts.join(",") + "}";
}
const hashOf = (text) => createHash("sha256").update(canon(JSON.parse(text))).digest("hex");

function world({ lose = new Set(), loseOnce = new Set(), haveStatus = 200, haveShort = false, haveAlien = false } = {}) {
  const seen = { stored: new Map(), have: [], singles: [], batches: 0, lost: new Set(loseOnce) };
  const put = (key, text) => {
    if (lose.has(key)) return;
    if (seen.lost.has(key)) { seen.lost.delete(key); return; }
    seen.stored.set(key, hashOf(text));
  };
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    const op = u.searchParams.get("op");
    if (op === "batch") {
      seen.batches++;
      const items = JSON.parse(init.body).items;
      for (const i of items) put(i.key, i.payload);
      return Response.json({ ok: true, results: items.map((i) => ({ key: i.key, ok: true })) });
    }
    if (op === "have") {
      const items = JSON.parse(init.body).items;
      seen.have.push(items.map((i) => i.key));
      if (haveStatus !== 200) return new Response("{}", { status: haveStatus });
      const have = [], need = [];
      for (const i of items) (seen.stored.get(i.key) === i.chash ? have : need).push(i.key);
      if (haveShort && need.length) need.pop();
      if (haveAlien && have.length) have[0] = "card:NOPE";
      return Response.json({ ok: true, have, need });
    }
    const key = u.searchParams.get("key");
    seen.singles.push(key);
    put(key, init.body);
    return Response.json({ ok: true });
  };
  return seen;
}

let salt = 100;
const freshStore = (transforms = []) => loadMutated(STORE, [...FAST, ...transforms], { salt: salt++ });

const card = (i, extra = {}) => ({ ticker: "T" + i, sessionDate: "2026-11-09", generatedAt: "2026-11-10T00:00:0" + (i % 10) + "Z", v: 2, n: i, ...extra });

const storeBattery = async (load) => {
  const out = [];
  const t = (name, pass) => out.push([name, !!pass]);
  {
    const store = await load();
    const seen = world();
    const keys = Array.from({ length: 120 }, (_, i) => "card:T" + String(i).padStart(3, "0"));
    await Promise.all(keys.map((k, i) => store.publish(k, card(i))));
    await store.publish("board:long", { side: "long", sessionDate: "2026-11-09", rows: [{ t: "T001" }], fresh: { readAt: "2026-11-10T00:00:00Z", cadenceS: 60 } });
    await store.publish("scores:2026-11-09", { a: 1 });
    await store.publish("meta", { sessionDate: "2026-11-09", generatedAt: "2026-11-10T00:00:00Z", stages: [] });
    const r = await store.reconcile();
    t("a healthy run is held in full, by a hash the store computed its own way", r.ok === true && r.asked === 121 && r.need.length === 0 && r.requests === 2 && r.resent === 0);
    t("and no dated key, live key or run record is asked about", seen.have.flat().every((k) => k !== "meta" && !/\d{4}-\d{2}-\d{2}/.test(k)) && seen.have.flat().length === 121);
  }
  {
    const store = await load();
    const seen = world({ loseOnce: new Set(["card:T005", "card:T017"]) });
    const keys = Array.from({ length: 30 }, (_, i) => "card:T" + String(i).padStart(3, "0"));
    await Promise.all(keys.map((k, i) => store.publish(k, card(i))));
    const r = await store.reconcile();
    t("a write the store acknowledged and lost is found and written again", r.ok === true && r.need.slice().sort().join() === "card:T005,card:T017" && r.resent === 2 && r.still.length === 0 &&
      seen.singles.slice().sort().join() === "card:T005,card:T017" && seen.stored.has("card:T005") && seen.stored.has("card:T017"));
    t("and only the keys that differed are asked about again", seen.have.length === 2 && seen.have[1].slice().sort().join() === "card:T005,card:T017");
  }
  {
    const store = await load();
    world({ lose: new Set(["card:T003"]) });
    await Promise.all(["card:T001", "card:T002", "card:T003"].map((k, i) => store.publish(k, card(i))));
    const r = await store.reconcile();
    t("a key the store never keeps is reported, not claimed", r.ok === false && r.still.join() === "card:T003" && r.resent === 1 && /card:T003/.test(r.said));
  }
  {
    const store = await load();
    const seen = world();
    await store.publish("card:T001", card(1));
    await store.publish("card:T001", card(1, { generatedAt: "2026-11-10T09:09:09Z" }));
    const r = await store.reconcile();
    t("a payload that differs only in its stamps is the same content", r.ok === true && r.need.length === 0 && seen.have.flat().length === 1);
  }
  {
    const store = await load();
    world();
    await store.publish("card:T001", card(1));
    store.publishedStore["card:T001"].n = 999;
    const r = await store.reconcile();
    t("the hash is of what was sent, not of what the run holds afterwards", r.ok === true && r.need.length === 0);
  }
  {
    const store = await load();
    const seen = world({ haveStatus: 400 });
    await store.publish("card:T001", card(1));
    const r = await store.reconcile();
    t("a store that does not answer the check is not read as agreement", r.ok === null && /HTTP 400/.test(r.said) && r.asked === 0 && seen.singles.length === 0);
  }
  {
    const store = await load();
    world({ lose: new Set(["card:T002"]), haveShort: true });
    await Promise.all(["card:T001", "card:T002"].map((k, i) => store.publish(k, card(i))));
    const r = await store.reconcile();
    t("an answer that does not account for every key is not believed", r.ok === null && r.resent === 0);
  }
  {
    const store = await load();
    world({ haveAlien: true });
    await store.publish("card:T001", card(1));
    const r = await store.reconcile();
    t("nor one that names a key that was not asked", r.ok === null);
  }
  {
    const store = await load();
    const seen = world();
    process.env.FLOWS_RECONCILE = "off";
    await store.publish("card:T001", card(1));
    const r = await store.reconcile();
    delete process.env.FLOWS_RECONCILE;
    t("the switch off asks nothing", r.ok === null && seen.have.length === 0 && /switch/.test(r.said));
  }
  {
    const store = await load();
    const seen = world({ lose: new Set(Array.from({ length: 130 }, (_, i) => "card:T" + String(i).padStart(3, "0"))) });
    const keys = Array.from({ length: 130 }, (_, i) => "card:T" + String(i).padStart(3, "0"));
    await Promise.all(keys.map((k, i) => store.publish(k, card(i))));
    const r = await store.reconcile();
    t("past the resend limit nothing is written again and every key is named as differing", r.ok === false && r.resent === 0 && r.still.length === 130 && seen.singles.length === 0);
  }
  return out;
};

const failed = (rows) => rows.filter(([, pass]) => !pass).map(([name]) => name);

hush();
const T = await import("../" + LEAF);
const V = await import("../" + VENDOR);

const alloc = allocBattery(T);
const line = lineBattery(T);
const leafRec = leafReconcileBattery(T);
const ctl = controllerBattery(V);
const rec = await storeBattery(() => freshStore());
loud();

for (const rows of [alloc, line, leafRec, ctl, rec]) for (const [name, pass] of rows) ok(pass, name);
for (const n of line.notes) console.log("  hidden capacity " + n);

const leafMutants = [
  ["reserves ignored", [["const due = Math.min(asked(c.id), c.floor);", "const due = 0;"]], allocBattery, "every class holds its reserve, up to what it asked"],
  ["the lowest class served first", [[".sort((a, b) => a.rank - b.rank || a.i - b.i);", ".sort((a, b) => b.rank - a.rank || a.i - b.i);"]], allocBattery, "a higher class with more to ask is served before a lower one"],
  ["only the first rank shares the excess", [["for (let k = 0; k < list.length && left > 0;) {", "for (let k = 0; k < 1 && left > 0;) {"]], allocBattery, "nothing is left idle while a class still asks"],
  ["a class given more than it asked", [["const got = Math.min(asked(c.id) - alloc[c.id], share);", "const got = share;"]], allocBattery, "no class is given more than it asked and the line is never exceeded"],
  ["the share helper lets a higher class take everything", [["demand[c.id] = c.id === id ? Infinity : c.rank <= rank ? whole(c.floor) : 0;", "demand[c.id] = c.rank <= rank ? Infinity : 0;"]], allocBattery, "the share helper gives the nightly 400 of 500 and 525 of 625"],
  ["a thin night raises the line", [["if (calls < cfg.evidenceCalls) {", "if (calls < 0) {"]], lineBattery, "a night under the evidence count changes nothing"],
  ["an idle night raises the line", [["if (!(alloc > 0) || peak < cfg.evidenceUse * alloc) {", "if (false) {"]], lineBattery, "a clean night that never ran near its share is no evidence"],
  ["a refused night is not cut", [["} else if (share >= cfg.dirty || (slowCounts && slow >= cfg.slowDirty)) {", "} else if (false) {"]], lineBattery, "two per cent refused cuts the line to seven tenths"],
  ["calls issued while backed off are ignored", [["share >= cfg.dirty || (slowCounts && slow >= cfg.slowDirty)", "share >= cfg.dirty"]], lineBattery, "a quarter of the calls issued while backed off is a cut too"],
  ["the ceiling is not applied", [["next = Math.min(cfg.max, Math.max(used, target));", "next = Math.max(used, target);"]], lineBattery, "the line never passes its ceiling"],
  ["the floor is not applied", [["next = Math.max(cfg.min, Math.floor(used * cfg.cut));", "next = Math.floor(used * cfg.cut);"]], lineBattery, "nor falls under its floor"],
  ["after a cut the line still jumps by a quarter", [["if (!avoid) {", "if (true) {"]], lineBattery, "the next clean night tries halfway between the line that held and the one that did not"],
  ["a cut forgets the line that held", [["if (good !== null && good < used) {\n      next = good;\n    } else {", "if (false) {\n      next = good;\n    } else {"]], lineBattery, "a refused night above a line that held returns to that line"],
  ["the slowed share eases on any refusal count", [["const slowCounts = refused >= cfg.slowRefusals;", "const slowCounts = true;"]], lineBattery, "two refusals do not ease the line, however long the pacer stayed backed off"],
  ["a mistaken ease is never taken back", [["    bad = null;\n    avoid = false;\n  }\n  let next = used;", "  }\n  let next = used;"]], lineBattery, "an ease recorded on under ten refusals is taken back on the next night"],
  ["some refusals are read as clean", [["} else if (share > cfg.clean || (slowCounts && slow > cfg.slowClean)) {", "} else if (false) {"]], lineBattery, "a probe that draws some refusals goes back to the line that held"],
  ["the record is never trimmed", [["history: history.slice(-cfg.history) },", "history },"]], lineBattery, "the record keeps the last fourteen nights"],
  ["a stored line of any version is read", [["|| s.v !== TRANSPORT.v) return null;", ") return null;"]], lineBattery, "a line of another version, out of range or malformed is not read"],
  ["dated keys are reconciled", [["return !DATED_RE.test(k);", "return true;"]], leafReconcileBattery, "live keys, the run record and dated archive keys are not reconciled"],
  ["the run record is reconciled", [["|| k === \"meta\") return false;", ") return false;"]], leafReconcileBattery, "live keys, the run record and dated archive keys are not reconciled"],
  ["a repaired run is reported as failed", [["if (!still.length) {", "if (false) {"]], leafReconcileBattery, "repaired when what differed was written again"],
];

const vendorMutants = [
  ["the floor eases under the pace", [["const eased = Math.max(baseMs, floorMs / recoverX);", "const eased = floorMs / recoverX;"]], "and the next six hundred bring it back to the pace, never under it"],
  ["a refusal keeps the clean count", [["maxDelayMs), streak: 0 };", "maxDelayMs), streak };"]], "a second refusal starts the count again"],
  ["the floor eases at once", [["clean >= recoverAfter", "clean >= 1"]], "five hundred and ninety-nine clean calls leave it there"],
  ["a failure counts as a clean call", [["Math.min(delayMs * 2, ceiling)), streak };", "Math.min(delayMs * 2, ceiling)), streak: streak + 1 };"]], "a failure that is not a refusal neither counts as clean nor clears the count"],
];

const storeMutants = [
  ["what differs is never written again", [["      await send(key, publishedStore[key]);\n      out.resent++;", "      out.resent++;"]], "a write the store acknowledged and lost is found and written again"],
  ["a short answer is believed", [["if (!have || !need || have.length + need.length !== pairs.length) return { status: response.status, need: null };", "if (!have || !need) return { status: response.status, need: null };"]], "an answer that does not account for every key is not believed"],
  ["an answer naming another key is believed", [["if (![...have, ...need].every((k) => asked.has(k))) return { status: response.status, need: null };", ""]], "nor one that names a key that was not asked"],
  ["the second check is skipped", [["out.still = second.failed ? first.need : second.need;", "out.still = [];"]], "a key the store never keeps is reported, not claimed"],
  ["the switch is ignored", [["if (String(env[RECONCILE.switchEnv] ?? \"\").trim().toLowerCase() === \"off\") return \"the switch is off\";", ""]], "the switch off asks nothing"],
  ["a refused check is read as agreement", [["if (first.failed) { out.skipped = first.failed; return done(); }", "if (first.failed) { out.asked = keys.length; return done(); }"]], "a store that does not answer the check is not read as agreement"],
  ["the hash is taken from the run's copy at the end", [["  landedHashes.set(key, sha256Hex(seen.canonical).catch(() => null));", "  landedHashes.set(key, Promise.resolve().then(() => new Promise((r) => setTimeout(r, 30))).then(() => sha256Hex(inspect(key, JSON.stringify(publishedStore[key])).canonical)));"]], "the hash is of what was sent, not of what the run holds afterwards"],
  ["the resend limit is ignored", [["if (first.need.length > RECONCILE.resendMax) { out.still = first.need; return done(); }", ""]], "past the resend limit nothing is written again and every key is named as differing"],
  ["stamps are part of the content", [["const seen = inspect(key, body);\n  if (!seen.ok) { landedHashes.delete(key); return; }\n  landedHashes.set(key, sha256Hex(seen.canonical).catch(() => null));", "landedHashes.set(key, sha256Hex(body).catch(() => null));"]], "a healthy run is held in full, by a hash the store computed its own way"],
];

hush();
let killed = 0;
const survivors = [];
for (const [title, transforms, battery, must] of leafMutants) {
  const mod = await loadMutated(LEAF, transforms, { salt: salt++ });
  let bad;
  try { bad = failed(battery(mod)); } catch (error) { bad = ["threw: " + error.message]; }
  if (bad.includes(must)) killed++; else survivors.push(`${title} (failed: ${bad.join("; ") || "nothing"})`);
}
for (const [title, transforms, must] of vendorMutants) {
  const mod = await loadMutated(VENDOR, transforms, { salt: salt++ });
  let bad;
  try { bad = failed(controllerBattery(mod)); } catch (error) { bad = ["threw: " + error.message]; }
  if (bad.includes(must)) killed++; else survivors.push(`${title} (failed: ${bad.join("; ") || "nothing"})`);
}
for (const [title, transforms, must] of storeMutants) {
  let bad;
  try { bad = failed(await storeBattery(() => freshStore(transforms))); } catch (error) { bad = ["threw: " + error.message]; }
  if (bad.includes(must)) killed++; else survivors.push(`${title} (failed: ${bad.join("; ") || "nothing"})`);
}
loud();
globalThis.fetch = realFetch;

const planted = leafMutants.length + vendorMutants.length + storeMutants.length;
eq(survivors, [], "every planted wrong build fails the check written for it");
ok(killed === planted, `${planted} planted wrong builds, each failed by its own check`);

console.log(`✓ flows-transport: ${checks} assertions, ${planted} planted wrong builds`);
