import { EXPORT_COLUMNS, COPY_BANNED } from "../../shared/ff-contract.js";
import { limiter, parseCsv } from "./ff-b-kit.mjs";
import { alice, bob, astOf, hitIdOf, liveAst, seedHit, seedWire, seedRun, seedReceipt, seedRecord, NOW, SESSION, PREV_SESSION, NAMES } from "./ff-b-world.mjs";

const rawOne = (api, sql, ...args) => {
  const r = api.world.f.db.prepare(sql).get(...args);
  return r === undefined ? undefined : { ...r };
};

const houseWire = async (api, id, { cadence = "nightly", title = "House wire " + id, sentence = "House sentence " + id } = {}) => {
  const body = cadence === "live" ? liveAst({ scope: { kind: "universe" } }) : astOf({ scope: { kind: "universe" } });
  const compiled = await api.world.core.compile({ body, universe: api.world.universe });
  seedWire(api.world.f, { member: null, id, title, cadence, scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence, template: "T" + id.slice(3, 5) });
};

const TIME = (day, hh, mm) => Date.parse(day + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00Z");

export async function digest(c, build) {
  const api = build();
  const S = PREV_SESSION;
  await houseWire(api, "h-t01");
  await houseWire(api, "h-t07a");
  await houseWire(api, "h-t03", { cadence: "live" });
  const wn = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYA102"] } }) }, user: alice })).body.wire.id;
  const wl = (await api.call("POST", "/api/ff/wires", { body: { ast: liveAst() }, user: alice })).body.wire.id;
  const t0 = TIME(S, 21, 0);
  for (let i = 0; i < 5; i++) seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: NAMES[i], key: "dg-h1-" + i, session: S, firedAt: t0 + i * 1000, dataAsOf: t0 + i * 1000 - 9000, label: "close" });
  seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: "SYA101", key: "dg-h1-old", session: "2026-10-23", firedAt: TIME("2026-10-23", 21, 0), dataAsOf: TIME("2026-10-23", 20, 59), label: "close" });
  seedHit(api.world.f, { stream: "house", wire: "h-t07a", symbol: "SYB201", key: "dg-h7", session: S, firedAt: t0 + 9000, dataAsOf: t0, label: "close" });
  for (let i = 0; i < 2; i++) seedHit(api.world.f, { stream: "house", wire: "h-t03", symbol: NAMES[i + 4], key: "dg-h3-" + i, session: S, firedAt: TIME(S, 15, i * 15), dataAsOf: TIME(S, 15, i * 15) - 7000, evaluator: "live", label: "open+1h05m" });
  for (let i = 0; i < 3; i++) seedHit(api.world.f, { stream: "alice.one", wire: wn, symbol: NAMES[i], key: "dg-a-" + i, session: S, firedAt: t0 + 20000 + i, dataAsOf: t0, label: "close" });
  seedHit(api.world.f, { stream: "alice.one", wire: wl, symbol: "SYA101", key: "dg-al", session: S, firedAt: TIME(S, 14, 5), dataAsOf: TIME(S, 14, 5) - 3000, evaluator: "live", label: "open+35m" });
  seedHit(api.world.f, { stream: "alice.one", wire: wn, symbol: "SYA102", key: "dg-a-other-day", session: "2026-10-23", firedAt: TIME("2026-10-23", 21, 5), dataAsOf: TIME("2026-10-23", 21, 0), label: "close" });
  seedHit(api.world.f, { stream: "bob.two", wire: wn, symbol: "SYA102", key: "dg-bob", session: S, firedAt: t0 + 30000, dataAsOf: t0, label: "close", member: "bob.two" });
  seedReceipt(api.world.f, { wire: "h-t01", session: S });
  seedReceipt(api.world.f, { wire: "h-t07a", session: S });
  seedReceipt(api.world.f, { wire: "h-t03", session: S, status: "not_evaluated", reason: "run_late" });
  seedReceipt(api.world.f, { wire: wn, session: S });
  seedReceipt(api.world.f, { wire: wl, session: S, status: "not_evaluated", reason: "source_stale" });
  seedRecord(api.world.f, { wire: "h-t01", firings: 3, sessions: 60 });
  seedRecord(api.world.f, { wire: "h-t07a", firings: 1, sessions: 100 });
  seedRun(api.world.f, { id: "nightly:" + S, kind: "nightly", session: S });
  const r = await api.call("GET", "/api/ff/digest?d=" + S, { user: alice });
  c.eq(r.status, 200, "digest: the day's digest answers");
  const d = r.body.digest;
  c.eq([d.session, r.body.latest, d.quadrants.map((q) => q.id)], [S, SESSION, ["house-nightly", "house-live", "yours-nightly", "yours-live"]], "digest: four quadrants in the contract's order");
  const [hn, hl, yn, yl] = d.quadrants;
  c.eq(hn.title + "|" + hl.title + "|" + yn.title + "|" + yl.title, "House · Nightly|House · Live|Yours · Nightly|Yours · Live", "digest: their titles");
  c.eq(hn.hits.map((g) => g.wire.id), ["h-t07a", "h-t01"], "digest: the rarer wire leads (1 in 100 before 1 in 20)");
  c.eq(hn.hits.map((g) => g.rarity.text), ["1 in 100 sessions", "1 in 20 sessions"], "digest: rarity from sessions over firings");
  const t01 = hn.hits.find((g) => g.wire.id === "h-t01");
  c.eq([t01.count, t01.grouped, t01.hits.length, t01.more], [5, true, 3, 2], "digest: more than three hits of one wire are grouped, three shown, two counted");
  c.eq(hn.total, 6, "digest: six house nightly hits in the session, the other day's left out");
  c.eq([hl.total, hl.hits[0].grouped, hl.hits[0].rarity.reason], [2, false, "short_history"], "digest: two live house hits, ungrouped, with no rarity until 20 sessions");
  c.eq([yn.total, yn.hits[0].wire.id, yn.hits[0].count, yn.hits[0].grouped, yn.hits[0].hits.length], [3, wn, 3, false, 3], "digest: her three nightly hits are exactly at the grouping line and stay ungrouped");
  c.eq([yl.total, yl.hits[0].wire.id], [1, wl], "digest: her live hit");
  c.eq(hn.receipts.line, "2 evaluated", "digest: the house nightly receipts line");
  c.eq(hl.receipts.line, "0 evaluated, 1 not evaluated: run_late", "digest: the house live receipts line names the reason");
  c.eq(yn.receipts.line, "1 evaluated", "digest: her nightly line");
  c.eq(yl.receipts.line, "0 evaluated, 1 not evaluated: source_stale", "digest: her live line");
  c.eq(hn.run.status, "done", "digest: the nightly run is attached to the nightly quadrants");
  c.eq(hl.run.reason, "not_measured", "digest: no live run is an absent figure with its reason");
  c.ok(d.quadrants.every((q) => q.complete === true), "digest: every quadrant is complete with few rows");
  c.eq(d.complete, true, "digest: and so is the digest");
  c.ok(!r.text.includes("dg-bob") && !JSON.stringify(r.body).includes(rawOne(api, "SELECT hit_id FROM ff_hit WHERE dedupe_key = 'dg-bob'").hit_id), "digest: another member's hit is absent");
  const flat = d.quadrants.flatMap((q) => q.hits.flatMap((g) => g.hits));
  c.ok(flat.every((h) => h.unread === false), "digest: nothing is unread in a digest");

  const muted = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
  const m = await api.call("GET", "/api/ff/digest?d=" + S, { user: alice });
  c.ok(muted.body.muted && m.body.digest.quadrants.flatMap((q) => q.hits.flatMap((g) => g.hits)).every((h) => h.symbol !== "SYA101"), "digest: a muted name leaves the digest");
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: false }, user: alice });
  await api.call("POST", "/api/ff/house", { body: { id: "h-t07a", follow: false }, user: alice });
  const off = await api.call("GET", "/api/ff/digest?d=" + S, { user: alice });
  c.eq(off.body.digest.quadrants[0].hits.map((g) => g.wire.id), ["h-t01"], "digest: a house wire she left is gone from hits");
  c.eq(off.body.digest.quadrants[0].receipts.line, "1 evaluated", "digest: and from its receipts line");
  const bobs = await api.call("GET", "/api/ff/digest?d=" + S, { user: bob });
  c.eq(bobs.body.digest.quadrants[0].hits.map((g) => g.wire.id), ["h-t07a", "h-t01"], "digest: bob still has it");
  const bobYours = bobs.body.digest.quadrants[2];
  c.eq(bobYours.total, 1, "digest: and only his own hit in his quadrant");
  c.ok(!JSON.stringify(bobs.body).includes(rawOne(api, "SELECT hit_id FROM ff_hit WHERE dedupe_key = 'dg-a-0'").hit_id), "digest: none of alice's hits");

  const latest = await api.call("GET", "/api/ff/digest", { user: alice });
  c.eq([latest.status, latest.body.digest.session], [200, SESSION], "digest: without d it is the latest session");
  for (const [d2, code] of [["2026-09-01", "ff_export_range"], ["2026-10-28", "ff_export_range"], ["2026-10-25", "ff_export_range"], ["2026-11-26", "ff_export_range"], ["2026-02-30", "ff_cursor_invalid"], ["x", "ff_cursor_invalid"], ["2026-10-2", "ff_cursor_invalid"], ["20261026", "ff_cursor_invalid"]]) {
    const e = await api.call("GET", "/api/ff/digest?d=" + d2, { user: alice });
    c.eq([e.status, e.error && e.error.code], [400, code], "digest: d=" + d2 + " is " + code);
  }
  const win = await api.call("GET", "/api/ff/digest?d=2026-09-01", { user: alice });
  c.eq(win.body.latest, SESSION, "digest: a window error names the latest session");
  const nine = await api.call("GET", "/api/ff/digest?d=2026-10-14", { user: alice });
  c.eq(nine.status, 200, "digest: a session nine trading days back is inside the window");
  const eleven = await api.call("GET", "/api/ff/digest?d=2026-10-12", { user: alice });
  c.eq(eleven.status, 400, "digest: eleven back is outside");
  const cost = await api.call("GET", "/api/ff/digest?d=" + S, { user: alice });
  c.ok(cost.read <= 160, "digest: reads a few dozen rows at this size", cost.read);
  c.eq(cost.trips, 1, "digest: in one trip");
}

