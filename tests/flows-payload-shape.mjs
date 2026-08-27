/* =============================================================
   flows-payload-shape.mjs — the publisher and the renderers, checked
   against each other rather than against a shared belief.

   WHY THIS SUITE EXISTS, AND WHAT IT COST TO LEARN.

   Every other suite in this directory feeds a HAND-WRITTEN fixture to
   a renderer. That proves the renderer is self-consistent and proves
   nothing whatever about the bytes scripts/flows-pipeline.mjs
   actually publishes, because the same person writes both and writes
   the same assumption into each. This repo has paid for that six
   times. The sixth reached production:

     scripts/flows-pipeline.mjs publishes the eleven sector readings
     under `sectors`. assets/js/flows-market.js read `sectors.rows`.
     No `rows` key has ever existed on that payload. The live run of
     2026-08-26 measured ELEVEN OF ELEVEN sectors, logged
     "sector:trix: 11/11 sectors measured", and the page said "No
     sector carried enough history to settle a TRIX reading this
     session" — a confident claim about the market, produced by a
     renderer that could not see the data. tests/flows-market-
     contract.mjs asserted 58 things about it and passed, because its
     fixture also said `rows`.

   The publisher's own log line had been saying so on every run for
   weeks: "published sector:trix: NO ROWS, 3563 bytes".

   SO THIS SUITE NEVER WRITES A FIXTURE. It runs the real pipeline,
   captures the real emitted payloads, and asserts that every root
   field a renderer reads is a field the publisher actually writes.
   The renderer's reads are EXTRACTED FROM ITS SOURCE rather than
   declared here, so the two cannot drift apart: adding a read of a
   field nobody publishes fails this suite the moment it is written.

   A field may be absent only by appearing in OPTIONAL below with a
   reason. That keeps an omission a deliberate, argued act instead of
   the silent default it was.
   ============================================================= */

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); checks++; };

/* ---------- the real payloads, from the real publisher -------------

   --dry-run uses synthetic VENDOR rows, which is the only part that
   is fake. The publish path, the payload assembly and every field
   name below are the production code paths verbatim. That is exactly
   the half this suite is about: the sector bug was never about the
   numbers, it was about what the object is called. */
const dir = mkdtempSync(join(tmpdir(), "flows-shape-"));
try {
  execFileSync("node", [join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run",
    "--emit", join(dir, "p.json")], { stdio: "pipe" });
} catch (error) {
  console.error("the pipeline itself failed to run, so nothing below is measurable");
  console.error(String(error.stdout || "") + String(error.stderr || ""));
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const emitted = (key) => {
  const file = join(dir, "p-" + key.replace(":", "-") + ".json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
};

/* ---------- what each renderer reads, and where ---------------------

   `fn` scopes the scan to one function, because assets/js/flows-
   market.js draws THREE different payloads and a whole-file scan
   would check each one's fields against all three payloads. Where a
   file draws a single payload, fn is null and the whole file counts.

   `vars` are the identifiers the payload arrives under. These are
   parameter names, so they are checked against the source below —
   a renamed parameter must not silently disable the scan. */
const SURFACES = [
  { key: "sector:trix", file: "assets/js/flows-market.js", fn: "paintSectors", vars: ["sectors"] },
  { key: "movers", file: "assets/js/flows-market.js", fn: "paintMovers", vars: ["movers"] },
  { key: "market", file: "assets/js/flows-market.js", fn: "paintTape", vars: ["m"] },
  { key: "market", file: "assets/js/flows-market.js", fn: "paintTilt", vars: ["m"] },
  { key: "market", file: "assets/js/flows-market.js", fn: "paintBreadth", vars: ["m"] },
  { key: "unusual", file: "assets/js/flows-unusual.js", fn: null, vars: ["payload"] },
  { key: "events", file: "assets/js/flows-events.js", fn: null, vars: ["payload"] },
  { key: "record", file: "assets/js/flows-history.js", fn: null, vars: ["payload"] },
];

/* ---------- absences that are arguments, not accidents --------------

   Every entry needs a reason, and the reason has to survive being
   read out loud. "It is sometimes missing" is not one — a renderer
   that reads a field the publisher never writes under ANY condition
   is the bug this suite exists to catch, and a blanket exemption
   would reinstate it. */
const OPTIONAL = {
  /* The worker answers an unpublished key with {status:"pending", rows:[]}
     rather than 404, so `status` is read off a shape the pipeline never
     emits. That read is correct and must stay. */
  "sector:trix": { status: "the worker's pending envelope carries it; the payload also does" },
};

const missingReport = [];

for (const surf of SURFACES) {
  const src = readFileSync(join(ROOT, surf.file), "utf8");
  let scope = src;

  if (surf.fn) {
    const start = src.indexOf("function " + surf.fn + "(");
    ok(start !== -1,
       `${surf.file} still defines ${surf.fn}() — if it was renamed, this scan silently ` +
       "stopped checking that payload and the rename must update SURFACES");
    /* To the next top-level-ish function declaration, which is how this
       file is laid out. Over-reading is safe (extra fields get checked);
       under-reading is not, so the fallback is the rest of the file. */
    const next = src.indexOf("\n  function ", start + 1);
    scope = src.slice(start, next === -1 ? src.length : next);
  }

  /* The parameter really is named what SURFACES claims. A renamed
     parameter would make the regex below match nothing and every
     assertion pass vacuously — the exact failure mode that let the
     sector bug live, reproduced inside its own detector. */
  for (const v of surf.vars) {
    ok(new RegExp("function\\s+\\w+\\s*\\(\\s*" + v + "\\b").test(scope) || !surf.fn,
       `${surf.file}:${surf.fn || "(module)"} still receives its payload as \`${v}\` — ` +
       "a renamed parameter makes this whole scan vacuous");
  }

  const payload = emitted(surf.key);
  ok(payload && typeof payload === "object",
     `the pipeline emitted a "${surf.key}" payload for ${surf.fn || surf.file} to be checked ` +
     "against — a key that stopped publishing is itself the failure this suite reports");
  if (!payload) continue;

  /* PROSE IS NOT A READ. The first run of this suite reported
     paintSectors reading `sectors.rows` — out of the comment that
     explains why it must never read `sectors.rows` again. Block
     comments come out before the scan; the `reads.size > 0` guard
     below is what catches a strip that took too much. */
  const code = scope.replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/([^:])\/\/[^\n]*/g, "$1");

  const re = new RegExp("\\b(" + surf.vars.join("|") + ")\\.([A-Za-z_][A-Za-z0-9_]*)", "g");
  const reads = new Set();
  let m;
  while ((m = re.exec(code)) !== null) reads.add(m[2]);

  /* A FIELD THE RENDERER ASSIGNS TO ITSELF IS NOT THE PUBLISHER'S.
     flows-unusual.js and flows-events.js stamp `payload.__updatedAt`
     from the response header before reading it back, which is a
     client-side annotation and not a claim that the pipeline writes
     it. Detected rather than allow-listed, because an allow-list
     entry is a promise someone has to keep re-reading and this rule
     enforces itself: stop assigning it and it must be published. */
  const selfAssigned = new Set();
  for (const v of surf.vars) {
    const asg = new RegExp("\\b" + v + "\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=(?!=)", "g");
    let a;
    while ((a = asg.exec(code)) !== null) selfAssigned.add(a[1]);
  }

  ok(reads.size > 0,
     `the scan actually found root-field reads in ${surf.fn || surf.file} — zero reads means ` +
     "the regex or the variable name is wrong, and a vacuous pass is worse than a failure");

  const allowed = OPTIONAL[surf.key] || {};
  for (const field of [...reads].sort()) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) { checks++; continue; }
    if (Object.prototype.hasOwnProperty.call(allowed, field)) { checks++; continue; }
    if (selfAssigned.has(field)) { checks++; continue; }
    missingReport.push(`${surf.file}:${surf.fn || "(module)"} reads \`${surf.vars[0]}.${field}\`` +
      ` but the published "${surf.key}" payload has no such key` +
      ` (it has: ${Object.keys(payload).sort().join(", ")})`);
  }
}

