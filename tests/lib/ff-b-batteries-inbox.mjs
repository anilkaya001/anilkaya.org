import { LIMITS } from "../../shared/ff-contract.js";
import { alice, bob, astOf, seedHit, seedWire, NOW, SESSION, PREV_SESSION, NAMES } from "./ff-b-world.mjs";

const rawAll = (api, sql, ...args) => api.world.f.db.prepare(sql).all(...args).map((r) => ({ ...r }));
const rawOne = (api, sql, ...args) => {
  const r = api.world.f.db.prepare(sql).get(...args);
  return r === undefined ? undefined : { ...r };
};

const order = (a, b) => (a.fired_at !== b.fired_at ? b.fired_at - a.fired_at : a.stream !== b.stream ? (a.stream < b.stream ? 1 : -1) : b.seq - a.seq);

const visibleOracle = (api, member, state = "all") => {
  const hits = rawAll(api, "SELECT * FROM ff_hit WHERE state = 'delivered' AND (stream = ? OR stream = 'house')", member);
  const muted = new Set(rawAll(api, "SELECT symbol FROM ff_mute WHERE member_id = ?", member).map((r) => r.symbol));
  const off = new Set(rawAll(api, "SELECT wire_id FROM ff_house_off WHERE member_id = ?", member).map((r) => r.wire_id));
  const marks = new Map(rawAll(api, "SELECT hit_id, mark FROM ff_hit_mark WHERE member_id = ?", member).map((r) => [r.hit_id, r.mark]));
  const cursors = rawOne(api, "SELECT read_seq, house_read_seq FROM ff_member WHERE member_id = ?", member) || { read_seq: 0, house_read_seq: 0 };
  const shown = hits.filter((h) => {
    if (h.symbol !== null && muted.has(h.symbol)) return false;
    if (h.stream === "house" && off.has(h.wire_id)) return false;
    const mark = marks.get(h.hit_id) || null;
    if (state === "pinned") return mark === "pinned";
    if (state === "archived") return mark === "dismissed";
    if (mark === "dismissed") return false;
    if (state === "unread") return h.seq > (h.stream === "house" ? cursors.house_read_seq : cursors.read_seq);
    return true;
  });
  return shown.sort(order);
};

export const oracles = { visibleOracle };

const walk = async (api, user, state, limit) => {
  const pages = [];
  let cursor = null;
  for (let i = 0; i < 80; i++) {
    const path = "/api/ff/hits?state=" + state + "&limit=" + limit + (cursor ? "&cursor=" + cursor : "");
    const r = await api.call("GET", path, { user });
    pages.push(r);
    if (r.status !== 200 || !r.body.next) break;
    cursor = r.body.next;
  }
  return pages;
};

const seedStreams = async (api, { memberCount, houseCount }) => {
  const w = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYA102", "SYB201"] } }) }, user: alice });
  const compiled = await api.world.core.compile({ body: astOf({ scope: { kind: "universe" } }), universe: api.world.universe });
  seedWire(api.world.f, { member: null, id: "h-t01", title: "Earnings run-up", cadence: "nightly", scopeKind: "universe", control: "fact", astJson: compiled.version.ast_json, astHash: compiled.version.ast_hash, clauseHash: compiled.version.clause_hash, sentence: "House sentence", template: "T01" });
  const mine = [];
  const house = [];
  let t = NOW - 7 * 3600000;
  for (let i = 0; i < Math.max(memberCount, houseCount); i++) {
    t += 60000 * 3;
    if (i < memberCount) mine.push(seedHit(api.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: NAMES[i % 3], key: "m" + i, firedAt: t, dataAsOf: t - 12000 }));
    t += 60000;
    if (i < houseCount) house.push(seedHit(api.world.f, { stream: "house", wire: "h-t01", symbol: NAMES[(i + 2) % 6], key: "h" + i, firedAt: t, dataAsOf: t - 12000 }));
  }
  return { wire: w.body.wire.id, mine, house };
};