export async function digestCompleteness(c, build) {
  const S = PREV_SESSION;
  const flood = (api, wire, n, session, symbol, tag) => {
    for (let i = 0; i < n; i++) seedHit(api.world.f, { stream: "alice.one", wire, symbol, key: tag + i, session, firedAt: TIME(session, 21, 0) + i * 1000, dataAsOf: TIME(session, 20, 59), label: "close" });
  };
  const fresh = async () => {
    const api = build();
    const wire = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice })).body.wire.id;
    return { api, wire };
  };
  const quadrant = async (api) => (await api.call("GET", "/api/ff/digest?d=" + S, { user: alice })).body;

  {
    const { api, wire } = await fresh();
    flood(api, wire, 150, S, "SYA101", "a");
    const full = await quadrant(api);
    const q = full.digest.quadrants[2];
    c.eq([q.complete, q.incomplete && q.incomplete.reason, full.digest.complete], [false, "not_measured", false], "completeness: 150 rows all inside the session may hide older ones and the digest says so");
    c.eq(q.total, 150, "completeness: it still counts what it read");
  }
  {
    const { api, wire } = await fresh();
    flood(api, wire, 1, "2026-10-19", "SYA101", "old");
    flood(api, wire, 149, S, "SYA101", "a");
    c.eq((await quadrant(api)).digest.quadrants[2].complete, true, "completeness: 150 rows that reach back past the fence are complete");
  }
  {
    const { api, wire } = await fresh();
    flood(api, wire, 149, S, "SYA101", "a");
    c.eq((await quadrant(api)).digest.quadrants[2].complete, true, "completeness: 149 rows in a stream shorter than the window is every row there is");
  }
  {
    const { api, wire } = await fresh();
    flood(api, wire, 400, S, "SYA101", "a");
    await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
    const r = await quadrant(api);
    c.eq([r.digest.quadrants[2].total, r.digest.quadrants[2].complete], [0, false], "completeness: a flood of muted rows fills the window and nothing visible, so the digest cannot say it is complete");
    const cost = await api.call("GET", "/api/ff/digest?d=" + S, { user: alice });
    c.ok(cost.read <= 700, "completeness: and reads a bounded window, not the stream", cost.read);
  }
  {
    const { api, wire } = await fresh();
    flood(api, wire, 100, "2026-10-19", "SYA101", "old");
    flood(api, wire, 250, S, "SYA101", "a");
    await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
    const r = await quadrant(api);
    c.eq([r.digest.quadrants[2].total, r.digest.quadrants[2].complete], [0, true], "completeness: when the window reaches past the fence the empty answer is complete");
  }
  {
    const { api, wire } = await fresh();
    flood(api, wire, 10, S, "SYA101", "a");
    const compiled = await api.world.core.compile({ body: astOf({ scope: { kind: "universe" } }), universe: api.world.universe });
    seedWire(api.world.f, { member: null, id: "h-t01", title: "House", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence: "House", template: "T01" });
    for (let i = 0; i < 1000; i++) seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: "SYB201", key: "hh" + i, session: S, firedAt: TIME(S, 21, 0) + i, dataAsOf: TIME(S, 20, 59), label: "close" });
    await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false }, user: alice });
    const r = await api.call("GET", "/api/ff/digest?d=" + S, { user: alice });
    c.eq([r.body.digest.quadrants[0].total, r.body.digest.quadrants[0].complete], [0, false], "completeness: a member who left the busiest house wire reads a bounded window, flagged incomplete");
    c.ok(r.read <= 900, "completeness: and at most about a window of rows", r.read);
  }


  const hy = build();
  const ids = [];
  for (const [i, [sessions, firings, last]] of [[30, 0, null], [29, 0, null], [40, 5, "2026-10-26"], [60, 2, "2026-07-01"]].entries()) {
    const r = await hy.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: [NAMES[i]] } }), title: "Hygiene " + i }, user: alice });
    ids.push(r.body.wire.id);
    seedRecord(hy.world.f, { wire: r.body.wire.id, firings, sessions });
    if (last) seedHit(hy.world.f, { stream: "alice.one", wire: r.body.wire.id, symbol: NAMES[i], key: "hy" + i, session: last, firedAt: TIME(last, 21, 0), dataAsOf: TIME(last, 20, 59), label: "close" });
  }
  const h = await hy.call("GET", "/api/ff/digest?d=" + PREV_SESSION, { user: alice });
  const silent = h.body.digest.hygiene.silent.map((x) => x.wire.id).sort();
  c.eq(silent, [ids[0], ids[3]].sort(), "hygiene: a wire with thirty sessions and no hit for thirty sessions is listed, a younger one and a firing one are not");
  c.eq(h.body.digest.hygiene.silent.find((x) => x.wire.id === ids[0]).lastHit.reason, "no_hits", "hygiene: no hit at all is an absent last hit");
}

