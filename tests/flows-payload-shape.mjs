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
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
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

   `at` scopes the scan to a block that has no name to find it by:
   the closure a page assembles itself in is a payload-reading site
   like any other, and leaving it out because it is anonymous covered
   the regions with a heading on them and none of the arithmetic
   between them. It anchors on the block's own text and runs to `to`,
   or to the end of the file.

   `vars` are the identifiers the payload arrives under. They are
   parameter names, destructured parameters or bindings, and each one
   is checked against the source below — a renamed identifier must
   not silently disable the scan. */
const SURFACES = [
  { key: "sector:trix", file: "assets/js/flows-market.js", fn: "paintSectors", vars: ["sectors"] },
  { key: "movers", file: "assets/js/flows-market.js", fn: "paintMovers", vars: ["movers"] },
  { key: "market", file: "assets/js/flows-market.js", fn: "paintTape", vars: ["m"] },
  { key: "market", file: "assets/js/flows-market.js", fn: "paintTilt", vars: ["m"] },
  { key: "market", file: "assets/js/flows-market.js", fn: "paintBreadth", vars: ["m"] },
  { key: "unusual", file: "assets/js/flows-unusual.js", fn: null, vars: ["payload"] },
  { key: "events", file: "assets/js/flows-events.js", fn: null, vars: ["payload"] },
  { key: "record", file: "assets/js/flows-history.js", fn: null, vars: ["payload"] },
  { key: "scoretrack", file: "assets/js/flows-track.js", fn: null, vars: ["payload"] },
  /* flows-unusual.js draws TWO payloads and keeps them under two names —
     `payload` for the counter feed, `alerts` for the vendor's flow alerts —
     precisely so these two scans cannot blur. One name reaching into the
     other's blob is the drift this suite exists to catch. */
  { key: "flowalerts", file: "assets/js/flows-unusual.js", fn: null, vars: ["alerts"] },
  { key: "pulse", file: "assets/js/flows-market.js", fn: "paintPulse", vars: ["pulse"] },
  /* The political renderer hands the WHOLE payload to each of its four
     painters under one name, so a whole-file scan is the right scope: every
     `p.` read in the file is a root-field claim about this key. */
  { key: "political", file: "assets/js/flows-political.js", fn: null, vars: ["p"] },
  /* THE COMMAND CENTER, which draws five payloads into one page and is the
     largest renderer on the site. Each region is scoped to its own painter,
     because a whole-file scan would check every payload's fields against all
     five keys and pass on the union — the exact vacuous-pass shape this suite
     exists to prevent. */
  { key: "scoretrack", file: "assets/js/flows-overview.js", fn: "paintChanged", vars: ["payload"] },
  { key: "flowalerts", file: "assets/js/flows-overview.js", fn: "paintAlerts", vars: ["payload"] },
  { key: "events", file: "assets/js/flows-overview.js", fn: "paintEvents", vars: ["payload"] },
  { key: "board:watch", file: "assets/js/flows-overview.js", fn: "paintWatch", vars: ["payload"] },
  /* AND THE OTHER HALF OF THAT PAGE, which was reading eight payload sites
     through four of them. The four above are the regions with a heading on
     them; the four below read a payload without owning one, so nothing on
     screen is named after them and a renamed field there is answered by the
     page's own vocabulary of absences — an em dash, an empty index, an axis
     with no hatch. That is the sector sentence exactly: a confident ordinary
     reading, produced by a renderer that could not see the data.

     readTrack() builds the score index every ranked row, the change table
     and the spine then draw from, out of `sessions`, `names` and `deadBand`.
     Rename one and the index comes back empty: no crossing tag on any row,
     no trail on the spine, no move anywhere — three regions each printing
     the ordinary "nothing moved" case off one unread field. */
  { key: "scoretrack", file: "assets/js/flows-overview.js", fn: "readTrack", vars: ["payload"] },
  /* paintVerdict() draws FOUR payloads into the seven tiles the route opens
     on and takes each under its own name, so it registers four times rather
     than once against a union that would pass a field belonging to any of
     them. Every tile is allowed to print an em dash — that is the honest
     answer for an endpoint that did not answer — which is precisely why a
     rename here is invisible: `market.breadth` gone is "— / —" under Breadth
     on a session the pipeline screened and measured in full. */
  { key: "market", file: "assets/js/flows-overview.js", fn: "paintVerdict", vars: ["market"] },
  /* poolCount() is the one place this page decides a side's population —
     `cleared`, the publisher's pool, ahead of the rows the cap kept — and the
     rail badge, the Cleared tile, the status line and the pole subtitles all
     read it. A renamed `cleared` would fall through to the row count in all
     four at once, silently: the badge would print 50 on a route whose own
     board says 53. An arrow const rather than a function declaration, so it
     is anchored on its own text. */
  { key: "board:long", file: "assets/js/flows-overview.js", at: "const poolCount = (payload)",
    to: "\n  };", label: "poolCount", vars: ["payload"] },
  { key: "flowalerts", file: "assets/js/flows-overview.js", fn: "paintVerdict", vars: ["alerts"] },
  { key: "board:long", file: "assets/js/flows-overview.js", fn: "paintVerdict", vars: ["long"] },
  { key: "board:short", file: "assets/js/flows-overview.js", fn: "paintVerdict", vars: ["short"] },
  /* renderSpine() is the page's one chart, and it reads the band, the scored
     population and the neutral count off the board root. `deadBand` renamed
     draws an axis with no hatch and a caption stating the band's width is not
     published — a claim about the session, made over a number sitting three
     fields away in the payload it was handed. */
  { key: "board:long", file: "assets/js/flows-overview.js", fn: "renderSpine", vars: ["payload"] },
  /* AND THE CLOSURE THAT ASSEMBLES THE PAGE, a payload-reading site with no
     name of its own: it joins the seven fetches, builds the two cross-region
     indexes and writes the three region subtitles. Its reads are the ones no
     painter takes — `alerts.seen` and `events.inWindow` are the denominators
     those subtitles state, `alerts.readAt` is the instant the flow feed was
     read, `lng.deep` is how a row knows whether it has a card behind it — so
     it is anchored by its own text rather than left unchecked for want of a
     function to name. Five entries over one scope, one per payload, for the
     same reason paintVerdict takes four. */
  { key: "board:long", file: "assets/js/flows-overview.js", at: "Promise.all([",
    label: "the region assembly", vars: ["lng", "payload", "meta"] },
  { key: "board:short", file: "assets/js/flows-overview.js", at: "Promise.all([",
    label: "the region assembly", vars: ["sht"] },
  { key: "flowalerts", file: "assets/js/flows-overview.js", at: "Promise.all([",
    label: "the region assembly", vars: ["alerts"] },
  { key: "events", file: "assets/js/flows-overview.js", at: "Promise.all([",
    label: "the region assembly", vars: ["events"] },
  { key: "scoretrack", file: "assets/js/flows-overview.js", at: "Promise.all([",
    label: "the region assembly", vars: ["track"] },
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
  /* Same pending-envelope allowance: the pulse renderer must recognise
     {status:"pending"} from the worker even though the pipeline's own
     payload never carries a top-level status. */
  pulse: { status: "the worker's pending envelope carries it" },
  /* Same allowance, same reason: the renderer must recognise the worker's
     {status:"pending"} for a key the pipeline has not written yet, and the
     political payload carries no top-level status of its own. */
  political: { status: "the worker's pending envelope carries it" },
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
  } else if (surf.at) {
    /* THE SAME NARROWING, FOR A BLOCK WITH NO NAME. Anchored on its own
       text, the way the card section below anchors on the drawer's comment
       marker. A missing anchor is reported rather than silently widening to
       the whole file, because a whole-file scope here would check five
       payloads' fields against one key and pass on the union. */
    const start = src.indexOf(surf.at);
    ok(start !== -1,
       `${surf.file} still carries the block anchored at \`${surf.at}\` — if it moved or was ` +
       "reworded, this scan silently stopped checking that payload and the move must update " +
       "SURFACES");
    const end = surf.to ? src.indexOf(surf.to, start + 1) : -1;
    scope = src.slice(start, end === -1 ? src.length : end);
  }

  /* The parameter really is named what SURFACES claims. A renamed
     parameter would make the regex below match nothing and every
     assertion pass vacuously — the exact failure mode that let the
     sector bug live, reproduced inside its own detector. */
  for (const v of surf.vars) {
    /* THE PAYLOAD NEED NOT BE THE FIRST PARAMETER, and insisting it was kept
       the site's largest renderer out of this scan entirely. flows-overview.js
       paints into a host it is handed first — paintChanged(into, payload) —
       so the old anchored pattern matched nothing there, and the only way to
       cover the file would have been to reorder five signatures to satisfy a
       test. A test that dictates parameter order is a test that will be
       worked around.

       The anti-vacuity guarantee is unchanged and is the whole point of this
       check: the name must appear in the parameter list of a function inside
       the scanned scope, so renaming it still fails here loudly instead of
       silently disabling every assertion below. */
    /* AND IT NEED NOT BE A NAMED FUNCTION'S PARAMETER EITHER. The page's
       assembling closure takes its seven payloads through a destructured
       arrow parameter and names the board it draws the spine from in a
       `const`, so an anchor-scoped surface has no `function name(...)` to
       match and the old check would have had to be waived for exactly the
       block it was added to cover. All three binding forms count; what does
       not count is the name being absent, which is still the failure. */
    const bound =
      new RegExp("function\\s+\\w+\\s*\\([^)]*\\b" + v + "\\b[^)]*\\)").test(scope) ||
      new RegExp("\\(\\s*\\[?[^)]*\\b" + v + "\\b[^)]*\\]?\\s*\\)\\s*=>").test(scope) ||
      new RegExp("\\b(?:const|let|var)\\s+(?:\\[[^\\]]*\\b" + v + "\\b[^\\]]*\\]|" +
                 "\\{[^}]*\\b" + v + "\\b[^}]*\\}|" + v + "\\b)").test(scope);
    ok(bound || !(surf.fn || surf.at),
       `${surf.file}:${surf.fn || surf.label || "(module)"} still names its payload \`${v}\` — ` +
       "a renamed parameter or binding makes this whole scan vacuous");
  }

  const payload = emitted(surf.key);
  ok(payload && typeof payload === "object",
     `the pipeline emitted a "${surf.key}" payload for ${surf.fn || surf.label || surf.file} ` +
     "to be checked against — a key that stopped publishing is itself the failure this suite " +
     "reports");
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

  /* THE SAME RULE, FOR AN ANNOTATION WRITTEN NOWHERE NEAR ITS READ. The
     scope-local pass above sees `payload.__updatedAt = …` because the
     renderer that stamps it is the renderer that reads it back.
     flows-overview.js stamps the spine's three onto the board payload in the
     closure that assembles them — `meta.__bull = bull` — and renderSpine
     reads them off its own parameter, so the write is two hundred lines and
     one name away and a scope-local pass cannot see it. This one is
     file-wide and deliberately narrow: only `__`-prefixed fields, which this
     codebase reserves for client-side notes, and only where the file really
     assigns one. It stays self-enforcing for the same reason as the pass
     above — stop assigning it and it must be published — which an allow-list
     entry naming three fields would not have been. */
  const annotated = new Set();
  {
    const whole = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/([^:])\/\/[^\n]*/g, "$1");
    const asg = /\b\w+\.(__[A-Za-z0-9_]+)\s*=(?!=)/g;
    let a;
    while ((a = asg.exec(whole)) !== null) annotated.add(a[1]);
  }

  ok(reads.size > 0,
     `the scan actually found root-field reads in ${surf.fn || surf.label || surf.file} — ` +
     "zero reads means the regex or the variable name is wrong, and a vacuous pass is worse " +
     "than a failure");

  const allowed = OPTIONAL[surf.key] || {};
  for (const field of [...reads].sort()) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) { checks++; continue; }
    if (Object.prototype.hasOwnProperty.call(allowed, field)) { checks++; continue; }
    if (selfAssigned.has(field)) { checks++; continue; }
    if (annotated.has(field)) { checks++; continue; }
    missingReport.push(`${surf.file}:${surf.fn || surf.label || "(module)"} reads ` +
      `\`${surf.vars[0]}.${field}\` but the published "${surf.key}" payload has no such key` +
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

/* ---------- the card panel, and the drawer that reads it ------------

   THE SCAN ABOVE ONLY REACHES ROOT FIELDS OF WHOLE-PAYLOAD RENDERERS, and
   the card is not one of those: /flows/ticker/ hands each drawer ONE panel
   out of card.panels, so every field it reads is `panel.x` or `f.x` and none
   of them is a root field of anything. That is a whole class of renderer
   this suite could not see, and the class the sector bug belongs to.

   marketRank is the newest member of it and the one with the most fields —
   twenty-odd per feed, a third of them nullable — so it is checked the way
   the root scans are: the reads are EXTRACTED FROM THE DRAWER'S OWN SOURCE
   and held against the panel the pipeline actually emitted, rather than
   against a fixture written by the same hand as the drawer.

   THE QUIET ARM IS CHECKED SEPARATELY AND THAT IS THE POINT. A name that is
   not in a feed still gets the population, the cut, the ordering and the
   feed's own session — that is what makes the absence a reading instead of
   a shrug — so the fields the drawer prints OUTSIDE its ok branch have to be
   on the quiet arm too. A publisher that dropped them there would leave a
   panel saying "not in the feed" with nothing to compare against, and every
   assertion above would still pass. */
{
  const cardFiles = readdirSync(dir).filter((f) => /^p-card-/.test(f));
  ok(cardFiles.length > 0, "the pipeline emitted cards for the panel scan to read");
  const cards = cardFiles.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

  const withRank = cards.filter((c) => c.panels && c.panels.marketRank);
  eq(withRank.length, cards.length,
     "every emitted card carries a marketRank panel — a panel published on SOME cards is a " +
     "renderer branch that only fails on the names nobody checked");

  const src = readFileSync(join(ROOT, "assets/js/flows-ticker.js"), "utf8");
  const start = src.indexOf("/* ===== marketRank");
  ok(start !== -1,
     "assets/js/flows-ticker.js still carries the marketRank drawer block — if it was " +
     "renamed, this scan silently stopped checking it and the rename must update this suite");
  const end = src.indexOf("const DRAW = {", start);
  const code = src.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/([^:])\/\/[^\n]*/g, "$1");

  const readsOf = (v) => {
    const re = new RegExp("\\b" + v + "\\.([A-Za-z_][A-Za-z0-9_]*)", "g");
    const out = new Set();
    let m;
    while ((m = re.exec(code)) !== null) out.add(m[1]);
    return out;
  };

  /* A card whose name is in BOTH feeds, and one whose name is in neither.
     Both must exist in the corpus or one of the two arms below is checked
     against nothing at all, which is the vacuous pass this file is about. */
  const okCard = withRank.find((c) =>
    c.panels.marketRank.status === "ok" &&
    c.panels.marketRank.feeds.oiChange.status === "ok" &&
    c.panels.marketRank.feeds.darkpool.status === "ok");
  const quietCard = withRank.find((c) =>
    c.panels.marketRank.status === "ok" &&
    c.panels.marketRank.feeds.oiChange.status === "quiet");
  ok(okCard, "an emitted card places in both market-wide feeds, so the ok arm is measurable");
  ok(quietCard,
     "and an emitted card places in neither, so the measured-absence arm is measurable too — " +
     "a corpus where every name ranks would certify only half of this panel");

  /* ANTI-VACUITY, the same guard the root scans carry. A regex that matches
     nothing passes every assertion below it, which is how the defect this
     file is named for survived a suite of fifty-eight assertions. */
  ok(readsOf("f").size >= 10,
     `the scan found the drawer's feed-field reads (${readsOf("f").size} of them) — zero ` +
     "would mean the block moved and this whole section is checking nothing");
  ok(readsOf("panel").size >= 3,
     `and its panel-field reads (${readsOf("panel").size} of them)`);

  const panelKeys = new Set(Object.keys(okCard.panels.marketRank));
  /* `reason` is the union's other arm: an unavailable panel carries it and
     an ok one never does. The drawer must read it — that is the whole
     three-silences contract — so it is named here rather than allowed by a
     blanket exemption. */
  panelKeys.add("reason");
  for (const field of [...readsOf("panel")].sort()) {
    ok(panelKeys.has(field),
       `the marketRank drawer reads panel.${field} and the emitted panel carries it ` +
       `(it has: ${[...panelKeys].sort().join(", ")})`);
  }

  /* THE REFERENCE IS THE UNION OF THE ARMS, because a feed reading is a
     tagged union and the drawer reads across all of them: `rank` and `value`
     exist only where the name placed, `reason` only where it did not. Held
     against one arm this would either reject the correct reads of the other
     or, checked against the wider arm alone, pass a read that no arm carries.
     Both arms come out of the EMITTED corpus, so neither is a fixture. */
  const okFeed = okCard.panels.marketRank.feeds.oiChange;
  const absentFeed = quietCard.panels.marketRank.feeds.oiChange;
  const feedKeys = new Set([...Object.keys(okFeed), ...Object.keys(absentFeed)]);
  for (const field of [...readsOf("f")].sort()) {
    ok(feedKeys.has(field),
       `the drawer reads f.${field} on a feed reading and the publisher writes it on some ` +
       `arm of the union (they carry: ${[...feedKeys].sort().join(", ")})`);
  }

  /* THE FIELDS THE ABSENCE READING NEEDS, on the arm that reports an
     absence. Named one by one because each carries a different half of the
     sentence: the population a rank would have sat inside, the cut the name
     did not clear, whether OUR OWN request did the cutting, the ordering
     that makes a cut a cut at all, and the session the feed is from. */
  const quietFeed = absentFeed;
  eq(quietFeed.status, "quiet",
     "a name the feed was READ without finding is quiet, not unavailable — it is a fact " +
     "about a market-wide selection, and only the third silence makes a claim about the market");
  eq(quietFeed.present, false, "and it says so as data, not only in prose");
  for (const field of ["population", "names", "requested", "capped", "ordered", "orderedBy",
                       "cut", "cutAt", "asOf", "asOfStated", "sameSession",
                       "unit", "unitOne", "kind", "reason"]) {
    ok(Object.hasOwn(quietFeed, field),
       "the absence reading still carries `" + field + "` — without it \"not in this feed\" " +
       "is a shrug rather than a reading a trader can size");
  }

  /* THE COVERAGE OF THE JOIN, ON THE PAYLOAD. If it reached two names in
     fifty, forty-eight cards will each say they are not in the feed; that is
     one thin join and the payload has to be able to say so rather than
     leaving forty-eight cards to read as forty-eight findings. */
  for (const feed of ["oiChange", "darkpool"]) {
    ok(!("coverage" in okCard.panels.marketRank.feeds[feed]),
       `the ${feed} reading does not carry its own copy of the join's coverage — one number ` +
       "in two places on one payload is two numbers that can disagree");
    const cov = okCard.panels.marketRank.coverage[feed];
    ok(cov && typeof cov.of === "number" && typeof cov.in === "number",
       `the ${feed} join publishes its own coverage as counts, not as a claim`);
    ok(cov.of > 0 && cov.in >= 0 && cov.in <= cov.of,
       `and the counts partition sensibly (${cov.in} of ${cov.of})`);
  }

  /* THE TIMING TRAP, ON THE WIRE. The vendor states the market-wide
     open-interest feed updates about 06:45 ET; this pipeline runs at 05:15
     ET. The emitted corpus is built to reproduce that — its feed dates
     itself to the session BEFORE the one the cards describe — so this
     asserts the payload can actually tell a reader the rank is not today's. */
  ok(okFeed.asOfStated === true && typeof okFeed.asOf === "string",
     "the market-wide feed publishes the session IT describes, from its own rows");
  eq(okFeed.sameSession, false,
     "and the corpus really exercises the timing trap: a 05:15 run joins the PREVIOUS " +
     "session's cross-section onto today's card, and the payload says so rather than " +
     "letting the card imply the ranking is today's");
  ok(okFeed.asOf < okCard.sessionDate,
     `the feed's session (${okFeed.asOf}) is genuinely earlier than the card's ` +
     `(${okCard.sessionDate})`);

  /* A RANK WITH NO POPULATION IS NOT A RANK. */
  ok(okFeed.rank >= 1 && okFeed.rank <= okFeed.population,
     `the published rank sits inside the published population (${okFeed.rank} of ${okFeed.population})`);
  ok(okFeed.unit !== null && okFeed.unitOne !== null,
     "and the value it ranked on carries a unit in both numbers — the singular is not the " +
     "plural with an s assumed off it");
}