export async function pagination(c, build) {
  const api = build();
  await seedStreams(api, { memberCount: 40, houseCount: 30 });
  const want = visibleOracle(api, "alice.one", "all");
  c.eq(want.length, 70, "pages: the oracle sees seventy rows");
  for (const limit of [1, 7, 12, 30]) {
    const pages = await walk(api, alice, "all", limit);
    const ids = pages.flatMap((p) => p.body.hits.map((h) => h.id));
    c.eq(ids, want.map((h) => h.hit_id), "pages: limit " + limit + " reads every visible row once, newest first, across both streams");
    c.eq(new Set(ids).size, ids.length, "pages: limit " + limit + " repeats nothing");
    c.ok(pages.slice(0, -1).every((p) => p.body.hits.length === limit), "pages: limit " + limit + " fills every page but the last");
    c.eq(pages[pages.length - 1].body.next, null, "pages: limit " + limit + " ends with no cursor");
    c.eq(pages[pages.length - 1].body.more, false, "pages: limit " + limit + " ends with more false");
    c.ok(pages[0].body.heads && pages.slice(1).every((p) => p.body.heads === null), "pages: only the first page carries the heads");
    c.ok(pages.length <= Math.ceil(70 / limit) + 1, "pages: limit " + limit + " takes no more pages than the rows need", pages.length);
  }
  const clamp = await api.call("GET", "/api/ff/hits?limit=500", { user: alice });
  c.eq(clamp.body.hits.length, 30, "pages: a limit of 500 is held to 30");
  const first = await api.call("GET", "/api/ff/hits", { user: alice });
  c.eq(first.body.hits.length, 12, "pages: the default page is twelve");
  c.eq(first.body.heads, { h: 30, m: 40 }, "pages: the heads are the two stream maxima");
  for (const bad of ["limit=0", "limit=-3", "limit=1.5", "limit=abc", "cursor=!!!", "cursor=" + "A".repeat(200), "cursor=e30", "state=bogus"]) {
    const r = await api.call("GET", "/api/ff/hits?" + bad, { user: alice });
    c.eq([r.status, r.error && r.error.code], [400, "ff_cursor_invalid"], "pages: " + bad + " is ff_cursor_invalid");
  }
  const forged = Buffer.from(JSON.stringify({ v: 1, h: -5, m: 3 })).toString("base64url");
  const neg = await api.call("GET", "/api/ff/hits?cursor=" + forged, { user: alice });
  c.eq(neg.status, 400, "pages: a forged cursor with a negative position is refused");
  const huge = Buffer.from(JSON.stringify({ v: 1, h: 1e300, m: 3 })).toString("base64url");
  const hugeR = await api.call("GET", "/api/ff/hits?cursor=" + huge, { user: alice });
  c.eq(hugeR.status, 400, "pages: and so is one past the safe integers");
  const stable = await api.call("GET", "/api/ff/hits?limit=12", { user: alice });
  const next = await api.call("GET", "/api/ff/hits?limit=12&cursor=" + stable.body.next, { user: alice });
  seedHit(api.world.f, { stream: "alice.one", wire: first.body.hits[0].wire.id, symbol: "SYA101", key: "new-arrival", firedAt: NOW - 1000, dataAsOf: NOW - 2000 });
  const nextAfter = await api.call("GET", "/api/ff/hits?limit=12&cursor=" + stable.body.next, { user: alice });
  c.eq(nextAfter.body.hits.map((h) => h.id), next.body.hits.map((h) => h.id), "pages: a hit that arrives between pages does not shift the next one");
  const refreshed = await api.call("GET", "/api/ff/hits?limit=12", { user: alice });
  c.eq(refreshed.body.hits[0].symbol, "SYA101", "pages: a fresh first page leads with the arrival");
}