export async function exportCsv(c, build) {
  const api = build();
  const w = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }) }, user: alice })).body.wire.id;
  await houseWire(api, "h-t01", { sentence: "=HYPERLINK(\"http://x\",\"click\")" });
  const mine = [];
  const house = [];
  const fired = TIME("2026-10-26", 21, 0);
  mine.push(seedHit(api.world.f, { stream: "alice.one", wire: w, symbol: "SYA101", key: "x1", session: "2026-10-26", firedAt: fired, dataAsOf: fired - 60000, label: "close" }));
  mine.push(seedHit(api.world.f, { stream: "alice.one", wire: w, symbol: "SYA101", key: "x2", session: "2026-10-22", firedAt: TIME("2026-10-22", 21, 0), dataAsOf: TIME("2026-10-22", 20, 59), label: "close" }));
  mine.push(seedHit(api.world.f, { stream: "alice.one", wire: w, symbol: "SYA101", key: "x3", session: "2026-09-01", firedAt: TIME("2026-09-01", 21, 0), dataAsOf: TIME("2026-09-01", 20, 59), label: "close" }));
  house.push(seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: "SYB201", key: "xh1", session: "2026-10-26", firedAt: fired + 5000, dataAsOf: fired - 60000, label: "close" }));
  seedHit(api.world.f, { stream: "alice.one", wire: w, symbol: "SYA101", key: "xheld", session: "2026-10-26", firedAt: fired + 1, dataAsOf: fired - 1, label: "close", state: "held" });
  const wd = seedHit(api.world.f, { stream: "alice.one", wire: w, symbol: "SYA101", key: "xwd", session: "2026-10-26", firedAt: fired + 2, dataAsOf: fired - 1, label: "close" });
  await api.store.withdrawHit(api.world.env, wd.hitId, "bad_data", NOW);
  seedHit(api.world.f, { stream: "bob.two", wire: w, symbol: "SYA101", key: "xbob", session: "2026-10-26", firedAt: fired + 3, dataAsOf: fired - 1, label: "close", member: "bob.two" });
  const r = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice });
  c.eq(r.status, 200, "export: answers");
  c.eq(r.headers["content-type"], "text/csv; charset=utf-8", "export: a CSV");
  c.eq(r.headers["content-disposition"], 'attachment; filename="fire-and-forget-hits-2026-10-20_2026-10-27.csv"', "export: with a filename");
  c.eq([...r.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "export: with a byte order mark");
  c.ok(r.text.endsWith("\r\n") && !/[^\r]\n/.test(r.text.replace(/"[^"]*"/g, "")), "export: lines end in CRLF");
  const rows = parseCsv(r.text);
  c.eq(rows[0], EXPORT_COLUMNS, "export: the header is the contract's columns");
  c.ok(!rows[0].some((h) => /(^|_)(px|price|ret|pnl|iv)(_|$)/.test(h)) && !rows[0].includes("note"), "export: no price, return or note column");
  c.eq(rows.length - 1, 3, "export: two of hers and one house row in range, held, withdrawn, other-day and bob's left out");
  c.eq(r.headers["x-ff-rows"], "3", "export: the row count header");
  c.eq(r.headers["x-ff-complete"], "1", "export: and completeness");
  const col = (name) => rows.slice(1).map((x) => x[EXPORT_COLUMNS.indexOf(name)]);
  c.eq(col("hit_id").sort(), [mine[0].hitId, mine[1].hitId, house[0].hitId].sort(), "export: the hit ids");
  const byId = new Map(rows.slice(1).map((x) => [x[0], x]));
  const row = byId.get(mine[0].hitId);
  c.eq(row[EXPORT_COLUMNS.indexOf("fired_at")], "2026-10-27T00:00:00+03:00", "export: fired_at in ISO 8601 with +03:00");
  c.eq(row[EXPORT_COLUMNS.indexOf("data_as_of")], "2026-10-26T23:59:00+03:00", "export: data_as_of likewise");
  c.eq([row[EXPORT_COLUMNS.indexOf("layer")], row[EXPORT_COLUMNS.indexOf("session")], row[EXPORT_COLUMNS.indexOf("session_label")], row[EXPORT_COLUMNS.indexOf("evaluator")]], ["member", "2026-10-26", "close", "nightly"], "export: layer, session, label, evaluator");
  const hrow = byId.get(house[0].hitId);
  c.eq(hrow[EXPORT_COLUMNS.indexOf("sentence")], "'=HYPERLINK(\"http://x\",\"click\")", "export: a sentence that starts with = is defused with an apostrophe and quoted");
  c.ok(JSON.parse(row[EXPORT_COLUMNS.indexOf("evidence_json")]).clauses.length > 0, "export: the evidence is JSON in one cell");
  c.ok(!r.text.includes("bad_data") && !r.text.includes("xheld"), "export: nothing about withdrawn or held rows");
  const order = rows.slice(1).map((x) => Date.parse(x[EXPORT_COLUMNS.indexOf("fired_at")]));
  c.eq(order, [...order].sort((a, b) => a - b), "export: oldest first");

  await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false }, user: alice });
  const left = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice });
  c.eq(parseCsv(left.text).length - 1, 2, "export: a house wire she left is not exported");
  const bobs = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: bob });
  c.eq(parseCsv(bobs.text).length - 1, 2, "export: bob gets his own hit and the house one");

  for (const q of ["from=2026-10-27&to=2026-10-20", "from=2026-10-01&to=2026-11-05", "from=2026-02-30&to=2026-03-01", "from=abc&to=def", "from=2026-10-20", "to=2026-10-27", ""]) {
    const e = await api.call("GET", "/api/ff/export?" + q, { user: alice });
    c.eq([e.status, e.error && e.error.code], [400, "ff_export_range"], "export: " + (q || "no range") + " is ff_export_range");
  }
  const edge = await api.call("GET", "/api/ff/export?from=2026-10-01&to=2026-10-31", { user: alice });
  c.eq(edge.status, 200, "export: thirty-one days is the longest range");
  const over = await api.call("GET", "/api/ff/export?from=2026-10-01&to=2026-11-01", { user: alice });
  c.eq(over.status, 400, "export: thirty-two is too long");
  const empty = await api.call("GET", "/api/ff/export?from=2026-06-01&to=2026-06-05", { user: alice });
  c.eq([empty.status, parseCsv(empty.text).length, empty.headers["x-ff-rows"]], [200, 1, "0"], "export: an empty range is a header alone");
}

