import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signSession, verifySession } from "../shared/session.js";
import {
  FLOWS_AUDIENCE, LEARN_AUDIENCE, FLOWS_COOKIE, FLOWS_USERNAMES,
  PBKDF2_ITERATIONS, deriveHash, timingSafeEqual, parseCredentials,
  verifyCredential, signFlowsSession, verifyFlowsSession, isLearnAudience,
  LOCKOUT, isLocked, nextFailureState, sessionEpoch, DEFAULT_SESSION_EPOCH,
  MEMBER_NAME, readMembers, memberRecord, memberOf, memberActive, isMemberDay,
  throttleBucket, THROTTLE_SHARED_BUCKET, throttleAddress, staleFailureCutoff, NO_MEMBERS,
} from "../shared/flows-auth.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const SECRET = "test-session-secret-not-production";
const PEPPER = "test-pepper-value";
const PASSWORD = "Ankara06**--";

{
  ok(FLOWS_USERNAMES.length === 12, "twelve accounts are provisioned");
  ok(new Set(FLOWS_USERNAMES).size === 12, "usernames are unique");
  ok(FLOWS_USERNAMES.every((u) => /^[a-z]+$/.test(u)), "usernames are lowercase and simple");
  ok(Object.isFrozen(FLOWS_USERNAMES), "the roster cannot be mutated at runtime");
  for (const expected of ["firatgok", "dincersen", "mehmetsen", "ferhatyukselturk", "berkkocak",
                          "anilkaya", "isaatceken", "bektastorun", "yigiteyi", "ahmetcan", "canaci",
                          "ozgurhatipoglu"]) {
    ok(FLOWS_USERNAMES.includes(expected), `roster contains ${expected}`);
  }
}

{
  ok(PBKDF2_ITERATIONS === 10000, "iteration count is the measured maximum for a 10 ms cap");

  const a = await deriveHash("anilkaya", PASSWORD, PEPPER);
  const b = await deriveHash("anilkaya", PASSWORD, PEPPER);
  ok(a === b, "derivation is deterministic");
  ok(a.length >= 40, "derived hash is a full 256 bits");

  const other = await deriveHash("berkkocak", PASSWORD, PEPPER);
  ok(a !== other, "the username salts the hash, so shared passwords differ per user");

  const noPepper = await deriveHash("anilkaya", PASSWORD, "");
  ok(a !== noPepper, "the pepper materially changes the hash");

  const wrongPepper = await deriveHash("anilkaya", PASSWORD, "different-pepper");
  ok(a !== wrongPepper, "a wrong pepper cannot reproduce the hash");

  const wrongPw = await deriveHash("anilkaya", "wrong", PEPPER);
  ok(a !== wrongPw, "a wrong password cannot reproduce the hash");

  ok(a === "Ct9eJHKJa8C/B829TA/m4Tz1bEVxehNxCFEjfaTHugU=",
     "THE KNOWN ANSWER: the derivation is byte-identical to the one every stored hash was minted with");
}

{
  ok(timingSafeEqual("abc", "abc"), "equal strings match");
  ok(!timingSafeEqual("abc", "abd"), "differing content fails");
  ok(!timingSafeEqual("abc", "abcd"), "differing length fails");
  ok(!timingSafeEqual("", "a"), "empty against non-empty fails");
  ok(timingSafeEqual("", ""), "empty against empty matches");
  ok(!timingSafeEqual(null, "a"), "null is handled");
  ok(timingSafeEqual(undefined, ""), "undefined coerces to empty");
}

{
  ok(parseCredentials(null) === null, "missing secret yields no credentials");
  ok(parseCredentials("not json") === null, "malformed secret yields no credentials");
  ok(parseCredentials("[]") === null, "an array is not a credential map");
  ok(parseCredentials("{}") === null, "an empty object yields no credentials");
  ok(parseCredentials('{"No Body":"x","ab":"x","a/b":"x"}') === null,
     "names outside /^[a-z0-9_.-]{3,32}$/ are ignored");

  const parsed = parseCredentials('{"anilkaya":"HASH","newmember":"H2","Bad Name":"x"}');
  ok(parsed && parsed.anilkaya.hash === "HASH", "legacy roster members are kept");
  ok(parsed && parsed.newmember.hash === "H2", "THE ALLOWLIST IS THE SECRET: a name only in the secret is kept");
  ok(parsed && !("Bad Name" in parsed), "an invalid name is dropped");
  ok(Object.getPrototypeOf(parsed) === null, "the map has a null prototype (no __proto__ tricks)");
  ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.anilkaya), "the parsed map and its records are frozen");
  ok(parsed.anilkaya.until === null && parsed.anilkaya.epoch === 0,
     "an old string value means no end date and per-user epoch 0");

  const proto = readMembers('{"__proto__":"P","toString":"T","constructor":"C"}');
  ok(Object.getPrototypeOf(proto) === null, "a __proto__ key cannot replace the map's prototype");
  ok(memberOf(proto, "tostring") === null && memberOf(proto, "hasOwnProperty") === null,
     "an inherited name is never a member");
  ok(memberOf(proto, "constructor").hash === "C", "a plain own key is looked up as data, nothing more");

  ok(MEMBER_NAME.test("abc") && MEMBER_NAME.test("a.b-c_9") && MEMBER_NAME.test("x".repeat(32)),
     "the name rule admits 3 to 32 of [a-z0-9_.-]");
  ok(!MEMBER_NAME.test("ab") && !MEMBER_NAME.test("x".repeat(33)) && !MEMBER_NAME.test("Abc") &&
     !MEMBER_NAME.test("a b") && !MEMBER_NAME.test("a\u0000b"), "and nothing else");
  ok(FLOWS_USERNAMES.every((u) => MEMBER_NAME.test(u)), "every legacy roster name satisfies the rule");
}