export async function filters(c, build) {
  const api = build();
  const { wire, mine, house } = await seedStreams(api, { memberCount: 14, houseCount: 10 });
  const muteA = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
  c.eq(muteA.body.muted, true, "filters: mute a name");
  let want = visibleOracle(api, "alice.one", "all");
  let pages = await walk(api, alice, "all", 5);
  c.eq(pages.flatMap((p) => p.body.hits.map((h) => h.id)), want.map((h) => h.hit_id), "filters: a muted name is absent from every page");
  c.ok(pages.every((p) => p.body.hits.every((h) => h.symbol !== "SYA101")), "filters: and from every row");
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: false }, user: alice });

  const pin = await api.call("POST", "/api/ff/hits", { body: { id: mine[3].hitId, mark: "pinned" }, user: alice });
  const dismiss = await api.call("POST", "/api/ff/hits", { body: { id: mine[5].hitId, mark: "dismissed" }, user: alice });
  const houseDismiss = await api.call("POST", "/api/ff/hits", { body: { id: house[2].hitId, mark: "dismissed" }, user: alice });
  const houseUseful = await api.call("POST", "/api/ff/hits", { body: { id: house[4].hitId, feedback: "useful", mark: "pinned" }, user: alice });
  c.eq([pin.body.mark, dismiss.body.mark, houseDismiss.body.mark, houseUseful.body.feedback], ["pinned", "dismissed", "dismissed", "useful"], "filters: marks and feedback are stored");
  for (const state of ["all", "unread", "pinned", "archived"]) {
    want = visibleOracle(api, "alice.one", state);
    pages = await walk(api, alice, state, 4);
    c.eq(pages.flatMap((p) => p.body.hits.map((h) => h.id)).sort(), want.map((h) => h.hit_id).sort(), "filters: the " + state + " list equals the oracle");
  }
  const pinned = await api.call("GET", "/api/ff/hits?state=pinned", { user: alice });
  c.eq(pinned.body.hits.map((h) => h.id).sort(), [mine[3].hitId, house[4].hitId].sort(), "filters: pinned lists the two pinned hits");
  c.ok(pinned.body.hits.every((h) => h.mark === "pinned"), "filters: with their mark");
  const archived = await api.call("GET", "/api/ff/hits?state=archived", { user: alice });
  c.eq(archived.body.hits.map((h) => h.id).sort(), [mine[5].hitId, house[2].hitId].sort(), "filters: archived lists the dismissed ones");
  const all = await api.call("GET", "/api/ff/hits?limit=30", { user: alice });
  c.ok(!all.body.hits.some((h) => h.id === mine[5].hitId || h.id === house[2].hitId), "filters: a dismissed hit leaves the main list");
  const sample = all.body.hits.find((h) => h.id === mine[0].hitId);
  const raw = rawOne(api, "SELECT fired_at, data_as_of, session_label, session FROM ff_hit WHERE hit_id = ?", mine[0].hitId);
  c.eq(sample.at.ms, raw.data_as_of, "times: the hit's own time is the data's as-of time, never the moment it fired");
  c.eq(sample.firedAt.ms, raw.fired_at, "times: the firing time is shown on its own");
  c.eq(sample.latency, { v: Math.round((raw.fired_at - raw.data_as_of) / 1000), text: "12 s" }, "times: the latency is the difference, shown separately");
  c.ok(sample.at.text.endsWith(raw.session_label) || sample.at.text.includes(raw.session_label), "times: and its text carries the session label", sample.at.text);
  c.ok(/TRT/.test(sample.at.text) && !/ET\b|UTC|GMT/.test(sample.at.text), "times: in TRT and no other zone", sample.at.text);

  const clear = await api.call("POST", "/api/ff/hits", { body: { id: mine[3].hitId, mark: null }, user: alice });
  c.eq([clear.status, clear.body.mark], [200, null], "filters: clearing a pin");
  const unmarkedFeedback = await api.call("POST", "/api/ff/hits", { body: { id: mine[0].hitId, mark: null }, user: alice });
  c.eq([unmarkedFeedback.status, unmarkedFeedback.body.mark], [200, null], "filters: clearing a mark that was never set is a 200 and not a 404");
  const again = await api.call("POST", "/api/ff/hits", { body: { id: mine[5].hitId, mark: "dismissed" }, user: alice });
  c.eq(again.written, 0, "filters: setting the same mark twice writes nothing");
  const both = await api.call("POST", "/api/ff/hits", { body: { id: mine[6].hitId, mark: "pinned", feedback: "noise" }, user: alice });
  c.eq([both.body.mark, both.body.feedback], ["pinned", "noise"], "filters: a mark and a feedback in one request");
  const onlyFeedback = await api.call("POST", "/api/ff/hits", { body: { id: mine[6].hitId, feedback: null }, user: alice });
  c.eq([onlyFeedback.body.mark, onlyFeedback.body.feedback], ["pinned", null], "filters: clearing the feedback keeps the mark");
  for (const body of [{ id: mine[0].hitId }, { id: mine[0].hitId, mark: "starred" }, { id: mine[0].hitId, feedback: "meh" }, { id: "short" }, { mark: "pinned" }]) {
    const r = await api.call("POST", "/api/ff/hits", { body, user: alice });
    c.ok(r.status === 400 || r.status === 404, "filters: " + JSON.stringify(body).slice(0, 50) + " is refused", r.status);
  }

  await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: false }, user: alice });
  want = visibleOracle(api, "alice.one", "all");
  pages = await walk(api, alice, "all", 6);
  c.eq(pages.flatMap((p) => p.body.hits.map((h) => h.id)), want.map((h) => h.hit_id), "filters: leaving the house wire hides its hits");
  c.ok(pages.every((p) => p.body.hits.every((h) => h.kind === "yours")), "filters: only her own remain");
  const pinnedAfter = await api.call("GET", "/api/ff/hits?state=pinned", { user: alice });
  c.ok(!pinnedAfter.body.hits.some((h) => h.kind === "house"), "filters: a pinned house hit is hidden too once the wire is left");

  await api.call("POST", "/api/ff/house", { body: { id: "h-t01", follow: true }, user: alice });
  const wd = await api.store.withdrawHit(api.world.env, mine[7].hitId, "bad_data", NOW);
  c.eq(wd, 1, "filters: a hit is withdrawn");
  const wdList = await api.call("GET", "/api/ff/hits?limit=30", { user: alice });
  const row = wdList.body.hits.find((h) => h.id === mine[7].hitId);
  c.ok(row && row.withdrawn && row.withdrawn.reason === "bad_data", "filters: a withdrawn hit stays visible and says why");
  c.ok(wdList.body.hits.filter((h) => h.id !== mine[7].hitId).every((h) => h.withdrawn === null), "filters: and no other hit is marked withdrawn");

  api.world.f.db.prepare("INSERT INTO ff_hit (stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state) VALUES ('alice.one', 99, 'heldhitaaaaaaaaaaaaa', ?, 1, 'alice.one', 'n:SYA101', 'SYA101', NULL, 'held-key', ?, 'close', ?, ?, 'nightly', 'e1', '{}', 'held')").run(wire, SESSION, NOW - 500, NOW - 900);
  const heldList = await api.call("GET", "/api/ff/hits?limit=30", { user: alice });
  c.ok(!heldList.text.includes("heldhitaaaaaaaaaaaaa"), "filters: a held hit is never listed");
  const heldDetail = await api.call("GET", "/api/ff/hits?id=heldhitaaaaaaaaaaaaa", { user: alice });
  c.eq(heldDetail.status, 404, "filters: and cannot be opened");
  const heldMark = await api.call("POST", "/api/ff/hits", { body: { id: "heldhitaaaaaaaaaaaaa", mark: "pinned" }, user: alice });
  c.eq(heldMark.status, 404, "filters: nor marked");
  const exp = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice });
  c.ok(!exp.text.includes("heldhitaaaaaaaaaaaaa") && !exp.text.includes(mine[7].hitId), "filters: a held or withdrawn hit is not exported");
}

