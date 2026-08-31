#!/usr/bin/env node
/* Generate the FLOWS_CREDENTIALS secret for the Flows credential gate.
 *
 * TWO MODES, and in both of them secrets stay off argv.
 *
 * An earlier version took secrets as command-line arguments while its own
 * banner claimed nothing was left behind. That was false: argv is visible to
 * every process on the machine via ps, and the shell appends the whole
 * invocation — plaintext password and pepper — to its history file. Both then
 * sit on disk indefinitely, which is exactly what the pepper exists to
 * prevent. So: the only argument this script accepts is the mode flag
 * `--mint`, which is not a secret; every secret is read from stdin or minted
 * in-process, and nothing is ever written to disk.
 *
 * MINT MODE — the normal way to provision or rotate the whole set:
 *
 *   node scripts/generate-flows-credentials.mjs --mint
 *
 * Mints a fresh crypto-random password PER USER (xxxx-xxxx-xxxx-xxxx, from an
 * unambiguous charset, ~79 bits each) and a fresh pepper, derives the hash
 * map, and prints all of it ONCE to the terminal: the username→password table
 * to distribute out-of-band, the pepper for `wrangler secret put FLOWS_PEPPER`,
 * and the JSON for `wrangler secret put FLOWS_CREDENTIALS`. To reuse an
 * existing pepper instead of minting one, pipe it in as the single stdin line:
 *
 *   printf '%s\n' "$PEPPER" | node scripts/generate-flows-credentials.mjs --mint
 *
 * LEGACY SHARED-PASSWORD MODE — kept for compatibility; every account gets
 * the same password (hashes still differ per user because the username is the
 * salt). Reads two stdin lines: the password, then the pepper.
 *
 *   node scripts/generate-flows-credentials.mjs
 *   printf '%s\n%s\n' "$PASSWORD" "$PEPPER" | node scripts/generate-flows-credentials.mjs
 *
 * Generate a pepper by hand if you need one outside --mint:
 *   openssl rand -base64 48
 */

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

/* Lowercase+digit charset with the lookalikes removed (no i/l/o/0/1) so a
   password read over the phone or off paper cannot be mis-copied. 31 symbols
   is ~4.95 bits each; 16 of them is ~79 bits per password. Rejection sampling
   keeps the draw uniform — a plain modulo would bias the low symbols. */
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

/* --mint on an interactive terminal must not sit waiting for input nobody
   was asked for, so it skips a TTY stdin; legacy mode reads it either way,
   which is how interactive entry has always worked. */
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
