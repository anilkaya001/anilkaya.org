import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRouter } from "../server/router.js";
import { flowsPositioningRows } from "../server/routes/flows-positioning.js";
import { flowsReadRows } from "../server/routes/flows-read.js";
import { positioningMode } from "../shared/flows-pos-switch.js";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const POS = JSON.stringify({ v: 1, sessionDate: "2026-10-26", basis: { asOf: "2026-10-26" }, rotation: { rows: [] } });
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const POL_SPACED = JSON.stringify({ rows: [{ t: "SYX101" }, { t: "SYX102" }], note: "stored as written" }, null, 1);
const CARDX_SPACED = JSON.stringify({ sessionDate: "2026-10-26", ticker: "SYX101", dx: { parts: {} } }, null, 1);
const POL = JSON.stringify({ rows: [{ t: "SYX101" }], late: [{ t: "SYX101" }], unusual: [], money: [], held: [], plan: { n: 1 } });
const POL_OLD = JSON.stringify({ rows: [{ t: "SYX101" }] });
const CARDX = JSON.stringify({ sessionDate: "2026-10-26", ticker: "SYX101", dx: { parts: {} }, ps: { parts: { ftd: { at: 1, rv: 1, x: { ok: true } } } } });
const CARDX_OLD = JSON.stringify({ sessionDate: "2026-10-26", ticker: "SYX101", dx: { parts: {} } });

const stored = (payload) => ({ payload, updatedAt: 7, fresh: null });

function world(rows) {
  const reads = [];
  const readServed = async (env, key) => { reads.push(key); return rows[key] ? stored(rows[key]) : null; };
  const passthrough = (s) => new Response(s.payload, { status: 200, headers: { "Content-Type": "application/json" } });
  const storeGone = () => new Error("store gone");
  const isOwner = (env, u) => u === "owner";
  return { reads, readServed, passthrough, storeGone, isOwner };
}

async function posCall(w, pathAndQuery, { user = "member", env = {} } = {}) {
  const table = createRouter(flowsPositioningRows({ readServed: w.readServed, passthrough: w.passthrough, storeGone: w.storeGone, isOwner: w.isOwner }));
  const url = new URL("https://anilkaya.test" + pathAndQuery);
  const request = new Request(url);
  const gates = { flows: async () => (user ? { username: user } : null) };
  try {
    const res = await table.handle({ request, env, url, ctx: {} }, gates);
    return { status: res.status, body: await res.json() };
  } catch (e) {
    return { status: e.status, code: e.code };
  }
}

async function readCall(w, path, { user = "member", env = {}, open, text = false }) {
  const table = createRouter(flowsReadRows({
    readServed: w.readServed, readFlowsPayload: w.readServed, readWithOverlay: async () => null, passthrough: w.passthrough, recallLastGood: async () => null,
    storeGone: w.storeGone, absentKey: async () => new Response("{}", { status: 404 }), cardWithEngine: async () => ({ card: null }),
    briefWithLive: async () => null, nightlyFreshHeaders: () => ({}), splitEngineMark: "\u0000no-split",
    positioningOpen: open ? (e, session) => positioningMode(e, Boolean(session) && w.isOwner(e, session.username)) : null,
  }));
  const url = new URL("https://anilkaya.test" + path);
  const request = new Request(url);
  const gates = { flows: async () => ({ username: user }) };
  const res = await table.handle({ request, env, url, ctx: {} }, gates);
  return text ? res.text() : res.json();
}

