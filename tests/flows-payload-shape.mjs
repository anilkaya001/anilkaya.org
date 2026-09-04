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
    ok(new RegExp("function\\s+\\w+\\s*\\([^)]*\\b" + v + "\\b[^)]*\\)").test(scope) || !surf.fn,
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

rmSync(dir, { recursive: true, force: true });

console.log(`✓ flows-payload-shape: ${checks} assertions — the publisher and the renderers ` +
  `checked against each other rather than against a fixture that agrees with both, every root ` +
  `field extracted from the renderer's own source so the two cannot drift, absences allowed ` +
  `only with a written reason, the sector regression pinned by name in both directions, and ` +
  `the card's panel-level renderers finally in scope: the market-wide join's drawer read ` +
  `against the panel the pipeline emits, on BOTH arms of its union, with the coverage of the ` +
  `join and the prior-session date of its ranking asserted on the wire`);
