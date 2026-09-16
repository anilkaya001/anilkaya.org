#!/usr/bin/env node

import { createInterface } from "node:readline";
import { webcrypto } from "node:crypto";
import { FLOWS_USERNAMES, deriveHash, PBKDF2_ITERATIONS } from "../shared/flows-auth.js";

const args = process.argv.slice(2);
const MINT = args.includes("--mint");

if (args.some((a) => a !== "--mint")) {
  process.stderr.write(
    "error: the only accepted argument is --mint — secrets are read from stdin\n" +
    "       or minted in-process so they do not land in shell history or ps.\n\n" +
    "  node scripts/generate-flows-credentials.mjs --mint   # per-user passwords\n" +
    "  node scripts/generate-flows-credentials.mjs          # legacy shared password\n",
  );
  process.exit(1);
}

function die(message) {
  process.stderr.write("error: " + message + "\n");
  process.exit(1);
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

if (MINT) {
  const lines = await readStdinLines(1, { skipTTY: true });
  const supplied = (lines[0] || "").trim();
  if (supplied && supplied.length < 24) {
    die("that pepper is too short to be worth having; use at least 24 characters, or pipe nothing and let --mint create one");
  }
  const pepper = supplied || mintPepper();

  const passwords = {};
  const map = {};
  for (const username of FLOWS_USERNAMES) {
    passwords[username] = mintPassword();
    map[username] = await deriveHash(username, passwords[username], pepper);
  }

  process.stderr.write(
    `\nMinted ${FLOWS_USERNAMES.length} per-user passwords and derived their hashes at ` +
    `${PBKDF2_ITERATIONS} PBKDF2 iterations` +
    (supplied ? " (pepper supplied on stdin)" : " (fresh pepper minted)") + ".\n\n" +
    "Everything below is printed ONCE and written nowhere. Keep this terminal\n" +
    "open until the two secrets are pasted into wrangler, and hand each person\n" +
    "their password out-of-band — never through a chat, ticket or email thread:\n" +
    "anything pasted there is burned and the whole set must be re-minted.\n\n" +
    "  wrangler secret put FLOWS_PEPPER          # the pepper below\n" +
    "  wrangler secret put FLOWS_CREDENTIALS     # the JSON below\n" +
    "  wrangler deploy                           # a stored secret is NOT a deployed one\n\n" +
    "If the old passwords were exposed anywhere, also bump FLOWS_SESSION_EPOCH\n" +
    "in wrangler.toml before deploying, so cookies minted under them die too.\n\n",
  );

  let out = "# passwords — distribute out-of-band, one per person\n";
  for (const username of FLOWS_USERNAMES) {
    out += username.padEnd(20) + passwords[username] + "\n";
  }
  out += "\n# FLOWS_PEPPER — paste as the value of: wrangler secret put FLOWS_PEPPER\n";
  out += pepper + "\n";
  out += "\n# FLOWS_CREDENTIALS — paste as the value of: wrangler secret put FLOWS_CREDENTIALS\n";
  out += JSON.stringify(map) + "\n";
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