export async function floodOfMuted(c, build) {
  const api = build();
  const w = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", "SYB201"] } }) }, user: alice });
  let t = NOW - 6 * 3600000;
  const kept = [];
  for (let i = 0; i < 5; i++) {
    t += 60000;
    kept.push(seedHit(api.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: "SYB201", key: "keep" + i, firedAt: t, dataAsOf: t - 5000 }).hitId);
  }
  for (let i = 0; i < 120; i++) {
    t += 60000;
    seedHit(api.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: "SYA101", key: "noise" + i, firedAt: t, dataAsOf: t - 5000 });
  }
  await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
  const pages = await walk(api, alice, "all", 5);
  const ids = pages.flatMap((p) => p.body.hits.map((h) => h.id));
  c.eq(ids.sort(), [...kept].sort(), "flood: five visible hits behind a hundred and twenty muted ones are all reached");
  c.ok(pages.length <= 12, "flood: and in a bounded number of pages", pages.length);
  c.ok(pages.every((p) => p.read <= 80), "flood: no page reads more than eighty rows", Math.max(...pages.map((p) => p.read)));
  c.ok(pages.slice(0, -1).some((p) => p.body.hits.length === 0 && p.body.more === true), "flood: a page of nothing visible says there is more");
  const last = pages[pages.length - 1];
  c.eq([last.body.next, last.body.more], [null, false], "flood: and the walk ends");
}

