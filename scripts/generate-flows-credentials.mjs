#!/usr/bin/env node

import { createInterface } from "node:readline";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import {
  FLOWS_USERNAMES, deriveHash, PBKDF2_ITERATIONS, MEMBER_NAME, MEMBER_EPOCH_MAX,
  MEMBER_SECRET_MAX_BYTES, memberRecord, memberActive, isMemberDay,
} from "../shared/flows-auth.js";

const USAGE =
  "usage — secrets are read from stdin or minted in-process, never taken from argv:\n\n" +
  "  node scripts/generate-flows-credentials.mjs --mint [--from members.json] [--out members.json]\n" +
  "      mint a fresh pepper and a password for every member (the legacy roster without --from)\n" +
  "  node scripts/generate-flows-credentials.mjs --add NAME [--until YYYY-MM-DD] [--epoch N] [--from members.json] [--out members.json]\n" +
  "      add a member, or give an existing one a new password; stdin: the pepper, then the current JSON unless --from\n" +
  "  node scripts/generate-flows-credentials.mjs --set NAME [--until YYYY-MM-DD|never] [--epoch N|next] [--from members.json] [--out members.json]\n" +
  "      renew, end or revoke a member without touching the password; stdin: the current JSON unless --from\n" +
  "  node scripts/generate-flows-credentials.mjs --remove NAME [--from members.json] [--out members.json]\n" +
  "      drop a member; stdin: the current JSON unless --from\n" +
  "  node scripts/generate-flows-credentials.mjs\n" +
  "      legacy shared password for the legacy roster; stdin: the password, then the pepper\n\n" +
  "--add, --set and --remove print the new FLOWS_CREDENTIALS JSON, and only that, on stdout,\n" +
  "or write it to the --out file instead (--from and --out may name the same file).\n";

function die(message) {
  process.stderr.write("error: " + message + "\n\n" + USAGE);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { mode: "legacy", name: null, until: undefined, epoch: undefined, from: null, out: null };
  const modes = new Set(["--mint", "--add", "--set", "--remove"]);
  const valued = new Set(["--add", "--set", "--remove", "--until", "--epoch", "--from", "--out"]);
  let seenMode = false;
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;
    const eq = flag.indexOf("=");
    if (flag.startsWith("--") && eq > 0) { value = flag.slice(eq + 1); flag = flag.slice(0, eq); }
    if (!modes.has(flag) && !valued.has(flag)) die(`unknown argument ${JSON.stringify(argv[i])}`);
    if (valued.has(flag) && value === undefined) {
      value = argv[++i];
      if (value === undefined || value.startsWith("--")) die(`${flag} needs a value`);
    }
    if (modes.has(flag)) {
      if (seenMode) die("give one of --mint, --add, --set or --remove");
      seenMode = true;
      out.mode = flag.slice(2);
      if (flag !== "--mint") out.name = value;
      else if (value !== undefined) die("--mint takes no value");
      continue;
    }
    const key = flag.slice(2);
    if (out[key] !== undefined && out[key] !== null) die(`${flag} given twice`);
    out[key] = value;
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.name !== null && !MEMBER_NAME.test(opts.name)) {
  die(`${JSON.stringify(opts.name)} is not a member name: use 3 to 32 of a-z, 0-9, dot, dash or underscore`);
}
if (opts.until !== undefined) {
  if (opts.mode !== "add" && opts.mode !== "set") die("--until applies to --add and --set");
  if (!(opts.until === "never" && opts.mode === "set") && !isMemberDay(opts.until)) {
    die("--until takes a calendar day, YYYY-MM-DD (the last Eastern day of access)" +
      (opts.mode === "set" ? ", or never" : ""));
  }
}
if (opts.epoch !== undefined) {
  if (opts.mode !== "add" && opts.mode !== "set") die("--epoch applies to --add and --set");
  const n = Number(opts.epoch);
  if (!(opts.epoch === "next" && opts.mode === "set") &&
      !(/^\d+$/.test(opts.epoch) && Number.isSafeInteger(n) && n <= MEMBER_EPOCH_MAX)) {
    die(`--epoch takes a whole number from 0 to ${MEMBER_EPOCH_MAX}` + (opts.mode === "set" ? ", or next" : ""));
  }
}
if ((opts.from !== null || opts.out !== null) && opts.mode === "legacy") {
  die("--from and --out apply to --mint, --add, --set and --remove");
}
if (opts.mode === "set" && opts.until === undefined && opts.epoch === undefined) {
  die("--set changes --until, --epoch or both; give at least one");
}