{
  ok(isMemberDay("2026-12-31") && !isMemberDay("2026-02-30") && !isMemberDay("2026-12-31T00:00") &&
     !isMemberDay(20261231) && !isMemberDay(""), "an end date is a real calendar day, nothing looser");
  ok(memberRecord({ hash: "H", until: "2026-12-31", epoch: 3 }).epoch === 3, "the object form is accepted");
  ok(memberRecord({ hash: "H", until: "2026-12-31", note: "renewed" }).until === "2026-12-31",
     "an unknown extra field is ignored, so a later field never breaks an older Worker");
  ok(memberRecord({ hash: "H", until: null }).until === null, "an explicit null end date means none");
  ok(memberRecord({ hash: "", epoch: 1 }) === null, "an empty hash is refused");
  ok(memberRecord({ until: "2026-12-31" }) === null, "a missing hash is refused");
  ok(memberRecord({ hash: "H", until: "2026-13-01" }) === null,
     "an impossible end date refuses the entry rather than granting open-ended access");
  ok(memberRecord({ hash: "H", epoch: -1 }) === null && memberRecord({ hash: "H", epoch: 1.5 }) === null &&
     memberRecord({ hash: "H", epoch: "2" }) === null, "a malformed epoch refuses the entry");
  ok(memberRecord({ hash: "x".repeat(257) }) === null && memberRecord("x".repeat(257)) === null,
     "an oversized hash is refused, so no entry can make a login costly");
  ok(memberRecord(["H"]) === null && memberRecord(7) === null && memberRecord(null) === null,
     "other shapes are refused");

  const mixed = readMembers(JSON.stringify({
    good: "HASH-GOOD", later: { hash: "HASH-L", until: "2027-01-31" },
    badday: { hash: "H", until: "31/01/2027" }, badepoch: { hash: "H", epoch: "x" }, arr: ["H"],
  }));
  ok(mixed && Object.keys(mixed).join() === "good,later",
     "A MALFORMED ENTRY IS IGNORED, NOT FATAL: the well-formed members survive beside it");

  const a1 = readMembers('{"abc":"H"}');
  ok(readMembers('{"abc":"H"}') === a1, "the same secret value is parsed once and reused");
  ok(readMembers('{"abd":"H"}') !== a1 && memberOf(readMembers('{"abc":"H"}'), "abc").hash === "H",
     "a changed secret value is parsed afresh");
  for (const raw of ["not json", undefined, "", "[1]", '{"anilkaya":"H",}', "null", "7"]) {
    const read = readMembers(raw);
    ok(read === NO_MEMBERS && Object.keys(read).length === 0 && Object.isFrozen(read),
       `AN UNREADABLE OR MISSING SECRET FAILS CLOSED: ${JSON.stringify(raw)} reads as no members, never null`);
  }
  const pristine = await import("../shared/flows-auth.js?pristine-memo");
  const first = pristine.readMembers(undefined);
  ok(first === pristine.NO_MEMBERS && Object.keys(first).length === 0,
     "including the very first read of a fresh isolate, before any secret was ever parsed");
  const empty = readMembers("{}");
  ok(empty !== null && Object.keys(empty).length === 0, "a readable but empty secret is an empty map too");
}

{
  const creds = Object.create(null);
  for (const u of FLOWS_USERNAMES) creds[u] = await deriveHash(u, PASSWORD, PEPPER);

  ok(await verifyCredential("anilkaya", PASSWORD, creds, PEPPER) === "anilkaya",
     "a correct credential authenticates");
  ok(await verifyCredential("ANILKAYA", PASSWORD, creds, PEPPER) === "anilkaya",
     "usernames are case-insensitive");
  ok(await verifyCredential("  anilkaya  ", PASSWORD, creds, PEPPER) === "anilkaya",
     "surrounding whitespace is tolerated");

  ok(await verifyCredential("anilkaya", "wrong", creds, PEPPER) === null,
     "a wrong password is rejected");
  ok(await verifyCredential("nosuchuser", PASSWORD, creds, PEPPER) === null,
     "an unknown username is rejected");
  ok(await verifyCredential("anilkaya", PASSWORD, creds, "wrong-pepper") === null,
     "a wrong pepper rejects even a correct password");
  ok(await verifyCredential("", "", creds, PEPPER) === null, "empty input is rejected");
  ok(await verifyCredential("anilkaya", PASSWORD, null, PEPPER) === null,
     "a missing credential map rejects rather than admits");

  for (const u of FLOWS_USERNAMES) {
    ok(await verifyCredential(u, PASSWORD, creds, PEPPER) === u, `${u} authenticates`);
  }
}