const battery = async (rowsModule) => {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 6) fails.push(m); };
  const w = world({ positioning: POS, "card-x:SYX101": CARDX });
  const gate = async (mode, user) => (await posCall(w, "/api/flows/positioning", { user, env: mode === undefined ? {} : { FLOWS_POSITIONING: mode } })).status;
  need(await gate("off", "owner") === 404 && await gate("off", "member") === 404, "off closes it for everyone");
  need(await gate("owner", "owner") === 200 && await gate("owner", "member") === 404, "owner opens it to owners alone");
  need(await gate("on", "member") === 200, "on opens it to members");
  need(await gate(undefined, "member") === 404 && await gate(undefined, "owner") === 200, "unset is owner");
  const off = await posCall(w, "/api/flows/positioning", { user: "member", env: { FLOWS_POSITIONING: "off" } });
  need(off.code === "positioning_off", "the refusal code is positioning_off");
  const whole = await posCall(w, "/api/flows/positioning", { user: "owner" });
  need(whole.body.sessionDate === "2026-10-26", "the whole payload is passed through");
  const one = await posCall(w, "/api/flows/positioning?t=SYX101", { user: "owner" });
  need(one.body.t === "SYX101" && one.body.ps && one.body.ps.parts.ftd && one.body.sessionDate === "2026-10-26", "a ticker projects its ps section and session");
  const none = await posCall(w, "/api/flows/positioning?t=SYX999", { user: "owner" });
  need(none.body.ps === null && none.body.why === "absent", "an unread name is absent with a reason and never an empty section");
  const bad = await posCall(w, "/api/flows/positioning?t=%3Cb%3E", { user: "owner" });
  need(bad.status === 400, "a malformed ticker is refused");
  const pend = await posCall(world({}), "/api/flows/positioning", { user: "owner" });
  need(pend.body.status === "pending", "an unwritten payload is pending");
  return fails;
};

const readBattery = async () => {
  const fails = [];
  const need = (c, m) => { if (!c && fails.length < 6) fails.push(m); };
  const w = world({ political: POL, "card-x:SYX101": CARDX });
  const closed = await readCall(w, "/api/flows/political", { user: "member", open: true });
  need(!("late" in closed) && !("money" in closed) && !("plan" in closed) && !("held" in closed) && !("unusual" in closed) && closed.rows.length === 1, "a closed reader loses the layers and keeps the rows");
  const open = await readCall(w, "/api/flows/political", { user: "owner", open: true });
  need("late" in open && "plan" in open, "an owner under the default keeps them");
  const memberOn = await readCall(w, "/api/flows/political", { user: "member", open: true, env: { FLOWS_POSITIONING: "on" } });
  need("late" in memberOn, "a member under on keeps them");
  const cx = await readCall(w, "/api/flows/card-x?t=SYX101", { user: "member", open: true });
  need(!("ps" in cx) && "dx" in cx, "card-x loses ps and keeps dx for a closed reader");
  const cxo = await readCall(w, "/api/flows/card-x?t=SYX101", { user: "owner", open: true });
  need("ps" in cxo, "and keeps it for an owner");
  const old = world({ political: POL_OLD, "card-x:SYX101": CARDX_OLD });
  need(JSON.stringify(await readCall(old, "/api/flows/political", { user: "member", open: true })) === POL_OLD, "a payload from before the layers is passed through untouched");
  need(JSON.stringify(await readCall(old, "/api/flows/card-x?t=SYX101", { user: "member", open: true })) === CARDX_OLD, "and so is a card-x with no ps");
  const legacy = await readCall(world({ political: POL }), "/api/flows/political", { user: "member", open: false });
  need("late" in legacy, "with no gate injected the row is what it was");
  return fails;
};