/* ---------- the two market-wide keys with no renderer yet ------------

   REGISTERED BEFORE A RENDERER EXISTS, WHICH IS THE ONLY TIME IT IS CHEAP.

   Every other entry in this file was written after a renderer had already
   drifted from its publisher. These two keys are published by this wave and
   drawn by the next one, so the field vocabulary can be pinned while it is
   still free to fix. When the renderers land they join SURFACES above and the
   generic scan takes over; until then these blocks are what stops a field
   from being quietly renamed in the gap between the two waves.

   THE SCANS ABOVE CANNOT COVER THEM. That machinery extracts a renderer's
   reads from its source and holds them against the payload; with no renderer
   there is nothing to extract, and adding a SURFACES entry pointing at a file
   that does not draw the key would fail on the anti-vacuity guard rather than
   check anything. So these assert the publisher's side directly. */
{
  /* ---- the sector OPTIONS lean, which is not the sector momentum ---- */
  const p = emitted("sector:premium");
  ok(p && typeof p === "object",
     "the pipeline emits a sector:premium payload — the eleven sector option leans");
  ok(Array.isArray(p.sectors) && p.sectors.length === 11,
     `it publishes all eleven baskets under \`sectors\` (${p.sectors && p.sectors.length}), ` +
     "present whatever the vendor answered — a panel that quietly shrinks from eleven bars " +
     "to nine is how an outage goes unnoticed for a week");
  ok(!("rows" in p),
     "and NOT under `rows` — the name the sector renderer read for that panel's whole life " +
     "while the publisher wrote `sectors`, which is the regression this suite is named for");

  /* THE TWO SECTOR KEYS KEEP DISJOINT VOCABULARIES, AND THAT IS THE WHOLE
     POINT OF PUBLISHING TWO. sector:trix carries a triple-smoothed oscillator
     on daily closes; sector:premium carries today's option premium lean. They
     describe the same eleven baskets and may disagree for weeks. If one row
     shape ever carried both, a renderer could read `trix` off a premium row —
     or worse, a future edit could "unify" them and a momentum reading would
     start being drawn on a premium axis. The only fields they may share are
     the identity of the basket and its absence note. */
  const trix = emitted("sector:trix");
  const trixFields = new Set(Object.keys(trix.sectors[0]));
  const leanFields = new Set(Object.keys(p.sectors[0]));
  const shared = [...leanFields].filter((f) => trixFields.has(f)).sort();
  assert.deepEqual(shared, ["etf", "reason", "sector"],
    "the two sector row shapes share only the basket's identity and its absence note " +
    `(they share: ${shared.join(", ")})`); checks++;
  ok(!leanFields.has("trix") && !leanFields.has("trixBp"),
     "no momentum field rides on a premium row");
  ok(!trixFields.has("leanRatio") && !trixFields.has("netPremiumUsd"),
     "and no premium field rides on a momentum row");

  /* UNITS TRAVEL WITH THE NUMBERS. A ratio and a dollar difference must not
     share a field name, and here they cannot: the names carry the units and
     the payload restates them so a renderer never has to infer. */
  ok(leanFields.has("netPremiumUsd") && leanFields.has("leanRatio"),
     "the dollar difference and the dimensionless lean are two separate fields");
  eq(p.units.netPremiumUsd, "usd", "the payload states that netPremiumUsd is dollars");
  eq(p.units.leanRatio, "ratio", "and that leanRatio is dimensionless");
  ok(typeof p.lean.relation === "string" &&
     /leanRatio = netPremiumUsd \/ grossPremiumUsd/.test(p.lean.relation),
     "and publishes the relation, so a reader who disagrees can redo it from the two raw sums");

  /* THREE READINGS, THREE ARMS, ALL REACHED BY THE CORPUS. A dry run in which
     every sector succeeds certifies only the arm that never breaks. */
  const arm = (r) => p.sectors.filter((s) => s.read === r);
  ok(arm("ok").length > 0, "the corpus reaches a sector that leaned");
  ok(arm("quiet").length > 0, "a sector that was MEASURED and empty");
  ok(arm("unreadable").length > 0, "and a sector whose premium sums could not be read");

  /* THE MEASURED ZERO, WHICH IS THE HOUSE DEFECT IN ITS PUREST FORM. */
  const quiet = arm("quiet")[0];
  eq(quiet.netPremiumUsd, 0,
     "a sector where both premium sums were zero keeps a VISIBLE measured 0 for the dollar " +
     "difference — it traded nothing, which is a reading, not an absence");
  eq(quiet.leanRatio, null,
     "and a null ratio, because 0/0 is undefined rather than neutral: publishing 0 here would " +
     "put a sector where nothing traded on the same footing as one where a hundred million " +
     "dollars traded evenly on both sides");
  ok(typeof quiet.reason === "string" && /measured and empty/.test(quiet.reason),
     "and it says which silence it is in words, not only in a status");

  /* HALF A SUBTRACTION IS NOT A LEAN. */
  const half = arm("unreadable").find((s) =>
    (s.bullishPremiumUsd === null) !== (s.bearishPremiumUsd === null));
  ok(half, "the corpus reaches a sector that sent one premium sum and not the other");
  eq(half.netPremiumUsd, null, "the difference stays null when only one side arrived");
  eq(half.leanRatio, null, "and so does the ratio");
  ok(half.bullishPremiumUsd !== null || half.bearishPremiumUsd !== null,
     "while the side that DID arrive is still published — it was measured");

  /* EVERY ROW ANSWERS, WHATEVER HAPPENED. A renderer iterating eleven rows
     must never meet an undefined field. */
  for (const row of p.sectors) {
    for (const field of ["sector", "etf", "fullName", "bullishPremiumUsd", "bearishPremiumUsd",
                         "grossPremiumUsd", "netPremiumUsd", "leanRatio", "read", "reason"]) {
      ok(Object.hasOwn(row, field),
         `${row.etf}'s row carries \`${field}\` on every arm of the union`);
    }
    ok(["ok", "quiet", "unreadable"].includes(row.read),
       `${row.etf}'s read is one of the three the publisher defines (got ${row.read})`);
  }

  /* THE READ IS OURS, THE SESSION IS THE VENDOR'S. This route takes no date
     parameter at all, so a reader must be able to see that "today" here is
     the vendor's determination and not one the pipeline pinned. */
  ok(typeof p.readAt === "string" && !Number.isNaN(Date.parse(p.readAt)),
     "the payload says when WE read it");
  eq(p.vendorDated, false,
     "and says the vendor dated it, not us — /api/market/sector-etfs accepts no date parameter");
  ok(typeof p.notSameAs === "string" && /sector:trix/.test(p.notSameAs),
     "and names the key it must not be confused with, on the payload rather than only in a " +
     "comment no renderer reads");

  /* THE VENDOR MAY SEND MORE BASKETS THAN WE MAP. The response leads with SPY,
     which is not one of the eleven, so `returned` is deliberately not the
     sector count and the payload keeps both numbers. */
  /* THE LEG'S OWN STATUS USES THE THREE SILENCES TOO, not sector:trix's
     ok/unavailable pair — "the vendor answered with nothing" and "the vendor
     answered with rows we could not read" are the two states whose difference
     decides whether the market was quiet or our field names are wrong. */
  ok(["ok", "quiet", "unreadable"].includes(p.status),
     `the leg's status is one of the three silences (got ${p.status})`);
  eq(p.status, "ok", "and the corpus reaches the measured one");

  ok(p.returned >= p.sectors.length,
     `the wire row count (${p.returned}) is published beside the eleven sectors, because the ` +
     "vendor's response leads with SPY and a reader comparing the two would otherwise think " +
     "a basket had gone missing");
}