{
  const at = (iso) => Date.parse(iso);
  const raw = JSON.stringify({
    anilkaya: await deriveHash("anilkaya", PASSWORD, PEPPER),
    newmember: await deriveHash("newmember", PASSWORD, PEPPER),
    lapsed: { hash: await deriveHash("lapsed", PASSWORD, PEPPER), until: "2026-09-24" },
    renewed: { hash: await deriveHash("renewed", PASSWORD, PEPPER), until: "2026-12-31", epoch: 2 },
  });
  const members = parseCredentials(raw);

  ok(await verifyCredential("newmember", PASSWORD, members, PEPPER) === "newmember",
     "A NAME ONLY IN THE SECRET SIGNS IN: no code change, no deploy");
  ok(await verifyCredential("NewMember ", PASSWORD, members, PEPPER) === "newmember",
     "and it is normalised like every other name");
  ok(await verifyCredential("anilkaya", PASSWORD, members, PEPPER) === "anilkaya",
     "an old string entry keeps working unchanged");
  ok(await verifyCredential("renewed", PASSWORD, members, PEPPER, at("2026-10-01T15:00:00Z")) === "renewed",
     "an object entry inside its end date signs in");

  const wrong = await verifyCredential("lapsed", "wrong", members, PEPPER, at("2026-09-25T15:00:00Z"));
  const lapsed = await verifyCredential("lapsed", PASSWORD, members, PEPPER, at("2026-09-25T15:00:00Z"));
  const unknown = await verifyCredential("nobody-here", PASSWORD, members, PEPPER, at("2026-09-25T15:00:00Z"));
  ok(lapsed === null, "AN END DATE IN THE PAST IS REFUSED, even with the right password");
  ok(lapsed === wrong && lapsed === unknown,
     "with exactly the failure a wrong password or an unknown name gets (no enumeration)");

  ok(await verifyCredential("lapsed", PASSWORD, members, PEPPER, at("2026-09-24T20:00:00Z")) === "lapsed",
     "the end date is inclusive: its own day still admits");
  ok(await verifyCredential("lapsed", PASSWORD, members, PEPPER, at("2026-09-25T03:30:00Z")) === "lapsed",
     "THE EASTERN DAY: 23:30 in New York on the end date admits although UTC has rolled over");
  ok(await verifyCredential("lapsed", PASSWORD, members, PEPPER, at("2026-09-25T04:00:00Z")) === null,
     "and New York's midnight ends it");
  ok(memberActive(memberOf(members, "lapsed"), NaN) === false, "an unreadable clock fails closed");

  const legacyMap = Object.create(null);
  legacyMap.anilkaya = await deriveHash("anilkaya", PASSWORD, PEPPER);
  ok(await verifyCredential("anilkaya", PASSWORD, legacyMap, PEPPER) === "anilkaya",
     "a hand-built map of plain hash strings is still accepted");
  const oddMap = Object.create(null);
  oddMap["bad name"] = await deriveHash("bad name", PASSWORD, PEPPER);
  ok(await verifyCredential("bad name", PASSWORD, oddMap, PEPPER) === null,
     "a name that breaks the rule never signs in, whatever map it is given");
}

{
  const at = (iso) => Date.parse(iso);
  const members = parseCredentials(JSON.stringify({
    anilkaya: "H-A", newmember: "H-N",
    lapsed: { hash: "H-L", until: "2026-09-24" },
    renewed: { hash: "H-R", until: "2026-12-31", epoch: 2 },
  }));

  const legacyToken = await signFlowsSession("anilkaya", SECRET, 3600, "1");
  const legacyClaims = await verifySession(legacyToken, SECRET);
  ok(!("uep" in legacyClaims),
     "a member at per-user epoch 0 gets a token shaped exactly as before, so the deploy signs nobody out");
  ok((await verifyFlowsSession(legacyToken, SECRET, "1", members)).username === "anilkaya",
     "and a pre-existing session verifies against the secret");

  const fresh = await signFlowsSession("newmember", SECRET, 3600, "1", 0);
  ok((await verifyFlowsSession(fresh, SECRET, "1", members)).username === "newmember",
     "a session for a name only in the secret verifies");
  ok(await verifyFlowsSession(fresh, SECRET, "1") === null,
     "while the legacy check alone (no members given) still refuses a name outside the old roster");

  const gone = parseCredentials(JSON.stringify({ anilkaya: "H-A" }));
  ok(await verifyFlowsSession(fresh, SECRET, "1", gone) === null,
     "REMOVAL IS REVOCATION: dropping a name from the secret ends its live session");

  const lapsedToken = await signFlowsSession("lapsed", SECRET, 3600, "1");
  ok((await verifyFlowsSession(lapsedToken, SECRET, "1", members, at("2026-09-24T21:00:00Z"))).username === "lapsed",
     "a session inside its member's end date verifies");
  ok(await verifyFlowsSession(lapsedToken, SECRET, "1", members, at("2026-09-25T13:00:00Z")) === null,
     "THE END DATE ENDS A LIVE SESSION BY ITSELF, not only the next sign-in");

  const r2 = await signFlowsSession("renewed", SECRET, 3600, "1", 2);
  const a0 = await signFlowsSession("anilkaya", SECRET, 3600, "1", 0);
  ok((await verifySession(r2, SECRET)).uep === 2, "the per-user epoch rides in the token");
  ok((await verifyFlowsSession(r2, SECRET, "1", members, at("2026-10-01T15:00:00Z"))).username === "renewed",
     "a session minted at the member's current epoch verifies");
  const bumped = parseCredentials(JSON.stringify({
    anilkaya: "H-A", newmember: "H-N",
    lapsed: { hash: "H-L", until: "2026-09-24" },
    renewed: { hash: "H-R", until: "2026-12-31", epoch: 3 },
  }));
  ok(await verifyFlowsSession(r2, SECRET, "1", bumped, at("2026-10-01T15:00:00Z")) === null,
     "BUMPING ONE USER'S EPOCH REVOKES THAT USER");
  ok((await verifyFlowsSession(a0, SECRET, "1", bumped)).username === "anilkaya" &&
     (await verifyFlowsSession(fresh, SECRET, "1", bumped)).username === "newmember",
     "AND ONLY THAT USER: everyone else stays signed in");
  ok(await verifyFlowsSession(a0, SECRET, "2", members) === null,
     "the global FLOWS_SESSION_EPOCH still signs everyone out");

  const forgedEpoch = await signSession(
    { sub: "renewed", aud: FLOWS_AUDIENCE, epoch: "1", uep: "2", exp: Date.now() + 60000 }, SECRET);
  ok(await verifyFlowsSession(forgedEpoch, SECRET, "1", members, at("2026-10-01T15:00:00Z")) === null,
     "a per-user epoch of the wrong type never matches");

  const nobody = readMembers("{}");
  ok(await verifyFlowsSession(a0, SECRET, "1", nobody) === null,
     "a readable secret with no members admits no session: the secret is authoritative");
  ok(await verifyFlowsSession(a0, SECRET, "1", readMembers("broken{")) === null,
     "NO FALLBACK: an unreadable secret admits no session, not even a legacy roster name's");
  ok(await verifyFlowsSession(a0, SECRET, "1", readMembers(undefined)) === null,
     "and neither does a missing one");
  const revokedLegacy = await signFlowsSession("anilkaya", SECRET, 3600, "1", 0);
  const lapsedSecret = JSON.stringify({ anilkaya: { hash: "H-A", until: "2026-01-01" } });
  ok(await verifyFlowsSession(revokedLegacy, SECRET, "1", readMembers(lapsedSecret)) === null &&
     await verifyFlowsSession(revokedLegacy, SECRET, "1", readMembers(lapsedSecret.slice(0, -1) + ",}")) === null,
     "THE REVIEW'S CASE: a lapsed legacy member stays out when one bad edit breaks the secret");
  ok(await verifyFlowsSession(fresh, SECRET, "1", readMembers("broken{")) === null,
     "and a name beyond the legacy roster is refused as before");
}