{
  eq(await battery(), [], "THE POSITIONING ROUTE: gates for each spelling and caller, the whole payload, the per-name projection, absent and pending states");
  eq(await readBattery(), [], "AND THE READ ROWS: the layers and the ps section are stripped for a closed reader, kept for an open one, and a payload without them is byte for byte as stored");
  const table = createRouter(flowsPositioningRows(world({})));
  eq(table.rows.map((r) => [r.id, r.path, r.methods, r.auth]), [["flows.positioning", "/api/flows/positioning", ["GET"], "flows"]], "one GET row behind the Flows session");
  const mod = (transforms) => loadMutated("server/routes/flows-positioning.js", transforms);
  const readMod = (transforms) => loadMutated("server/routes/flows-read.js", transforms);
  const planted = [
    ["the gate ignored", await mod([["if (!positioningMode(env, isOwner(env, session && session.username))) throw HttpError.of(\"positioning_off\");", ""]])],
    ["a member treated as an owner", await mod([["isOwner(env, session && session.username)", "true"]])],
    ["a missing name read as an empty section", await mod([["if (stored === null) return json({ t: ticker, sessionDate: null, ps: null, why: \"absent\" });", "if (stored === null) return json({ t: ticker, sessionDate: null, ps: {} });"]])],
    ["the pending body dropped", await mod([["if (stored === null) return json(PENDING);", "if (stored === null) return json({});"]])],
  ];
  for (const [title, m] of planted) {
    const rows = m.flowsPositioningRows;
    const saved = { create: createRouter };
    const w = world({ positioning: POS, "card-x:SYX101": CARDX });
    const run = async (pq, o) => {
      const t = createRouter(rows({ readServed: w.readServed, passthrough: w.passthrough, storeGone: w.storeGone, isOwner: w.isOwner }));
      const url = new URL("https://anilkaya.test" + pq);
      const gates = { flows: async () => ({ username: o.user }) };
      try { const res = await t.handle({ request: new Request(url), env: o.env || {}, url, ctx: {} }, gates); return { status: res.status, body: await res.json() }; } catch (e) { return { status: e.status, code: e.code }; }
    };
    const fails = [];
    const need = (c, msg) => { if (!c) fails.push(msg); };
    need((await run("/api/flows/positioning", { user: "member", env: { FLOWS_POSITIONING: "off" } })).status === 404, "off");
    need((await run("/api/flows/positioning", { user: "member", env: {} })).status === 404, "member under unset");
    const none = await run("/api/flows/positioning?t=SYX999", { user: "owner" });
    need(none.body && none.body.ps === null && none.body.why === "absent", "absent");
    const pend = await posCall(world({}), "/api/flows/positioning", { user: "owner" });
    const pend2 = await (async () => { const t = createRouter(rows({ readServed: async () => null, passthrough: w.passthrough, storeGone: w.storeGone, isOwner: w.isOwner })); const url = new URL("https://anilkaya.test/api/flows/positioning"); const res = await t.handle({ request: new Request(url), env: {}, url, ctx: {} }, { flows: async () => ({ username: "owner" }) }); return res.json(); })();
    need(pend2.status === "pending" && pend.body.status === "pending", "pending");
    ok(fails.length > 0, "PLANTED WRONG BUILD FAILS: " + title);
    void saved;
  }
  const readPlants = [
    ["the political layers left in for a closed reader", [["passthrough(gated(rc) ? strip(stored, '\"late\":', [\"late\", \"unusual\", \"money\", \"held\", \"plan\"]) : stored)", "passthrough(stored)"]]],
    ["only some layers stripped", [["[\"late\", \"unusual\", \"money\", \"held\", \"plan\"]", "[\"late\"]"]]],
    ["ps left in card-x for a closed reader", [["if (kind === \"card-x\" && gated(rc)) stored = strip(stored, '\"ps\":', [\"ps\"]);", ""]]],
    ["dx stripped with ps", [["strip(stored, '\"ps\":', [\"ps\"])", "strip(stored, '\"ps\":', [\"ps\", \"dx\"])"]]],
  ];
  for (const [title, transforms] of readPlants) {
    const m = await readMod(transforms);
    const w = world({ political: POL, "card-x:SYX101": CARDX });
    const run = async (path, user) => {
      const t = createRouter(m.flowsReadRows({
        readServed: w.readServed, readFlowsPayload: w.readServed, readWithOverlay: async () => null, passthrough: w.passthrough, recallLastGood: async () => null,
        storeGone: w.storeGone, absentKey: async () => new Response("{}", { status: 404 }), cardWithEngine: async () => ({ card: null }),
        briefWithLive: async () => null, nightlyFreshHeaders: () => ({}), splitEngineMark: "\u0000no-split",
        positioningOpen: (e, session) => positioningMode(e, Boolean(session) && w.isOwner(e, session.username)),
      }));
      const url = new URL("https://anilkaya.test" + path);
      const res = await t.handle({ request: new Request(url), env: {}, url, ctx: {} }, { flows: async () => ({ username: user }) });
      return res.json();
    };
    const pol = await run("/api/flows/political", "member");
    const cx = await run("/api/flows/card-x?t=SYX101", "member");
    const bad = "late" in pol || "unusual" in pol || "money" in pol || "held" in pol || "plan" in pol || "ps" in cx || !("dx" in cx);
    ok(bad, "PLANTED WRONG BUILD FAILS: " + title);
  }
}