assert.deepEqual(missingReport, [],
  "every root field a renderer reads is a field the publisher writes:\n  " +
  missingReport.join("\n  ")); checks++;

/* ---------- the specific regression, pinned by name -----------------

   The generic scan above would catch this again, but only while the
   renderer still reads the field. Someone "simplifying" paintSectors
   back to `.rows` with a fixture to match would pass the generic scan
   (it checks what IS read) and fail here. */
{
  const p = emitted("sector:trix");
  ok(Array.isArray(p.sectors),
     "sector:trix publishes its readings under `sectors` — the name the renderer must read");
  ok(!("rows" in p),
     "and does NOT publish a `rows` key. assets/js/flows-market.js read `sectors.rows` for " +
     "the panel's whole life; the page reported no sector had enough history through a live " +
     "run that measured eleven of eleven. If this assertion ever fails because `rows` was " +
     "ADDED to placate a renderer, that is the bug returning wearing the fix's clothes");

  const market = readFileSync(join(ROOT, "assets/js/flows-market.js"), "utf8");
  const paint = market.slice(market.indexOf("function paintSectors("));
  /* Comments stripped here for the same reason as in the scan above: the
     renderer's own explanation of why it must never read `sectors.rows`
     contains the string `sectors.rows`, and tripped this assertion on its
     first run. The detector reading its own warning as the defect is a
     fitting last instance of the pattern this whole file is about. */
  const body = paint.slice(0, paint.indexOf("\n  function "))
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/([^:])\/\/[^\n]*/g, "$1");
  ok(/sectors\.sectors/.test(body),
     "paintSectors reads sectors.sectors");
  ok(!/sectors\.rows/.test(body),
     "and no `rows` fallback was left behind — a fallback lets the payload and the renderer " +
     "drift apart again in silence, which is the only reason this survived a live run");

  /* THREE SILENCES, THREE SENTENCES. The panel used to answer all of
     "not published", "published but unreadable" and "published and
     nothing settled" with the last one, which is the only one of the
     three that makes a claim about the market. */
  ok(/status === "pending"/.test(body),
     "an unpublished key is told apart from a measured emptiness — before, a pending payload " +
     "and eleven settled sectors printed the same sentence");
  const historyClaim = body.indexOf("No sector carried enough history");
  const measuredGuard = body.indexOf("if (!measured.length)");
  ok(historyClaim > measuredGuard && measuredGuard !== -1,
     "and the sentence that claims no sector settled sits BEHIND the check that readings were " +
     "actually published, so it can only be said once it is true");
}

rmSync(dir, { recursive: true, force: true });

console.log(`✓ flows-payload-shape: ${checks} assertions — the publisher and the renderers ` +
  `checked against each other rather than against a fixture that agrees with both, every root ` +
  `field extracted from the renderer's own source so the two cannot drift, absences allowed ` +
  `only with a written reason, and the sector regression pinned by name in both directions`);
