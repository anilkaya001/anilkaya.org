import { tickers, world } from "./world.mjs";

const SESSION = "2026-08-24";
const PRIOR = "2026-08-21";

const WANTS = Object.freeze({
  board: ["card", "card-x", "hist"], focus: ["card", "card-x", "hist"], cross: ["card", "card-x", "hist"], index: ["card", "card-x"], fund: ["card", "card-x"], screen: [],
});

const DEPTHS = [[15, "board"], [5, "focus"], [20, "cross"], [3, "index"], [2, "fund"], [55, "screen"]];

const CODE = Object.freeze({ ok: 0, failed: 2, unfetched: 3, stale: 4, pending: 5 });
const SEVERITY = Object.freeze({ 2: 0, 4: 1 });

const freeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) freeze(v[k]);
  }
  return v;
};

export function oracleState(entry, expected, truncated, listed) {
  if (!listed) return CODE.pending;
  if (!entry || entry.present === false) return truncated ? CODE.pending : CODE.failed;
  const session = typeof entry.sessionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.sessionDate) ? entry.sessionDate : null;
  if (session === null) return CODE.failed;
  if (expected === null) return CODE.pending;
  return session < expected ? CODE.stale : CODE.ok;
}

export function planWorld(w) {
  const names = tickers(w, 24 + w.int(40)).map((t, i) => t + String(i));
  const depthOf = new Map(names.map((t) => [t, w.weighted(DEPTHS.map(([n, d]) => [n, d]))]));
  const noisy = w.chance(0.45);
  const crash = noisy && w.chance(0.3) ? w.int(names.length * 3) : null;
  const keys = {};
  const wanted = [];
  for (const t of names) for (const kind of WANTS[depthOf.get(t)]) wanted.push(`${kind}:${t}`);
  const fresh = () => ({ present: true, sessionDate: SESSION, generatedAt: SESSION + "T22:00:00Z", updatedAt: 2 });
  const old = () => ({ present: true, sessionDate: PRIOR, generatedAt: PRIOR + "T22:00:00Z", updatedAt: 1 });
  wanted.forEach((key, order) => {
    if (!noisy) { keys[key] = fresh(); return; }
    if (crash !== null && order + 1 > crash) {
      if (w.chance(0.5)) keys[key] = old();
      return;
    }
    const r = w.uniform();
    if (r < 0.74) keys[key] = fresh();
    else if (r < 0.84) keys[key] = old();
    else if (r < 0.92) return;
    else if (r < 0.96) keys[key] = { present: true, sessionDate: null, generatedAt: null, updatedAt: 1 };
    else keys[key] = { ...fresh(), sessionDate: key.startsWith("card:") ? SESSION : PRIOR };
  });
  let defect = null;
  if (!noisy && wanted.length && w.chance(0.6)) {
    const key = w.pick(wanted);
    defect = w.pick(["absent", "stale", "unsessioned", "skew"]);
    if (defect === "absent") delete keys[key];
    else if (defect === "stale") keys[key] = old();
    else if (defect === "unsessioned") keys[key] = { present: true, sessionDate: null, generatedAt: null, updatedAt: 1 };
    else keys[key] = { ...fresh(), sessionDate: PRIOR };
  }
  return { names, depthOf, keys, crash, noisy, defect };
}

