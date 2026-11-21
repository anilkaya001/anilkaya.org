import { isDeepStrictEqual } from "node:util";
import { ROUTES, TEMPLATES } from "../shared/ff-contract.js";
import { FF_TABLES } from "../shared/ff-schema.js";
import { prepareVersion } from "../shared/ff-grammar.js";
import { effectiveSession, nightlyFinal } from "../shared/ff-session.js";
import { FIRE_SHADOW_LINE } from "../shared/flows-pages.js";
import { NAMES, SECTORS, anomalyAst, astOf, liveAst, metricsPayload, seedRun, universePayload } from "./lib/ff-b-world.mjs";
import {
  FF_ON, HOST, INGEST_TOKEN, LIVE_TOKEN, MEMBER, MEMBER_2, ffSql, fire, liveAlerts, loadWorker, mountEnv, pinClock, quiet, send, store, windowRow,
} from "./lib/ff-u-mount.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import { absent, count, expect, moduleSource, slice, workerSource } from "./lib/source-scan.mjs";

const LOOP = "http://127.0.0.1";
const MON_RTH = "2026-10-26T15:00:00Z";
const MON_EVENING = "2026-10-26T21:30:00Z";
const MON_LATE = "2026-10-27T01:00:00Z";
const TUE_RTH = "2026-10-27T15:30:00Z";
const TUE_LATE = "2026-10-28T01:00:00Z";
const WED_PRUNE = "2026-10-28T07:10:00Z";
const MONDAY = "2026-10-26";
const FRIDAY = "2026-10-23";

function recorder() {
  const fails = [];
  let checks = 0;
  return {
    ok(group, cond, msg) {
      checks++;
      if (!cond) fails.push({ group, msg });
    },
    eq(group, a, b, msg) {
      checks++;
      if (!isDeepStrictEqual(a, b)) fails.push({ group, msg: msg + " | got " + String(JSON.stringify(a)).slice(0, 200) + " want " + String(JSON.stringify(b)).slice(0, 200) });
    },
    get fails() { return fails; },
    get checks() { return checks; },
  };
}

const rows = (f, sql, ...args) => f.db.prepare(sql).all(...args).map((r) => ({ ...r }));

function world({ metricsSession = MONDAY, env = {}, schema, payloads = true } = {}) {
  const f = schema === undefined ? store() : store({ schema });
  if (payloads) {
    f.put("universe", universePayload());
    f.put("ff-metrics", metricsPayload(NAMES, { sessionDate: metricsSession, generatedAt: metricsSession + "T22:50:00.000Z" }));
  }
  return { f, env: mountEnv(f.D1, env) };
}

const universeCtx = (now) => ({ universe: new Set(NAMES), sectors: new Set(SECTORS), universeSize: NAMES.length, now });
const withCooldown = (ast, n) => ({ ...ast, cooldown: { unit: "session", n } });
const universeWire = (over = {}) => anomalyAst({ scope: { kind: "universe" }, ...over });
const arm = (worker, env, ast, extra = {}) => send(worker, env, "/api/ff/wires", { method: "POST", body: { ast, title: "A wire", ...(extra.body || {}) }, headers: extra.headers || {}, as: extra.as || MEMBER });
const versionRow = (f, id) => rows(f, "SELECT * FROM ff_wire_version WHERE wire_id = ? ORDER BY version DESC LIMIT 1", id)[0];
const runNightly = (worker, env, session, extra = {}) => send(worker, env, "/api/ff/run", { method: "POST", as: null, bearer: INGEST_TOKEN, body: { cadence: "nightly", session }, ...extra });
const postLive = (worker, env, body, extra = {}) => send(worker, env, "/api/flows/ingest?key=live:alerts", { method: "POST", as: null, bearer: LIVE_TOKEN, body, host: LOOP, ...extra });
const liveEnv = { FLOWS_LIVE_TOKEN: LIVE_TOKEN };