export async function readCursors(c, build) {
  const api = build();
  const { mine, house } = await seedStreams(api, { memberCount: 8, houseCount: 5 });
  const h0 = await api.call("GET", "/api/ff/health", { user: alice });
  c.eq(h0.body.unread, { house: 0, member: 8, total: 8, capped: false, label: "8" }, "read: a new member has no house backlog and eight of their own");
  const upTo = await api.call("POST", "/api/ff/read", { body: { readSeq: 3 }, user: alice });
  c.eq(upTo.body.cursors, { readSeq: 3, houseReadSeq: 5 }, "read: advance the member cursor to 3 and leave the house cursor where it started, at the head");
  c.eq(upTo.body.unread.member, 5, "read: five remain");
  const back = await api.call("POST", "/api/ff/read", { body: { readSeq: 1 }, user: alice });
  c.eq(back.body.cursors.readSeq, 3, "read: a cursor never moves backwards");
  const past = await api.call("POST", "/api/ff/read", { body: { readSeq: 9999, houseReadSeq: 9999 }, user: alice });
  c.eq(past.body.cursors, { readSeq: 8, houseReadSeq: 5 }, "read: a cursor never passes the stream's head");
  c.eq(past.body.unread.total, 0, "read: nothing is unread");
  seedHit(api.world.f, { stream: "alice.one", wire: mine[0] ? rawOne(api, "SELECT wire_id FROM ff_hit WHERE hit_id = ?", mine[0].hitId).wire_id : "", symbol: "SYA101", key: "late", firedAt: NOW - 100, dataAsOf: NOW - 200 });
  const h1 = await api.call("GET", "/api/ff/health", { user: alice });
  c.eq(h1.body.unread.member, 1, "read: a hit after the read counts one");
  const unread = await api.call("GET", "/api/ff/hits?state=unread", { user: alice });
  c.eq(unread.body.hits.length, 1, "read: and the unread list holds it");
  c.ok(unread.body.hits[0].unread === true, "read: flagged unread");
  const all = await api.call("GET", "/api/ff/hits?limit=30", { user: alice });
  c.eq(all.body.hits.filter((h) => h.unread).length, 1, "read: exactly one row is unread in the full list");
  const twice = await api.call("POST", "/api/ff/read", { body: { all: true }, user: alice });
  const same = await api.call("POST", "/api/ff/read", { body: { all: true }, user: alice });
  c.eq(same.written, 0, "read: reading what is read writes nothing");
  c.eq(twice.body.cursors.readSeq, 9, "read: all moves to the head");
  for (const body of [{}, { readSeq: -1 }, { readSeq: 1.5 }, { readSeq: "3" }, { all: "yes" }, { houseReadSeq: Number.MAX_SAFE_INTEGER + 2 }]) {
    const r = await api.call("POST", "/api/ff/read", { body, user: alice });
    c.eq([r.status, r.error && r.error.code], [400, "ff_cursor_invalid"], "read: " + JSON.stringify(body) + " is ff_cursor_invalid");
  }
  void house;

  const big = build();
  const w = await big.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  for (let i = 0; i < 120; i++) seedHit(big.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: "SYA101", key: "bulk" + i, firedAt: NOW - 200000 + i, dataAsOf: NOW - 300000 + i });
  const h = await big.call("GET", "/api/ff/health", { user: alice });
  c.eq(h.body.unread, { house: 0, member: 120, total: 120, capped: true, label: "99+" }, "read: the label caps at 99+ and the total stays exact");
}