{
  ok(throttleBucket("anilkaya") === "anilkaya", "a legacy roster name keeps its own throttle bucket");
  ok(throttleBucket("newmember") === THROTTLE_SHARED_BUCKET && throttleBucket("zz-nobody") === THROTTLE_SHARED_BUCKET,
     "every other name, member or not, shares one bucket per address, so a lockout cannot tell them apart");
  const buckets = new Set();
  for (let i = 0; i < 5000; i++) buckets.add(throttleBucket("guess" + i));
  ok(buckets.size === 1, "and unknown names never grow the throttle table by name");
  ok(!MEMBER_NAME.test(THROTTLE_SHARED_BUCKET), "the shared bucket can never collide with a member's name");
  ok(throttleBucket(undefined) === THROTTLE_SHARED_BUCKET, "a missing name is safe");

  ok(throttleAddress("203.0.113.10") === "203.0.113.10", "an IPv4 address is its own counter");
  ok(throttleAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd") === "2001:db8:1:2::/64" &&
     throttleAddress("2001:DB8:1:2::1") === "2001:db8:1:2::/64" &&
     throttleAddress("2001:0db8:0001:0002:ffff::9") === "2001:db8:1:2::/64",
     "AN IPv6 ADDRESS COUNTS AS ITS /64, however it is written, so rotating the host half cannot mint counters");
  ok(throttleAddress("2001:db8::1") === "2001:db8:0:0::/64" && throttleAddress("::1") === "0:0:0:0::/64",
     "a compressed prefix expands before it is cut");
  ok(throttleAddress("2001:db8:1:3::1") !== throttleAddress("2001:db8:1:2::1"), "another /64 is another counter");
  ok(throttleAddress("::ffff:198.51.100.20") === "198.51.100.20",
     "an IPv4-mapped address counts as its IPv4 address, not as the one all-zero /64");
  ok(throttleAddress(null) === "unknown" && throttleAddress("") === "unknown" && throttleAddress("x".repeat(65)) === "unknown",
     "a missing or oversized header shares one bounded key");
  ok(throttleAddress("1:2:3") === "1:2:3" && throttleAddress("1::2::3") === "1::2::3",
     "a malformed address is kept as given (bounded), never widened into someone else's /64");
}

{
  const flowsToken = await signFlowsSession("anilkaya", SECRET);

  const good = await verifyFlowsSession(flowsToken, SECRET);
  ok(good && good.username === "anilkaya", "a flows session verifies for flows");

  const asPayload = await verifySession(flowsToken, SECRET);
  ok(asPayload !== null, "the token is cryptographically valid (same secret)");
  ok(asPayload.aud === FLOWS_AUDIENCE, "and it carries the flows audience");
  ok(!isLearnAudience(asPayload),
     "THE BOUNDARY: a flows token is refused by the learning audience check");

  const learnToken = await signSession(
    { sub: "g_12345", aud: LEARN_AUDIENCE, exp: Date.now() + 60000 }, SECRET,
  );
  ok(await verifyFlowsSession(learnToken, SECRET) === null,
     "THE BOUNDARY: a learning token is refused by the flows gate");
  ok(isLearnAudience(await verifySession(learnToken, SECRET)),
     "and it still works for learning");

  const legacy = await signSession({ sub: "g_legacy", exp: Date.now() + 60000 }, SECRET);
  ok(isLearnAudience(await verifySession(legacy, SECRET)),
     "a legacy audience-less token is still accepted for learning (nobody is logged out)");
  ok(await verifyFlowsSession(legacy, SECRET) === null,
     "but a legacy token cannot reach flows");

  const alien = await signSession({ sub: "x", aud: "admin", exp: Date.now() + 60000 }, SECRET);
  ok(!isLearnAudience(await verifySession(alien, SECRET)), "an unknown audience fails learning");
  ok(await verifyFlowsSession(alien, SECRET) === null, "an unknown audience fails flows");

  ok(await verifyFlowsSession(flowsToken, "wrong-secret") === null, "a wrong secret fails");
  ok(await verifyFlowsSession("garbage", SECRET) === null, "a malformed token fails");
  ok(await verifyFlowsSession("", SECRET) === null, "an empty token fails");
  ok(await verifyFlowsSession(null, SECRET) === null, "a null token fails");

  const expired = await signFlowsSession("anilkaya", SECRET, -1);
  ok(await verifyFlowsSession(expired, SECRET) === null, "an expired token fails");

  const ghost = await signSession(
    { sub: "removed-user", aud: FLOWS_AUDIENCE, exp: Date.now() + 60000 }, SECRET,
  );
  ok(await verifyFlowsSession(ghost, SECRET) === null, "an off-roster subject is refused");

  ok(FLOWS_COOKIE !== "session", "the flows cookie name differs from the learning one");
}

