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

  { key: "flowalerts", file: "assets/js/flows-unusual.js", fn: null, vars: ["alerts"] },
  { key: "pulse", file: "assets/js/flows-market.js", fn: "paintPulse", vars: ["pulse"] },

  { key: "political", file: "assets/js/flows-political.js", fn: null, vars: ["p"] },

  { key: "scoretrack", file: "assets/js/flows-overview.js", fn: "paintChanged", vars: ["payload"] },
  { key: "flowalerts", file: "assets/js/flows-overview.js", fn: "paintAlerts", vars: ["payload"] },
  { key: "events", file: "assets/js/flows-overview.js", fn: "paintEvents", vars: ["payload"] },
  { key: "board:watch", file: "assets/js/flows-overview.js", fn: "paintWatch", vars: ["payload"] },

  { key: "scoretrack", file: "assets/js/flows-overview.js", fn: "readTrack", vars: ["payload"] },

  { key: "market", file: "assets/js/flows-overview.js", fn: "paintVerdict", vars: ["market"] },

  { key: "board:long", file: "assets/js/flows-overview.js", at: "const poolCount = (payload)",
    to: "\n  };", label: "poolCount", vars: ["payload"] },
  { key: "flowalerts", file: "assets/js/flows-overview.js", fn: "paintVerdict", vars: ["alerts"] },

  { key: "board:long", file: "assets/js/flows-overview.js", fn: "boardsRead", vars: ["long"] },
  { key: "board:short", file: "assets/js/flows-overview.js", fn: "boardsRead", vars: ["short"] },

  { key: "board:long", file: "assets/js/flows-overview.js", fn: "renderSpine", vars: ["payload"] },

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

const OPTIONAL = {

  "sector:trix": { status: "the worker's pending envelope carries it; the payload also does" },

  pulse: { status: "the worker's pending envelope carries it" },

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

    const next = src.indexOf("\n  function ", start + 1);
    scope = src.slice(start, next === -1 ? src.length : next);
  } else if (surf.at) {

    const start = src.indexOf(surf.at);
    ok(start !== -1,
       `${surf.file} still carries the block anchored at \`${surf.at}\` — if it moved or was ` +
       "reworded, this scan silently stopped checking that payload and the move must update " +
       "SURFACES");
    const end = surf.to ? src.indexOf(surf.to, start + 1) : -1;
    scope = src.slice(start, end === -1 ? src.length : end);
  }

  for (const v of surf.vars) {

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

  const code = scope.replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/([^:])\/\/[^\n]*/g, "$1");

  const re = new RegExp("\\b(" + surf.vars.join("|") + ")\\.([A-Za-z_][A-Za-z0-9_]*)", "g");
  const reads = new Set();
  let m;
  while ((m = re.exec(code)) !== null) reads.add(m[2]);

  const selfAssigned = new Set();
  for (const v of surf.vars) {
    const asg = new RegExp("\\b" + v + "\\.([A-Za-z_][A-Za-z0-9_]*)\\s*=(?!=)", "g");
    let a;
    while ((a = asg.exec(code)) !== null) selfAssigned.add(a[1]);
  }

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

  const body = paint.slice(0, paint.indexOf("\n  function "))
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/([^:])\/\/[^\n]*/g, "$1");
  ok(/sectors\.sectors/.test(body),
     "paintSectors reads sectors.sectors");
  ok(!/sectors\.rows/.test(body),
     "and no `rows` fallback was left behind — a fallback lets the payload and the renderer " +
     "drift apart again in silence, which is the only reason this survived a live run");

  ok(/status === "pending"/.test(body),
     "an unpublished key is told apart from a measured emptiness — before, a pending payload " +
     "and eleven settled sectors printed the same sentence");
  const historyClaim = body.indexOf("No sector carried enough history");
  const measuredGuard = body.indexOf("if (!measured.length)");
  ok(historyClaim > measuredGuard && measuredGuard !== -1,
     "and the sentence that claims no sector settled sits BEHIND the check that readings were " +
     "actually published, so it can only be said once it is true");
}