const CHARSET = "abcdefghjkmnpqrstuvwxyz23456789";

function mintPassword() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    while (s.length < 4) {
      const b = new Uint8Array(1);
      webcrypto.getRandomValues(b);
      if (b[0] < CHARSET.length * Math.floor(256 / CHARSET.length)) {
        s += CHARSET[b[0] % CHARSET.length];
      }
    }
    groups.push(s);
  }
  return groups.join("-");
}

function mintPepper() {
  const b = new Uint8Array(48);
  webcrypto.getRandomValues(b);
  return Buffer.from(b).toString("base64");
}

async function readStdinLines(max, { skipTTY = false } = {}) {
  if (skipTTY && process.stdin.isTTY) return [];
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
    if (lines.length === max) break;
  }
  return lines;
}

async function readStdinAll() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function loadMembers(text, source, { allowBad = null } = {}) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { die(`${source} is not JSON; it must be the current FLOWS_CREDENTIALS value`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    die(`${source} must be a JSON object of member name to credential`);
  }
  const members = new Map();
  const bad = [];
  for (const name of Object.keys(parsed)) {
    const record = MEMBER_NAME.test(name) ? memberRecord(parsed[name]) : null;
    if (record) members.set(name, record);
    else if (name !== allowBad) bad.push(name);
  }
  if (bad.length) {
    die(`${source} holds entries the Worker ignores: ${bad.map((n) => JSON.stringify(n)).join(", ")}. ` +
      "Fix them, or drop each with --remove NAME, before changing anything else");
  }
  return members;
}

function encode(members) {
  const out = {};
  for (const [name, m] of members) {
    if (m.until === null && m.epoch === 0) { out[name] = m.hash; continue; }
    const value = { hash: m.hash };
    if (m.until !== null) value.until = m.until;
    if (m.epoch !== 0) value.epoch = m.epoch;
    out[name] = value;
  }
  const json = JSON.stringify(out);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > MEMBER_SECRET_MAX_BYTES) {
    die(`the new FLOWS_CREDENTIALS would be ${bytes} bytes; a Worker secret holds at most ` +
      `${MEMBER_SECRET_MAX_BYTES}. Remove lapsed members first (--remove NAME)`);
  }
  return { json, bytes };
}

function describe(name, m) {
  const parts = [];
  parts.push(m.until === null ? "no end date" : "through " + m.until + " (Eastern)");
  parts.push("epoch " + m.epoch);
  return name + ": " + parts.join(", ");
}