{
  const now = Date.UTC(2026, 7, 24, 12, 0, 0);
  ok(!isLocked(null, now), "no record means not locked");
  ok(!isLocked({ failures: 3, first_at: now - 1000 }, now), "below the threshold is not locked");
  ok(isLocked({ failures: LOCKOUT.maxFailures, first_at: now - 1000 }, now), "at the threshold is locked");
  ok(isLocked({ failures: 99, first_at: now - 1000 }, now), "above the threshold is locked");

  const stale = now - (LOCKOUT.windowSeconds * 1000 + 1);
  ok(!isLocked({ failures: 99, first_at: stale }, now), "an expired window releases the lock");

  const first = nextFailureState(null, now);
  ok(first.failures === 1 && first.first_at === now, "the first failure opens a window");

  const second = nextFailureState(first, now + 1000);
  ok(second.failures === 2, "failures accumulate");
  ok(second.first_at === now, "the window anchor does not slide (no infinite extension)");

  const rolled = nextFailureState({ failures: 7, first_at: stale }, now);
  ok(rolled.failures === 1, "a stale window resets the count");

  const cutoff = staleFailureCutoff(now);
  ok(!isLocked({ failures: 99, first_at: cutoff - 1 }, now) &&
     nextFailureState({ failures: 99, first_at: cutoff - 1 }, now).failures === 1,
     "THE PRUNE IS SAFE: a counter older than the cutoff neither locks nor counts, so deleting it changes nothing");
  ok(isLocked({ failures: LOCKOUT.maxFailures, first_at: cutoff }, now),
     "and a counter at the cutoff is still live, so the prune never frees a locked address early");
}

{
  ok(DEFAULT_SESSION_EPOCH === "1", "an unset epoch binding is a stable default, not undefined");
  ok(sessionEpoch({}) === "1", "a missing binding falls back to the default");
  ok(sessionEpoch({ FLOWS_SESSION_EPOCH: "" }) === "1", "an empty binding falls back");
  ok(sessionEpoch({ FLOWS_SESSION_EPOCH: "7" }) === "7", "a set binding is honoured");
  ok(sessionEpoch(null) === "1", "a null env is safe");

  const t1 = await signFlowsSession("anilkaya", SECRET, 3600, "1");
  ok((await verifyFlowsSession(t1, SECRET, "1")).username === "anilkaya",
     "a session verifies against its own epoch");
  ok(await verifyFlowsSession(t1, SECRET, "2") === null,
     "THE REVOCATION LEVER: bumping the epoch invalidates an outstanding session");

  const epochless = await signSession(
    { sub: "anilkaya", aud: FLOWS_AUDIENCE, exp: Date.now() + 60000 }, SECRET,
  );
  ok(await verifyFlowsSession(epochless, SECRET, "1") === null,
     "a token predating epochs is refused rather than silently accepted");

  const wrongAud = await signSession(
    { sub: "anilkaya", aud: "learn", epoch: "1", exp: Date.now() + 60000 }, SECRET,
  );
  ok(await verifyFlowsSession(wrongAud, SECRET, "1") === null,
     "a correct epoch does not excuse a wrong audience");
}

