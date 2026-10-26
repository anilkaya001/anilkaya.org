import assert from "node:assert/strict";
import { hkdfSync, createCipheriv, createHash } from "node:crypto";
import * as W from "./member-world.mjs";

export const T = { checks: 0 };
export const ok = (c, m) => { assert.ok(c, m); T.checks++; };
export const eq = (a, b, m) => { assert.deepEqual(a, b, m); T.checks++; };

export async function killed(run) {
  try { await run(); } catch (error) {
    if (/^mutant did not apply/.test(String(error && error.message))) throw error;
    if (process.env.MUTANT_TRACE) console.log("  killed by: " + String(error && error.message).split("\n")[0].slice(0, 140));
    return true;
  }
  return false;
}

export const oracleKey = (secret, id) => Buffer.from(hkdfSync("sha256", secret, "flows-member-state/v1/salt", "flows-member-state/v1/watchlist|" + id, 32));
export const oracleKid = (secret) => Buffer.from(hkdfSync("sha256", secret, "flows-member-state/v1/salt", "flows-member-state/v1/kid", 4)).readUInt32BE(0);
export function oracleSeal(secret, id, version, names, iv) {
  const plain = Buffer.alloc(2624, 0x20);
  Buffer.from(JSON.stringify(names)).copy(plain);
  const c = createCipheriv("aes-256-gcm", oracleKey(secret, id), iv, { authTagLength: 16 });
  c.setAAD(Buffer.from("flows-member-state/v1|" + id + "|" + version));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([body, c.getAuthTag()]);
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");

const SECRET = "known-answer-secret-0123456789-abcdefghij";
const IV = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
const KAT_NAMES = ["SYA001", "SYA002", "SYB777"];
const KAT_SHA = "75cf301f3e9c00fd897422e1bd0a7500dc194b9fbe71ec3d19a29a8a9600307e";
const KAT_KID = 3871177751;

export async function cryptoBattery(C) {
  const sealed = await C.seal(SECRET, "member.alpha", 3, KAT_NAMES, IV);
  const expect = oracleSeal(SECRET, "member.alpha", 3, KAT_NAMES, Buffer.from(IV));
  eq(sealed.ct, b64u(expect), "the ciphertext equals the independent node:crypto computation");
  eq(sealed.iv, b64u(Buffer.from(IV)), "and the iv is carried as given");
  eq(sealed.kid, oracleKid(SECRET), "the key id is the first four bytes of a second HKDF, big endian");
  eq(createHash("sha256").update(Buffer.from(sealed.ct, "base64url")).digest("hex"), KAT_SHA, "the module's ciphertext hashes to the digest pinned from a first run of the oracle");
  eq(sealed.kid, KAT_KID, "and its key id is the pinned one");
  eq(sealed.ct.length, 3520, "a three-name list seals to 2,640 bytes");
  const one = await C.seal(SECRET, "member.alpha", 1, ["SYA001"]);
  const full = await C.seal(SECRET, "member.alpha", 1, W.names("SYA", 200));
  eq([one.ct.length, full.ct.length], [3520, 3520], "one name and 200 names seal to the same length, so the stored size reveals nothing");
  eq(await C.open(SECRET, "member.alpha", 3, sealed.iv, sealed.ct), KAT_NAMES, "the module opens what it sealed");
  eq(await C.open(SECRET, "member.alpha", 1, full.iv, full.ct), W.names("SYA", 200), "and the full list");
  for (const [label, run] of [
    ["another member", () => C.open(SECRET, "member.bravo", 3, sealed.iv, sealed.ct)],
    ["another version", () => C.open(SECRET, "member.alpha", 4, sealed.iv, sealed.ct)],
    ["another secret", () => C.open(SECRET + "x", "member.alpha", 3, sealed.iv, sealed.ct)],
  ]) {
    let threw = false;
    try { await run(); } catch { threw = true; }
    ok(threw, "a ciphertext moved to " + label + " does not open");
  }
  const flipped = Buffer.from(sealed.ct, "base64url");
  flipped[10] ^= 1;
  let bad = false;
  try { await C.open(SECRET, "member.alpha", 3, sealed.iv, b64u(flipped)); } catch { bad = true; }
  ok(bad, "one flipped ciphertext byte does not open");
  const ivs = new Set();
  for (let i = 0; i < 50; i += 1) ivs.add((await C.seal(SECRET, "member.alpha", 2, KAT_NAMES)).iv);
  eq(ivs.size, 50, "fifty seals of the same list use fifty different ivs");
  ok(!ivs.has(b64u(new Uint8Array(12))), "and none is all zero");
  ok(C.secretUsable("ğ".repeat(16)) && !C.secretUsable("a".repeat(31)) && C.secretUsable("a".repeat(32)) && !C.secretUsable(undefined) && !C.secretUsable(""),
    "a secret is measured in utf-8 bytes: sixteen two-byte characters are enough, thirty-one ascii characters are not");
  const unsorted = oracleSeal(SECRET, "member.alpha", 1, ["SYB002", "SYA001"], Buffer.from(IV));
  let refused = false;
  try { await C.open(SECRET, "member.alpha", 1, b64u(Buffer.from(IV)), b64u(unsorted)); } catch { refused = true; }
  ok(refused, "a list sealed unsorted is refused on open");
  const twice = await C.seal(SECRET, "member.alpha", 1, ["SYB002", "SYA001", "SYA001"], IV);
  eq(await C.open(SECRET, "member.alpha", 1, twice.iv, twice.ct), ["SYA001", "SYB002"], "sealing sorts and merges duplicates");
  eq(await C.keyId(SECRET), await C.keyId(SECRET), "the key id is stable");
  ok((await C.keyId(SECRET)) !== (await C.keyId(SECRET + "y")), "and differs between secrets");
  eq(await C.pickSecret([undefined, "short", SECRET], sealed.kid), SECRET, "the secret whose id matches is picked, unusable ones skipped");
  eq(await C.pickSecret([SECRET], (sealed.kid + 1) >>> 0), null, "and none when no id matches");
  let tooMany = false;
  try { await C.seal(SECRET, "member.alpha", 1, W.names("SYA", 201)); } catch { tooMany = true; }
  ok(tooMany, "201 names do not seal");
}

export function stateBattery(S) {
  const known = new Set(W.UNIVERSE_NAMES);
  const run = (list, opts = {}) => S.normalizeWatchlist(list, { known, fixtureHost: true, ...opts });
  eq(run(["sya002", " SYA001 ", "SYA001"]), { ok: true, names: ["SYA001", "SYA002"] }, "names are trimmed, upper-cased, merged and sorted");
  eq(run([]), { ok: true, names: [] }, "an empty list is a list");
  const unicode = run(["ſYA001"]);
  eq([unicode.ok, unicode.rejected[0].reason], [false, "not a ticker symbol"], "a long s that upper-cases to a Latin S is refused as a format, not folded into SYA001");
  eq(run(["ıBM"]).rejected[0].reason, "not a ticker symbol", "and so is a dotless i");
  const mixed = run(["SYA001", "SYZ999", "bad name", 7, null, "SYA002"]);
  eq(mixed.code, "rejected", "any bad name rejects the whole list");
  eq(mixed.rejected.map((r) => r.reason).sort(), ["not a ticker symbol", "not a ticker symbol", "not a ticker symbol", "not in the universe"], "with a reason for each");
  const wide = run(Array.from({ length: 30 }, (_, i) => "bad" + i + " x"));
  eq([wide.rejected.length, wide.rejectedCount], [20, 30], "at most twenty rejected names are shown, with the count");
  eq(S.normalizeWatchlist(["SYA001"], { known, fixtureHost: false }).rejected[0].reason, "a reserved test name", "a fixture name off a test host is refused as reserved");
  eq(S.normalizeWatchlist(["SYA001"], { known: new Set(["SYA001"]), fixtureHost: true }).ok, true, "and accepted on a test host");
  eq(run(W.names("SYA", 200)).ok, true, "200 distinct names are accepted");
  const over = run(W.names("SYA", 201));
  eq([over.ok, over.code, over.distinct], [false, "too_many", 201], "201 distinct names are refused with the count");
  eq(run(W.names("SYA", 200).concat(W.names("SYA", 200))).ok, true, "duplicates do not count toward the limit");
  eq(S.normalizeWatchlist("SYA001", { known }).code, "shape", "a non-array is refused");
  const parse = S.parseIfMatch;
  eq(parse('"w0"'), { state: "ok", version: 0 }, "If-Match w0");
  eq(parse(' "w41" '), { state: "ok", version: 41 }, "If-Match w41 trimmed");
  eq(parse(null), { state: "missing" }, "no header is missing");
  for (const junk of ['W/"w0"', "*", '"w01"', '"w0", "w1"', '"x1"', "w1", '"w-1"', '"w1234567890123456"', ""]) eq(parse(junk), { state: "invalid" }, "junk If-Match " + JSON.stringify(junk));
  eq(S.etagOf(7), '"w7"', "the etag is the version");
  const limits = S.MEMBER_LIMITS;
  const t0 = 1790000000000;
  const row = (seen, visit, prev) => ({ seenMs: seen, visitMs: visit, prevSeenMs: prev });
  eq(S.visitStep(null, t0), { wrote: true, newVisit: true, seenMs: t0, visitMs: t0, prevSeenMs: null }, "the first ping starts a visit");
  eq(S.visitStep(row(t0, t0, null), t0 + 59999), { wrote: false, newVisit: false, seenMs: t0, visitMs: t0, prevSeenMs: null }, "a ping 59.999 s later writes nothing");
  eq(S.visitStep(row(t0, t0, null), t0 + 60000), { wrote: true, newVisit: false, seenMs: t0 + 60000, visitMs: t0, prevSeenMs: null }, "at 60 s the last-seen time moves and the visit goes on");
  eq(S.visitStep(row(t0, t0, null), t0 + limits.idleVisitMs - 1), { wrote: true, newVisit: false, seenMs: t0 + limits.idleVisitMs - 1, visitMs: t0, prevSeenMs: null }, "one millisecond short of 30 minutes is the same visit");
  eq(S.visitStep(row(t0, t0, null), t0 + limits.idleVisitMs), { wrote: true, newVisit: true, seenMs: t0 + limits.idleVisitMs, visitMs: t0 + limits.idleVisitMs, prevSeenMs: t0 }, "at exactly 30 minutes a new visit starts and the previous one ends at the old last-seen time");
  eq(S.visitStep(row(t0, t0, null), t0 - 120000).wrote, false, "a clock that went backwards writes nothing");
  eq(S.visitStep(row(t0 + 100, t0, t0 - 5000), t0 + 100 + 2 * limits.idleVisitMs).prevSeenMs, t0 + 100, "prev is the old last-seen, not the old visit start");
  eq(S.moveZ(0.06, 0.02), { z: Math.log1p(0.06) / 0.02, why: null }, "move_z is the log return over the typical move");
  ok(Math.abs(S.moveZ(0.06, 0.02).z - 2.9134) < 1e-4 && Math.abs(S.moveZ(0.06, 0.02).z - 3) > 0.08, "2.91 at a 6 percent rise and a 2 percent typical move, where the simple ratio would say 3.00");
  ok(S.moveZ(-0.2, 0.02).z < -11 && S.moveZ(-0.2, 0.02).z > -11.2, "and a 20 percent fall is a log return of -0.223");
  eq(S.moveZ(0.05, 0), { z: null, why: "zero_scale" }, "a zero typical move is a reason, not Infinity");
  eq(S.moveZ(0.05, null), { z: null, why: "short_history" }, "no typical move is a short history");
  eq(S.moveZ(null, 0.02), { z: null, why: "no_change" }, "no day change is a reason");
  eq(S.moveZ(-1, 0.02), { z: null, why: "no_change" }, "a -100 percent change has no log");
  eq(["ON", " on", "onn", "", undefined, "Owner", "off", "true"].map(S.modeOf), ["on", "on", "off", "off", "off", "owner", "off", "off"], "a switch is on, owner or off after trim and lower-casing, and anything else is off");
}

export const PUT = (version, body) => ({ method: "PUT", headers: { "If-Match": '"w' + version + '"' }, body });
export const LIST = (names) => ({ deviceOnly: false, watchlist: names });
export const rowOf = (w, id = W.ALICE) => w.f.db.prepare("SELECT * FROM member_state WHERE member_id = ?").get(id);
export const count = (w, table) => w.f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;

export async function routeBattery(modules) {
  const make = (extra = {}) => W.build({ modules, ...extra });
  {
    const w = await make();
    const g = await w.call("me.state");
    eq(g.status, 200, "GET state is 200");
    eq(Object.keys(g.json).sort(), ["maxNames", "member", "mode", "reason", "unreadable", "version", "watchlist"], "and carries exactly these keys, no stored column");
    eq([g.json.member, g.json.mode, g.json.reason, g.json.version, g.json.watchlist, g.json.maxNames], [W.ALICE, "server", null, 0, null, 200], "a member who never saved has no list");
    eq(g.headers.get("ETag"), '"w0"', "with the etag of version 0");
    ok(!/wl_|_ct|_iv|kid/.test(g.text), "and no stored column name");
    eq([w.limits.read.calls, w.limits.write.calls, w.limits.export.calls], [[W.ALICE], [], []], "GET spends the read limiter, keyed by the member, and no other");
  }
  {
    const w = await make();
    const p = await w.call("me.state", PUT(0, LIST(["sya102", "SYA101", "SYA101"])));
    eq([p.status, p.json.version, p.json.watchlist, p.headers.get("ETag")], [200, 1, ["SYA101", "SYA102"], '"w1"'], "PUT w0 saves a sorted, merged list as version 1");
    eq(w.limits.write.calls, [W.ALICE], "and spends the write limiter");
    const row = rowOf(w);
    eq([row.wl_ver, row.wl_kid, row.wl_iv.length, row.wl_ct.length, row.device_only], [1, oracleKid(W.KEY), 16, 3520, 0], "the row holds version 1, the key id, a 16-character iv and a 3,520-character ciphertext");
    const text = JSON.stringify(W.allRows(w.f));
    ok(!text.includes("SYA101") && !text.includes("SYA102") && !text.includes('["'), "no ticker and no JSON fragment is in any column");
    const g = await w.call("me.state");
    eq(g.json.watchlist, ["SYA101", "SYA102"], "GET reads it back");
    const KEYS = ["maxNames", "member", "mode", "reason", "unreadable", "version", "watchlist"];
    eq([Object.keys(g.json).sort(), Object.keys(p.json).sort()], [KEYS, KEYS], "with exactly the keys of the empty case, in GET and in the PUT answer: no stored column is ever in a body");
    const stale = await w.call("me.state", PUT(0, LIST(["SYA103"])));
    eq([stale.status, stale.json.error.code, stale.json.version, stale.headers.get("ETag")], [412, "stale_version", 1, '"w1"'], "a PUT with the old version is 412 with the current version and etag");
    eq(rowOf(w).wl_ct, row.wl_ct, "and changes nothing");
    const next = await w.call("me.state", PUT(1, LIST(["SYA103"])));
    eq([next.status, next.json.version, next.json.watchlist], [200, 2, ["SYA103"]], "the current version succeeds");
    ok(rowOf(w).wl_iv !== row.wl_iv, "with a new iv");
    const ahead = await w.call("me.state", PUT(5, LIST(["SYA103"])));
    eq(ahead.status, 412, "a version ahead of the row is stale too");
    const nobody = await w.call("me.state", { ...PUT(3, LIST(["SYA103"])), session: { username: W.BOB } });
    eq([nobody.status, count(w, "member_state")], [412, 1], "and a PUT for a member with no row creates none unless it says w0");
  }
  {
    const w = await make();
    const [a, b] = await Promise.all([w.call("me.state", PUT(0, LIST(["SYA001"]))), w.call("me.state", PUT(0, LIST(["SYA002"])))]);
    eq([a.status, b.status].sort(), [200, 412], "two PUTs at w0 at once give exactly one success");
    eq(rowOf(w).wl_ver, 1, "and the version moved once");
  }
  {
    const w = await make();
    const none = await w.call("me.state", { method: "PUT", body: LIST(["SYA001"]) });
    eq([none.status, none.json.error.code], [428, "precondition_required"], "no If-Match is 428");
    for (const junk of ['W/"w0"', "*", '"w01"', '"w0", "w1"', "w0", '"x0"']) {
      const r = await w.call("me.state", { method: "PUT", headers: { "If-Match": junk }, body: LIST(["SYA001"]) });
      eq([r.status, r.json.error.code], [400, "invalid_precondition"], "If-Match " + junk + " is 400");
    }
    const plain = await w.call("me.state", { ...PUT(0, LIST(["SYA001"])), contentType: "text/plain" });
    eq(plain.status, 415, "text/plain is 415");
    const shapes = [{}, { deviceOnly: true, watchlist: [] }, { deviceOnly: false }, { deviceOnly: "yes" }, { watchlist: ["SYA001"] },
      { deviceOnly: false, watchlist: "SYA001" }, { deviceOnly: false, watchlist: [], memberId: "member.bravo" }, { deviceOnly: true, extra: 1 }];
    for (const body of shapes) {
      const r = await w.call("me.state", PUT(0, body));
      eq([r.status, r.json.error.code], [400, "invalid_watchlist"], "body " + JSON.stringify(body) + " is 400");
    }
    const arr = await w.call("me.state", { ...PUT(0), raw: "[]" });
    eq(arr.status, 400, "an array body is 400");
    eq(count(w, "member_state"), 0, "and nothing was written by any of them");
  }
  {
    const w = await make();
    const r = await w.call("me.state", PUT(0, LIST(["SYA001", "SYZ999", "bad name"])));
    eq([r.status, r.json.error.code, r.json.rejectedCount], [400, "invalid_watchlist", 2], "an unknown name rejects the list");
    eq(r.json.rejected.map((x) => [x.ticker, x.reason]).sort(), [["SYZ999", "not in the universe"], ["bad name", "not a ticker symbol"]], "with a reason for each name");
    ok(!r.json.error.message.includes("SYZ999") && !r.json.error.message.includes("SYA001"), "and no name in the message");
    const big = await w.call("me.state", PUT(0, LIST(W.names("SYA", 201))));
    eq([big.status, big.json.limit, big.json.distinct], [400, 200, 201], "201 distinct names are refused with the limit");
    eq((await w.call("me.state", PUT(0, LIST(W.names("SYA", 200))))).status, 200, "200 are saved");
    const prod = await w.call("me.state", { ...PUT(1, LIST(["SYA001"])), host: "https://anilkaya.org" });
    eq(prod.json.rejected[0].reason, "a reserved test name", "a reserved name is refused on a production host");
    const uni = await make({ payloads: { universe: null } });
    const un = await uni.call("me.state", PUT(0, LIST(["SYA001"])));
    eq([un.status, un.json.error.code], [503, "store_unreadable"], "no universe row is 503 and nothing is saved");
    const bad = await make({ payloads: { universe: { t: [], sessionDate: "2026-10-23" } } });
    eq((await bad.call("me.state", PUT(0, LIST(["SYA001"])))).status, 503, "an empty universe list is 503");
    const odd = await make({ payloads: { universe: { t: ["SYA001", 7] } } });
    eq((await odd.call("me.state", PUT(0, LIST(["SYA001"])))).status, 503, "and a malformed one");
    eq(count(uni, "member_state") + count(bad, "member_state") + count(odd, "member_state"), 0, "none of them wrote a row");
  }
  for (const key of [undefined, "", "k".repeat(31)]) {
    const w = await make({ env: { MEMBER_STATE_KEY: key } });
    const g = await w.call("me.state");
    eq([g.status, g.json.mode, g.json.reason, g.json.watchlist, g.json.unreadable], [200, "device-only", "key_absent", null, false], "an unusable key (" + String(key && key.length) + ") reports device-only mode");
    const p = await w.call("me.state", PUT(0, LIST(["SYA001"])));
    eq([p.status, p.json.error.code], [503, "member_state_unavailable"], "and refuses a list");
    eq(count(w, "member_state"), 0, "storing nothing");
    const d = await w.call("me.state", PUT(0, { deviceOnly: true }));
    eq([d.status, d.json.mode, d.json.reason], [200, "device-only", "key_absent"], "but accepts the switch to device-only");
    eq((await w.call("me.state", { method: "DELETE" })).status, 200, "and a delete");
  }
  {
    const w = await make();
    await w.call("me.state", PUT(0, LIST(["SYA001"])));
    const gone = { ...w.env, MEMBER_STATE_KEY: undefined };
    const g = await w.call("me.state", { env: gone });
    eq([g.json.mode, g.json.reason, g.json.unreadable, g.json.watchlist], ["device-only", "key_absent", true, null], "a stored list with the key removed is unreadable, never an error");
    const d = await w.call("me.state", PUT(1, { deviceOnly: true }));
    eq([d.status, d.json.mode, d.json.reason, d.json.version, d.json.watchlist], [200, "device-only", "member_choice", 2, null], "switching to device-only drops the ciphertext and bumps the version");
    const r = rowOf(w);
    eq([r.wl_ct, r.wl_iv, r.wl_kid, r.device_only], [null, null, null, 1], "the row holds no list");
    const back = await w.call("me.state", PUT(2, LIST(["SYA005"])));
    eq([back.status, back.json.mode, back.json.watchlist, back.json.version], [200, "server", ["SYA005"], 3], "and switching back needs the list in the same PUT");
  }
  {
    const w = await make();
    await w.call("me.state", PUT(0, LIST(["SYA001"])));
    const row = rowOf(w);
    const flip = (ct) => ct.slice(0, 20) + (ct[20] === "A" ? "B" : "A") + ct.slice(21);
    w.f.db.prepare("UPDATE member_state SET wl_ct = ? WHERE member_id = ?").run(flip(row.wl_ct), W.ALICE);
    const g = await w.call("me.state");
    eq([g.status, g.json.unreadable, g.json.watchlist, g.json.version], [200, true, null, 1], "a corrupted ciphertext is unreadable with the version, not an error");
    const fixed = await w.call("me.state", PUT(1, LIST(["SYA002"])));
    eq([fixed.status, fixed.json.watchlist], [200, ["SYA002"]], "and a PUT with the right version replaces it");
    const second = rowOf(w);
    w.f.db.prepare("INSERT INTO member_state (member_id, wl_kid, wl_iv, wl_ct, wl_ver, updated_ms) VALUES (?, ?, ?, ?, ?, 1)").run(W.BOB, second.wl_kid, second.wl_iv, second.wl_ct, second.wl_ver);
    eq((await w.call("me.state", { session: { username: W.BOB } })).json.unreadable, true, "a row copied to another member does not open");
    w.f.db.prepare("UPDATE member_state SET wl_ver = wl_ver + 1 WHERE member_id = ?").run(W.ALICE);
    eq((await w.call("me.state")).json.unreadable, true, "and a row moved to another version does not open");
  }
  {
    const w = await make({ env: { MEMBER_STATE_KEY: W.KEY_PREV } });
    await w.call("me.state", PUT(0, LIST(["SYA001", "SYA002"])));
    const kid1 = rowOf(w).wl_kid;
    const rotated = { ...w.env, MEMBER_STATE_KEY: W.KEY, MEMBER_STATE_KEY_PREV: W.KEY_PREV };
    eq((await w.call("me.state", { env: rotated })).json.watchlist, ["SYA001", "SYA002"], "a row sealed under the previous key still reads after rotation");
    const swept = await w.store.housekeeping(rotated, w.now(), [W.KEY, W.KEY_PREV]);
    eq([swept.resealed, swept.remaining], [1, 0], "the sweep re-seals it under the new key");
    const after = rowOf(w);
    eq([after.wl_kid === oracleKid(W.KEY), after.wl_kid !== kid1, after.wl_ver], [true, true, 1], "with the new key id and the same version");
    eq((await w.call("me.state", { env: { ...w.env, MEMBER_STATE_KEY: W.KEY } })).json.watchlist, ["SYA001", "SYA002"], "and it reads without the previous key");
    const noPrev = await w.store.housekeeping({ ...w.env }, w.now(), [W.KEY]);
    eq(noPrev.resealed, 0, "no sweep runs without a previous key");
    const bare = await W.build({ modules, payloads: {}, now: w.now });
    bare.f.db.exec("DROP TABLE member_state; DROP TABLE member_export;");
    const ddlBefore = bare.f.trips.length;
    eq(await bare.store.housekeeping(bare.env, w.now(), [W.KEY, W.KEY_PREV]), { pruned: 0, resealed: 0, remaining: null }, "the sweep on a database that has no member tables does nothing and does not throw");
    ok(bare.f.trips.slice(ddlBefore).every((t) => t.sqls.every((q) => !/^CREATE/i.test(q))), "and creates nothing: the nightly schedule never runs the member schema");
    eq(await bare.store.housekeeping({}, w.now(), [W.KEY]), { pruned: 0, resealed: 0, remaining: null }, "and does nothing without a database");
    const broken = { DB: { prepare() { throw new Error("D1 is down"); } } };
    let rethrown = null;
    try { await bare.store.housekeeping(broken, w.now(), [W.KEY]); } catch (error) { rethrown = error.message; }
    eq(rethrown, "D1 is down", "any other failure reaches the caller, whose guard logs it");
  }
  {
    const now = W.clock();
    const w = await make({ now });
    const t0 = now();
    const v1 = await w.call("me.visit");
    eq(v1.json.visit, { startedMs: t0, lastSeenMs: t0, previousEndedMs: null, firstVisit: true, newVisit: true }, "the first visit");
    now.tick(10000);
    const v2 = await w.call("me.visit");
    eq(v2.json.visit, { startedMs: t0, lastSeenMs: t0, previousEndedMs: null, firstVisit: true, newVisit: false }, "a ping 10 s later changes nothing");
    const before = rowOf(w).updated_ms;
    now.tick(51000);
    const v3 = await w.call("me.visit");
    eq([v3.json.visit.startedMs, v3.json.visit.lastSeenMs, v3.json.visit.newVisit, rowOf(w).updated_ms > before], [t0, t0 + 61000, false, true], "at 61 s the last-seen time moves and the visit goes on");
    const g = await w.call("me.state");
    await w.call("me.state", PUT(g.json.version, LIST(["SYA001"])));
    eq(rowOf(w).wl_ver, 1, "a visit does not move the list version");
    now.tick(60000);
    await w.call("me.visit");
    const put = await w.call("me.state", PUT(1, LIST(["SYA002"])));
    eq(put.status, 200, "so a PUT made after another visit's ping with the version it read still succeeds");
    const seen = rowOf(w).seen_ms;
    now.set(seen + 30 * 60 * 1000);
    const v4 = await w.call("me.visit");
    eq([v4.json.visit.newVisit, v4.json.visit.previousEndedMs, v4.json.visit.startedMs, v4.json.visit.firstVisit], [true, seen, seen + 30 * 60 * 1000, false], "at exactly 30 minutes idle a new visit starts and the previous one ended at the old last-seen time");
    now.set(rowOf(w).seen_ms - 120000);
    const v5 = await w.call("me.visit");
    eq(v5.json.visit.newVisit, false, "a clock that went backwards starts nothing");
    ok(rowOf(w).seen_ms > now(), "and writes nothing");
    const bob = await w.call("me.visit", { session: { username: W.BOB } });
    eq(bob.json.visit.firstVisit, true, "another member has a visit of their own");
  }
  {
    const w = await make();
    await w.call("me.state", PUT(0, LIST(["SYA001"])));
    await w.call("me.state", { ...PUT(0, LIST(["SYA009"])), session: { username: W.BOB } });
    w.f.db.prepare("INSERT INTO member_export (member_id, page, n_rows, cols, at_ms) VALUES (?, 'moves', 3, 'ticker,sig', ?)").run(W.ALICE, w.now() - 1000);
    const d = await w.call("me.state", { method: "DELETE" });
    eq([d.status, d.json.deleted, d.json.kept.exports, d.json.kept.untilMs, d.json.kept.reason], [200, { state: 1 }, 1, w.now() - 1000 + 90 * 86400000, "export record, kept 90 days"], "DELETE removes the state and says the export record stays");
    eq([rowOf(w), rowOf(w, W.BOB) !== undefined, count(w, "member_export")], [undefined, true, 1], "only the caller's row went; another member's stayed; the export log stayed");
    const g = await w.call("me.state");
    eq([g.json.version, g.json.watchlist], [0, null], "the next read is a fresh member");
    eq((await w.call("me.state", { method: "DELETE" })).json.deleted, { state: 0 }, "and DELETE is idempotent");
  }
  {
    const w = await make();
    const trips = w.f.trips.length;
    const foreign = await w.call("me.state", { ...PUT(0, LIST(["SYA001"])), headers: { "If-Match": '"w0"', Origin: "https://evil.example" } });
    eq(foreign.status, 403, "a foreign origin is 403");
    const cross = await w.call("me.state", { ...PUT(0, LIST(["SYA001"])), headers: { "If-Match": '"w0"', "Sec-Fetch-Site": "cross-site" } });
    eq(cross.status, 403, "a cross-site fetch is 403");
    const bareWrite = await w.call("me.state", { ...PUT(0, LIST(["SYA001"])), same: false });
    eq(bareWrite.status, 403, "a write with neither header is 403");
    eq([w.limits.read.calls, w.limits.write.calls, w.limits.export.calls], [[], [], []], "none of them spent a limiter");
    eq(w.f.trips.length, trips, "and none touched the database");
    const bare = await w.call("me.state", { same: false });
    eq(bare.status, 200, "a GET with neither header is allowed");
  }
  {
    const w = await make();
    let last;
    for (let i = 0; i < 30; i += 1) last = await w.call("me.visit");
    eq(last.status, 200, "30 writes in a window are served");
    const trips = w.f.trips.length;
    const over = await w.call("me.visit");
    eq([over.status, over.json.error.code, over.headers.get("Retry-After")], [429, "rate_limited", "60"], "the 31st is 429 with Retry-After 60");
    eq(w.f.trips.length, trips, "with no database trip");
    const put = await w.call("me.state", PUT(0, LIST(["SYA001"])));
    eq(put.status, 429, "PUT and DELETE share the write limiter");
    eq((await w.call("me.state")).status, 200, "a read has a limiter of its own");
    const other = await w.call("me.visit", { session: { username: W.BOB } });
    eq(other.status, 200, "and another member has a counter of their own");
  }
  {
    for (const [value, expect] of [["ON", 200], [" on", 200], ["onn", 404], ["", 404], [undefined, 404], ["off", 404], ["true", 404]]) {
      const w = await make({ env: { FLOWS_MEMBER_STATE: value } });
      const r = await w.call("me.state");
      eq(r.status, expect, "FLOWS_MEMBER_STATE " + JSON.stringify(value) + " is " + expect);
      if (expect === 404) eq([r.json.error.code, w.limits.read.calls.length], ["member_state_off", 0], "and spends no limiter");
    }
    const w = await make({ env: { FLOWS_MEMBER_STATE: "owner" } });
    const m = await w.call("me.state");
    eq([m.status, m.json.error.code], [403, "forbidden"], "owner mode is 403 for a member, on the server");
    eq((await w.call("me.state", { session: { username: W.OWNER } })).status, 200, "and open to the owner");
    for (const username of ["Bad", "ab", "", undefined]) {
      eq((await w.call("me.state", { session: { username } })).status, 401, "a session name " + JSON.stringify(username) + " is 401");
    }
  }
}
