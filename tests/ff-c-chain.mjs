import { createFfStore } from "../server/ff-store.js";
import { createEvaluator } from "../server/ff-eval.js";
import { buildMetrics } from "../scripts/flows-legs/ff-metrics.mjs";
import { buildCarry } from "../scripts/flows-legs/ff-carry.mjs";
import { PAYLOADS } from "../shared/ff-contract.js";
import { makeWorld, seedWire } from "./lib/ff-b-world.mjs";
import { clone, dateAdd, emit, histSeries, recorder, zOracle } from "./lib/ff-c-kit.mjs";
import { metricById } from "../shared/ff-contract.js";

const R = recorder();
const E = emit();
const universe = E.get("universe");
const session = universe.sessionDate;
const AT = Date.parse(session + "T23:00:00Z");

const built = buildMetrics({
  sessionDate: session, generatedAt: session + "T22:40:00.000Z", universe,
  histOf: (t) => E.get("hist:" + t) || null, cardXOf: (t) => E.get("card-x:" + t) || null, cardOf: (t) => E.get("card:" + t) || null,
});
const metrics = JSON.parse(JSON.stringify(built.payload));
const flowalerts = clone(E.get("flowalerts"));
const carry = buildCarry({ sessionDate: session, generatedAt: session + "T22:41:00.000Z", alerts: flowalerts });
R.ok(JSON.stringify(carry).length <= PAYLOADS.carry.maxBytes, "carry under its cap");

const zOf = (t) => {
  const h = E.get("hist:" + t);
  const s = histSeries(h);
  return zOracle(s.np.get(session), s.np, session, metricById("flow.net_premium.z20").baseline).z;
};

const w = makeWorld({ now: AT, env: { FF_MODE: "on" } });
const payloads = new Map([["ff-metrics", metrics], ["flowalerts", flowalerts]]);
const ev = createEvaluator({
  store: createFfStore({ ensureFf: async () => {} }),
  flowsStore: { async readMany(_e, keys) {
    return new Map(keys.filter((k) => payloads.has(k)).map((k) => [k, { payload: clone(payloads.get(k)), updatedAt: AT }]));
  } },
  now: () => AT,
});

const wid = (c) => "w-" + c + "a".repeat(15);
const body = (symbols, all, over = {}) => JSON.stringify({ v: 1, cadence: "nightly", scope: symbols ? { kind: "names", symbols } : { kind: "universe" }, all, persist: 1, cooldown: { unit: "session", n: 5 }, ...over });
const z = (op, x) => [{ m: "flow.net_premium.z20", op, x }];
const mk = (id, member, symbols, all) => seedWire(w.f, { member, id, scopeKind: symbols ? "names" : "universe", symbols: symbols || [], astJson: body(symbols, all), effective: "2026-01-01" });

const low = "SYN208";
const mid = "AVGO";
R.ok(zOf(low) < -3.2 && zOf(low) > -3.5, "fixture: the lowest name sits near -3.3 sigma");
R.ok(zOf(mid) > 2.1 && zOf(mid) < 2.2, "fixture: the highest name sits near 2.16 sigma");
mk(wid("a"), "alice.one", [low], z("<=", -3));
mk(wid("b"), "alice.one", null, z(">=", 2));
mk(wid("c"), "bob.two", [mid], z(">=", 2));
mk(wid("d"), "bob.two", [mid], z(">=", 2.25));
const dayRows = flowalerts.rows.filter((r) => typeof r.t === "string" && typeof r.oc === "string" && universe.t.includes(r.t) && Number.isFinite(r.prem) && r.prem >= 2500000 && typeof r.exp === "string"
  && Math.round((Date.parse(r.exp) - Date.parse(session)) / 86400000) <= 40);
const wantSubjects = [...new Set(dayRows.map((r) => "c:" + r.t + ":" + r.oc))].sort();
mk(wid("e"), "carol.three", null, [{ m: "contract.premium", op: ">=", x: 2500000 }, { m: "contract.dte", op: "<=", x: 40 }]);

const out = await ev.nightly(w.env, { session, at: AT });
R.eq(out.status, "done", "chain: the night ran");
const rows = (sql, ...a) => w.f.db.prepare(sql).all(...a).map((r) => ({ ...r }));
const by = (id) => rows("SELECT subject, evidence_json FROM ff_hit WHERE wire_id = ? ORDER BY subject", id);

R.eq(by(wid("a")).map((h) => h.subject), ["n:" + low], "chain: the lowest name fires its wire");
const ea = JSON.parse(by(wid("a"))[0].evidence_json);
R.ok(Math.abs(ea.clauses[0].value - zOf(low)) <= 0.0051, "chain: the evidence z is the oracle's z to the displayed step, " + ea.clauses[0].value);
R.eq(by(wid("b")), [], "chain: a universe wire at 2 sigma finds nothing after the false-discovery gate over 124 names");
R.eq(by(wid("c")).map((h) => h.subject), ["n:" + mid], "chain: a lone name at 2.16 sigma passes at 2");
R.eq(by(wid("d")), [], "chain: and not at 2.25");
R.ok(wantSubjects.length > 0, "fixture: flagged windows pass the bar");
{
  const got = by(wid("e")).map((h) => h.subject);
  R.eq(got.length, 10, "chain: a member wire is capped at ten hits a session");
  R.eq(got.filter((x) => !wantSubjects.includes(x)), [], "chain: every hit is a contract that passes the bar");
  const re = rows("SELECT hits, hits_capped FROM ff_receipt WHERE wire_id = ?", wid("e"))[0];
  R.eq([re.hits, re.hits_capped], [10, wantSubjects.length - 10], "chain: the receipt counts the capped ones");
}
for (const id of [wid("a"), wid("b"), wid("c"), wid("d"), wid("e")]) {
  const r = rows("SELECT status, reason FROM ff_receipt WHERE wire_id = ?", id)[0];
  R.eq(r.status, "evaluated", "chain: receipt evaluated " + id);
}
const rb = rows("SELECT names_evaluated, names_absent FROM ff_receipt WHERE wire_id = ?", wid("b"))[0];
R.ok(rb.names_evaluated + rb.names_absent === universe.t.length || rb.names_evaluated > 100, "chain: the universe wire evaluated names, " + rb.names_evaluated + " and " + rb.names_absent + " unknown");
R.ok(rb.names_absent > 0, "chain: names with no history are counted unknown, not zero");

if (R.fails.length) {
  for (const f of R.fails) console.error("  FAIL " + f);
  console.error(`ff-c-chain: ${R.fails.length} of ${R.checks} checks failed`);
  process.exit(1);
}
console.log(`ff-c-chain: ${R.checks} checks hold, legs to evaluator to rows`);
void dateAdd;