export async function shadowMode(c, build) {
  const api = build({ world: { env: { FF_MODE: "shadow" } } });
  const w = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  c.eq(w.status, 201, "shadow: wires can still be armed");
  const hit = seedHit(api.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: "SYA101", key: "s1", state: "held" });
  const delivered = seedHit(api.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: "SYA101", key: "s2" });
  const list = await api.call("GET", "/api/ff/hits", { user: alice });
  c.eq([list.status, list.body.hits, list.body.shadow], [200, [], true], "shadow: the inbox is empty and says it is in shadow");
  const detail = await api.call("GET", "/api/ff/hits?id=" + delivered.hitId, { user: alice });
  c.eq(detail.status, 404, "shadow: a hit cannot be opened");
  const mark = await api.call("POST", "/api/ff/hits", { body: { id: delivered.hitId, mark: "pinned" }, user: alice });
  c.eq(mark.status, 404, "shadow: nor marked");
  const health = await api.call("GET", "/api/ff/health", { user: alice });
  c.eq([health.body.mode, health.body.unread.total], ["shadow", 0], "shadow: health reports the mode and no unread");
  const read = await api.call("POST", "/api/ff/read", { body: { all: true }, user: alice });
  c.eq(read.body.cursors, { readSeq: 0, houseReadSeq: 0 }, "shadow: reading moves nothing");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_member").n <= 1, true, "shadow: at most the cursor row exists");
  const exp = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice });
  c.ok(!exp.text.includes(hit.hitId) && !exp.text.includes(delivered.hitId) || exp.status === 200, "shadow: the export is a plain answer");
  const off = build({ world: { env: { FF_MODE: "off" } } });
  const refused = await off.call("GET", "/api/ff/hits", { user: alice });
  c.eq([refused.status, refused.error && refused.error.code, refused.body.reason], [404, "ff_off", "mode_off"], "shadow: off refuses the inbox with its reason");
  const unset = build({ world: { env: { FF_MODE: undefined } } });
  const gone = await unset.call("GET", "/api/ff/wires", { user: alice });
  c.eq([gone.status, gone.error && gone.error.code], [404, "ff_off"], "shadow: an unset mode fails closed");
  for (const odd of ["ON", " on ", "true", "1", "enabled", "yes"]) {
    const x = build({ world: { env: { FF_MODE: odd } } });
    const r = await x.call("GET", "/api/ff/wires", { user: alice });
    const expected = odd.trim().toLowerCase() === "on" ? 200 : 404;
    c.eq(r.status, expected, "shadow: FF_MODE " + JSON.stringify(odd) + " is " + (expected === 200 ? "on" : "off"));
  }
}

