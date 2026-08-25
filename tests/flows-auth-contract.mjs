/* Contracts for shared/flows-auth.js.

   The case that matters most is session isolation. Review of the
   original design found that verifySession() checks only the HMAC,
   a non-empty sub and a future exp — so a token minted for one part
   of the site verifies fine against another. Cookie NAME is not a
   boundary, because a caller chooses which cookie to put a token in.
   These tests pin the audience claim that IS the boundary, in both
   directions, and pin the legacy allowance that keeps currently
   signed-in learners from being logged out. */

import assert from "node:assert/strict";
import { signSession, verifySession } from "../shared/session.js";
import {
  FLOWS_AUDIENCE, LEARN_AUDIENCE, FLOWS_COOKIE, FLOWS_USERNAMES,
  PBKDF2_ITERATIONS, deriveHash, timingSafeEqual, parseCredentials,
  verifyCredential, signFlowsSession, verifyFlowsSession, isLearnAudience,
  LOCKOUT, isLocked, nextFailureState,
} from "../shared/flows-auth.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const SECRET = "test-session-secret-not-production";
const PEPPER = "test-pepper-value";
const PASSWORD = "Ankara06**--";

/* ---------- roster --------------------------------------------- */
{
  ok(FLOWS_USERNAMES.length === 11, "eleven accounts are provisioned");
  ok(new Set(FLOWS_USERNAMES).size === 11, "usernames are unique");
  ok(FLOWS_USERNAMES.every((u) => /^[a-z]+$/.test(u)), "usernames are lowercase and simple");
  ok(Object.isFrozen(FLOWS_USERNAMES), "the roster cannot be mutated at runtime");
  for (const expected of ["firatgok", "dincersen", "mehmetsen", "ferhatyukselturk", "berkkocak",
                          "anilkaya", "isaatceken", "bektastorun", "yigiteyi", "ahmetcan", "canaci"]) {
    ok(FLOWS_USERNAMES.includes(expected), `roster contains ${expected}`);
  }
}

/* ---------- derivation ----------------------------------------- */
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
}

/* ---------- timing-safe comparison ------------------------------ */
{
  ok(timingSafeEqual("abc", "abc"), "equal strings match");
  ok(!timingSafeEqual("abc", "abd"), "differing content fails");
  ok(!timingSafeEqual("abc", "abcd"), "differing length fails");
  ok(!timingSafeEqual("", "a"), "empty against non-empty fails");
  ok(timingSafeEqual("", ""), "empty against empty matches");
  ok(!timingSafeEqual(null, "a"), "null is handled");
  ok(timingSafeEqual(undefined, ""), "undefined coerces to empty");
}

/* ---------- credential map -------------------------------------- */
{
  ok(parseCredentials(null) === null, "missing secret yields no credentials");
  ok(parseCredentials("not json") === null, "malformed secret yields no credentials");
  ok(parseCredentials("[]") === null, "an array is not a credential map");
  ok(parseCredentials("{}") === null, "an empty object yields no credentials");
  ok(parseCredentials('{"nobody":"x"}') === null, "usernames outside the roster are ignored");

  const parsed = parseCredentials('{"anilkaya":"HASH","nobody":"x"}');
  ok(parsed && parsed.anilkaya === "HASH", "roster members are kept");
  ok(parsed && !("nobody" in parsed), "non-roster entries are dropped");
  ok(Object.getPrototypeOf(parsed) === null, "the map has a null prototype (no __proto__ tricks)");
}

/* ---------- verification ---------------------------------------- */
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

  // Every roster member authenticates with the shared password.
  for (const u of FLOWS_USERNAMES) {
    ok(await verifyCredential(u, PASSWORD, creds, PEPPER) === u, `${u} authenticates`);
  }
}

/* ---------- SESSION ISOLATION: the boundary --------------------- */
{
  const flowsToken = await signFlowsSession("anilkaya", SECRET);

  const good = await verifyFlowsSession(flowsToken, SECRET);
  ok(good && good.username === "anilkaya", "a flows session verifies for flows");

  // 1. A flows token must NOT pass as a learning session.
  const asPayload = await verifySession(flowsToken, SECRET);
  ok(asPayload !== null, "the token is cryptographically valid (same secret)");
  ok(asPayload.aud === FLOWS_AUDIENCE, "and it carries the flows audience");
  ok(!isLearnAudience(asPayload),
     "THE BOUNDARY: a flows token is refused by the learning audience check");

  // 2. A learning token must NOT pass as a flows session.
  const learnToken = await signSession(
    { sub: "g_12345", aud: LEARN_AUDIENCE, exp: Date.now() + 60000 }, SECRET,
  );
  ok(await verifyFlowsSession(learnToken, SECRET) === null,
     "THE BOUNDARY: a learning token is refused by the flows gate");
  ok(isLearnAudience(await verifySession(learnToken, SECRET)),
     "and it still works for learning");

  // 3. Legacy learning tokens carry no audience at all and must keep working.
  const legacy = await signSession({ sub: "g_legacy", exp: Date.now() + 60000 }, SECRET);
  ok(isLearnAudience(await verifySession(legacy, SECRET)),
     "a legacy audience-less token is still accepted for learning (nobody is logged out)");
  ok(await verifyFlowsSession(legacy, SECRET) === null,
     "but a legacy token cannot reach flows");

  // 4. An unknown audience is refused by both.
  const alien = await signSession({ sub: "x", aud: "admin", exp: Date.now() + 60000 }, SECRET);
  ok(!isLearnAudience(await verifySession(alien, SECRET)), "an unknown audience fails learning");
  ok(await verifyFlowsSession(alien, SECRET) === null, "an unknown audience fails flows");

  // 5. Ordinary token hygiene.
  ok(await verifyFlowsSession(flowsToken, "wrong-secret") === null, "a wrong secret fails");
  ok(await verifyFlowsSession("garbage", SECRET) === null, "a malformed token fails");
  ok(await verifyFlowsSession("", SECRET) === null, "an empty token fails");
  ok(await verifyFlowsSession(null, SECRET) === null, "a null token fails");

  const expired = await signFlowsSession("anilkaya", SECRET, -1);
  ok(await verifyFlowsSession(expired, SECRET) === null, "an expired token fails");

  // 6. A token whose subject is not on the roster is refused even if
  //    correctly signed — a removed account cannot ride an old token.
  const ghost = await signSession(
    { sub: "removed-user", aud: FLOWS_AUDIENCE, exp: Date.now() + 60000 }, SECRET,
  );
  ok(await verifyFlowsSession(ghost, SECRET) === null, "an off-roster subject is refused");

  ok(FLOWS_COOKIE !== "session", "the flows cookie name differs from the learning one");
}

/* ---------- lockout --------------------------------------------- */
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
}

console.log(`✓ flows-auth: ${checks} assertions — roster, peppered PBKDF2, timing-safe verify, bidirectional session isolation with legacy tolerance, lockout`);