{
  const SCRIPT = fileURLToPath(new URL("../scripts/generate-flows-credentials.mjs", import.meta.url));
  const MINT_PEPPER = "members-contract-pepper-0123456789";
  const dir = mkdtempSync(path.join(tmpdir(), "flows-members-"));
  const run = (args, input = "") => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });
  try {
    const file = path.join(dir, "members.json");
    writeFileSync(file, JSON.stringify({ anilkaya: await deriveHash("anilkaya", PASSWORD, MINT_PEPPER) }));

    const added = run(["--add", "new.member", "--until", "2099-12-31", "--from", file, "--out", file], MINT_PEPPER + "\n");
    ok(added.status === 0, "--add succeeds: " + added.stderr);
    ok(added.stdout === "", "with --out, nothing but the file receives the JSON");
    const password = /password for new\.member:\s+(\S+)/.exec(added.stderr)?.[1];
    ok(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/.test(password || ""), "a fresh password is shown once, on the terminal");
    ok(added.stderr.includes("wrangler secret put FLOWS_CREDENTIALS < " + file),
       "THE ONE COMMAND: the exact install line is printed");
    const afterAdd = readMembers(readFileSync(file, "utf8").trim());
    ok(afterAdd.anilkaya && afterAdd["new.member"].until === "2099-12-31",
       "the new member lands beside the old one, with its end date, in the object form");
    ok(await verifyCredential("new.member", password, afterAdd, MINT_PEPPER) === "new.member",
       "the printed password signs the new member in against the new secret");
    ok(await verifyCredential("anilkaya", PASSWORD, afterAdd, MINT_PEPPER) === "anilkaya",
       "and the existing member's password is untouched");

    const bumped = run(["--set", "new.member", "--epoch", "next"], readFileSync(file, "utf8"));
    ok(bumped.status === 0, "--set reads the current JSON from stdin");
    const lines = bumped.stdout.split("\n").filter(Boolean);
    ok(lines.length === 1, "and stdout carries exactly one line, the JSON, so it pipes straight into wrangler");
    const afterSet = readMembers(lines[0]);
    ok(afterSet["new.member"].epoch === 1 && afterSet["new.member"].hash === afterAdd["new.member"].hash,
       "--epoch next revokes by bumping the epoch and keeps the password");
    ok(afterSet.anilkaya.epoch === 0, "nobody else's epoch moves");
    ok(JSON.parse(lines[0]).anilkaya === afterAdd.anilkaya.hash,
       "a member with no end date and epoch 0 stays in the old string form");

    const cleared = run(["--set", "new.member", "--until", "never"], lines[0]);
    ok(readMembers(cleared.stdout.trim())["new.member"].until === null, "--until never lifts an end date");

    const removed = run(["--remove", "new.member"], lines[0]);
    ok(removed.status === 0 && !("new.member" in readMembers(removed.stdout.trim())), "--remove drops a member");

    ok(run(["--add", "Bad Name"], MINT_PEPPER + "\n{}").status !== 0, "a name outside the rule is refused");
    ok(run(["--add", "okname", "--until", "2026-02-30"], MINT_PEPPER + "\n{}").status !== 0,
       "an impossible end date is refused");
    ok(run(["--add", "okname", "--epoch", "-1"], MINT_PEPPER + "\n{}").status !== 0, "a negative epoch is refused");
    ok(run(["--add", "okname"], "short\n{}").status !== 0, "a pepper too short to be the real one is refused");
    ok(run(["--set", "okname", "--epoch", "1"], "{}").status !== 0, "--set on a stranger is refused");
    const dirty = run(["--set", "anilkaya", "--epoch", "1"], JSON.stringify({ anilkaya: "H", broken: { until: "x" } }));
    ok(dirty.status !== 0 && dirty.stderr.includes('"broken"'),
       "a current map holding an entry the Worker would ignore is named, not silently rewritten");
    const cleaned = run(["--remove", "broken"], JSON.stringify({ anilkaya: "H", broken: { until: "x" } }));
    ok(cleaned.status === 0 && JSON.parse(cleaned.stdout).anilkaya === "H", "and --remove can clear it");

    const kept = readFileSync(file, "utf8");
    const clobber = run(["--mint", "--out", file]);
    ok(clobber.status !== 0 && readFileSync(file, "utf8") === kept,
       "THE MEMBERS FILE IS NEVER CLOBBERED: --mint --out on an existing file without --from refuses and leaves it intact");
    ok(clobber.stderr.includes("--mint --from " + file + " --out " + file),
       "and names the command that re-mints the members it lists");
    const remint = run(["--mint", "--from", file, "--out", file]);
    ok(remint.status === 0 && Object.keys(readMembers(readFileSync(file, "utf8").trim())).join() === "anilkaya,new.member" &&
       readMembers(readFileSync(file, "utf8").trim())["new.member"].until === "2099-12-31",
       "while --mint --from the same file re-mints every member it lists, end dates intact");

    const fresh = path.join(dir, "fresh.json");
    const firstMint = run(["--mint", "--out", fresh]);
    ok(firstMint.status === 0 && Object.keys(readMembers(readFileSync(fresh, "utf8").trim())).length === FLOWS_USERNAMES.length,
       "the first-time --mint --out still creates the file from the legacy roster");
    if (process.platform !== "win32") {
      ok((statSync(fresh).mode & 0o777) === 0o600, "a members file the script creates is private to its owner");
      chmodSync(file, 0o644);
      const tightened = run(["--set", "anilkaya", "--epoch", "1", "--from", file, "--out", file]);
      ok(tightened.status === 0 && (statSync(file).mode & 0o777) === 0o600,
         "and one that already existed world-readable is made private on the next write");
    }

    const crowd = {};
    for (let i = 0; i < 60; i++) crowd["member" + String(i).padStart(3, "0")] = { hash: "x".repeat(44), until: "2099-12-31", epoch: 1 };
    const full = run(["--set", "member000", "--epoch", "2"], JSON.stringify(crowd));
    ok(full.status !== 0 && /at most 5000/.test(full.stderr),
       "a map past Cloudflare's 5 KB secret ceiling is refused before wrangler would reject it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { DatabaseSync } = await import("node:sqlite");
  const { easternInstant } = await import("../shared/flows-freshness.js");
  const { throttleNetwork, loginNameKey } = await import("../shared/flows-auth.js");
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

  ok(throttleNetwork("203.0.113.10") === "203.0.113.0/24" && throttleNetwork("203.0.113.250") === "203.0.113.0/24",
     "an IPv4 address belongs to its /24");
  ok(throttleNetwork("203.0.114.10") !== throttleNetwork("203.0.113.10"), "another /24 is another network");
  ok(throttleNetwork("2001:db8:1:2:aaaa:bbbb:cccc:dddd") === "2001:db8:1::/48" &&
     throttleNetwork("2001:db8:1:ffff::9") === "2001:db8:1::/48" && throttleNetwork("2001:db8:2:2::9") === "2001:db8:2::/48",
     "an IPv6 address belongs to its /48");
  ok(throttleNetwork("::ffff:198.51.100.20") === "198.51.100.0/24", "an IPv4-mapped address belongs to the IPv4 /24");
  ok(throttleNetwork(null) === "unknown" && throttleNetwork("") === "unknown", "a missing address is one network of its own");
  ok(loginNameKey("berkkocak", "203.0.113.10") === "berkkocak|203.0.113.0/24", "the name limiter key is the name plus the network");
  ok(loginNameKey("floodrow1", "203.0.113.10") === "floodrow1|203.0.113.0/24" && loginNameKey("a b", "203.0.113.10") === "*|203.0.113.0/24" &&
     loginNameKey("x".repeat(500), "203.0.113.10") === "*|203.0.113.0/24" && loginNameKey(undefined, "203.0.113.10") === "*|203.0.113.0/24",
     "a name that cannot be a member name shares one counter per network, so guessed names never grow the key space");

  const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  const fakeD1 = () => {
    const db = new DatabaseSync(":memory:");
    db.exec(SCHEMA);
    const trips = [];
    const returns = /^\s*(SELECT|PRAGMA|WITH)|\bRETURNING\b/i;
    const exec = (sql, args) => {
      const st = db.prepare(sql);
      if (returns.test(sql)) return { results: st.all(...args), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(st.run(...args).changes) } };
    };
    const trip = (kind, sqls, fn) => new Promise((resolve, reject) => setTimeout(() => {
      trips.push({ kind, sqls });
      try { resolve(fn()); } catch (error) { reject(error); }
    }, 0));
    const D1 = {
      prepare(sql) {
        const st = { sql, args: [], bind(...a) { st.args = a; return st; },
          first: () => trip("first", [sql], () => exec(sql, st.args).results[0] ?? null),
          all: () => trip("all", [sql], () => exec(sql, st.args)),
          run: () => trip("run", [sql], () => exec(sql, st.args)) };
        return st;
      },
      batch: (list) => trip("batch", list.map((s) => s.sql), () => list.map((s) => exec(s.sql, s.args))),
    };
    return { D1, db, trips };
  };
  const limiter = (limit) => {
    const seen = new Map();
    return {
      calls: [],
      async limit({ key }) {
        this.calls.push(key);
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        return { success: n <= limit };
      },
      reset() { seen.clear(); this.calls.length = 0; },
    };
  };

  const worker = (await import("../worker.js?authlogin")).default;
  const ORIGIN = "https://anilkaya.org";
  const MEMBER = "berkkocak";
  const credentials = JSON.stringify({ [MEMBER]: await deriveHash(MEMBER, PASSWORD, PEPPER), anilkaya: await deriveHash("anilkaya", PASSWORD, PEPPER) });
  const makeEnv = (extra = {}) => {
    const f = fakeD1();
    return { f, env: { DB: f.D1, SESSION_SECRET: SECRET, FLOWS_PEPPER: PEPPER, FLOWS_CREDENTIALS: credentials,
      LOGIN_IP: limiter(10), LOGIN_NAME: limiter(20), ...extra } };
  };
  const subtle = globalThis.crypto.subtle;
  const realDerive = subtle.deriveBits.bind(subtle);
  let derives = 0;
  subtle.deriveBits = (...args) => { derives++; return realDerive(...args); };
  const signIn = async (env, username, password, ip) => {
    const res = await worker.fetch(new Request(ORIGIN + "/flows/login", {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "CF-Connecting-IP": ip },
      body: new URLSearchParams({ username, password }).toString(),
    }), env, { waitUntil() {} });
    return { res, text: await res.text() };
  };

  try {
    {
      const { f, env } = makeEnv();
      const statuses = [];
      for (let i = 1; i <= 10; i++) statuses.push((await signIn(env, "guess" + i, "wrong", "203.0.113.10")).res.status);
      ok(statuses.every((s) => s === 401), "the first ten failed attempts from one address are answered as before (401)");
      const trips = f.trips.length;
      const before = derives;
      const eleventh = await signIn(env, MEMBER, PASSWORD, "203.0.113.10");
      ok(eleventh.res.status === 429 && eleventh.res.headers.get("Retry-After") === "60" && /Too many attempts/.test(eleventh.text),
         `THE 11TH ATTEMPT IN THE WINDOW FROM ONE ADDRESS is refused with a 429, Retry-After 60 and the sign-in page (${eleventh.res.status})`);
      ok(/text\/html/.test(eleventh.res.headers.get("Content-Type")) && !eleventh.res.headers.get("Set-Cookie"),
         "the refusal is the HTML page and sets no session");
      ok(f.trips.length === trips, "THE REFUSED ATTEMPT MAKES 0 D1 STATEMENTS");
      ok(derives === before, "and runs no PBKDF2, even with the member's correct password");
      ok(env.LOGIN_NAME.calls.length === 10, "and never reaches the name limiter");
      ok(env.LOGIN_IP.calls.every((k) => k === "203.0.113.10"), "the address limiter is keyed on the client address");
      const elsewhere = await signIn(env, MEMBER, PASSWORD, "198.51.100.20");
      ok(elsewhere.res.status === 303 && /flows_session=/.test(elsewhere.res.headers.get("Set-Cookie") || ""),
         "another address is not charged for this address's flood, and signs the member in");
      env.LOGIN_IP.reset();
      const later = await signIn(env, MEMBER, PASSWORD, "203.0.113.10");
      ok(later.res.status === 303, "a new window admits the address again");
    }

    {
      const { f, env } = makeEnv();
      const hosts = ["203.0.113.11", "203.0.113.12", "203.0.113.13"];
      const out = [];
      for (let i = 0; i < 21; i++) out.push((await signIn(env, MEMBER, "wrong-" + i, hosts[i % 3])).res.status);
      ok(out.slice(0, 20).every((s) => s === 401) && out[20] === 429,
         `a flood on one name from one network is limited at the 21st attempt (${out.slice(-3).join(",")})`);
      ok(env.LOGIN_IP.calls.length === 21 && new Set(env.LOGIN_NAME.calls).size === 1 &&
         env.LOGIN_NAME.calls[0] === MEMBER + "|203.0.113.0/24",
         "the name limiter key is the name plus the attacker's /24, not the name alone");
      const trips = f.trips.length;
      const before = derives;
      const again = await signIn(env, MEMBER, PASSWORD, "203.0.113.14");
      ok(again.res.status === 429 && f.trips.length === trips && derives === before,
         "the same name from the flooded network stays refused with 0 D1 statements and no PBKDF2");
      const member = await signIn(env, MEMBER, PASSWORD, "198.51.100.20");
      ok(member.res.status === 303 && /flows_session=/.test(member.res.headers.get("Set-Cookie") || ""),
         "THE MEMBER ON ANOTHER NETWORK SIGNS IN: attempts on the name from network X do not consume its bucket for network Y");
      ok(env.LOGIN_NAME.calls[env.LOGIN_NAME.calls.length - 1] === MEMBER + "|198.51.100.0/24", "the member's own bucket is keyed on the member's network");
    }

    {
      const { env } = makeEnv();
      for (let i = 0; i < 30; i++) await signIn(env, "junk " + i, "x", "203.0.113." + (30 + (i % 3)));
      ok(new Set(env.LOGIN_NAME.calls).size === 1 && env.LOGIN_NAME.calls[0] === "*|203.0.113.0/24",
         "names that cannot be member names key one limiter counter per network");
    }

    {
      const { f, env } = makeEnv({ LOGIN_IP: undefined, LOGIN_NAME: { limit: async () => { throw new Error("limiter down"); } } });
      const r = await signIn(env, MEMBER, PASSWORD, "203.0.113.10");
      ok(r.res.status === 303, "a missing or failing limiter admits the attempt: the D1 lockout remains the backstop");
      const bad = await signIn(env, MEMBER, "wrong", "203.0.113.10");
      ok(bad.res.status === 401 && f.db.prepare("SELECT count(*) AS n FROM flows_login_failures").get().n === 1,
         "and a failure is still counted by it");
    }

    {
      const { f, env } = makeEnv();
      for (let i = 0; i < 3; i++) await signIn(env, MEMBER, "wrong-" + i, "203.0.113." + (60 + i));
      const issued = f.trips.flatMap((t) => t.sqls);
      ok(!issued.some((sql) => /DELETE FROM flows_login_failures WHERE first_at/.test(sql)),
         "the failure path no longer deletes by first_at: no full-table scan on a failed login");
      const perKey = issued.filter((sql) => /DELETE FROM flows_login_failures WHERE username = \? AND first_at < \?/.test(sql));
      ok(perKey.length === 3, "each failure prunes only its own key");
      const plan = f.db.prepare("EXPLAIN QUERY PLAN DELETE FROM flows_login_failures WHERE username = ? AND first_at < ?").all("a", 0)
        .map((r) => r.detail).join(" | ");
      ok(/SEARCH flows_login_failures/.test(plan) && !/SCAN/.test(plan), `the per-key prune is a primary-key search: ${plan}`);
      const rows = f.db.prepare("SELECT username FROM flows_login_failures ORDER BY username").all().map((r) => r.username);
      ok(rows.length === 3 && rows.every((k) => k.startsWith(MEMBER + "|")), "and each failure is still recorded under bucket and address");

      const stale = Date.now() - 20 * 60 * 1000;
      f.db.prepare("INSERT INTO flows_login_failures (username, failures, first_at) VALUES (?, 3, ?)").run("old|203.0.113.1", stale);
      f.db.prepare("INSERT INTO flows_login_failures (username, failures, first_at) VALUES (?, 3, ?)").run("recent|203.0.113.2", Date.now());
      const dailyPlan = f.db.prepare("EXPLAIN QUERY PLAN DELETE FROM flows_login_failures WHERE first_at < ?").all(0).map((r) => r.detail).join(" | ");
      ok(dailyPlan.includes("USING INDEX flows_login_failures_by_first") && !/SCAN/.test(dailyPlan),
         `the daily prune is a range seek on the first_at index: ${dailyPlan}`);

      const night = easternInstant("2026-10-13", 3 * 60);
      f.db.prepare("UPDATE flows_login_failures SET first_at = ? WHERE username = 'recent|203.0.113.2'").run(night - 60 * 1000);
      f.db.prepare("UPDATE flows_login_failures SET first_at = ? WHERE username = 'old|203.0.113.1'").run(night - 3600 * 1000);
      f.db.prepare("DELETE FROM flows_login_failures WHERE username LIKE ?").run(MEMBER + "|%");
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error("no network in this suite"); };
      const background = [];
      const before = f.trips.length;
      try {
        await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: night }, env, { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) });
        await Promise.all(background);
      } finally { globalThis.fetch = realFetch; }
      const prune = f.trips.slice(before).filter((t) => t.kind === "batch" && t.sqls.some((s) => /DELETE FROM flows_login_failures WHERE first_at/.test(s)));
      ok(prune.length === 1 && prune[0].sqls.length === 2 && /^CREATE INDEX IF NOT EXISTS flows_login_failures_by_first/.test(prune[0].sqls[0]),
         "the 03:00 ET firing prunes the failure table in one batch: the idempotent index, then one DELETE");
      const left = f.db.prepare("SELECT username FROM flows_login_failures").all().map((r) => r.username);
      ok(left.join() === "recent|203.0.113.2", `it removes rows older than the window and keeps the live one (${left.join()})`);
      const noon = f.trips.length;
      await worker.scheduled({ cron: "*/30 * * * *", scheduledTime: easternInstant("2026-10-13", 12 * 60) }, env, { waitUntil: (p) => background.push(Promise.resolve(p).catch(() => {})) });
      await Promise.all(background);
      ok(!f.trips.slice(noon).some((t) => t.sqls.some((s) => /flows_login_failures/.test(s))), "and only in that firing");
    }
  } finally {
    subtle.deriveBits = realDerive;
  }
}

console.log(`✓ flows-auth: ${checks} assertions — members from the secret, end dates on the Eastern day, per-user epochs, peppered PBKDF2, timing-safe verify, bidirectional session isolation with legacy tolerance, bounded lockout`);