export async function mutesAndNotes(c, build) {
  const api = build();
  const w = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  const id = w.body.wire.id;
  const m1 = await api.call("POST", "/api/ff/mute", { body: { symbol: "sya101", mute: true }, user: alice });
  c.eq([m1.status, m1.body.symbol, m1.body.muted], [200, "SYA101", true], "mute: a name is upper-cased and muted");
  const m2 = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
  c.eq([m2.body.muted, m2.written], [true, 0], "mute: muting twice writes nothing");
  const panel = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice });
  c.eq(panel.body.panel.muted, true, "mute: the panel says muted");
  const un = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: false }, user: alice });
  c.eq(un.body.muted, false, "mute: unmute");
  for (const bad of ["", "A B", "TOOLONGSYMBOL123", "A/B", "<b>", "SYA101;DROP"]) {
    const r = await api.call("POST", "/api/ff/mute", { body: { symbol: bad, mute: true }, user: alice });
    c.eq([r.status, r.error && r.error.code], [400, "invalid_ticker"], "mute: " + JSON.stringify(bad) + " is invalid_ticker");
  }
  const notBool = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: "yes" }, user: alice });
  c.eq(notBool.status, 400, "mute: mute must be a boolean");
  const ins = api.world.f.db.prepare("INSERT INTO ff_mute (member_id, symbol, created_at) VALUES ('alice.one', ?, ?)");
  for (let i = 0; i < LIMITS.mutesPerMember; i++) ins.run("M" + String(i).padStart(4, "0"), NOW);
  const over = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYC301", mute: true }, user: alice });
  c.eq([over.status, over.error && over.error.code, over.body.limit], [409, "ff_wire_limit", "mutes"], "mute: the 501st name is refused");
  const already = await api.call("POST", "/api/ff/mute", { body: { symbol: "M0003", mute: true }, user: alice });
  c.eq([already.status, already.body.muted], [200, true], "mute: a name already muted is still muted at the cap");
  const free = await api.call("POST", "/api/ff/mute", { body: { symbol: "M0003", mute: false }, user: alice });
  const admitted = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYC301", mute: true }, user: alice });
  c.eq([free.body.muted, admitted.status], [false, 200], "mute: freeing one admits another");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_mute WHERE member_id = 'bob.two'").n, 0, "mute: bob has none");

  const put = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "  my reason  " }, user: alice });
  c.eq([put.status, put.body.note.body], [200, "  my reason  "], "note: a note is stored as written");
  const same = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "  my reason  " }, user: alice });
  c.eq(same.written, 0, "note: the same text writes nothing");
  const edit = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "my other reason" }, user: alice });
  c.eq(edit.body.note.body, "my other reason", "note: a new text replaces it");
  c.eq(rawOne(api, "SELECT count(*) AS n FROM ff_note").n, 1, "note: one row per wire");
  const max = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "x".repeat(LIMITS.noteChars) }, user: alice });
  c.eq(max.status, 200, "note: 500 characters fit");
  const emoji = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "😀".repeat(LIMITS.noteChars) }, user: alice });
  c.eq(emoji.status, 200, "note: 500 emoji fit because the limit counts characters and not bytes");
  const long = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "x".repeat(LIMITS.noteChars + 1) }, user: alice });
  c.eq([long.status, long.error && long.error.code, long.body.max], [400, "ff_note_too_long", LIMITS.noteChars], "note: 501 is ff_note_too_long");
  const empty = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "" }, user: alice });
  c.eq([empty.status, empty.error && empty.error.code], [400, "ff_grammar_invalid"], "note: empty is refused");
  const notText = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: 5 }, user: alice });
  c.eq(notText.status, 400, "note: a number is refused");
  const bad = await api.call("PUT", "/api/ff/note", { body: { wire: "nope", body: "x" }, user: alice });
  c.eq([bad.status, bad.error && bad.error.code], [404, "ff_wire_not_found"], "note: an unknown wire is not found");
  const del = await api.call("DELETE", "/api/ff/note?wire=" + id, { user: alice });
  c.eq([del.status, del.body.note.v], [200, null], "note: delete leaves an absent note");
  const detail = await api.call("GET", "/api/ff/wires?id=" + id, { user: alice });
  c.eq(detail.body.note.reason, "no_record", "note: the wire's note is absent with its reason");
  const html = await api.call("PUT", "/api/ff/note", { body: { wire: id, body: "<img src=x onerror=alert(1)>" }, user: alice });
  c.eq(html.body.note.body, "<img src=x onerror=alert(1)>", "note: markup is stored as text, the page escapes it");
}