export async function exportCompleteness(c, build) {
  const api = build();
  const w = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice })).body.wire.id;
  const ins = api.world.f.db.prepare("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('alice.one', ?, ?, ?, 1, 'alice.one', 'n:SYA101', 'SYA101', NULL, ?, '2026-10-26', 'close', ?, ?, 'nightly', 'e1', '{}', 'delivered')");
  const base = TIME("2026-10-26", 21, 0);
  for (let i = 1; i <= 1000; i++) ins.run(i, hitIdOf(w, "k" + i), w, "k" + i, base + i, base);
  const r = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice });
  c.eq([r.status, r.headers["x-ff-rows"], r.headers["x-ff-complete"]], [200, "1000", "0"], "completeness: a thousand rows in range may hide older ones and the header says so");
  c.ok(r.read <= 1100, "completeness: a thousand rows is the most it reads for a stream", r.read);
}

export async function previews(c, build) {
  const api = build();
  const names = Array.from({ length: 40 }, (_, i) => "SYX" + String(i + 100));
  const big = build({ world: { names } });
  const ok = await api.call("POST", "/api/ff/preview", { body: { ast: astOf() }, user: alice });
  const p = ok.body.preview;
  c.eq([ok.status, p.status, p.reason], [200, "ok", null], "preview: answers ok");
  c.eq(p.coverage, { subjects: 2, evaluated: 2, wouldHit: 2, unknown: 0, reasons: {} }, "preview: both names would hit, worked by hand: sessions 3 and 4 are at most 10 and the date is confirmed");
  c.eq(p.subjects.map((s) => [s.symbol, s.verdict, s.wouldHit]), [["SYA101", "true", true], ["SYA102", "true", true]], "preview: the rows");
  c.eq(p.subjects[0].clauses[0], { metric: "earn.sessions", label: "sessions to the next report", op: "<=", threshold: 10, thresholdText: "10 sessions", value: 3, valueText: "3 sessions", ok: true, precision: 1 }, "preview: a clause carries its value and threshold in words");
  c.eq(p.sentence.startsWith("When "), true, "preview: the wire's sentence");
  c.eq([p.cadence, p.control, p.expWeek.reason], ["nightly", "fact", "not_measured"], "preview: a fact wire has no expected false alarms");
  c.eq(p.freshness.session, PREV_SESSION, "preview: the snapshot's session");
  c.eq([p.freshness.stale, p.freshness.expected], [false, PREV_SESSION], "preview: not stale against the nightly due");
  c.eq(p.evaluator.firstCheck.ms, Date.UTC(2026, 9, 26, 21, 30), "preview: a nightly wire's first check is 17:30 ET after the effective session's close");
  c.eq(p.evaluator.firstCheck.scheduled, true, "preview: labelled scheduled");
  c.ok(p.evaluator.firstCheck.label.endsWith("(scheduled)"), "preview: in words too", p.evaluator.firstCheck.label);
  c.eq(p.slots.history.reason, "not_measured", "preview: the history strip is a reserved slot");
  const keys = [];
  const scan = (v) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.push(k); scan(x); } };
  scan(ok.body);
  c.ok(!keys.some((k) => /^(px|ref_px|price|ret|pnl|fired_at)/.test(k)), "preview: no price, return or later time key anywhere", keys.filter((k) => /^(px|price|ret|pnl)/.test(k)));
  c.eq(ok.written, 0, "preview: writes nothing");
  c.ok(ok.trips <= 2, "preview: at most two trips", ok.trips);

  const unknown = await api.call("POST", "/api/ff/preview", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYB202", "SYC301"] }, all: [{ m: "vol.iv.30d.chg1d", op: ">=", x: 3 }] }) }, user: alice });
  const u = unknown.body.preview;
  c.eq(u.coverage, { subjects: 2, evaluated: 1, wouldHit: 1, unknown: 1, reasons: { missing: 1 } }, "preview: a null input is unknown and counted by reason");
  const row = u.subjects.find((s) => s.symbol === "SYB202");
  c.eq([row.verdict, row.wouldHit, row.reason, row.reasonText, row.clauses[0].value, row.clauses[0].valueText], ["unknown", null, "missing", "— missing", null, "—"], "preview: an unknown row has a null verdict, a reason and an em dash");

  const miss = build();
  miss.world.f.db.prepare("DELETE FROM flows_payload WHERE id = 'ff-metrics'").run();
  const m = await miss.call("POST", "/api/ff/preview", { body: { ast: astOf() }, user: alice });
  c.eq([m.status, m.body.preview.status, m.body.preview.reason, m.body.preview.reasonText], [200, "unavailable", "missing", "— missing"], "preview: no metrics product is unavailable and says why, never an empty list");

  const universe = await big.call("POST", "/api/ff/preview", { body: { ast: astOf({ scope: { kind: "universe" }, all: [{ m: "earn.sessions", op: "<=", x: 100 }] }) }, user: alice });
  const un = universe.body.preview;
  c.eq([un.coverage.subjects, un.coverage.wouldHit, un.subjects.length, un.truncated], [40, 40, 25, true], "preview: a universe wire lists at most 25 of the names that would hit and says it cut the list");
  const two = await big.call("POST", "/api/ff/preview", { body: { ast: astOf({ scope: { kind: "universe" }, all: [{ m: "earn.sessions", op: "<=", x: 5 }] }) }, user: alice });
  c.eq([two.body.preview.coverage.wouldHit, two.body.preview.truncated], [3, false], "preview: a short list is whole");

  const live = build();
  live.world.core.setSession("2026-10-27");
  const lv = await live.call("POST", "/api/ff/preview", { body: { ast: liveAst() }, user: alice });
  c.eq(lv.body.preview.evaluator.firstCheck.ms, Date.UTC(2026, 9, 27, 15, 45), "preview: a live wire in session is checked at the next quarter hour");
  c.eq(lv.body.preview.evaluator.text, "Checked every 15 min in the session (Tier 2)", "preview: described in words");
  live.setNow(Date.UTC(2026, 9, 27, 13, 31));
  const early = await live.call("POST", "/api/ff/preview", { body: { ast: liveAst() }, user: alice });
  c.eq(early.body.preview.evaluator.firstCheck.ms, Date.UTC(2026, 9, 27, 13, 35), "preview: a live wire read just after the open waits for the first tick, five minutes in");
  live.world.core.setSession("2026-10-28");
  const next = await live.call("POST", "/api/ff/preview", { body: { ast: liveAst() }, user: alice });
  c.eq(next.body.preview.evaluator.firstCheck.ms, Date.UTC(2026, 9, 28, 13, 35), "preview: a wire effective tomorrow is first checked five minutes after tomorrow's open");

  const stale = build();
  stale.setNow(Date.UTC(2026, 9, 28, 2, 0));
  const st = await stale.call("POST", "/api/ff/preview", { body: { ast: astOf() }, user: alice });
  c.eq([st.body.preview.freshness.stale, st.body.preview.freshness.expected], [true, "2026-10-27"], "preview: a snapshot older than the nightly due is flagged stale");

  for (const [body, code] of [
    [{}, "ff_grammar_invalid"], [{ ast: 5 }, "ff_grammar_invalid"], [{ ast: astOf({ scope: { kind: "watchlist" } }) }, "ff_scope_reserved"],
    [{ ast: astOf({ scope: { kind: "names", symbols: ["ZZZZ"] } }) }, "ff_symbol_outside_universe"], [{ ast: astOf({ all: [{ m: "nope.metric", op: "<=", x: 1 }] }) }, "ff_grammar_invalid"],
    [{ ast: astOf({ all: [{ m: "earn.sessions", op: "<=", x: 1.5 }] }) }, "ff_grammar_precision"], [{ ast: astOf({ all: [{ m: "flow.put_premium", op: ">=", x: 1000 }] }) }, "ff_metric_unavailable"],
    [{ ast: astOf(), extra: 1 }, "ff_grammar_invalid"],
  ]) {
    const r = await api.call("POST", "/api/ff/preview", { body, user: alice });
    c.eq(r.error && r.error.code, code, "preview: " + JSON.stringify(body).slice(0, 60) + " is " + code);
  }
  const forged = await api.call("POST", "/api/ff/preview", { body: { ast: { ...astOf(), d: { control: "fact" } } }, user: alice });
  c.eq(forged.error && forged.error.code, "ff_grammar_invalid", "preview: a client-derived field is refused");

  const seen = [];
  const limited = build({ world: { env: { FF_HEAVY: limiter(6, seen) } } });
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await limited.call("POST", "/api/ff/preview", { body: { ast: astOf() }, user: alice })).status);
  c.eq(codes, [200, 200, 200, 200, 200, 200, 429, 429], "preview: six a minute through the heavy limiter");
  const prod = build({ host: "https://anilkaya.org" });
  const fixture = await prod.call("POST", "/api/ff/preview", { body: { ast: astOf() }, user: alice });
  c.eq([fixture.status, fixture.error && fixture.error.code], [400, "invalid_ticker"], "preview: a fixture name is refused on the production host");
  const created = await prod.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  c.eq([created.status, created.error && created.error.code], [400, "invalid_ticker"], "preview: and when arming");
}