{
  /* ---- the news tape ---- */
  const n = emitted("news");
  ok(n && Array.isArray(n.rows), "the pipeline emits a news payload with a `rows` array");

  /* A LIST THAT TRUNCATES WITHOUT SAYING SO READS AS A POPULATION — so four
     counts, each answering a different question, and the corpus reaches the
     case where they disagree. */
  for (const field of ["requested", "returned", "kept", "cap", "capped", "shed",
                       "atVendorLimit", "unusable", "undatedKept", "undatedSeen"]) {
    ok(Object.hasOwn(n, field),
       `the payload carries \`${field}\` — without it a capped list reads as the population`);
  }
  eq(n.kept, n.rows.length, "`kept` is the length of what was actually published");
  ok(n.capped === true && n.shed > 0,
     `the corpus really exercises truncation (${n.shed} shed by the ${n.cap}-row cap) — a ` +
     "fixture that fitted inside the cap would leave the disclosure certified by nothing");
  eq(n.atVendorLimit, true,
     "and the vendor's own ceiling too: a full page means the true population is unknown and " +
     "at least that large, which is a DIFFERENT fact from our cap having shed rows we saw");
  ok(n.returned > n.kept, `and the two counts differ (${n.returned} returned, ${n.kept} kept)`);

  /* FRESHNESS: THE VENDOR'S STAMP ON EVERY ROW, OUR READ ON THE ENVELOPE. */
  ok(typeof n.readAt === "string" && !Number.isNaN(Date.parse(n.readAt)),
     "the payload says when WE read the tape, which is the load-bearing field on a stream " +
     "published by a once-a-day job");
  eq(n.refreshed, "nightly",
     "and says it is NOT intraday-refreshed, so a renderer states the age rather than " +
     "implying the headline just arrived");
  ok(typeof n.cadence === "string" && /05:15/.test(n.cadence),
     "and names the cadence behind that word");
  ok(typeof n.newest === "string" && typeof n.oldest === "string" && n.oldest <= n.newest,
     `the window the published rows cover is bounded from their own stamps ` +
     `(${n.oldest} .. ${n.newest})`);
  for (const row of n.rows) {
    ok(Object.hasOwn(row, "createdAt") && Object.hasOwn(row, "createdAtMs"),
       "every published row carries the vendor's own timestamp verbatim and our parse of it");
    ok(Object.hasOwn(row, "tickers") && Array.isArray(row.tickers),
       "and the ticker array that makes a per-name join a filter rather than a vendor call");
    ok(row.headline && typeof row.headline === "string",
       "and a headline, which is the row");
  }

  /* ORDERING IS OURS AND IS STATED. The cap is applied AFTER the sort, so
     `kept` means the newest sixty rather than the first sixty the vendor sent.
     The fixture hands them over shuffled precisely so this can fail. */
  eq(n.ordered, true, "the payload states that it ordered the rows");
  eq(n.orderedBy, "createdAt", "and by which field");
  eq(n.orderedDesc, true, "and in which direction");
  const dated = n.rows.map((r) => r.createdAtMs).filter((ms) => ms !== null);
  ok(dated.every((ms, i) => i === 0 || dated[i - 1] >= ms),
     "and the published rows really are newest-first — the cap is applied after the sort, so " +
     "`kept` is the newest sixty and not the first sixty the vendor happened to send");

  /* THE ONE THING NO PER-NAME LOOP MAY EVER BE WRITTEN FOR. */
  ok(typeof n.scope === "string" && /filter/.test(n.scope),
     "the payload says the route is market-wide and that `ticker` on it is a filter — the " +
     "warning that stops the next reader spending +50 calls on rows this one call returned");

  /* SIZE, AGAINST THE DOOR IT HAS TO FIT THROUGH. */
  const bytes = Buffer.byteLength(JSON.stringify(n));
  ok(bytes < 40 * 1024,
     `the capped tape is ${(bytes / 1024).toFixed(1)}KB, well inside the 128KB ` +
     "FLOWS_MAX_PAYLOAD_BYTES the ingest route accepts (worker.js) — the cap is a budget, " +
     "not a taste");
}

rmSync(dir, { recursive: true, force: true });

console.log(`✓ flows-payload-shape: ${checks} assertions — the publisher and the renderers ` +
  `checked against each other rather than against a fixture that agrees with both, every root ` +
  `field extracted from the renderer's own source so the two cannot drift, absences allowed ` +
  `only with a written reason, the sector regression pinned by name in both directions, and ` +
  `the card's panel-level renderers finally in scope: the market-wide join's drawer read ` +
  `against the panel the pipeline emits, on BOTH arms of its union, with the coverage of the ` +
  `join and the prior-session date of its ranking asserted on the wire, and the landing page ` +
  `whole rather than half of it: the score index, the seven verdict tiles, the spine and the ` +
  `closure that writes the region subtitles all read against the payloads they are handed — ` +
  `and the two market-wide keys whose renderers have not been written yet pinned on the ` +
  `publisher's side while that is still free to fix: the sector option lean's three reads ` +
  `and its measured zero, its vocabulary proven DISJOINT from the sector momentum key it ` +
  `must never be merged with, and the news tape's four counts, its stated ordering and the ` +
  `vendor stamp on every row beside the instant we read them`);
