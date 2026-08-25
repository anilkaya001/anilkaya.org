#!/usr/bin/env node
/* Generate the FLOWS_CREDENTIALS secret for the Flows credential gate.
 *
 * Reads both secrets from STDIN, never from argv.
 *
 * An earlier version took them as command-line arguments while its own banner
 * claimed nothing was left behind. That was false: argv is visible to every
 * process on the machine via ps, and the shell appends the whole invocation —
 * plaintext shared password and pepper — to its history file. Both then sit on
 * disk indefinitely, which is exactly what the pepper exists to prevent.
 *
 *   node scripts/generate-flows-credentials.mjs
 *
 * Or non-interactively, without touching shell history:
 *   printf '%s\n%s\n' "$PASSWORD" "$PEPPER" | node scripts/generate-flows-credentials.mjs
 *
 * Generate a pepper first if you do not have one:
 *   openssl rand -base64 48
 */

import { createInterface } from "node:readline";
import { FLOWS_USERNAMES, deriveHash, PBKDF2_ITERATIONS } from "../shared/flows-auth.js";

if (process.argv.length > 2) {
  process.stderr.write(
    "error: this script takes no arguments — secrets are read from stdin so they\n" +
    "       do not land in shell history or ps output.\n\n" +
    "  node scripts/generate-flows-credentials.mjs\n",
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, terminal: false });
const lines = [];
for await (const line of rl) {
  lines.push(line);
  if (lines.length === 2) break;
}

const [password, pepper] = lines;

function die(message) {
  process.stderr.write("error: " + message + "\n");
  process.exit(1);
}

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