export async function receiptsAndRecords(c, build) {
  const api = build();
  const w = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice })).body.wire.id;
  await houseWire(api, "h-t01");
  const sessions = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"];
  sessions.forEach((s, i) => seedReceipt(api.world.f, { wire: w, session: s, status: i === 2 ? "not_evaluated" : "evaluated", reason: i === 2 ? "source_stale" : null, hits: i, absent: i === 4 ? JSON.stringify({ thin: 2 }) : null, namesAbsent: i === 4 ? 2 : 0, late: i === 1 ? 1 : 0 }));
  seedReceipt(api.world.f, { wire: "h-t01", session: PREV_SESSION });
  const r = await api.call("GET", "/api/ff/receipts?wire=" + w, { user: alice });
  c.eq(r.body.receipts.map((x) => x.session), [...sessions].reverse(), "receipts: newest session first");
  const stale = r.body.receipts.find((x) => x.session === "2026-10-22");
  c.eq([stale.status, stale.reason, stale.line], ["not_evaluated", "source_stale", "— not evaluated: source_stale"], "receipts: a missed session says why");
  const good = r.body.receipts.find((x) => x.session === "2026-10-26");
  c.eq([good.reason, good.line, good.absent, good.namesAbsent], [null, "evaluated", { thin: 2 }, 2], "receipts: an evaluated session has no reason and its absences");
  c.eq(r.body.receipts.find((x) => x.session === "2026-10-21").late, true, "receipts: a late upgrade is flagged");
  const one = await api.call("GET", "/api/ff/receipts?wire=" + w + "&session=2026-10-23", { user: alice });
  c.eq(one.body.receipts.map((x) => x.session), ["2026-10-23"], "receipts: one session");
  const limited = await api.call("GET", "/api/ff/receipts?wire=" + w + "&limit=2", { user: alice });
  c.eq(limited.body.receipts.length, 2, "receipts: a limit");
  const house = await api.call("GET", "/api/ff/receipts?wire=h-t01", { user: bob });
  c.eq(house.body.receipts.length, 1, "receipts: a house wire's receipts are readable by every member");
  const none = await api.call("GET", "/api/ff/receipts?wire=" + w + "&session=2026-01-05", { user: alice });
  c.eq([none.status, none.body.receipts], [200, []], "receipts: an own wire with none for that session is an empty list");
  const bobs = await api.call("GET", "/api/ff/receipts?wire=" + w, { user: bob });
  c.eq(bobs.status, 404, "receipts: another member's wire is not found");
  for (const q of ["", "wire=nope", "wire=" + w + "&session=junk", "wire=h-zz9"]) {
    const e = await api.call("GET", "/api/ff/receipts?" + q, { user: alice });
    c.ok([400, 404].includes(e.status), "receipts: " + (q || "no wire") + " is refused", e.status);
  }

  seedRecord(api.world.f, { wire: w, firings: 4, sessions: 25, budget: 1.5, placebo: 1.2, placeboN: 200, confirmation: 0.75, confirmN: 4, p50: 90, p95: 300, coverage: 0.9, nullReasons: null });
  seedRecord(api.world.f, { wire: w, period: "2026-W43", firings: 1, sessions: 5, budget: null, nullReasons: JSON.stringify({ budget: "short_history" }) });
  seedRecord(api.world.f, { wire: "h-t01", firings: 2, sessions: 10 });
  const rec = await api.call("GET", "/api/ff/records?wire=" + w + "&week=2026-W43", { user: alice });
  const all = rec.body.all;
  c.eq([all.firings, all.sessions], [{ v: 4, text: "4" }, { v: 25, text: "25" }], "records: firings and sessions");
  c.eq([all.calibration.budget, all.calibration.placebo, all.calibration.placeboN], [{ v: 1.5, text: "1.5" }, { v: 1.2, text: "1.2" }, { v: 200, text: "200" }], "records: calibration figures");
  c.eq([all.confirmation.share, all.coverage, all.latency.p95], [{ v: 0.75, text: "75%" }, { v: 0.9, text: "90%" }, { v: 300, text: "5 min" }], "records: shares as whole percents and durations in words");
  c.eq(all.latency.p50, { v: 90, text: "2 min" }, "records: ninety seconds reads as 2 min");
  c.eq(all.confirmation.n.v, 4, "records: the confirmation sample");
  c.eq([rec.body.week.calibration.budget.v, rec.body.week.calibration.budget.reason, rec.body.week.calibration.budget.reasonText], [null, "short_history", "under 20 sessions of history"], "records: a null figure carries the stored reason in words");
  c.eq(rec.body.week.calibration.placebo.reason, "no_record", "records: a null with no stored reason says no record");
  c.eq(rec.body.version, 1, "records: the current version");
  const nothing = await api.call("GET", "/api/ff/records?wire=" + w + "&version=3", { user: alice });
  c.eq([nothing.status, nothing.body.all.reason], [200, "no_record"], "records: a version with no record is an absent figure");
  const houseRec = await api.call("GET", "/api/ff/records?wire=h-t01", { user: bob });
  c.eq(houseRec.body.all.firings.v, 2, "records: a house record is readable by any member");
  const bobRec = await api.call("GET", "/api/ff/records?wire=" + w, { user: bob });
  c.eq(bobRec.status, 404, "records: another member's wire is not found");
  for (const q of ["wire=" + w + "&week=2026-43", "wire=nope", ""]) {
    const e = await api.call("GET", "/api/ff/records?" + q, { user: alice });
    c.ok([400, 404].includes(e.status), "records: " + (q || "no wire") + " is refused", e.status);
  }

  const houseList = await api.call("GET", "/api/ff/house", { user: alice });
  c.eq(houseList.body.wires[0].record.firings.v, 2, "house: the list carries each wire's record");
  c.eq(houseList.body.wires[0].rarity.reason, "short_history", "house: and a rarity absent under twenty sessions");
  seedRecord(api.world.f, { wire: "h-t01", version: 1, period: "2026-W42", firings: 1, sessions: 5 });
  const detail = await api.call("GET", "/api/ff/house?id=h-t01", { user: alice });
  c.eq([detail.status, detail.body.wire.id, detail.body.note.reason], [200, "h-t01", "no_record"], "house: one wire with an absent note");
  const unknown = await api.call("GET", "/api/ff/house?id=h-t99", { user: alice });
  c.eq(unknown.status, 404, "house: an unknown house wire is not found");
  const member = await api.call("GET", "/api/ff/house?id=" + w, { user: alice });
  c.eq(member.status, 404, "house: a member wire id is not a house wire");
}

