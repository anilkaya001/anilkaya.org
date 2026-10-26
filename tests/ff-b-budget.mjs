import { collector, buildApi } from "./lib/ff-b-kit.mjs";
import { loadWorld, LOAD } from "./lib/ff-b-load.mjs";
import { alice, astOf, liveAst, hitIdOf, seedHit, seedWire, NAMES, NOW } from "./lib/ff-b-world.mjs";
import { FF_ROUTE_CEILINGS, FF_BUDGET_PARAMS, FF_PLANNED, ffRows } from "./lib/d1-budget-ff.mjs";
import { EXPORT } from "../server/ff-export.js";
import { DIGEST } from "../server/ff-digest.js";
import { HITS_PAGE } from "../server/routes/flows-ff.js";

const c = collector();

const measured = new Map();

const take = (key, r) => {
  const was = measured.get(key);
  if (was) c.ok(false, "budget: scenario " + key + " measured twice");
  measured.set(key, { read: r.read, written: r.written, trips: r.trips, status: r.status });
};

const api = buildApi();
const { wires } = await loadWorld(api);
const mine = wires.get("alice.one");
const call = (method, path, body) => api.call(method, path, { body, user: alice });

take("healthCold", await call("GET", "/api/ff/health"));
take("healthWarm", await call("GET", "/api/ff/health"));
take("hitsFirst", await call("GET", "/api/ff/hits"));
const first = await call("GET", "/api/ff/hits");
take("hitsNext", await call("GET", "/api/ff/hits?cursor=" + first.body.next));
take("hitsLarge", await call("GET", "/api/ff/hits?limit=" + HITS_PAGE.max));
take("hitsMarked", await call("GET", "/api/ff/hits?state=pinned"));
take("hitDetail", await call("GET", "/api/ff/hits?id=" + first.body.hits[0].id));
take("read", await call("POST", "/api/ff/read", { all: true }));
take("mark", await call("POST", "/api/ff/hits", { id: first.body.hits[0].id, mark: "pinned" }));
take("wiresList", await call("GET", "/api/ff/wires"));
take("wireDetail", await call("GET", "/api/ff/wires?id=" + mine[0]));
take("houseList", await call("GET", "/api/ff/house"));
take("houseDetail", await call("GET", "/api/ff/house?id=h-t01"));
const digests = [await call("GET", "/api/ff/digest"), await call("GET", "/api/ff/digest?d=2026-10-26"), await call("GET", "/api/ff/digest?d=2026-10-21")];
take("digest", digests.reduce((a, b) => (b.read > a.read ? b : a)));
take("symbol", await call("GET", "/api/ff/symbol?t=SYA101"));
take("receipts", await call("GET", "/api/ff/receipts?wire=" + mine[0]));
take("records", await call("GET", "/api/ff/records?wire=" + mine[0]));
take("exportWindow", await call("GET", "/api/ff/export?from=2026-10-01&to=2026-10-31"));
take("preview", await call("POST", "/api/ff/preview", { ast: astOf() }));
take("create", await call("POST", "/api/ff/wires", { ast: astOf({ scope: { kind: "names", symbols: ["SYC301", "SYC302", "SYD401", "SYD402", "SYE501"] } }) }));
take("adjust", await call("PATCH", "/api/ff/wires", { id: mine[1], version: 1, ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYA102", "SYB201", "SYB202", "SYC301"] }, all: [{ m: "earn.sessions", op: "<=", x: 4 }, { m: "earn.confirmed", op: "==", x: 1 }] }) }));
take("retitle", await call("PATCH", "/api/ff/wires", { id: mine[2], title: "Renamed" }));
take("pause", await call("PATCH", "/api/ff/wires", { id: mine[3], status: "paused" }));
take("restore", await call("PATCH", "/api/ff/wires", { id: mine[3], status: "armed" }));
take("mute", await call("POST", "/api/ff/mute", { symbol: "SYC301", mute: true }));
take("note", await call("PUT", "/api/ff/note", { wire: mine[0], body: "x" }));
take("houseSet", await call("POST", "/api/ff/house", { id: "h-t01", follow: false }));

const widest = buildApi();
const names25 = Array.from({ length: 25 }, (_, i) => "SYX" + String(100 + i));
const wide = buildApi({ world: { names: names25 } });
take("createWidest", await wide.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: names25 } }) }, user: alice }));
void widest;

