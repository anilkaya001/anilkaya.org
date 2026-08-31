/* Contract for the generator's --mint mode, exercised as a child process —
   the same way an operator runs it — with a FIXTURE pepper on stdin so the
   assertions are about behavior, not about any real secret. Nothing here is
   a credential: every value is minted inside this test run and discarded.

   What is worth pinning: that a mint covers the WHOLE roster (a rotation
   that silently skips a user locks that person out with no error anywhere),
   that the printed JSON is the exact shape parseCredentials accepts, and
   that a minted password actually round-trips through verifyCredential —
   the one end-to-end fact the operator cannot check until a human tries to
   sign in. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  FLOWS_USERNAMES, parseCredentials, verifyCredential,
} from "../shared/flows-auth.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const FIXTURE_PEPPER = "fixture-pepper-for-the-mint-contract-only";

const out = execFileSync(process.execPath,
  ["../scripts/generate-flows-credentials.mjs", "--mint"],
  { input: FIXTURE_PEPPER + "\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

const lines = out.split("\n");

/* ---------- the password table -------------------------------- */
const passwords = Object.create(null);
for (const line of lines) {
  const m = /^([a-z]+)\s+([a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4})$/.exec(line);
  if (m) passwords[m[1]] = m[2];
}
eq(Object.keys(passwords).length, FLOWS_USERNAMES.length,
  "one minted password per roster account — a mint that skips a user locks " +
  "that person out with no error anywhere");
for (const u of FLOWS_USERNAMES) ok(passwords[u], `a password was minted for ${u}`);
ok(new Set(Object.values(passwords)).size === FLOWS_USERNAMES.length,
  "passwords are distinct per user — the whole point of leaving shared mode");
ok(Object.values(passwords).every((p) => !/[ilo01]/.test(p)),
  "no lookalike characters (i/l/o/0/1) — passwords get read off paper");

/* ---------- the pepper and the JSON ---------------------------- */
const pepperIdx = lines.findIndex((l) => l.startsWith("# FLOWS_PEPPER"));
eq(lines[pepperIdx + 1], FIXTURE_PEPPER,
  "a pepper supplied on stdin is used verbatim, not silently replaced");

const jsonIdx = lines.findIndex((l) => l.startsWith("# FLOWS_CREDENTIALS"));
const credsRaw = lines[jsonIdx + 1];
const creds = parseCredentials(credsRaw);
ok(creds, "the printed JSON is exactly what parseCredentials accepts");
eq(Object.keys(creds).length, FLOWS_USERNAMES.length,
  "and it carries a hash for every roster account");

/* ---------- the end-to-end fact -------------------------------- */
const who = FLOWS_USERNAMES[FLOWS_USERNAMES.length - 1];
eq(await verifyCredential(who, passwords[who], creds, FIXTURE_PEPPER), who,
  "a minted password round-trips through verifyCredential — the one fact an " +
  "operator cannot check until a human tries to sign in");
eq(await verifyCredential(who, passwords[FLOWS_USERNAMES[0]], creds, FIXTURE_PEPPER), null,
  "and another user's minted password does not open the account");

/* ---------- fresh-pepper mint ---------------------------------- */
{
  const out2 = execFileSync(process.execPath,
    ["../scripts/generate-flows-credentials.mjs", "--mint"],
    { input: "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const l2 = lines2(out2);
  const p2 = l2[l2.findIndex((l) => l.startsWith("# FLOWS_PEPPER")) + 1];
  ok(p2 && p2.length >= 24 && p2 !== FIXTURE_PEPPER,
    "with nothing on stdin a fresh pepper is minted");
  function lines2(s) { return s.split("\n"); }
}

/* ---------- a short supplied pepper is refused ----------------- */
{
  let failed = false;
  try {
    execFileSync(process.execPath,
      ["../scripts/generate-flows-credentials.mjs", "--mint"],
      { input: "too-short\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch { failed = true; }
  ok(failed, "a supplied pepper under 24 characters is refused, not quietly used");
}

console.log(`✓ flows-mint: ${checks} assertions — a mint covering the whole roster with ` +
  `distinct lookalike-free passwords, a stdin pepper used verbatim, JSON that ` +
  `parseCredentials accepts, a password that round-trips verifyCredential, a fresh ` +
  `pepper when none is supplied, and a too-short pepper refused`);