{
  const table = (w) => createRouter(flowsPositioningRows({ readServed: w.readServed, passthrough: w.passthrough, storeGone: w.storeGone, isOwner: w.isOwner }));
  const bare = async (w, method, pq, user, env = {}) => {
    const url = new URL("https://anilkaya.test" + pq);
    try { const res = await table(w).handle({ request: new Request(url, { method }), env, url, ctx: {} }, { flows: async () => (user ? { username: user } : null) }); return res.status; } catch (e) { return e.status; }
  };
  const w1 = world({ positioning: POS, "card-x:SYX101": CARDX });
  eq([await bare(w1, "POST", "/api/flows/positioning", null), await bare(w1, "DELETE", "/api/flows/positioning", "owner"), w1.reads.length], [405, 405, 0], "A WRONG METHOD IS 405 BEFORE THE SESSION IS ASKED, and reads nothing");
  eq(await bare(w1, "GET", "/api/flows/positioning", null), 401, "a signed-out GET is 401");
  eq(w1.reads.length, 0, "and still reads nothing");
  eq(await bare(w1, "GET", "/api/flows/positioning", "member", { FLOWS_POSITIONING: "owner" }), 404, "a member under owner is refused");
  eq(w1.reads.length, 0, "THE GATE ANSWERS BEFORE ANY STORE READ");
  const w2 = world({ positioning: POS, "card-x:SYX101": CARDX });
  await bare(w2, "GET", "/api/flows/positioning", "owner");
  eq(w2.reads, ["positioning"], "the whole payload costs one row read, of the positioning key");
  const w3 = world({ positioning: POS, "card-x:SYX101": CARDX });
  await bare(w3, "GET", "/api/flows/positioning?t=SYX101", "owner");
  eq(w3.reads, ["card-x:SYX101"], "a name costs one row read, of its card-x key");
  const one = await posCall(world({ "card-x:SYX101": CARDX }), "/api/flows/positioning?t=SYX101", { user: "owner" });
  eq(Object.keys(one.body).sort(), ["ps", "sessionDate", "t"], "and answers only the section, the session and the name");
  ok(!("dx" in one.body.ps) && !("dx" in one.body), "the rest of the card-x is not sent");

  const w4 = world({ political: POL_SPACED, "card-x:SYX101": CARDX_SPACED });
  eq(await readCall(w4, "/api/flows/political", { user: "member", open: true, env: { FLOWS_POSITIONING: "off" }, text: true }), POL_SPACED, "WITH THE SWITCH OFF THE POLITICAL ROUTE ANSWERS THE STORED BYTES");
  eq(await readCall(w4, "/api/flows/card-x?t=SYX101", { user: "member", open: true, env: { FLOWS_POSITIONING: "off" }, text: true }), CARDX_SPACED, "and the card-x route answers the stored bytes");
  eq(await readCall(w4, "/api/flows/political", { user: "owner", open: true, text: true }), POL_SPACED, "an owner reads the stored bytes too when nothing is layered");

  const readPlant = await loadMutated("server/routes/flows-read.js", [["if (typeof stored.payload !== \"string\" || !stored.payload.includes(mark)) return stored;", "if (typeof stored.payload !== \"string\") return stored;"]]);
  const wp = world({ political: POL_SPACED });
  const planted = createRouter(readPlant.flowsReadRows({
    readServed: wp.readServed, readFlowsPayload: wp.readServed, readWithOverlay: async () => null, passthrough: wp.passthrough, recallLastGood: async () => null,
    storeGone: wp.storeGone, absentKey: async () => new Response("{}", { status: 404 }), cardWithEngine: async () => ({ card: null }),
    briefWithLive: async () => null, nightlyFreshHeaders: () => ({}), splitEngineMark: "\u0000no-split",
    positioningOpen: (e, session) => positioningMode(e, Boolean(session) && wp.isOwner(e, session.username)),
  }));
  const url = new URL("https://anilkaya.test/api/flows/political");
  const res = await planted.handle({ request: new Request(url), env: {}, url, ctx: {} }, { flows: async () => ({ username: "member" }) });
  ok((await res.text()) !== POL_SPACED, "PLANTED WRONG BUILD FAILS: every political body parsed and written again");

  const gateAfter = await loadMutated("server/routes/flows-positioning.js", [
    ["    if (!positioningMode(env, isOwner(env, session && session.username))) throw HttpError.of(\"positioning_off\");\n", ""],
    ["    const stored = await readServed(env, \"positioning\");\n", "    const stored = await readServed(env, \"positioning\");\n    if (!positioningMode(env, isOwner(env, session && session.username))) throw HttpError.of(\"positioning_off\");\n"],
  ]);
  const wg = world({ positioning: POS });
  const tg = createRouter(gateAfter.flowsPositioningRows({ readServed: wg.readServed, passthrough: wg.passthrough, storeGone: wg.storeGone, isOwner: wg.isOwner }));
  const ug = new URL("https://anilkaya.test/api/flows/positioning");
  try { await tg.handle({ request: new Request(ug), env: {}, url: ug, ctx: {} }, { flows: async () => ({ username: "member" }) }); } catch { }
  ok(wg.reads.length > 0, "PLANTED WRONG BUILD FAILS: the gate after the store read");

  const whole = await loadMutated("server/routes/flows-positioning.js", [["const ps = card.ps && typeof card.ps === \"object\" ? card.ps : null;", "const ps = card;"]]);
  const ww = world({ "card-x:SYX101": CARDX });
  const tw = createRouter(whole.flowsPositioningRows({ readServed: ww.readServed, passthrough: ww.passthrough, storeGone: ww.storeGone, isOwner: ww.isOwner }));
  const uw = new URL("https://anilkaya.test/api/flows/positioning?t=SYX101");
  const rw = await (await tw.handle({ request: new Request(uw), env: {}, url: uw, ctx: {} }, { flows: async () => ({ username: "owner" }) })).json();
  ok("dx" in rw.ps, "PLANTED WRONG BUILD FAILS: the whole card-x served on a name");
}

