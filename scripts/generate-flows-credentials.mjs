#!/usr/bin/env node
/* Generate the FLOWS_CREDENTIALS secret for the Flows credential gate.
 *
 * Run this LOCALLY. It prints one JSON line to stdout and writes nothing to
 * disk: this repository is public, so neither the password, the pepper, nor
 * the derived map may ever be committed.
 *
 *   node scripts/generate-flows-credentials.mjs '<shared password>' '<pepper>'
 *
 * Generate a pepper first if you do not have one:
 *   openssl rand -base64 48
 */

import { FLOWS_USERNAMES, deriveHash, PBKDF2_ITERATIONS } from "../shared/flows-auth.js";

const [password, pepper] = process.argv.slice(2);

function die(message) {
  process.stderr.write("error: " + message + "\n\n" +
    "usage: node scripts/generate-flows-credentials.mjs '<password>' '<pepper>'\n");
  process.exit(1);
}

if (!password || !password.trim()) die("a shared password is required");
if (!pepper || !pepper.trim()) die("a pepper is required — generate one with: openssl rand -base64 48");
if (pepper.trim().length < 24) die("that pepper is too short to be worth having; use at least 24 characters");

const map = {};
for (const username of FLOWS_USERNAMES) {
  map[username] = await deriveHash(username, password, pepper);
}

process.stderr.write(
  `\nDerived ${FLOWS_USERNAMES.length} credentials at ${PBKDF2_ITERATIONS} PBKDF2 iterations.\n\n` +
  "Set three secrets on the Worker. SESSION_SECRET is already configured and is\n" +
  "shared with the learning session — the audience claim, not the secret, is what\n" +
  "separates the two.\n\n" +
  "  wrangler secret put FLOWS_PEPPER        # the pepper you passed here\n" +
  "  wrangler secret put FLOWS_CREDENTIALS   # the JSON line printed below\n\n" +
  "The repository is PUBLIC. Do not commit either value, do not paste them into\n" +
  "an issue, and do not echo them in CI. Nothing has been written to disk.\n\n",
);

process.stdout.write(JSON.stringify(map) + "\n");