const worst = buildApi();
const wid = (await worst.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice })).body.wire.id;
const compiled = await worst.world.core.compile({ body: astOf({ scope: { kind: "universe" } }), universe: worst.world.universe });
seedWire(worst.world.f, { member: null, id: "h-t01", title: "House", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence: "House", template: "T01" });
const ins = worst.world.f.db.prepare("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES (?, ?, ?, ?, 1, ?, 'n:SYA101', 'SYA101', NULL, ?, '2026-10-26', 'close', ?, ?, 'nightly', 'e1', '{}', 'delivered')");
const base = Date.parse("2026-10-26T21:00:00Z");
for (let i = 1; i <= EXPORT.rowsPerStream + 50; i++) {
  ins.run("alice.one", i, hitIdOf(wid, "m" + i), wid, "alice.one", "m" + i, base + i, base);
  ins.run("house", i, hitIdOf("h-t01", "h" + i), "h-t01", null, "h" + i, base + i, base);
}
take("exportWorst", await worst.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice }));

for (const [key, got] of measured) {
  const ceiling = FF_ROUTE_CEILINGS[key];
  c.ok(Boolean(ceiling), "budget: " + key + " has a declared ceiling");
  if (!ceiling) continue;
  c.eq(got.status === 200 || got.status === 201, true, "budget: " + key + " answers", got.status);
  c.ok(got.read <= ceiling.read, "budget: " + key + " reads " + got.read + " rows, at most " + ceiling.read, got.read);
  c.ok(got.written <= ceiling.written, "budget: " + key + " writes " + got.written + " rows, at most " + ceiling.written, got.written);
  c.ok(got.trips <= ceiling.trips, "budget: " + key + " takes " + got.trips + " trips, at most " + ceiling.trips, got.trips);
  const slack = Math.max(2, Math.ceil(ceiling.read * 0.25));
  c.ok(ceiling.read - got.read <= slack, "budget: " + key + " ceiling of " + ceiling.read + " is not loose against " + got.read + " measured", ceiling.read - got.read);
  if (ceiling.written > 0) c.ok(ceiling.written - got.written <= Math.max(1, Math.ceil(ceiling.written * 0.25)), "budget: " + key + " write ceiling is not loose", ceiling.written - got.written);
}
for (const key of Object.keys(FF_ROUTE_CEILINGS)) c.ok(measured.has(key), "budget: ceiling " + key + " is measured by a scenario");

c.eq(FF_ROUTE_CEILINGS.exportWorst.read, 2 * EXPORT.rowsPerStream, "budget: the export's worst case is both streams at their row limit");
c.ok(FF_ROUTE_CEILINGS.digest.read >= DIGEST.houseRows + DIGEST.memberRows - 10 && FF_ROUTE_CEILINGS.digest.read <= DIGEST.houseScan + DIGEST.memberScan + 100, "budget: the digest ceiling sits between its row limits and its scan windows", FF_ROUTE_CEILINGS.digest.read);
c.eq(FF_BUDGET_PARAMS.digestReadsPerLoad, FF_ROUTE_CEILINGS.digest.read, "budget: the planned digest cost is the ceiling");
c.eq(FF_BUDGET_PARAMS.healthReadsPerPoll, FF_ROUTE_CEILINGS.healthWarm.read, "budget: the planned health poll is the member's own part");
c.eq(FF_BUDGET_PARAMS.wiresPerMember, LOAD.wiresPerMember, "budget: the load world is the planned world");
c.eq(FF_BUDGET_PARAMS.members, LOAD.members, "budget: with the planned members");
c.eq(FF_BUDGET_PARAMS.symbolsPerWire, LOAD.symbolsPerWire, "budget: and symbols per wire");
c.ok(FF_PLANNED.find((p) => p.id === "ff.api").read === ffRows().api[1], "budget: the planned API row is the model's");
const apiRead = ffRows().api[1];
c.ok(apiRead < 70000, "budget: the API's day of reads stays under 70,000 rows, leaving the nightly and the live loop their share", apiRead);

const shared = buildApi();
await loadWorld(shared);
const before = shared.world.f.trips.length;
for (let i = 0; i < FF_BUDGET_PARAMS.members; i++) {
  const member = { username: i === 0 ? "alice.one" : "load" + String.fromCharCode(97) + String.fromCharCode(97 + i) + ".x", exp: NOW + 86400000, epoch: "1" };
  await shared.call("GET", "/api/ff/health", { user: member });
}
const polled = shared.world.f.rowsRead(before);
c.ok(polled <= FF_BUDGET_PARAMS.members * FF_ROUTE_CEILINGS.healthWarm.read + 8, "budget: twelve members polling inside one window read their own rows and the shared rows once", polled);

void liveAst;
void seedHit;
void NAMES;

if (c.failed.length) {
  for (const f of c.failed) console.log("FAIL " + f.id + (f.detail ? " :: " + f.detail : ""));
  console.log("ff-b-budget: " + c.failed.length + " of " + c.count() + " checks failed");
  process.exitCode = 1;
} else {
  console.log("ff-b-budget: " + c.count() + " checks passed");
  for (const [key, got] of measured) console.log("  " + key.padEnd(14) + " read " + String(got.read).padStart(5) + "  written " + String(got.written).padStart(3) + "  trips " + got.trips);
}