{
  const NORMALISE = [
    [/\?v=\d+/g, "?v=0"],
    [/plFeed/g, "plTape"],
    [/data-v="feed"/g, 'data-v="tape"'],
    ["The feed carries no party per filing, so no party split is shown or inferred.", "The vendor feed carries no party field, so no Republican or Democrat split is shown or inferred."],
  ];
  const render = async (root) => {
    const saved = Date.now;
    Date.now = () => Date.parse("2026-10-27T15:00:00Z");
    try {
      const M = await import(pathToFileURL(path.join(root, "shared/flows-pages.js")).href);
      const out = {};
      for (const [name, fn] of Object.entries(M.FLOWS_PAGES)) {
        if (typeof fn !== "function" || name === "positioningPage") continue;
        for (const [label, args] of [["member", { username: "test" }], ["owner", { username: "test", owner: true }]]) {
          let html = fn(args);
          for (const [from, to] of NORMALISE) html = html.replace(from, to);
          out[name + ":" + label] = createHash("sha256").update(html).digest("hex");
        }
      }
      return out;
    } finally {
      Date.now = saved;
    }
  };
  const FIXTURE = path.join(ROOT, "tests/fixtures-pos-off-pages.json");
  const at = process.argv.indexOf("--write");
  if (at >= 0) {
    const base = path.resolve(process.argv[at + 1]);
    fs.writeFileSync(FIXTURE, JSON.stringify({ provenance: { nature: "sha256 of every page render of origin/main at a pinned clock, version tokens and the declared renames normalised", base: process.argv[at + 2] || null }, pages: await render(base) }, null, 1) + "\n");
    console.log("wrote " + FIXTURE);
    process.exit(0);
  }
  const want = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const got = await render(ROOT);
  eq(Object.keys(got).sort(), Object.keys(want.pages).sort(), "the baseline covers every page function but the new one, as member and as owner");
  const moved = Object.keys(want.pages).filter((k) => want.pages[k] !== got[k]);
  eq(moved, [], "WITH BOTH SWITCHES OFF EVERY EXISTING PAGE RENDERS BYTE FOR BYTE AS ORIGIN/MAIN RENDERS IT (version tokens and the declared renames aside): " + moved.join(", "));
}

console.log(`✓ flows-pos-route: ${checks} assertions — the positioning route's gate for each spelling and caller, the whole payload and per-name projection with absent and pending states, the read rows stripping the layers and ps for a closed reader and passing an older payload byte for byte, 405 before the session, one row read, the gate before the read, the stored bytes with the switches off, every other page unchanged against a committed baseline, and the planted wrong builds that each fail`);
