import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCredentials, verifyCredential, MEMBER_NAME } from "../shared/flows-auth.js";
import { FIXTURE_ROSTER } from "./lib/fixture-roster.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const FIXTURE_PEPPER = "fixture-pepper-for-the-mint-contract-only";

const SCRIPT = "../scripts/generate-flows-credentials.mjs";
const dir = mkdtempSync(path.join(tmpdir(), "flows-mint-"));
const rosterFile = path.join(dir, "roster.json");
writeFileSync(rosterFile, JSON.stringify(Object.fromEntries(FIXTURE_ROSTER.map((n) => [n, "x"]))));

const out = execFileSync(process.execPath,
  [SCRIPT, "--mint", "--from", rosterFile],
  { input: FIXTURE_PEPPER + "\n", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

const lines = out.split("\n");

const passwords = Object.create(null);
for (const line of lines) {
  const m = /^([a-z0-9_.-]+)\s+([a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4})$/.exec(line);
  if (m) passwords[m[1]] = m[2];
}
eq(Object.keys(passwords).length, FIXTURE_ROSTER.length,
  "one minted password per roster account — a mint that skips a user locks " +
  "that person out with no error anywhere");
for (const u of FIXTURE_ROSTER) ok(passwords[u], `a password was minted for ${u}`);
ok(new Set(Object.values(passwords)).size === FIXTURE_ROSTER.length,
  "passwords are distinct per user — the whole point of leaving shared mode");
ok(Object.values(passwords).every((p) => !/[ilo01]/.test(p)),
  "no lookalike characters (i/l/o/0/1) — passwords get read off paper");

const pepperIdx = lines.findIndex((l) => l.startsWith("# FLOWS_PEPPER"));
eq(lines[pepperIdx + 1], FIXTURE_PEPPER,
  "a pepper supplied on stdin is used verbatim, not silently replaced");

const jsonIdx = lines.findIndex((l) => l.startsWith("# FLOWS_CREDENTIALS"));
const credsRaw = lines[jsonIdx + 1];
const creds = parseCredentials(credsRaw);
ok(creds, "the printed JSON is exactly what parseCredentials accepts");
eq(Object.keys(creds).length, FIXTURE_ROSTER.length,
  "and it carries a hash for every roster account");

const who = FIXTURE_ROSTER[FIXTURE_ROSTER.length - 1];
eq(await verifyCredential(who, passwords[who], creds, FIXTURE_PEPPER), who,
  "a minted password round-trips through verifyCredential — the one fact an " +
  "operator cannot check until a human tries to sign in");
eq(await verifyCredential(who, passwords[FIXTURE_ROSTER[0]], creds, FIXTURE_PEPPER), null,
  "and another user's minted password does not open the account");

{
  const out2 = execFileSync(process.execPath,
    [SCRIPT, "--mint", "--from", rosterFile],
    { input: "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const l2 = lines2(out2);
  const p2 = l2[l2.findIndex((l) => l.startsWith("# FLOWS_PEPPER")) + 1];
  ok(p2 && p2.length >= 24 && p2 !== FIXTURE_PEPPER,
    "with nothing on stdin a fresh pepper is minted");
  function lines2(s) { return s.split("\n"); }
}

{
  const run = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });

  const short = run(["--mint", "--from", rosterFile], "too-short\n");
  ok(short.status !== 0 && short.stderr.includes("that pepper is too short"),
    "a supplied pepper under 24 characters is refused for being short, not for a missing --from");

  const bare = run(["--mint"], "");
  ok(bare.status !== 0 && bare.stderr.includes("--mint needs --from") && !bare.stdout,
    "--mint with no --from is refused and prints nothing: no member name lives in the source");

  const legacy = run([], "a shared password\nan-unrelated-pepper-of-sufficient-length\n");
  ok(legacy.status !== 0 && legacy.stderr.includes("give one of --mint, --add, --set or --remove") && !legacy.stdout,
    "the shared-password mode is gone: no flag prints the usage and no hashes");

  const empty = path.join(dir, "empty.json");
  writeFileSync(empty, "{}");
  const none = run(["--mint", "--from", empty], "");
  ok(none.status !== 0 && none.stderr.includes("lists no members to mint for"), "an empty roster file mints nothing");

  const dotted = FIXTURE_ROSTER.filter((n) => n.includes("."));
  ok(dotted.length > 0 && dotted.every((n) => MEMBER_NAME.test(n) && passwords[n]),
    "names with dots mint like any other, so the password parser is not limited to [a-z]");
}

rmSync(dir, { recursive: true, force: true });

console.log(`✓ flows-mint: ${checks} assertions — a mint covering the whole roster file it is given with ` +
  `distinct lookalike-free passwords, a stdin pepper used verbatim, JSON that ` +
  `parseCredentials accepts, a password that round-trips verifyCredential, a fresh ` +
  `pepper when none is supplied, a too-short pepper refused for that reason, and no roster, no source list and no shared-password mode`);