export async function absentWithReason(c, build) {
  const api = build();
  const w = (await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101"] } }) }, user: alice })).body.wire.id;
  await houseWire(api, "h-t01");
  const hit = seedHit(api.world.f, { stream: "alice.one", wire: w, symbol: "SYA101", key: "n1", firedAt: NOW - 90000, dataAsOf: NOW - 100000 });
  seedRun(api.world.f, { id: "nightly:" + PREV_SESSION, kind: "nightly", session: PREV_SESSION });
  seedRun(api.world.f, { id: "live:" + SESSION, kind: "live", session: SESSION, finishedAt: NOW - 60000, startedAt: NOW - 62000 });
  seedReceipt(api.world.f, { wire: w, session: PREV_SESSION });
  const reads = [
    ["GET", "/api/ff/wires"], ["GET", "/api/ff/wires?id=" + w], ["GET", "/api/ff/house"], ["GET", "/api/ff/house?id=h-t01"], ["GET", "/api/ff/hits"], ["GET", "/api/ff/hits?id=" + hit.hitId],
    ["GET", "/api/ff/health"], ["GET", "/api/ff/digest?d=" + PREV_SESSION], ["GET", "/api/ff/symbol?t=SYA101"], ["GET", "/api/ff/symbol?t=SYB201"], ["GET", "/api/ff/receipts?wire=" + w], ["GET", "/api/ff/records?wire=" + w],
    ["GET", "/api/ff/records?wire=h-t01"], ["POST", "/api/ff/preview", { ast: astOf() }],
  ];
  for (const [method, path, body] of reads) {
    const r = await api.call(method, path, { body, user: alice });
    c.ok(r.status === 200, "absent: " + path.split("?")[0] + " answers", r.status);
    const bare = [];
    const walk = (v, p) => {
      if (v === null) { bare.push(p); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + "[" + i + "]")); return; }
      if (v && typeof v === "object") {
        const keys = Object.keys(v);
        const absent = "reason" in v && v.v === null;
        for (const k of keys) {
          if (v[k] === null && !absent) {
            const allowed = ["reason", "reasonText", "withdrawn", "mark", "feedback", "next", "heads", "origin", "upgradedAt", "absent", "quietUntil", "limits", "week", "template", "status", "session", "late", "error", "ast", "sector", "subject", "wouldHit", "value", "ok", "precision", "incomplete", "healthy"];
            if (!allowed.includes(k)) bare.push(p + "." + k);
          } else if (v[k] !== null) walk(v[k], p + "." + k);
        }
      }
    };
    walk(r.body, "");
    c.eq(bare, [], "absent: " + path.split("?")[0] + " carries no bare null figure, every absent one has its reason");
  }
  const text = [];
  const collect = (v) => { if (typeof v === "string") text.push(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === "object") Object.values(v).forEach(collect); };
  for (const [method, path, body] of reads) collect((await api.call(method, path, { body, user: alice })).body);
  const joined = text.join("\n");
  for (const word of COPY_BANNED) c.ok(!new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(joined), "copy: the banned word " + JSON.stringify(word) + " appears nowhere in the replies");
  c.ok(!/\bundefined\b|\bNaN\b|\[object/.test(joined), "copy: no undefined, NaN or [object in any reply");
  c.ok(!/\bnull\b/.test(joined.replace(/"null"/g, "")), "copy: the word null appears in no sentence");
}