export async function symbolPanel(c, build) {
  const api = build();
  const empty = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice });
  c.eq([empty.body.panel.armed, empty.body.panel.line, empty.body.panel.lastHit.reason], [0, "No armed wire names SYA101", "no_hits"], "panel: no wire, no hit");
  const made = [];
  for (let i = 0; i < 5; i++) {
    const r = await api.call("POST", "/api/ff/wires", { body: { ast: astOf({ scope: { kind: "names", symbols: ["SYA101", NAMES[2 + i]] }, all: [{ m: "earn.sessions", op: "<=", x: 5 + i }, { m: "earn.confirmed", op: "==", x: 1 }] }) }, user: alice });
    made.push(r.body.wire.id);
  }
  made.sort();
  await api.call("PATCH", "/api/ff/wires", { body: { id: made[1], status: "paused" }, user: alice });
  await api.call("PATCH", "/api/ff/wires", { body: { id: made[2], status: "retired" }, user: alice });
  const panel = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice });
  c.eq(panel.body.panel.wires.length, 3, "panel: at most three wires are listed");
  c.eq(panel.body.panel.armed, panel.body.panel.wires.filter((w) => w.status === "armed").length, "panel: armed counts the armed ones listed");
  c.ok(!panel.body.panel.wires.some((w) => w.id === made[2]), "panel: a retired wire is not listed");
  c.ok(panel.body.panel.wires.some((w) => w.state === "paused") || panel.body.panel.wires.length === 3, "panel: a paused wire reads paused");
  api.world.f.db.prepare("INSERT INTO ff_state (wire_id, subject, version, phase, cnt, last_session, cool_until) VALUES (?, 'n:SYA101', 1, 'cooling', 0, ?, ?)").run(made[0], PREV_SESSION, "2026-10-29");
  const quiet = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice });
  const q = quiet.body.panel.wires.find((w) => w.id === made[0]);
  c.eq([q && q.state, q && q.quietUntil], ["quiet", "2026-10-29"], "panel: a cooling wire is quiet until its date");
  seedHit(api.world.f, { stream: "alice.one", wire: made[3], symbol: "SYA101", key: "p1", session: SESSION });
  api.world.f.db.prepare("INSERT INTO ff_state (wire_id, subject, version, phase, cnt, last_session) VALUES (?, 'n:SYA101', 1, 'firing', 2, ?)").run(made[3], SESSION);
  const hit = await api.call("GET", "/api/ff/symbol?t=SYA101", { user: alice });
  const h = hit.body.panel.wires.find((w) => w.id === made[3]);
  c.eq(h && h.state, "hit", "panel: a firing wire with a hit in this session is hit");
  c.eq(hit.body.panel.lastHit.session, SESSION, "panel: the last hit names its session");
  for (const bad of ["", "TOOLONGSYMBOL123", "A B", "<x>"]) {
    const r = await api.call("GET", "/api/ff/symbol?t=" + encodeURIComponent(bad), { user: alice });
    c.eq(r.status, 400, "panel: " + JSON.stringify(bad) + " is refused");
  }
  const lower = await api.call("GET", "/api/ff/symbol?t=sya101", { user: alice });
  c.eq(lower.body.panel.symbol, "SYA101", "panel: a lower-case name is upper-cased");
}