function shellWord(word) {
  return /^[A-Za-z0-9_.\/-]+$/.test(word) ? word : "'" + word.replace(/'/g, "'\\''") + "'";
}

function installHint(bytes, members) {
  const lapsed = [...members].filter(([, m]) => !memberActive(m)).map(([n, m]) => `${n} (ended ${m.until})`);
  const file = opts.out ? shellWord(opts.out) : "<the file holding the JSON printed on stdout>";
  return (
    `\n${members.size} member${members.size === 1 ? "" : "s"}, ${bytes} of ${MEMBER_SECRET_MAX_BYTES} bytes.` +
    (lapsed.length ? `\nEnded and still listed (the Worker refuses them; --remove to reclaim room): ${lapsed.join(", ")}` : "") +
    "\n\nInstall it with this one command. `wrangler secret put` deploys the new secret\n" +
    "at once: no code deploy, and every other member stays signed in.\n\n" +
    `  ./tests/node_modules/.bin/wrangler secret put FLOWS_CREDENTIALS < ${file}\n\n` +
    "Keep that JSON: it is the --from file next time, and Cloudflare never shows a\n" +
    "secret's value again. Keep it out of the repository (it is public) and apart\n" +
    "from the pepper.\n"
  );
}

function writeMembersFile(json) {
  try {
    writeFileSync(opts.out, json + "\n", { mode: 0o600 });
    chmodSync(opts.out, 0o600);
  } catch { die(`cannot write ${opts.out}`); }
}

function emit(json) {
  if (!opts.out) { process.stdout.write(json + "\n"); return; }
  writeMembersFile(json);
}

async function currentMembersText(pepperFirst) {
  if (opts.from) {
    let text;
    try { text = readFileSync(opts.from, "utf8"); } catch { die(`cannot read ${opts.from}`); }
    if (!pepperFirst) return { text, pepper: null };
    const [pepper] = await readStdinLines(1);
    return { text, pepper };
  }
  if (process.stdin.isTTY) die("pipe the current FLOWS_CREDENTIALS JSON on stdin, or name its file with --from");
  const all = await readStdinAll();
  if (!pepperFirst) return { text: all, pepper: null };
  const cut = all.indexOf("\n");
  if (cut < 0) die("expected the pepper on the first line of stdin and the current JSON after it");
  return { text: all.slice(cut + 1), pepper: all.slice(0, cut) };
}

function requirePepper(pepper) {
  const p = (pepper || "").trim();
  if (!p) die("the pepper is required (first line of stdin): the value set as FLOWS_PEPPER");
  if (p.length < 24) die("that pepper is too short to be the real one; FLOWS_PEPPER is at least 24 characters");
  return p;
}

if (opts.mode === "add") {
  const { text, pepper: rawPepper } = await currentMembersText(true);
  const pepper = requirePepper(rawPepper);
  const members = loadMembers(text, opts.from || "stdin");
  const previous = members.get(opts.name) || null;
  const password = mintPassword();
  const record = memberRecord({
    hash: await deriveHash(opts.name, password, pepper),
    until: opts.until !== undefined ? opts.until : (previous ? previous.until : null),
    epoch: opts.epoch !== undefined ? Number(opts.epoch) : (previous ? previous.epoch : 0),
  });
  members.set(opts.name, record);
  const { json, bytes } = encode(members);
  process.stderr.write(
    `\n${previous ? "New password for" : "Added"} ${describe(opts.name, record)}.\n\n` +
    `  password for ${opts.name}:  ${password}\n\n` +
    "Printed once and written nowhere: hand it over out-of-band, never through a\n" +
    "chat, ticket or email thread.\n" +
    (previous ? "A new password does not sign the old one's sessions out; add --epoch " +
      (previous.epoch + 1) + " to do that too.\n" : "") +
    installHint(bytes, members),
  );
  emit(json);
} else if (opts.mode === "set") {
  const { text } = await currentMembersText(false);
  const members = loadMembers(text, opts.from || "stdin");
  const previous = members.get(opts.name);
  if (!previous) die(`${opts.name} is not a member; --add creates one`);
  const until = opts.until === undefined ? previous.until : (opts.until === "never" ? null : opts.until);
  const epoch = opts.epoch === undefined ? previous.epoch
    : (opts.epoch === "next" ? previous.epoch + 1 : Number(opts.epoch));
  if (epoch > MEMBER_EPOCH_MAX) die(`the epoch cannot pass ${MEMBER_EPOCH_MAX}`);
  const record = memberRecord({ hash: previous.hash, until, epoch });
  members.set(opts.name, record);
  const { json, bytes } = encode(members);
  process.stderr.write(
    `\nWas ${describe(opts.name, previous)}.\nNow ${describe(opts.name, record)}.\n` +
    (epoch !== previous.epoch ? `${opts.name}'s live sessions end once this is installed; nobody else's do.\n` : "") +
    installHint(bytes, members),
  );
  emit(json);
} else if (opts.mode === "remove") {
  const { text } = await currentMembersText(false);
  const members = loadMembers(text, opts.from || "stdin", { allowBad: opts.name });
  let parsedKeys = [];
  try { parsedKeys = Object.keys(JSON.parse(text)); } catch { parsedKeys = []; }
  if (!members.has(opts.name) && !parsedKeys.includes(opts.name)) die(`${opts.name} is not in the map`);
  members.delete(opts.name);
  const { json, bytes } = encode(members);
  process.stderr.write(
    `\nRemoved ${opts.name}. Their live sessions end once this is installed.\n` + installHint(bytes, members),
  );
  emit(json);
} else if (opts.mode === "mint") {
  if (opts.out && !opts.from && existsSync(opts.out)) {
    die(`${opts.out} already exists, and without --from --mint would replace it with the legacy roster, ` +
      "dropping every member added since along with their end dates and epochs. To re-mint the members " +
      `it lists, run: --mint --from ${shellWord(opts.out)} --out ${shellWord(opts.out)}`);
  }
  let roster = FLOWS_USERNAMES.map((name) => [name, { until: null, epoch: 0 }]);
  if (opts.from) {
    let text;
    try { text = readFileSync(opts.from, "utf8"); } catch { die(`cannot read ${opts.from}`); }
    roster = [...loadMembers(text, opts.from)].map(([name, m]) => [name, { until: m.until, epoch: m.epoch }]);
    if (!roster.length) die(`${opts.from} lists no members to mint for`);
  }
  const lines = await readStdinLines(1, { skipTTY: true });
  const supplied = (lines[0] || "").trim();
  if (supplied && supplied.length < 24) {
    die("that pepper is too short to be worth having; use at least 24 characters, or pipe nothing and let --mint create one");
  }
  const pepper = supplied || mintPepper();

  const passwords = {};
  const members = new Map();
  for (const [username, keep] of roster) {
    passwords[username] = mintPassword();
    members.set(username, memberRecord({ hash: await deriveHash(username, passwords[username], pepper), ...keep }));
  }
  const { json } = encode(members);
  if (opts.out) writeMembersFile(json);

  process.stderr.write(
    `\nMinted ${roster.length} per-user passwords and derived their hashes at ` +
    `${PBKDF2_ITERATIONS} PBKDF2 iterations` +
    (supplied ? " (pepper supplied on stdin)" : " (fresh pepper minted)") + ".\n\n" +
    "Everything below is printed ONCE and written nowhere. Keep this terminal\n" +
    "open until the two secrets are pasted into wrangler, and hand each person\n" +
    "their password out-of-band — never through a chat, ticket or email thread:\n" +
    "anything pasted there is burned and the whole set must be re-minted.\n\n" +
    "  wrangler secret put FLOWS_PEPPER          # the pepper below\n" +
    "  wrangler secret put FLOWS_CREDENTIALS     # the JSON below\n\n" +
    "`wrangler secret put` deploys each secret as it is stored. The dashboard\n" +
    "does not: a secret added there waits for its Deploy button.\n" +
    (opts.out ? `The JSON is also in ${opts.out}: --add, --set and --remove start from it.\n\n`
      : "Save the JSON as members.json (outside the repository): --add, --set and\n" +
        "--remove start from it.\n\n") +
    "If the old passwords were exposed anywhere, also bump FLOWS_SESSION_EPOCH\n" +
    "in wrangler.toml before deploying, so cookies minted under them die too.\n\n",
  );

  let out = "# passwords — distribute out-of-band, one per person\n";
  for (const [username] of roster) {
    out += username.padEnd(20) + passwords[username] + "\n";
  }
  out += "\n# FLOWS_PEPPER — paste as the value of: wrangler secret put FLOWS_PEPPER\n";
  out += pepper + "\n";
  out += "\n# FLOWS_CREDENTIALS — paste as the value of: wrangler secret put FLOWS_CREDENTIALS\n";
  out += json + "\n";
  process.stdout.write(out);
} else {
  const lines = await readStdinLines(2);
  const [password, pepper] = lines;

  if (process.stdin.isTTY && lines.length < 2) die("expected two lines: the password, then the pepper");
  if (!password || !password.trim()) die("a shared password is required (first line of stdin)");
  if (!pepper || !pepper.trim()) die("a pepper is required (second line) — generate one with: openssl rand -base64 48");
  if (pepper.trim().length < 24) die("that pepper is too short to be worth having; use at least 24 characters");

  const map = {};
  for (const username of FLOWS_USERNAMES) {
    map[username] = await deriveHash(username, password, pepper);
  }

  process.stderr.write(
    `\nDerived ${FLOWS_USERNAMES.length} credentials at ${PBKDF2_ITERATIONS} PBKDF2 iterations.\n\n` +
    "Set these on the Worker. SESSION_SECRET is already configured and is shared\n" +
    "with the learning session — the audience claim, not the secret, separates them.\n\n" +
    "  wrangler secret put FLOWS_PEPPER          # the pepper you just supplied\n" +
    "  wrangler secret put FLOWS_CREDENTIALS     # the JSON line printed below\n" +
    "  wrangler secret put FLOWS_INGEST_TOKEN    # bearer token for the pipeline\n\n" +
    "To revoke every live session, bump FLOWS_SESSION_EPOCH (a plain var, not a\n" +
    "secret). Rotating FLOWS_PEPPER does NOT sign anyone out — the pepper is used\n" +
    "for credential derivation only and never touches session verification.\n\n" +
    "The repository is PUBLIC. Do not commit either value and do not paste them\n" +
    "into an issue. Nothing has been written to disk by this script, and reading\n" +
    "from stdin keeps them out of shell history and ps.\n\n",
  );

  process.stdout.write(JSON.stringify(map) + "\n");
}