{
  const cardFiles = readdirSync(dir).filter((f) => /^p-card-/.test(f));
  ok(cardFiles.length > 0, "the pipeline emitted cards for the panel scan to read");
  const cards = cardFiles.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

  const withRank = cards.filter((c) => c.panels && c.panels.marketRank);
  eq(withRank.length, cards.length,
     "every emitted card carries a marketRank panel — a panel published on SOME cards is a " +
     "renderer branch that only fails on the names nobody checked");

  const src = readFileSync(join(ROOT, "assets/js/flows-ticker.js"), "utf8");
  const start = src.indexOf("function drawMarketRank(");
  ok(start !== -1,
     "assets/js/flows-ticker.js still carries the marketRank drawer — if it was " +
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

  ok(readsOf("f").size >= 10,
     `the scan found the drawer's feed-field reads (${readsOf("f").size} of them) — zero ` +
     "would mean the block moved and this whole section is checking nothing");
  ok(readsOf("panel").size >= 3,
     `and its panel-field reads (${readsOf("panel").size} of them)`);

  const panelKeys = new Set(Object.keys(okCard.panels.marketRank));

  panelKeys.add("reason");
  for (const field of [...readsOf("panel")].sort()) {
    ok(panelKeys.has(field),
       `the marketRank drawer reads panel.${field} and the emitted panel carries it ` +
       `(it has: ${[...panelKeys].sort().join(", ")})`);
  }

  const okFeed = okCard.panels.marketRank.feeds.oiChange;
  const absentFeed = quietCard.panels.marketRank.feeds.oiChange;
  const feedKeys = new Set([...Object.keys(okFeed), ...Object.keys(absentFeed)]);
  for (const field of [...readsOf("f")].sort()) {
    ok(feedKeys.has(field),
       `the drawer reads f.${field} on a feed reading and the publisher writes it on some ` +
       `arm of the union (they carry: ${[...feedKeys].sort().join(", ")})`);
  }

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

  ok(okFeed.asOfStated === true && typeof okFeed.asOf === "string",
     "the market-wide feed publishes the session IT describes, from its own rows");
  eq(okFeed.sameSession, false,
     "and the corpus really exercises the timing trap: a run joins the vendor's morning " +
     "update, which here describes the PREVIOUS " +
     "session's cross-section, onto today's card, and the payload says so rather than " +
     "letting the card imply the ranking is today's");
  ok(okFeed.asOf < okCard.sessionDate,
     `the feed's session (${okFeed.asOf}) is genuinely earlier than the card's ` +
     `(${okCard.sessionDate})`);

  ok(okFeed.rank >= 1 && okFeed.rank <= okFeed.population,
     `the published rank sits inside the published population (${okFeed.rank} of ${okFeed.population})`);
  ok(okFeed.unit !== null && okFeed.unitOne !== null,
     "and the value it ranked on carries a unit in both numbers — the singular is not the " +
     "plural with an s assumed off it");
}

{

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

  ok(leanFields.has("netPremiumUsd") && leanFields.has("leanRatio"),
     "the dollar difference and the dimensionless lean are two separate fields");
  eq(p.units.netPremiumUsd, "usd", "the payload states that netPremiumUsd is dollars");
  eq(p.units.leanRatio, "ratio", "and that leanRatio is dimensionless");
  ok(typeof p.lean.relation === "string" &&
     /leanRatio = netPremiumUsd \/ grossPremiumUsd/.test(p.lean.relation),
     "and publishes the relation, so a reader who disagrees can redo it from the two raw sums");

  const arm = (r) => p.sectors.filter((s) => s.read === r);
  ok(arm("ok").length > 0, "the corpus reaches a sector that leaned");
  ok(arm("quiet").length > 0, "a sector that was MEASURED and empty");
  ok(arm("unreadable").length > 0, "and a sector whose premium sums could not be read");

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

  const half = arm("unreadable").find((s) =>
    (s.bullishPremiumUsd === null) !== (s.bearishPremiumUsd === null));
  ok(half, "the corpus reaches a sector that sent one premium sum and not the other");
  eq(half.netPremiumUsd, null, "the difference stays null when only one side arrived");
  eq(half.leanRatio, null, "and so does the ratio");
  ok(half.bullishPremiumUsd !== null || half.bearishPremiumUsd !== null,
     "while the side that DID arrive is still published — it was measured");

  for (const row of p.sectors) {
    for (const field of ["sector", "etf", "fullName", "bullishPremiumUsd", "bearishPremiumUsd",
                         "grossPremiumUsd", "netPremiumUsd", "leanRatio", "read", "reason"]) {
      ok(Object.hasOwn(row, field),
         `${row.etf}'s row carries \`${field}\` on every arm of the union`);
    }
    ok(["ok", "quiet", "unreadable"].includes(row.read),
       `${row.etf}'s read is one of the three the publisher defines (got ${row.read})`);
  }

  ok(typeof p.readAt === "string" && !Number.isNaN(Date.parse(p.readAt)),
     "the payload says when WE read it");
  eq(p.vendorDated, false,
     "and says the vendor dated it, not us — /api/market/sector-etfs accepts no date parameter");
  ok(typeof p.notSameAs === "string" && /sector:trix/.test(p.notSameAs),
     "and names the key it must not be confused with, on the payload rather than only in a " +
     "comment no renderer reads");

  ok(["ok", "quiet", "unreadable"].includes(p.status),
     `the leg's status is one of the three silences (got ${p.status})`);
  eq(p.status, "ok", "and the corpus reaches the measured one");

  ok(p.returned >= p.sectors.length,
     `the wire row count (${p.returned}) is published beside the eleven sectors, because the ` +
     "vendor's response leads with SPY and a reader comparing the two would otherwise think " +
     "a basket had gone missing");
}

{

  const n = emitted("news");
  ok(n && Array.isArray(n.rows), "the pipeline emits a news payload with a `rows` array");

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

  ok(typeof n.readAt === "string" && !Number.isNaN(Date.parse(n.readAt)),
     "the payload says when WE read the tape, which is the load-bearing field on a stream " +
     "published by a once-a-day job");
  eq(n.refreshed, "nightly",
     "and says it is NOT intraday-refreshed, so a renderer states the age rather than " +
     "implying the headline just arrived");
  ok(typeof n.cadence === "string" && /after the close/.test(n.cadence) &&
     /21:30 UTC/.test(n.cadence) && !/05:15/.test(n.cadence),
     "and names the cadence behind that word — the post-close schedule the workflow " +
     "actually fires on, not the 05:15 one that fired 4.5 to 6.6 hours late every weekday");
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

  eq(n.ordered, true, "the payload states that it ordered the rows");
  eq(n.orderedBy, "createdAt", "and by which field");
  eq(n.orderedDesc, true, "and in which direction");
  const dated = n.rows.map((r) => r.createdAtMs).filter((ms) => ms !== null);
  ok(dated.every((ms, i) => i === 0 || dated[i - 1] >= ms),
     "and the published rows really are newest-first — the cap is applied after the sort, so " +
     "`kept` is the newest sixty and not the first sixty the vendor happened to send");

  ok(typeof n.scope === "string" && /filter/.test(n.scope),
     "the payload says the route is market-wide and that `ticker` on it is a filter — the " +
     "warning that stops the next reader spending +50 calls on rows this one call returned");

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
  `whole rather than half of it: the score index, the five verdict tiles and the caption that carries the two readings they shed, the spine and the ` +
  `closure that writes the region subtitles all read against the payloads they are handed — ` +
  `and the two market-wide keys whose renderers have not been written yet pinned on the ` +
  `publisher's side while that is still free to fix: the sector option lean's three reads ` +
  `and its measured zero, its vocabulary proven DISJOINT from the sector momentum key it ` +
  `must never be merged with, and the news tape's four counts, its stated ordering and the ` +
  `vendor stamp on every row beside the instant we read them`);