export function storeScenario(seed, cov) {
  const w = world(seed, "store");
  const plan = planWorld(w);
  const { names, depthOf } = plan;
  const n = names.length;
  const universe = {
    n, t: names, sessionDate: SESSION, units: { px: ["usd", 100] },
    cols: {
      px: names.map(() => 10000),
      sig: names.map((t) => (depthOf.get(t) === "screen" ? null : 123)),
      f2: names.map((t) => (depthOf.get(t) === "screen" ? null : 4)),
      f3: names.map((t) => (depthOf.get(t) === "screen" ? null : 1)),
      iv30p: names.map((t) => (depthOf.get(t) === "screen" || (plan.noisy && w.chance(0.02)) ? null : 450)),
    },
  };
  const roster = { sessionDate: SESSION, depth: {}, session: {}, held: {} };
  for (const t of names) {
    if (depthOf.get(t) !== "screen") roster.depth[t] = depthOf.get(t);
    const card = plan.keys["card:" + t];
    if (card && card.sessionDate && depthOf.get(t) !== "screen") roster.session[t] = plan.noisy && w.chance(0.04) ? PRIOR : card.sessionDate;
  }
  const truncated = plan.noisy && w.chance(0.2);
  const unreadable = plan.noisy && !truncated && w.chance(0.1);
  let listing = { keys: { ...plan.keys }, listed: Object.keys(plan.keys).length, truncated: false };
  if (truncated) {
    const all = Object.keys(plan.keys);
    const cut = all.slice(0, Math.max(0, all.length - 1 - w.int(Math.max(1, all.length / 3))));
    listing = { keys: Object.fromEntries(cut.map((k) => [k, plan.keys[k]])), listed: cut.length, truncated: true };
  }
  if (unreadable) listing = null;
  const expected = plan.noisy && w.chance(0.08) ? null : SESSION;
  const globalKeys = ["universe", "roster", "meta", "regime", "events"];
  const globals = Object.fromEntries(globalKeys.map((k) => [k, plan.noisy && w.chance(0.15) ? { present: true, sessionDate: PRIOR } : plan.noisy && w.chance(0.06) ? { present: false } : { present: true, sessionDate: SESSION }]));
  if (!plan.noisy && w.chance(0.15)) globals[w.pick(globalKeys)] = w.chance(0.5) ? { present: true, sessionDate: PRIOR } : { present: false };
  w.log(`world: ${n} names, ${Object.keys(plan.keys).length} keys, crash at ${plan.crash}, listing ${unreadable ? "unreadable" : truncated ? "truncated" : "whole"}, expected ${expected}`);
  freeze(universe); freeze(roster); freeze(listing); freeze(globals);

  let report;
  try {
    report = cov.verifyCoverage({ universe, roster, listing, globals, expected });
  } catch (error) {
    w.check(false, "verifyCoverage threw on a well-formed world (inputs are frozen, so a mutation of them throws): " + error.message);
    return { violations: w.violations, checks: w.checks, events: w.events };
  }

  const listed = listing !== null;
  const cut = !!(listing && listing.truncated);
  const PRODUCT_KIND = { card: "card", cardX: "card-x", hist: "hist" };
  const expectedCols = { row: [], card: [], cardX: [], hist: [] };
  const counts = { row: [0, 0, 0, 0, 0, 0], card: [0, 0, 0, 0, 0, 0], cardX: [0, 0, 0, 0, 0, 0], hist: [0, 0, 0, 0, 0, 0] };
  const failing = [];
  const p = { P1: { failing: 0, of: 0 }, P2: { failing: 0, of: 0 }, P4: { failing: 0, of: 0 } };
  let p7 = 0;
  names.forEach((t, i) => {
    const d = depthOf.get(t);
    const wants = WANTS[d];
    const gaps = ["sig", "f2", "f3", "iv30p"].some((c) => universe.cols[c][i] === null);
    const put = (prod, state, why) => {
      expectedCols[prod][i] = state;
      counts[prod][state]++;
      if (state === CODE.failed || state === CODE.stale) failing.push({ t, prod, state, why });
    };
    put("row", gaps ? CODE.unfetched : CODE.ok);
    if (gaps) p7++;
    const sessions = {};
    for (const [prod, kind] of Object.entries(PRODUCT_KIND)) {
      if (!wants.includes(kind)) { put(prod, CODE.unfetched); continue; }
      const seen = listed && listing.keys[`${kind}:${t}`];
      sessions[kind] = seen && typeof seen.sessionDate === "string" ? seen.sessionDate : null;
      put(prod, oracleState(seen || null, expected, cut, listed));
    }
    if (wants.includes("card")) {
      p.P1.of++;
      if (expectedCols.card[i] !== CODE.ok) p.P1.failing++;
      for (const kind of wants.filter((k) => k !== "card")) {
        if (sessions.card && sessions[kind]) { p.P2.of++; if (sessions[kind] !== sessions.card) p.P2.failing++; }
      }
      if (sessions.card && typeof roster.session[t] === "string") { p.P4.of++; if (roster.session[t] !== sessions.card) p.P4.failing++; }
    }
  });

  for (const prod of Object.keys(expectedCols)) {
    w.check(JSON.stringify(report.columns[prod]) === JSON.stringify(expectedCols[prod]),
      `${prod}: the report's states differ from the world's truth (first difference at ${report.columns[prod].findIndex((s, i) => s !== expectedCols[prod][i])} of ${n})`);
    const states = ["ok", "quiet", "failed", "unfetched", "stale", "pending"];
    w.check(states.every((s, k) => report.products[prod][s] === counts[prod][k]), `${prod}: the counts by state differ from the truth ${JSON.stringify(counts[prod])} vs ${JSON.stringify(report.products[prod])}`);
    w.check(Object.values(report.products[prod]).reduce((a, b) => a + b, 0) === n, `CONSERVATION: ${prod}'s states add up to the ${n} names of the universe`);
  }
  w.check(report.conservation.ok === true, "the report's own conservation check holds");
  w.check(report.predicates.P1.failing === p.P1.failing && report.predicates.P1.of === p.P1.of, `P1 counts ${JSON.stringify(report.predicates.P1)} against the truth ${JSON.stringify(p.P1)}`);
  w.check(report.predicates.P2.failing === p.P2.failing && report.predicates.P2.of === p.P2.of, `P2 counts ${JSON.stringify(report.predicates.P2)} against the truth ${JSON.stringify(p.P2)}`);
  w.check(report.predicates.P4.failing === p.P4.failing && report.predicates.P4.of === p.P4.of, `P4 counts ${JSON.stringify(report.predicates.P4)} against the truth ${JSON.stringify(p.P4)}`);
  w.check(report.predicates.P7.failing === p7 && report.predicates.P7.of === n, `P7 counts ${JSON.stringify(report.predicates.P7)} against the truth ${p7} of ${n}`);
  w.check(report.failingTotal === failing.length, `the failing total is ${report.failingTotal}, the truth is ${failing.length}`);
  w.check(report.failing.length === Math.min(100, failing.length), "the failing list is capped at 100 and holds as many as it may");
  const sorted = report.failing.every((f, i, list) => i === 0 || SEVERITY[list[i - 1].code] <= SEVERITY[f.code]);
  w.check(sorted, "failures sort before stale names");
  const globalsOk = Object.entries(globals).every(([, g]) => oracleState(g, expected, false, true) === CODE.ok);
  const truthComplete = listed && !cut && globalsOk && failing.length === 0 && p.P1.failing === 0 && p.P2.failing === 0 && p.P4.failing === 0 && expected !== null;
  w.check(report.complete === truthComplete, `${truthComplete ? "NO FALSE ALARM" : "NO FALSE GREEN"}: the report says complete=${report.complete}, the world is ${truthComplete ? "complete" : "not complete"}`);
  if (cut || !listed) w.check(report.complete === false, "a cut or unreadable listing is never complete");
  for (const [key, g] of Object.entries(globals)) {
    const want = ["ok", "quiet", "failed", "unfetched", "stale", "pending"][oracleState(g, expected, false, true)];
    w.check(report.globals[key] && report.globals[key].state === want, `global ${key}: ${want} expected, ${report.globals[key] && report.globals[key].state}`);
  }
  return { violations: w.violations, checks: w.checks, events: w.events };
}