const GROUPS = {
  async routes(load, R, clock) {
    clock.set(MON_RTH);
    const worker = await load();
    const { env } = world();
    for (const r of ROUTES.api) {
      const wrong = ["GET", "POST", "PUT", "PATCH", "DELETE"].find((m) => !r.methods.includes(m));
      const res = await send(worker, env, r.path, { method: wrong, as: null, body: wrong === "GET" ? undefined : {} });
      R.eq("routes", [res.status, res.res.headers.get("Allow")], [405, r.methods.join(", ")], r.path + ": a method the contract does not list is a 405 naming the contract's methods");
      const first = r.methods[0];
      const anon = await send(worker, env, r.path, { method: first, as: null, body: first === "GET" || first === "DELETE" ? undefined : {} });
      R.eq("routes", [anon.status, anon.code], [401, "unauthorized"], r.path + ": a caller with no credential is 401");
      R.eq("routes", [anon.res.headers.get("Cache-Control"), /json/.test(anon.res.headers.get("Content-Type") || ""), anon.res.headers.get("X-Content-Type-Options")],
        ["no-store", true, "nosniff"], r.path + ": the answer is JSON, no-store, through the finalizer");
    }
    const unknown = await send(worker, env, "/api/ff/zz");
    R.eq("routes", [unknown.status, unknown.code], [404, "not_found"], "a path the contract does not list is the JSON 404");
  },

  async switches(load, R, clock) {
    clock.set(MON_RTH);
    const worker = await load();
    for (const mode of [undefined, "off", "", "members", "ON-ish"]) {
      const { f, env } = world({ env: { ...liveEnv, FF_MODE: mode } });
      const wires = await send(worker, env, "/api/ff/wires");
      R.eq("switches", [wires.status, wires.code, wires.json && wires.json.reason], [404, "ff_off", "mode_off"], `FF_MODE ${JSON.stringify(mode)}: the API answers ff_off`);
      const page = await send(worker, env, "/flows/fire/");
      R.eq("switches", page.status, 404, `FF_MODE ${JSON.stringify(mode)}: the Fire page is the unknown-page 404`);
      const run = await runNightly(worker, env, MONDAY);
      R.eq("switches", [run.status, run.code], [404, "ff_off"], `FF_MODE ${JSON.stringify(mode)}: the run route is closed`);
      await fire(worker, env, clock.at);
      clock.set(MON_EVENING);
      await fire(worker, env, clock.at);
      clock.set(MON_RTH);
      await postLive(worker, env, liveAlerts([windowRow("SYA101")], { readAt: clock.at - 20000, session: MONDAY }));
      R.eq("switches", ffSql(f), [], `FF_MODE ${JSON.stringify(mode)}: no request, cron firing or live write sends a statement that names an ff_ table`);
    }
    {
      const { env } = world({ env: { FF_MODE: "on", FF_ROUTE_WIRES: "off" } });
      const wires = await send(worker, env, "/api/ff/wires");
      R.eq("switches", [wires.status, wires.code, wires.json.reason, wires.json.route], [404, "ff_off", "route_off", "wires"], "a route switch closes its own routes and says which");
      const health = await send(worker, env, "/api/ff/health");
      R.eq("switches", [health.status, health.json.routes.wires.available, health.json.routes.inbox.available], [200, false, true], "and the health route still answers and names the closed part");
    }
    {
      const { env } = world();
      const page = await send(worker, env, "/flows/fire/");
      R.eq("switches", [page.status, page.text.split(FIRE_SHADOW_LINE).length - 1], [200, 1], "in shadow the Fire page is served and says it runs in shadow");
      const board = await send(worker, env, "/flows/long/");
      R.eq("switches", (board.text.match(/<a href="\/flows\/fire\/"[^>]*>/g) || []).length, 1, "and every member page links Fire from the sidebar");
      const live = await send(worker, { ...env, FF_MODE: "on" }, "/flows/fire/");
      R.eq("switches", [live.status, live.text.includes(FIRE_SHADOW_LINE)], [200, false], "with FF_MODE on the page does not say shadow");
    }
  },

  async ddl(load, R, clock) {
    clock.set(MON_RTH);
    const tables = (f) => rows(f, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ff!_%' ESCAPE '!' ORDER BY name").map((r) => r.name);
    const created = (f) => f.trips.filter((t) => t.sqls.some((sql) => /CREATE TABLE IF NOT EXISTS ff_/.test(sql))).length;
    const probes = (f) => f.trips.filter((t) => t.sqls.some((sql) => /^SELECT 1 FROM ff_member LIMIT 0$/.test(sql))).length;
    {
      const worker = await load();
      const { f, env } = world({ schema: null, payloads: false });
      R.eq("ddl", tables(f), [], "fixture: the database starts with no ff_ table");
      const first = await send(worker, env, "/api/ff/wires");
      R.eq("ddl", first.status, 200, "the first request on a database that has no ff_ table is answered");
      R.eq("ddl", tables(f), [...FF_TABLES].sort(), "and left it holding exactly the contract's tables");
      for (let i = 0; i < 3; i++) await send(worker, env, "/api/ff/wires");
      await send(worker, env, "/api/ff/health");
      R.eq("ddl", [created(f), probes(f)], [1, 1], "the first-use DDL runs once in an isolate and the probe once");
      const second = await load();
      const from = f.trips.length;
      const again = await send(second, env, "/api/ff/wires");
      R.eq("ddl", [again.status, f.trips.slice(from).filter((t) => t.sqls.some((sql) => /CREATE TABLE/.test(sql) && /ff_/.test(sql))).length], [200, 0], "a second isolate finds the tables and sends no ff_ DDL");
    }
    {
      const worker = await load();
      const { f, env } = world();
      await send(worker, env, "/api/ff/wires");
      await send(worker, env, "/api/ff/wires");
      R.eq("ddl", [created(f), probes(f)], [0, 1], "on a migrated database the probe runs once and no DDL is sent");
    }
  },

  async compile(load, R, clock) {
    clock.set(MON_RTH);
    const worker = await load();
    const { f, env } = world();
    const made = await arm(worker, env, astOf());
    R.eq("compile", made.status, 201, "a nightly names wire with no cooldown is armed");
    const id = made.json && made.json.wire ? made.json.wire.id : "";
    R.ok("compile", /^w-[a-z2-7]{16}$/.test(id), "its id is a member wire id");
    const want = prepareVersion(withCooldown(astOf(), 5), universeCtx(clock.at));
    const row = versionRow(f, id) || {};
    R.eq("compile", [row.cadence, row.scope_kind, row.control, row.exp_week, row.template, row.sentence, row.clause_hash, row.ast_hash, row.ast_json],
      ["nightly", "names", "fact", null, "custom", want.version.sentence, want.version.clause_hash, want.version.ast_hash, want.version.ast_json],
      "the stored version is lane A's compilation of the body with the nightly default cooldown of five sessions");
    R.eq("compile", row.effective_session, effectiveSession("nightly", clock.at), "and takes effect from the session lane A rules for a nightly wire");
    R.eq("compile", rows(f, "SELECT symbol FROM ff_wire_symbol WHERE wire_id = ? ORDER BY symbol", id).map((r) => r.symbol), ["SYA101", "SYA102"], "its names are indexed");

    const kept = await arm(worker, env, withCooldown(astOf({ scope: { kind: "names", symbols: ["SYB201"] } }), 2));
    R.eq("compile", JSON.parse((versionRow(f, kept.json.wire.id) || {}).ast_json || "{}").cooldown, { unit: "session", n: 2 }, "a cooldown the member states is kept");

    const live = await arm(worker, env, liveAst());
    const liveRow = versionRow(f, live.json && live.json.wire ? live.json.wire.id : "") || {};
    R.eq("compile", [live.status, liveRow.cadence, JSON.parse(liveRow.ast_json || "{}").cooldown, liveRow.effective_session],
      [201, "live", { unit: "session", n: 1 }, effectiveSession("live", clock.at)], "a live wire takes the live default cooldown and lane A's live effective session");

    const uni = await arm(worker, env, universeWire());
    const uniRow = versionRow(f, uni.json && uni.json.wire ? uni.json.wire.id : "") || {};
    const uniWant = prepareVersion(withCooldown(universeWire(), 5), universeCtx(clock.at));
    R.eq("compile", [uni.status, uniRow.control, uniRow.exp_week], [201, "bh", uniWant.version.exp_week], "a universe anomaly wire is tested against the universe and carries lane A's expected false alarms a week");
    R.ok("compile", typeof uniRow.exp_week === "number" && uniRow.exp_week > 0, "which is a positive number");

    const sectorAst = anomalyAst({ scope: { kind: "sector", sector: "Technology" } });
    const sec = await arm(worker, env, sectorAst);
    const secRow = versionRow(f, sec.json && sec.json.wire ? sec.json.wire.id : "") || {};
    const exact = prepareVersion(withCooldown(sectorAst, 5), { ...universeCtx(clock.at), sectorSizes: { Technology: 5 } });
    R.eq("compile", [sec.status, secRow.control, secRow.exp_week], [201, "bh", uniWant.version.exp_week], "a sector anomaly wire is priced on the universe's size, which the route knows");
    R.ok("compile", exact.ok && secRow.exp_week >= exact.version.exp_week, "and that is never below the figure of the sector's own size");

    clock.set(MON_EVENING);
    const late = await arm(worker, env, astOf({ scope: { kind: "names", symbols: ["SYC301"] } }));
    const lateLive = await arm(worker, env, liveAst({ scope: { kind: "names", symbols: ["SYC302"] } }));
    R.eq("compile", [(versionRow(f, late.json.wire.id) || {}).effective_session, (versionRow(f, lateLive.json.wire.id) || {}).effective_session],
      [effectiveSession("nightly", clock.at), effectiveSession("live", clock.at)], "after the close each cadence takes its own next session");
    R.ok("compile", effectiveSession("nightly", Date.parse(MON_RTH)) !== effectiveSession("nightly", clock.at), "fixture: the two clocks give different sessions");
    clock.set(MON_RTH);

    const cases = [
      [astOf({ scope: { kind: "names", symbols: ["SYZ999"] } }), 422, "ff_symbol_outside_universe", "a name outside the universe"],
      [astOf({ all: [{ m: "earn.sessions", op: "<", x: 10 }] }), 400, "ff_grammar_invalid", "an operator the grammar does not hold"],
      [anomalyAst({ all: [{ m: "flow.net_premium.z20", op: ">=", x: 3.1 }] }), 400, "ff_grammar_precision", "a threshold finer than the metric's step"],
      [astOf({ all: [{ m: "desk.yield_cc", op: ">=", x: 1 }] }), 409, "ff_metric_unavailable", "a hidden metric"],
    ];
    for (const [ast, status, code, label] of cases) {
      const out = await arm(worker, env, ast);
      R.eq("compile", [out.status, out.code], [status, code], label + " is refused with lane A's code");
    }
    const before = rows(f, "SELECT COUNT(*) AS n FROM ff_wire WHERE layer = 'member'")[0].n;
    R.eq("compile", before, 7, "and a refused wire stores nothing");

    const t01 = TEMPLATES.find((t) => t.id === "T01").ast;
    const hinted = await arm(worker, env, t01, { body: { template: "T01" }, as: MEMBER_2 });
    R.eq("compile", [hinted.status, (versionRow(f, hinted.json && hinted.json.wire ? hinted.json.wire.id : "") || {}).template], [201, "T01"], "a template hint whose clauses are the template's is recorded");
    const moved = { ...t01, all: t01.all.map((c, i) => (i === 0 ? { ...c, x: 3.5 } : c)) };
    const unhinted = await arm(worker, env, moved, { body: { template: "T01" }, as: MEMBER_2 });
    R.eq("compile", [unhinted.status, (versionRow(f, unhinted.json && unhinted.json.wire ? unhinted.json.wire.id : "") || {}).template], [201, "custom"], "a hint whose clauses were edited is not believed");

    const keyed = await arm(worker, env, astOf({ scope: { kind: "names", symbols: ["SYD401"] } }), { headers: { "Idempotency-Key": "ff-mount-key-1" } });
    const replay = await arm(worker, env, astOf({ scope: { kind: "names", symbols: ["SYD401"] } }), { headers: { "Idempotency-Key": "ff-mount-key-1" } });
    R.eq("compile", [keyed.status, replay.status, replay.json.replayed, replay.json.wire.id === keyed.json.wire.id], [201, 200, true, true], "a repeated arm request under one idempotency key replays the first wire");

    const adjusted = await send(worker, env, "/api/ff/wires", { method: "PATCH", body: { id, version: 1, ast: astOf({ all: [{ m: "earn.sessions", op: "<=", x: 5 }] }) } });
    const v2 = versionRow(f, id) || {};
    R.eq("compile", [adjusted.status, v2.version, v2.effective_session], [200, 2, effectiveSession("nightly", clock.at)], "an adjust writes version two with lane A's effective session");
  },

  async preview(load, R, clock) {
    clock.set(MON_RTH);
    const worker = await load();
    const { f, env } = world({ env: liveEnv });
    const ask = async (ast, extra = {}) => {
      const from = f.trips.length;
      const out = await send(worker, env, "/api/ff/preview", { method: "POST", body: { ast, ...extra } });
      return { ...out, view: out.json && out.json.preview ? out.json.preview : {}, written: f.written(from), read: f.rowsRead(from), trips: f.trips.length - from };
    };
    await send(worker, env, "/api/ff/wires");
    await ask(astOf());
    const names = await ask(astOf());
    R.eq("preview", [names.status, names.view.status, names.view.coverage], [200, "ok", { subjects: 2, evaluated: 2, wouldHit: 2, unknown: 0, reasons: {} }], "a names wire is read on the stored figures: both names hold");
    R.eq("preview", (names.view.subjects || []).map((s) => [s.symbol, s.verdict, s.clauses.map((c) => c.value)]), [["SYA101", "true", [3, 1]], ["SYA102", "true", [4, 1]]], "with each name's own figures");
    R.eq("preview", [names.written, names.read, names.trips], [0, 2, 1], "a warm preview writes nothing and reads the two stored rows in one trip, the ceiling lane B declares for it");
    R.eq("preview", [names.view.freshness.session, names.view.evaluator.effectiveSession], [MONDAY, effectiveSession("nightly", clock.at)], "it names the session it read and the session the wire takes effect from");

    const far = await ask(astOf({ scope: { kind: "names", symbols: ["SYA101", "SYE501", "SYE502"] }, all: [{ m: "earn.sessions", op: "<=", x: 10 }] }));
    R.eq("preview", [(far.view.coverage || {}).wouldHit, (far.view.subjects || []).map((s) => [s.symbol, s.verdict])], [1, [["SYA101", "true"], ["SYE501", "false"], ["SYE502", "false"]]], "a name that does not hold is listed as not holding, never dropped");

    const gap = await ask(astOf({ scope: { kind: "names", symbols: ["SYB201", "SYB202"] }, all: [{ m: "vol.iv.30d.chg1d", op: ">=", x: 1 }] }));
    R.eq("preview", [gap.view.coverage.evaluated, gap.view.coverage.unknown, (gap.view.subjects || []).map((s) => [s.symbol, s.verdict, s.reason !== null])], [1, 1, [["SYB201", "true", false], ["SYB202", "unknown", true]]],
      "a name whose figure is absent is unknown with a reason, never false and never zero");

    const uni = await ask(universeWire({ all: [{ m: "flow.net_premium.z20", op: ">=", x: 5 }] }));
    const hold = NAMES.filter((_, i) => i >= 5);
    R.eq("preview", [uni.view.coverage.subjects, uni.view.coverage.evaluated, uni.view.coverage.wouldHit, (uni.view.subjects || []).map((s) => s.symbol).sort()], [NAMES.length, NAMES.length, hold.length, hold],
      "a universe wire counts every name and lists the ones that hold");
    R.eq("preview", [uni.view.control, typeof uni.view.expWeek.v], ["bh", "number"], "and states its expected false alarms");

    const windows = await ask({ v: 1, cadence: "nightly", scope: { kind: "universe" }, all: [{ m: "contract.premium", op: ">=", x: 1000000 }], persist: 1 });
    R.eq("preview", [windows.view.status, windows.view.reason, windows.view.detail], ["unavailable", "source_missing", "windows_unread"], "a nightly wire on flagged windows says the preview cannot read them, never that none holds");
    R.ok("preview", /^— source missing: the nightly run reads this wire from the session's flagged windows/.test(windows.view.reasonText) && /add open interest confirmed/.test(windows.view.reasonText), "and says why, and what would let it preview", windows.view.reasonText);

    const before = await ask(liveAst());
    R.eq("preview", [before.view.status, before.view.coverage.evaluated, before.view.coverage.unknown, before.view.freshness.session], ["ok", 0, 1, null], "a live wire with no live record stored is unknown for its name");
    await postLive(worker, env, liveAlerts([windowRow("SYA101", { exp: "2026-11-06", spanStart: "2026-10-26T14:40:00.000Z" }), windowRow("SYA101", { oc: "SYA101270115C00100000", exp: "2027-01-15" }), windowRow("SYB201", { prem: 900000 })],
      { readAt: clock.at - 20000, session: MONDAY }));
    const after = await ask(liveAst());
    R.eq("preview", [after.view.status, after.view.coverage.wouldHit, after.view.freshness.session, (after.view.subjects || []).map((s) => [s.subject, s.verdict])],
      ["ok", 1, MONDAY, [["c:SYA101:SYA101261120C00100000", "true"]]], "with the live record stored it reads the session's windows: the near-dated window above the bar holds");

    f.db.prepare("DELETE FROM flows_payload WHERE id = 'ff-metrics'").run();
    const none = await ask(astOf());
    R.eq("preview", [none.status, none.view.status, none.view.reason], [200, "unavailable", "missing"], "without the nightly's figures the preview is unavailable with its reason");
  },

  async run(load, R, clock, log) {
    clock.set(MON_RTH);
    const worker = await load();
    const { f, env } = world({ env: liveEnv });
    const uni = await arm(worker, env, universeWire());
    const wire = uni.json.wire.id;
    clock.set(MON_EVENING);
    const outbound = log.outbound;
    for (const [label, extra] of [["no bearer", { bearer: null }], ["a bearer that is not a token", { bearer: "not-the-token" }], ["a member's session", { bearer: null, as: MEMBER }]]) {
      const out = await runNightly(worker, env, MONDAY, extra);
      R.eq("run", [out.status, out.code], [401, "unauthorized"], label + " cannot start a run");
    }
    R.eq("run", rows(f, "SELECT id FROM ff_run"), [], "and none of them claimed the night");
    const early = await runNightly(worker, env, "2026-10-27");
    R.eq("run", [early.status, early.json.run.status, early.json.run.reason, rows(f, "SELECT id FROM ff_run").length], [200, "refused", "source_missing", 0],
      "a run asked for a session whose figures are not stored is refused and the night is not claimed");
    const done = await runNightly(worker, env, MONDAY);
    R.eq("run", [done.status, done.json.run.status, done.json.run.hits], [200, "done", 7], "the nightly's request evaluates the night: seven names clear three sigma");
    const hits = rows(f, "SELECT subject, state, evaluator FROM ff_hit WHERE wire_id = ? ORDER BY subject", wire);
    R.eq("run", [hits.length, [...new Set(hits.map((h) => h.state))], [...new Set(hits.map((h) => h.evaluator))]], [7, ["held"], ["nightly"]], "in shadow every hit is stored as held");
    R.eq("run", rows(f, "SELECT status, hits FROM ff_receipt WHERE wire_id = ? AND session = ?", wire, MONDAY), [{ status: "evaluated", hits: 7 }], "with its receipt");
    R.eq("run", rows(f, "SELECT id, status, attempts FROM ff_run"), [{ id: "nightly:" + MONDAY, status: "done", attempts: 1 }], "and the run row is done");
    const inbox = await send(worker, env, "/api/ff/hits");
    R.eq("run", [inbox.status, inbox.json.shadow, inbox.json.hits], [200, true, []], "and nothing is delivered: the inbox route says shadow and lists no hit");
    const health = await send(worker, env, "/api/ff/health");
    R.eq("run", [health.json.mode, health.json.unread.total], ["shadow", 0], "nor counted as unread");
    const again = await runNightly(worker, env, MONDAY);
    R.eq("run", [again.status, again.json.run.status, rows(f, "SELECT attempts FROM ff_run")[0].attempts], [200, "not_claimed", 1], "a second request for the same night claims nothing");
    const live = await send(worker, env, "/api/ff/run", { method: "POST", as: null, bearer: LIVE_TOKEN, host: LOOP, body: { cadence: "nightly", session: MONDAY } });
    R.eq("run", [live.status, live.code], [403, "forbidden"], "the live credential cannot start a nightly run");
    R.eq("run", log.outbound, outbound, "and no request in this block left the Worker");

    const open = world({ env: { FF_MODE: "on" } });
    clock.set(MON_RTH);
    const armed = await arm(worker, open.env, universeWire());
    clock.set(MON_EVENING);
    await runNightly(worker, open.env, MONDAY);
    const delivered = rows(open.f, "SELECT state FROM ff_hit WHERE wire_id = ?", armed.json.wire.id).map((h) => h.state);
    const listed = await send(worker, open.env, "/api/ff/hits");
    R.eq("run", [delivered.length, delivered.includes("held"), listed.json.hits.length, listed.json.shadow === true], [7, false, 7, false], "with FF_MODE on the same night's hits are not held and the inbox lists them");
  },

  async housekeeping(load, R, clock, log) {
    const worker = await load();
    const ffTrips = (f, from) => f.trips.slice(from).filter((t) => t.sqls.some((sql) => /\bff_[a-z_]+/.test(sql)));
    const runs = (f) => rows(f, "SELECT id, status, attempts FROM ff_run ORDER BY id");
    const readOnly = (f, from) => ffTrips(f, from).every((t) => t.sqls.every((sql) => /^SELECT/.test(sql)));
    {
      clock.set(MON_RTH);
      const { f, env } = world({ metricsSession: FRIDAY });
      const uni = await arm(worker, env, universeWire());
      clock.set(MON_EVENING);
      const stale = await fire(worker, env, clock.at);
      R.eq("housekeeping", [stale.threw, stale.guards, runs(f).filter((r) => r.id === "nightly:" + MONDAY)], [null, 4, []], "figures of an older session never start the night: no run row is claimed");
      const spent = async (extra) => {
        const fresh = await load();
        const w = world({ env: extra });
        const before = log.outbound;
        const out = await fire(fresh, w.env, clock.at);
        return [out.guards, log.outbound - before];
      };
      R.eq("housekeeping", await spent({}), await spent({ FF_MODE: "off" }), "H9: the housekeeping adds no guard and no outbound request to the cron firing: the count with Fire & Forget in shadow is the count with it off");
      f.put("ff-metrics", metricsPayload(NAMES, { sessionDate: MONDAY }));
      await fire(worker, env, clock.at);
      R.eq("housekeeping", runs(f).filter((r) => r.id === "nightly:" + MONDAY), [{ id: "nightly:" + MONDAY, status: "done", attempts: 1 }], "once the night's figures are stored the cron evaluates it without the pipeline's request");
      R.eq("housekeeping", rows(f, "SELECT COUNT(*) AS n, MIN(state) AS s FROM ff_hit WHERE wire_id = ?", uni.json.wire.id)[0], { n: 7, s: "held" }, "and stores its hits as held");
      const from = f.trips.length;
      await fire(worker, env, clock.at);
      R.eq("housekeeping", [runs(f).filter((r) => r.id === "nightly:" + MONDAY)[0].attempts, ffTrips(f, from).some((t) => t.sqls.some((sql) => /^INSERT INTO ff_hit/.test(sql)))], [1, false], "a later firing does not evaluate the night again");
      clock.set(MON_LATE);
      const after = f.trips.length;
      await fire(worker, env, clock.at);
      const sent = ffTrips(f, after);
      R.eq("housekeeping", [sent.length, sent.every((t) => t.sqls.every((sql) => /^SELECT/.test(sql))), sent.reduce((n, t) => n + (t.rows || 0), 0)], [2, true, 2],
        "past the deadline a steady firing reads the night's run row twice, two rows, and writes nothing");
      R.eq("housekeeping", rows(f, "SELECT COUNT(*) AS n FROM ff_receipt WHERE session = ? AND status = 'not_evaluated'", MONDAY)[0].n, 0, "and flags nothing for a night that ran");
    }
    {
      clock.set(MON_RTH);
      const { f, env } = world({ metricsSession: FRIDAY });
      const uni = await arm(worker, env, universeWire());
      clock.set(MON_LATE);
      await fire(worker, env, clock.at);
      R.eq("housekeeping", rows(f, "SELECT status, reason FROM ff_receipt WHERE wire_id = ? AND session = ?", uni.json.wire.id, MONDAY), [{ status: "not_evaluated", reason: "run_late" }],
        "a night whose figures never came is flagged not evaluated past the deadline, with its reason");
      R.eq("housekeeping", rows(f, "SELECT COUNT(*) AS n FROM ff_hit")[0].n, 0, "and nothing is evaluated on old figures");
    }
    {
      clock.set(MON_EVENING);
      const failedOnce = world();
      seedRun(failedOnce.f, { id: "nightly:" + MONDAY, kind: "nightly", session: MONDAY, status: "failed", attempts: 1, error: "boom" });
      await fire(worker, failedOnce.env, clock.at);
      R.eq("housekeeping", runs(failedOnce.f), [{ id: "nightly:" + MONDAY, status: "done", attempts: 2 }], "a failed run is retried");
      const spent = world();
      seedRun(spent.f, { id: "nightly:" + MONDAY, kind: "nightly", session: MONDAY, status: "failed", attempts: 3, error: "boom" });
      const spentFrom = spent.f.trips.length;
      await fire(worker, spent.env, clock.at);
      R.eq("housekeeping", runs(spent.f), [{ id: "nightly:" + MONDAY, status: "failed", attempts: 3 }], "and not past its third attempt");
      R.eq("housekeeping", readOnly(spent.f, spentFrom), true, "nor is a claim sent for it: the firing only reads the run table");
      const leased = world();
      leased.f.db.prepare("INSERT INTO ff_run (id, kind, session, slot, status, attempts, lease_until, started_at) VALUES (?, 'nightly', ?, 'n', 'running', 1, ?, ?)").run("nightly:" + MONDAY, MONDAY, clock.at + 60000, clock.at - 1000);
      const leasedFrom = leased.f.trips.length;
      await fire(worker, leased.env, clock.at);
      R.eq("housekeeping", runs(leased.f), [{ id: "nightly:" + MONDAY, status: "running", attempts: 1 }], "a run inside its lease is left alone");
      R.eq("housekeeping", readOnly(leased.f, leasedFrom), true, "and no claim is sent for it");
      const expired = world();
      expired.f.db.prepare("INSERT INTO ff_run (id, kind, session, slot, status, attempts, lease_until, started_at) VALUES (?, 'nightly', ?, 'n', 'running', 1, ?, ?)").run("nightly:" + MONDAY, MONDAY, clock.at - 60000, clock.at - 900000);
      await fire(worker, expired.env, clock.at);
      R.eq("housekeeping", runs(expired.f), [{ id: "nightly:" + MONDAY, status: "done", attempts: 2 }], "and one past its lease is taken over");
    }
    {
      clock.set(TUE_RTH);
      const { f, env } = world();
      R.ok("housekeeping", clock.at >= nightlyFinal(MONDAY), "fixture: Tuesday's session has opened");
      await fire(worker, env, clock.at);
      R.eq("housekeeping", runs(f), [], "once the next session has opened the missed night is no longer evaluated");
    }
    {
      const { f, env } = world();
      for (const day of ["2026-10-01", "2026-10-13", "2026-10-14", "2026-10-27"]) seedRun(f, { id: "nightly:" + day, kind: "nightly", session: day });
      clock.set(TUE_LATE);
      await fire(worker, env, clock.at);
      R.eq("housekeeping", runs(f).length, 4, "outside the 03:00 ET window no run row is pruned");
      clock.set(WED_PRUNE);
      await fire(worker, env, clock.at);
      R.eq("housekeeping", runs(f).map((r) => r.id), ["nightly:2026-10-14", "nightly:2026-10-27"], "in it the run rows older than fourteen days go");
    }
    {
      clock.set(MON_EVENING);
      const { f, env } = world();
      f.fail(/\bff_run\b/);
      const before = log.events("ff housekeeping failed").length;
      const out = await fire(worker, env, clock.at);
      R.eq("housekeeping", [out.threw, out.guards, out.settled], [null, 4, ["settled", "settled", "settled", "settled"]], "a store that refuses the run table fails this guard alone: the handler returns and every other guard runs");
      R.eq("housekeeping", log.events("ff housekeeping failed").length - before, 1, "and it is logged once");
    }
  },

  async live(load, R, clock, log) {
    const worker = await load();
    const body = (rowsOf, at) => liveAlerts(rowsOf, { readAt: at - 20000, session: MONDAY });
    const near = () => windowRow("SYA101", { exp: "2026-11-06", spanStart: "2026-10-26T14:40:00.000Z" });
    const liveRow = (f) => rows(f, "SELECT id FROM flows_live WHERE id = 'live:alerts'").length;
    const setup = async (envExtra = {}) => {
      clock.set(MON_RTH);
      const w = world({ env: { ...liveEnv, ...envExtra } });
      const made = await arm(worker, w.env, liveAst());
      return { ...w, wire: made.json.wire.id };
    };
    {
      const { f, env, wire } = await setup();
      const from = f.trips.length;
      const out = await postLive(worker, env, body([near(), windowRow("SYB201", { prem: 900000 })], clock.at));
      R.eq("live", [out.status, out.json.stored, out.background, liveRow(f)], [200, "written", ["settled"], 1], "a live:alerts write lands and one background task follows it");
      R.eq("live", rows(f, "SELECT subject, state, evaluator, stream FROM ff_hit WHERE wire_id = ?", wire), [{ subject: "c:SYA101:SYA101261120C00100000", state: "held", evaluator: "live", stream: MEMBER }],
        "the task evaluates the live wires on the record just written and holds the hit in shadow");
      const look = Math.floor((clock.at - 20000 - Date.parse("2026-10-26T13:30:00Z")) / 300000);
      R.eq("live", rows(f, "SELECT id, status, slot, error FROM ff_run"), [{ id: "live:" + MONDAY, status: "done", slot: "t" + look, error: null }], "and records the tick under the five-minute slot of the record's own read time");
      R.ok("live", ffSql(f, from).length > 0, "fixture: the tick sent statements");
      const again = await postLive(worker, env, body([near(), windowRow("SYB201", { prem: 900000 })], clock.at));
      R.eq("live", [again.status, rows(f, "SELECT COUNT(*) AS n FROM ff_hit WHERE wire_id = ?", wire)[0].n], [200, 1], "the same record posted again writes no second hit");
    }
    {
      const { f, env, wire } = await setup();
      clock.set(MON_EVENING);
      await runNightly(worker, env, MONDAY);
      clock.set(MON_RTH);
      await postLive(worker, env, body([windowRow("SYB201", { prem: 900000 })], clock.at - 300000));
      R.eq("live", rows(f, "SELECT status FROM ff_run WHERE id = ?", "live:" + MONDAY), [{ status: "done" }], "fixture: a first tick ran clean");
      f.fail(/FROM ff_state/);
      const before = log.events("ff live tick failed").length;
      const out = await postLive(worker, env, body([near()], clock.at));
      R.eq("live", [out.status, out.json && out.json.stored, liveRow(f)], [200, "written", 1], "H14: when the engine's read throws the live write still lands and is answered");
      R.eq("live", rows(f, "SELECT COUNT(*) AS n FROM ff_hit WHERE wire_id = ?", wire)[0].n, 0, "no hit is written");
      const run = rows(f, "SELECT status, error FROM ff_run WHERE id = ?", "live:" + MONDAY)[0] || {};
      R.eq("live", [run.status, typeof run.error === "string" && run.error.length > 0], ["failed", true], "the run row records the error");
      R.eq("live", log.events("ff live tick failed").length - before, 1, "and the failure is logged once");
      f.fail(null);
      const fresh = await load();
      const health = await send(fresh, env, "/api/ff/health");
      R.eq("live", [health.json.state, health.json.reason], ["degraded", "evaluator_error"], "and the health route goes degraded with its reason");
    }
    {
      const { f, env } = await setup();
      let reads = 0;
      const trapped = new Proxy(env, { get: (target, key) => {
        if (key === "FF_MODE" && ++reads > 2) throw new Error("env trap in the tick");
        return target[key];
      } });
      const before = log.events("ff live tick failed").length;
      const out = await postLive(worker, trapped, body([near()], clock.at));
      R.eq("live", [out.status, out.json && out.json.stored, liveRow(f), out.background], [200, "written", 1, ["settled"]], "H14: a tick that rejects outright cannot turn the landed write into an error");
      R.eq("live", [reads > 2, log.events("ff live tick failed").length - before], [true, 1], "and is logged once");
    }
    {
      const { f, env } = await setup();
      const trapped = new Proxy(env, { get: (target, key) => {
        if (key === "FF_MODE") throw new Error("env trap in the hook");
        return target[key];
      } });
      const before = log.events("ff live tick failed").length;
      const out = await postLive(worker, trapped, body([near()], clock.at));
      R.eq("live", [out.status, out.json && out.json.stored, liveRow(f)], [200, "written", 1], "H14: a hook that throws before it starts the tick cannot reach the response either");
      R.eq("live", log.events("ff live tick failed").length - before, 1, "and is logged once");
    }
    {
      const { f, env } = await setup();
      f.hangOnce(/FROM ff_wire w JOIN/);
      const out = await Promise.race([
        postLive(worker, env, body([near()], clock.at), { wait: false }),
        new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      R.eq("live", [out === null ? "held" : out.status, liveRow(f)], [200, 1], "H14: an evaluation that never returns does not hold the response");
    }
    {
      const { f, env } = await setup();
      const from = f.trips.length;
      const beat = { v: 1, key: "live:heartbeat", fresh: { v: 1, readAt: new Date(clock.at).toISOString(), source: "actions", cadenceS: 900, session: MONDAY, writer: "flows-live" }, run: { calls: 1, failedCalls: 0 } };
      const other = await send(worker, env, "/api/flows/ingest?key=live:heartbeat", { method: "POST", as: null, bearer: LIVE_TOKEN, body: beat, host: LOOP });
      R.eq("live", [other.status, ffSql(f, from)], [200, []], "a write of another live key starts no evaluation");
      const bad = await postLive(worker, env, { v: 2, rows: [] });
      R.eq("live", [bad.status >= 400, ffSql(f, from)], [true, []], "a refused write starts none");
      const read = await send(worker, env, "/api/flows/ingest?key=live:alerts", { method: "GET", as: null, bearer: LIVE_TOKEN, host: LOOP });
      R.eq("live", [read.status, ffSql(f, from)], [200, []], "a read starts none");
      clock.set(MON_EVENING);
      const closed = await postLive(worker, env, liveAlerts([near()], { readAt: clock.at - 20000, session: MONDAY }));
      R.eq("live", [closed.status, ffSql(f, from)], [200, []], "outside the regular session a landed write sends no ff_ statement");
    }
  },
};

const MUTANTS = [
  { name: "the live tick is awaited before the write is answered", group: "live", target: "worker.js",
    transforms: [["      ffAfterLive(request, env, url, response, ctx);\n", "      if (url.searchParams.get(\"key\") === \"live:alerts\" && request.method === \"POST\" && response.status === 200 && ffMode(env) !== \"off\") await ffLiveTick(env, Date.now());\n"]] },
  { name: "a live tick starts behind every live key", group: "live", target: "worker.js",
    transforms: [["if (url.searchParams.get(\"key\") !== \"live:alerts\" || ffMode(env) === \"off\") return;", "if (ffMode(env) === \"off\") return;"]] },
  { name: "a refused live write starts an evaluation", group: "live", target: "worker.js",
    transforms: [["if (url.pathname !== \"/api/flows/ingest\" || request.method !== \"POST\" || response.status !== 200) return;", "if (url.pathname !== \"/api/flows/ingest\" || request.method !== \"POST\") return;"]] },
  { name: "the live record is read without its session day", group: "live", target: "worker.js",
    transforms: [["? { ...body, day: body.sessionDate } : null;", "? { ...body } : null;"]] },
  { name: "the hook's catch is gone", group: "live", target: "worker.js",
    transforms: [["  } catch (error) {\n    logFailure(\"error\", \"ff live tick failed\", { route: url.pathname }, error);\n  }\n}", "  } finally {\n    void 0;\n  }\n}"]] },
  { name: "a failed live tick is not logged", group: "live", target: "worker.js",
    transforms: [["      if (out && out.status === \"failed\") failed(out.error);\n    }, failed));", "    }, () => {}));"]] },
  { name: "housekeeping is awaited in the cron handler", group: "housekeeping", target: "worker.js",
    transforms: [["    guard(\"ff housekeeping failed\", ffHousekeeping(env, at));", "    await ffHousekeeping(env, at);"]] },
  { name: "the cron evaluates the night on whatever figures are stored", group: "housekeeping", target: "worker.js",
    transforms: [["(!run || run.attempts < EVAL_LIMITS.attempts) && (await ffNightlyHeld(env, session))", "(!run || run.attempts < EVAL_LIMITS.attempts)"]] },
  { name: "the cron retries without an attempts ceiling", group: "housekeeping", target: "worker.js",
    transforms: [["if (open && (!run || run.attempts < EVAL_LIMITS.attempts) && ", "if (open && "]] },
  { name: "the cron takes over a run inside its lease", group: "housekeeping", target: "worker.js",
    transforms: [["(run.status === \"running\" && !(run.lease_until > at))", "run.status === \"running\""]] },
  { name: "the cron evaluates a night after the next session opened", group: "housekeeping", target: "worker.js",
    transforms: [["if (session && at < nightlyFinal(session)) {", "if (session) {"]] },
  { name: "the gap check is dropped", group: "housekeeping", target: "worker.js",
    transforms: [["const gap = await FF_EVAL.gap(env, { at });", "const gap = { status: \"none\" };"]] },
  { name: "run rows are pruned on every firing", group: "housekeeping", target: "worker.js",
    transforms: [["if (FLOWS_LIVE.pruneDue(at)) await FF_STORE.pruneRuns(", "await FF_STORE.pruneRuns("]] },
  { name: "run rows are kept seven days", group: "housekeeping", target: "worker.js",
    transforms: [["shiftDay(easternDay(at), -FF_BUDGET.runRetention)", "shiftDay(easternDay(at), -7)"]] },
  { name: "housekeeping runs with the switch off", group: "switches", target: "worker.js",
    transforms: [["  if (ffMode(env) === \"off\" || !env.DB) return null;\n  const phase = phaseAt(at, FLOWS_LIVE.memoizedClock(at));", "  const phase = phaseAt(at, FLOWS_LIVE.memoizedClock(at));"]] },
  { name: "the run route evaluates a night whose figures are not stored", group: "run", target: "worker.js",
    transforms: [["if (cadence === \"nightly\" && !(await ffNightlyHeld(env, session))) {", "if (false) {"]] },
  { name: "any bearer starts a run", group: "run", target: "worker.js",
    transforms: [["  if (kind || !FLOWS_LIVE.looksLikeJwt(offered)) return kind;", "  if (offered) return \"nightly\";\n  if (kind || !FLOWS_LIVE.looksLikeJwt(offered)) return kind;"]] },
  { name: "the live credential may start a nightly run", group: "run", target: "worker.js",
    transforms: [["  if (cadence === \"nightly\" && kind !== \"nightly\") throw HttpError.of(\"forbidden\");\n", ""]] },
  { name: "the evaluator ignores shadow", group: "run", target: "worker.js",
    transforms: [["const FF_EVAL = createEvaluator({ store: FF_STORE, flowsStore: FLOWS_STORE, mode: ffMode });", "const FF_EVAL = createEvaluator({ store: FF_STORE, flowsStore: FLOWS_STORE, mode: () => \"on\" });"]] },
  { name: "a body with no cooldown is refused", group: "compile", target: "worker.js",
    transforms: [["const ast = plain && body.cooldown === undefined && Object.hasOwn(FF_LIMITS.cooldownDefault, body.cadence)", "const ast = false"]] },
  { name: "a template hint is believed without its clauses", group: "compile", target: "worker.js",
    transforms: [["return [template.ast.all, ...(template.variants || []).map((v) => v.clauses)].some((all) => ffClauseHash(all) === mine) ? template.id : null;", "return mine ? template.id : null;"]] },
  { name: "the family of a tested wire has no size", group: "compile", target: "worker.js",
    transforms: [["universe: universe.symbols, sectors: universe.sectors, universeSize: universe.symbols.size, now,", "universe: universe.symbols, sectors: universe.sectors, universeSize: 1, now,"]] },
  { name: "a preview lists only the names that hold", group: "preview", target: "worker.js",
    transforms: [["    return wire.scope.symbols.map((symbol) => {\n      if (held.has(symbol)) return held.get(symbol);", "    return wire.scope.symbols.filter((symbol) => held.has(symbol)).map((symbol) => {\n      if (held.has(symbol)) return held.get(symbol);"]] },
  { name: "an absent figure previews as not holding", group: "preview", target: "worker.js",
    transforms: [["return { subject: \"n:\" + symbol, symbol, verdict: \"unknown\", reason: Object.keys(one.reasons)[0] || lost, clauses: [] };", "return { subject: \"n:\" + symbol, symbol, verdict: \"false\", reason: null, clauses: [] };"]] },
  { name: "a nightly window wire previews as nothing holding", group: "preview", target: "worker.js",
    transforms: [["if (nightly && wire.subjectKind === \"c\" && !wire.clauses.some((c) => c.m === \"contract.oi_confirm\")) {", "if (false) {"]] },
  { name: "a nightly window wire previews with no reason why", group: "preview", target: "worker.js",
    transforms: [["return { status: \"unavailable\", reason: \"source_missing\", detail: \"windows_unread\", subjects: [] };", "return { status: \"unavailable\", reason: \"source_missing\", subjects: [] };"]] },
  { name: "the first-use DDL is probed on every request", group: "ddl", target: "worker.js",
    transforms: [["    .then(() => { state.ffReady = true; }, (error) => logFailure(\"warn\", \"ff schema bootstrap failed\", {}, error))", "    .then(() => { state.ffReady = false; }, (error) => logFailure(\"warn\", \"ff schema bootstrap failed\", {}, error))"]] },
  { name: "the tables are never created at first use", group: "ddl", target: "worker.js",
    transforms: [["const FF_TABLES = createFfStore({ ensureFf });", "const FF_TABLES = createFfStore({ ensureFf: async () => {} });"]] },
];

const SALT = { n: 0 };
const realLoad = () => loadWorker();
const mutantLoad = (m) => async () => (await loadMutated(m.target, m.transforms, { salt: ++SALT.n })).default;

async function runGroups(load, groups, clock, log) {
  const R = recorder();
  for (const name of groups) {
    try {
      await GROUPS[name](load, R, clock, log);
    } catch (error) {
      R.ok(name, false, name + " threw: " + (error && error.stack ? error.stack.split("\n").slice(0, 3).join(" | ") : error));
    }
  }
  return R;
}

const log = quiet();
const clock = pinClock(Date.parse(MON_RTH));
let exit = 0;
const out = [];
try {
  const real = await runGroups(realLoad, Object.keys(GROUPS), clock, log);
  if (real.fails.length) {
    for (const f of real.fails.slice(0, 30)) out.push("  FAIL [" + f.group + "] " + f.msg);
    out.push(`server-ff: ${real.fails.length} of ${real.checks} checks failed on the real Worker`);
    exit = 1;
  } else {
    out.push(`server-ff: ${real.checks} checks hold on the real Worker`);
    const survivors = [];
    let planted = 0;
    for (const m of MUTANTS) {
      if (m.pending) continue;
      planted++;
      let caught = false;
      try {
        const r = await runGroups(mutantLoad(m), [m.group], clock, log);
        caught = r.fails.length > 0;
      } catch (error) {
        out.push("  planted build did not load: " + m.name + ": " + (error && error.message));
        exit = 1;
        continue;
      }
      if (!caught) survivors.push(m.name);
    }
    if (survivors.length) {
      for (const s of survivors) out.push("  SURVIVED " + s);
      exit = 1;
    }
    out.push(`server-ff: ${planted - survivors.length} of ${planted} planted wrong builds of the mount fail`);
  }
} finally {
  clock.restore();
  log.restore();
}

if (exit === 0) {
  const R = recorder();
  const w = workerSource();
  const text = moduleSource("worker.js");
  const ok = (cond, msg) => R.ok("scan", cond, msg);
  ok(expect(w, /createRouter\([\s\S]*?flowsFfRows\(\{ store: FF_STORE, flowsStore: FLOWS_STORE, core: FF_CORE,/, { min: 1, max: 1, why: "the Worker's one table takes the ff family" }) === 1, "the ff family is a family of the Worker's one route table");
  ok(count(text, /ffAfterLive\(request, env, url, response, ctx\);/g) === 1 && count(text, /\bffLiveTick\(/g) === 3, "the live hook is called once, from the fetch handler, and the tick from the hook and the run route alone");
  ok(count(text, /guard\("ff housekeeping failed", ffHousekeeping\(env, at\)\);/g) === 1 && count(text, /\bffHousekeeping\(/g) === 2, "the housekeeping runs once, behind its own guard");
  const block = slice(text, "async function ensureFf(env) {", "function nightlyFreshHeaders(");
  ok(absent(block, /\buwFetch\b|\bcappedAi\b|\baskModels\b|\bmeteredAi\b|\bvendorGate\b|\bfetch\(|\.AI\b|UW_ONDEMAND|MEMBER_VENDOR/, { anchor: /const FF_CORE = Object\.freeze\(\{/, why: "the mount reaches no feed, no model and no limiter of theirs" }), "the mount's block names no feed client, no model and no vendor limiter");
  ok(absent(block, /\.prepare\(|\.batch\(/, { anchor: /FF_STORE\.runRow\(/, why: "every ff_ statement lives in lane B's store and lane C's evaluator" }), "and prepares no statement itself");
  ok(absent(text, /CREATE (TABLE|INDEX|TRIGGER)[^"\n]*\bff_/, { anchor: /bootstrapFf\(env\.DB\)/, why: "the DDL is shared/ff-schema.js's" }), "worker.js holds no ff_ DDL: the first-use fallback is the schema leaf's");
  const pages = moduleSource("server/routes/flows-pages.js");
  ok(count(pages, /if \(session && page\.ff && !ffPageOpen\(env, page\.ff\)\) throw HttpError\.of\("not_found"\);/g) === 1, "the page family closes a Fire & Forget page behind its switch after the session is read");
  ok(count(pages, /const rendered = fireNav\(shelled, ffPageOpen\(env, "fire"\), slug\);/g) === 1, "and adds the Fire entry to a member's sidebar only while Fire is open");
  const toml = moduleSource("wrangler.toml");
  const staging = moduleSource("wrangler.staging.toml");
  const limiter = (src, name) => {
    const m = new RegExp("\\[\\[ratelimits\\]\\]\\nname = \"" + name + "\"\\nnamespace_id = \"(\\d+)\"\\nsimple = \\{ limit = (\\d+), period = (\\d+) \\}").exec(src);
    return m ? [m[1], Number(m[2]), Number(m[3])] : null;
  };
  R.eq("scan", [limiter(toml, "FF_WRITE"), limiter(toml, "FF_HEAVY"), limiter(toml, "FF_HEALTH"), limiter(toml, "FF_PREVIEW")], [["1131", 10, 60], ["1132", 6, 60], ["1133", 4, 60], ["1134", 30, 60]], "wrangler.toml binds the four limiters lane B reads, at its limits");
  R.eq("scan", [limiter(staging, "FF_WRITE"), limiter(staging, "FF_HEAVY"), limiter(staging, "FF_HEALTH"), limiter(staging, "FF_PREVIEW")], [["2131", 10, 60], ["2132", 6, 60], ["2133", 4, 60], ["2134", 30, 60]], "and staging binds them under its own namespaces");
  const ids = [...toml.matchAll(/namespace_id = "(\d+)"/g)].map((m) => m[1]);
  ok(new Set(ids).size === ids.length, "no two production limiters share a namespace");
  for (const [key, value] of Object.entries(FF_ON)) ok(new RegExp("^" + key + " = \"" + value + "\"$", "m").test(toml), "wrangler.toml ships " + key + " = " + value);
  if (R.fails.length) {
    for (const f of R.fails) out.push("  FAIL [scan] " + f.msg);
    exit = 1;
  } else out.push(`server-ff: ${R.checks} source and configuration checks hold`);
}

for (const line of out) console.log(line);
process.exit(exit);
