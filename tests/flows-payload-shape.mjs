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
  const cards = readdirSync(dir).filter((f) => /^p-card-[A-Z0-9.]+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .filter((c) => c && c.engine && Array.isArray(c.engine.structures) && c.engine.structures.length);
  ok(cards.length > 0, `the dry run publishes cards whose engine block carries priced structures (${cards.length})`);
  const src = readFileSync(join(ROOT, "assets/js/flows-ticker.js"), "utf8");
  const start = src.indexOf("function engineIdea(");
  ok(start !== -1, "flows-ticker.js still defines engineIdea() — a rename silently stops this scan");
  const scope = src.slice(start, src.indexOf("\n  function ", start + 1));
  const reads = (v) => [...new Set([...scope.matchAll(new RegExp("\\b" + v + "\\.([A-Za-z_][A-Za-z0-9_]*)", "g"))]
    .map((m) => m[1]).filter((k) => !["find", "map", "join", "replace", "filter", "slice"].includes(k)))];
  const surfaces = [["eng", (c) => [c.engine]], ["st", (c) => c.engine.structures],
    ["pr", (c) => c.engine.structures.map((x) => x.prob)], ["ev", (c) => c.engine.structures.map((x) => x.ev)],
    ["l", (c) => c.engine.structures.flatMap((x) => x.legs)], ["f", (c) => c.engine.facts]];
  const missing = [];
  for (const [v, pick] of surfaces) {
    const keys = reads(v);
    ok(keys.length > 0, `engineIdea reads fields off \`${v}\` (${keys.join(", ")}) — zero reads would make this scan vacuous`);
    for (const c of cards) {
      for (const obj of pick(c)) {
        for (const k of keys) {
          if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, k)) { checks++; continue; }
          missing.push(`${c.ticker}: engineIdea reads \`${v}.${k}\` and the engine block has no such key`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    "every engine field the ticker's idea renderer reads by id is one the pipeline publishes:\n  " + [...new Set(missing)].join("\n  ")); checks++;
}

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
  const cardFiles = readdirSync(dir).filter((f) => /^p-card-(?!x-)/.test(f));
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

{
  const cardFiles = readdirSync(dir).filter((f) => /^p-card-(?!x-)/.test(f));
  const cards = cardFiles.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  ok(cards.every((c) => c.panels && c.panels.variation),
     "every emitted card carries the hedging panel, deep and cross-section alike");
  const full = cards.find((c) => c.panels.variation.status === "ok" && c.panels.variation.grid &&
    c.panels.variation.channels.vanna && c.panels.variation.channels.charm);
  ok(full, "an emitted card carries the hedging panel with every channel and its grid, so the full arm is measurable");

  const src = readFileSync(join(ROOT, "assets/js/flows-drawers.js"), "utf8");
  const start = src.indexOf("function renderVariation(");
  ok(start !== -1, "assets/js/flows-drawers.js still carries the hedging-flow drawer");
  const end = src.indexOf("function renderPremiumTrack(", start);
  const code = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/([^:])\/\/[^\n]*/g, "$1");
  const readsOf = (v) => {
    const out = new Set();
    for (const m of code.matchAll(new RegExp("\\b" + v + "\\.([A-Za-z_][A-Za-z0-9_]*)", "g"))) out.add(m[1]);
    return out;
  };
  const V = full.panels.variation;
  const TARGETS = [
    ["panel", V], ["inputs", V.inputs], ["ch", V.channels], ["v", V.variance], ["g", V.grid], ["c", V.conventions],
  ];
  const missing = [];
  for (const [name, obj] of TARGETS) {
    const reads = readsOf(name);
    ok(reads.size > 0, `the drawer reads fields off \`${name}\` (${reads.size} of them)`);
    const keys = new Set(Object.keys(obj || {}));
    if (name === "panel") keys.add("reason");
    for (const field of reads) {
      if (keys.has(field)) { checks++; continue; }
      missing.push(`renderVariation reads ${name}.${field}, and the emitted ${name} has only ${[...keys].sort().join(", ")}`);
    }
  }
  const ch = V.channels;
  for (const [key, fields] of [["gamma", ["perSigma", "pctAdv", "source"]], ["vanna", ["perPoint", "perSigma", "pctAdvPerPoint", "pctAdvPerSigma"]],
    ["charm", ["hedge", "pctAdv", "perSession"]]]) {
    for (const f of fields) {
      ok(Object.hasOwn(ch[key], f), `the drawer's ${key} bar reads channels.${key}.${f}, and the emitted channel carries it`);
    }
  }
  for (const f of ["rows", "cols", "cells", "volSilent"]) ok(Object.hasOwn(V.grid, f), `the grid carries ${f}`);
  ok(V.grid.rows.every((r) => "price" in r && "kS" in r && "linear" in r), "every grid row carries its price, its step and its linear flag");
  assert.deepEqual(missing, [], "every field the hedging drawer reads is one the pipeline writes:\n  " + missing.join("\n  ")); checks++;
  const bytes = Buffer.byteLength(JSON.stringify(V));
  ok(bytes < 8 * 1024, `the hedging panel is ${(bytes / 1024).toFixed(1)}KB of a card capped at 100KB`);
}

{
  const PANEL_FIELDS = {
    cone: ["asOf", "sameSession", "tenors", "iv30", "pct30", "coneShape", "richCheap", "view", "slope30_90", "front7_30",
      "slope30_90ExEvent", "xPct", "weights", "units", "silent"],
    rv: ["asOf", "sameSession", "bars", "from", "estimator", "cone", "yz", "pk21", "cc21", "gap", "breaks", "units", "silent"],
    vrp: ["asOf", "latest", "n", "hitRate", "meanRp", "medianRp", "rankOwn", "meanVariance", "exAnte", "garch", "series",
      "realizedSessions", "units", "silent"],
    term: ["asOf", "sameSession", "expiries", "earnings", "eventExpiry", "eventKink", "eventMove", "minSamples",
      "kinkThreshold", "units", "silent"],
    skew: ["asOf", "sameSession", "expiry", "dte", "dteFirst", "rr25", "rr10", "tail", "z", "zBasis", "zRaw", "z10", "z10Raw",
      "maturitySlope", "n", "mom5", "crash", "crashMedian", "xPct", "series", "rolled", "expirySource", "units", "silent"],
    ivDyn: ["asOf", "sameSession", "n", "iv", "volOfVol", "volOfVolRel", "changes", "halfLife", "phi", "longRun",
      "spotVolCorr", "rank", "pct", "vendorRank", "view", "units", "silent"],
    anomaly: ["asOf", "sameSession", "from", "score", "direction", "view", "sampleSize", "components", "signConsistency",
      "ours", "vote", "history", "units", "silent"],
    sentiment: ["asOf", "sameSession", "from", "score", "direction", "lean", "vwks", "avar", "components", "sampleSize",
      "z", "n", "ours", "vote", "history", "units", "silent"],
    character: ["asOf", "sameSession", "from", "character", "halfLifeDays", "hurst", "ar1B", "entropyNegative",
      "entropyConditional", "entropySamples", "sampleSize", "view", "ours", "vote", "history", "units", "silent"],
  };
  const ROW_FIELDS = {
    "cone.tenors": ["days", "iv", "min", "q1", "median", "q3", "max", "pct", "samples", "firstDate", "iqrPos", "rangePos",
      "lowSample", "rvWindow", "rvPct"],
    "rv.cone": ["n", "ivDays", "now", "count", "min", "p10", "p25", "p50", "p75", "p90", "max", "pct"],
    "term.expiries": ["expiry", "dte", "iv", "min", "q1", "median", "q3", "max", "pct", "pctRaw", "samples", "firstDate",
      "zShape", "fwd", "premium", "kink", "event", "eventFirst"],
  };
  const files = readdirSync(dir).filter((f) => /^p-card-x-/.test(f));
  const everyX = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  const dossiers = everyX.filter((d) => Object.hasOwn(d, "scope"));
  ok(everyX.filter((d) => !Object.hasOwn(d, "scope")).every((d) => !Object.hasOwn(d, "cone") &&
    ["short", "insiders", "earnings"].some((k) => Object.hasOwn(d, k)) && !Object.hasOwn(d, "gex")),
     "a card-x the vol leg did not write is an ownership-only dossier from the universe leg, not a vol dossier missing its envelope");
  const carded = readdirSync(dir).filter((f) => /^p-card-[A-Z]/.test(f)).map((f) => f.slice("p-card-".length, -".json".length));
  ok(carded.every((t) => dossiers.some((d) => d.ticker === t)), "every carded name has its vol dossier");
  ok(dossiers.length >= 100, `the dry run emits a card-x dossier per carded and index name (${dossiers.length})`);
  const byScope = (s) => dossiers.filter((d) => d.scope === s);
  ok(byScope("deep").length > 0 && byScope("carded").length > 0 && byScope("index").length === 3,
     "all three scopes are emitted: deep, carded and the three index names");
  const arms = {};
  for (const d of dossiers) {
    for (const k of ["v", "ticker", "scope", "sessionDate", "generatedAt", "fresh", "why"]) {
      ok(Object.hasOwn(d, k), `card-x:${d.ticker} carries its envelope field \`${k}\``);
    }
    for (const k of ["v", "readAt", "vendorAt", "source", "cadenceS", "session", "writer"]) {
      ok(Object.hasOwn(d.fresh, k), `and the freshness envelope's \`${k}\``);
    }
    for (const panel of Object.keys(PANEL_FIELDS)) {
      const p = d[panel];
      ok(p && ["ok", "quiet", "unavailable", "unreadable"].includes(p.status),
         `card-x:${d.ticker}.${panel} is present with one of the four statuses (got ${p && p.status})`);
      (arms[panel + ":" + p.status] ||= []).push(d.ticker);
      if (p.status === "ok") {
        for (const f of PANEL_FIELDS[panel]) {
          if (!Object.hasOwn(p, f)) missingReport.push(`card-x ${panel} (ok) lacks \`${f}\` on ${d.ticker}`);
          else checks++;
        }
      } else {
        ok(typeof p.code === "string" && typeof p.reason === "string" && p.asOf === null,
           `a silent ${panel} carries its code, its reason and no date (${d.ticker}: ${p.code})`);
        ok(Object.hasOwn(d.why, p.code), `and the dossier's legend explains ${p.code}`);
      }
      for (const code of Object.values((p && p.silent) || {})) {
        ok(Object.hasOwn(d.why, code), `a silenced ${panel} field's code ${code} is in the legend`);
      }
    }
    for (const [path, fields] of Object.entries(ROW_FIELDS)) {
      const [panel, key] = path.split(".");
      if (d[panel].status !== "ok") continue;
      for (const row of d[panel][key]) for (const f of fields) {
        if (!Object.hasOwn(row, f)) missingReport.push(`card-x ${path} row lacks \`${f}\` on ${d.ticker}`);
        else checks++;
      }
    }
    const bytes = Buffer.byteLength(JSON.stringify(d));
    ok(bytes < 60 * 1024, `card-x:${d.ticker} is ${(bytes / 1024).toFixed(1)}KB, leaving the other areas' panels room under the 100KB cap`);
  }
  for (const arm of ["cone:ok", "rv:ok", "vrp:ok", "term:ok", "term:unavailable", "skew:ok", "ivDyn:ok",
    "anomaly:ok", "anomaly:unavailable", "sentiment:ok", "sentiment:unreadable", "character:ok"]) {
    ok(arms[arm] && arms[arm].length > 0, `the corpus reaches the ${arm} arm`);
  }
  ok(byScope("carded").every((d) => ["term", "skew", "anomaly", "sentiment", "character"].every((k) => d[k].code === "not-read")),
     "a carded dossier says the deep-only reads were not made, rather than carrying empty panels");
  ok(byScope("index").every((d) => d.ivDyn.status === "ok"), "an index dossier reads its own 1y iv series");
  const dyn = byScope("deep").filter((d) => d.ivDyn.status === "ok").length;
  ok(dyn > byScope("deep").length / 2, `the deep dossiers carry IV dynamics from the card leg's 1y read (${dyn})`);

  const cardFiles = readdirSync(dir).filter((f) => /^p-card-(?!x-)/.test(f));
  const SUMMARY = ["v", "asOf", "iv30", "iv30Pct", "richCheap", "view", "coneShape", "slope30_90", "rv21", "rv21Pct", "yz21",
    "gap63", "vrp", "skew", "term", "ivDyn", "votes", "status"];
  for (const f of cardFiles) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    ok(c.x && c.x.vol, `${f} carries the compact vol summary at x.vol`);
    for (const k of SUMMARY) {
      if (!Object.hasOwn(c.x.vol, k)) missingReport.push(`card x.vol lacks \`${k}\` on ${c.ticker}`);
      else checks++;
    }
  }
  const regime = emitted("regime");
  ok(regime && regime.volRadar, "the pipeline emits a regime payload with the vol radar");
  for (const side of ["rich", "cheap", "bullish", "bearish"]) {
    const s = regime.volRadar[side];
    for (const k of ["status", "seen", "rows"]) ok(Object.hasOwn(s, k), `the radar's ${side} side carries \`${k}\``);
    const fields = side === "rich" || side === "cheap"
      ? ["t", "score", "n", "carded", "iv", "skew", "vov", "vrpZ", "regime", "crash"]
      : ["t", "score", "n", "carded", "vwks", "avar"];
    for (const row of s.rows) for (const k of fields) {
      if (!Object.hasOwn(row, k)) missingReport.push(`regime.volRadar.${side} row lacks \`${k}\``);
      else checks++;
    }
  }
  ok(Array.isArray(regime.volRadar.carded), "the radar lists the carded names it reaches");
  ok(Buffer.byteLength(JSON.stringify(regime)) < 60 * 1024, "and the regime stays inside its 60KB plan budget");
  assert.deepEqual(missingReport.filter((m) => /^card-x|^card x\.vol|^regime/.test(m)), [],
    "every field the vol contract publishes is on every emitted arm:\n  " +
    missingReport.filter((m) => /^card-x|^card x\.vol|^regime/.test(m)).slice(0, 20).join("\n  ")); checks++;
  const { FLOW_CODES, UNITS } = await import("../shared/flows-positioning.js");
  const cardX = readdirSync(dir).filter((f) => /^p-card-x-[A-Z]/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .filter((c) => Object.hasOwn(c, "depth"));
  const hists = readdirSync(dir).filter((f) => /^p-hist-[A-Z]/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  ok(cardX.length > 0 && hists.length === cardX.length,
     `the pipeline emits card-x and hist for the same names (${cardX.length} and ${hists.length})`);
  const PINNED = {
    gex: ["asOf", "n", "net", "usd1pct", "adv", "z", "pct", "regime", "persist", "longShare", "flips",
      "charm", "charmZ", "charmPct", "vanna", "vannaZ", "vannaPct", "u", "gaps"],
    volume: ["asOf", "n", "netPrem", "netPremZ", "netPremPct", "bullBear", "bullBearZ", "bullBearPct", "volume",
      "volumeZ", "volumePct", "pc", "pcZ", "pcPct", "oi", "oiSlope", "oiSlopeRel", "u", "gaps"],
    gexLevels: ["asOf", "spot", "callWall", "putWall", "magnet", "flip", "callWallAtr", "putWallAtr", "magnetAtr",
      "flipAtr", "nearby", "ambiguity", "ours", "flipGap", "flipAgree", "callWallAgree", "putWallAgree", "u", "gaps"],
    flowExpiry: ["asOf", "readAt", "netTotal", "grossTotal", "otmShare", "convictionDte", "convictionBucket", "mix", "rows", "u", "gaps"],
    flowStrike: ["asOf", "spot", "centroid", "centroidSigma", "longPeak", "shortPeak", "callWallFlow", "putWallFlow",
      "wallShare", "ladder", "u", "gaps"],
    nope: ["asOf", "close", "closeCheck", "fill", "high", "highM", "low", "lowM", "divergence", "z", "pct", "m", "x", "u", "gaps"],
    gexPath: ["asOf", "flowFilled", "open", "close", "change", "flips", "flipM", "flowFlips", "charmClose",
      "charmLastHour", "m", "px", "g", "f", "c", "u", "gaps"],
    contracts: ["rows"],
    dpLevels: ["asOf", "darkShare", "shelves", "profile", "u", "gaps"],
    alerts: ["asOf", "n", "complete", "prem", "askShare", "sweepShare", "openingShare", "callShare", "urgency", "dots", "u", "gaps"],
    multiLeg: ["asOf", "n", "truncated", "netPrem", "grossPrem", "netDelta", "netVega", "creditShare", "openingShare",
      "byStrategy", "top", "u", "gaps"],
    oiWalls: ["asOf", "callWall", "putWall", "callWallAtr", "putWallAtr", "calls", "puts", "pcOi", "u", "gaps"],
  };
  const seen = new Set();
  for (const c of cardX) {
    for (const f of ["v", "ticker", "sessionDate", "generatedAt", "depth", "fresh"]) {
      ok(Object.hasOwn(c, f), `card-x:${c.ticker} carries ${f}`);
    }
    for (const [key, fields] of Object.entries(PINNED)) {
      const s = c[key];
      if (!s) continue;
      ok(["ok", "stale", "quiet", "unavailable", "unreadable"].includes(s.status),
         `card-x:${c.ticker}.${key} is one arm of the silence union (got ${s.status})`);
      if (s.status !== "ok" && s.status !== "stale") {
        ok(s.why in FLOW_CODES, `card-x:${c.ticker}.${key} ${s.status} names a code the UI can explain (${s.why})`);
        continue;
      }
      seen.add(key);
      for (const f of fields) ok(Object.hasOwn(s, f), `card-x:${c.ticker}.${key} carries ${f} on its readable arm`);
      for (const unit of Object.values(s.u || {})) ok(unit in UNITS, `card-x:${c.ticker}.${key} unit ${unit} is declared`);
    }
    for (const row of (c.contracts && c.contracts.rows) || []) {
      for (const f of ["id", "cp", "k", "e", "status", "buildStart", "buildSessions", "askShareBuild", "d", "oi", "iv", "ask"]) {
        ok(Object.hasOwn(row, f), `card-x:${c.ticker} lifeline ${row.id} carries ${f}`);
      }
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(PINNED).sort(),
    "every pinned section is reached on its readable arm somewhere in the corpus"); checks++;
  for (const h of hists) {
    for (const f of ["v", "ticker", "sessionDate", "fresh", "d0", "dd", "gex", "volume", "u"]) {
      ok(Object.hasOwn(h, f), `hist:${h.ticker} carries ${f}`);
    }
    for (const [group, keys] of [["gex", ["g", "c", "v"]], ["volume", ["np", "bb", "vol", "pc", "oi"]]]) {
      for (const k of keys) {
        const p = h[group] && h[group][k];
        ok(p && Number.isInteger(p.s) && Array.isArray(p.x) && p.x.length === h.dd.length,
           `hist:${h.ticker}.${group}.${k} is a packed series on the shared axis`);
      }
    }
    ok(JSON.stringify(h).length <= 16 * 1024, `hist:${h.ticker} is inside its 16 KB budget`);
  }

  const u = emitted("universe");
  ok(u && u.status === "ok", "the pipeline emits a universe payload and it is readable");
  ok(Array.isArray(u.t) && u.t.length === u.n && u.n > 0, `universe.t names every column row (${u.n})`);
  ok(Array.isArray(u.sec) && u.sec.length === u.n && Array.isArray(u.sectors), "sectors travel as a dictionary and an index column");
  for (const [k, col] of Object.entries(u.cols)) {
    eq(col.length, u.n, `universe.cols.${k} has one cell per name`);
    ok(Array.isArray(u.units[k]) && typeof u.units[k][0] === "string" && u.units[k][1] !== 0,
      `universe.units.${k} states its unit and scale (${u.units[k]})`);
    ok(col.every((v) => v === null || Number.isInteger(v)), `universe.cols.${k} is scaled integers or null, never text`);
    ok(Number.isInteger(u.counts[k]) && u.counts[k] === col.filter((v) => v !== null).length,
      `universe.counts.${k} is the number of names carrying a value`);
  }
  for (const [k, col] of Object.entries(u.pct)) {
    ok(col.length === u.n && col.every((v) => v === null || (v >= 0 && v <= 100)), `universe.pct.${k} is 0..100 per name`);
  }
  ok(u.shock && Array.isArray(u.shock.v) && u.shock.v.length === u.n && /cross-sectional/.test(u.shock.rule),
    "the IV shock z is published with its cross-sectional rule");
  ok(Array.isArray(u.shed), "the universe says which columns it shed for its budget");
  ok(u.fresh && u.fresh.cadenceS === 0 && u.fresh.session === u.sessionDate && u.fresh.source === "nightly",
    "and carries the nightly freshness envelope");
  ok(Buffer.byteLength(JSON.stringify(u)) <= 100 * 1024, "inside its 100KB budget");

  const r = emitted("regime");
  ok(r && r.status === "ok", "the pipeline emits a regime payload");
  for (const k of ["volCurve", "zeroDte", "sectors", "etfTide", "fundFlows", "impliedCorrelation", "groups", "optionsPulse", "dailyReport"]) {
    ok(r[k] && typeof r[k].status === "string", `regime.${k} carries a status on every arm`);
  }
  eq(r.volCurve.vendor.reason, "plan_gated", "the VIX futures curve's 403 is a published silence, not an absence");
  ok(["SPY", "QQQ", "IWM"].every((t) => r.volCurve.byIndex[t] && r.volCurve.byIndex[t].status),
    "and the screener curve is published per index ETF");
  eq(r.sectors.rows.length, 11, "all eleven sector tides are listed, read or not");
  ok(r.fresh && r.fresh.cadenceS === 0, "regime carries the freshness envelope");
  ok(Buffer.byteLength(JSON.stringify(r)) <= 60 * 1024, "inside its 60KB budget");

  const e = emitted("events");
  for (const k of ["macro", "fda", "earningsCalendar", "catalysts", "history"]) {
    ok(e[k] && typeof e[k] === "object", `events gains ${k}`);
  }
  ok(Array.isArray(e.rows), "and keeps its rows, which the events renderer reads");
  ok(Buffer.byteLength(JSON.stringify(e)) <= 100 * 1024, "events stays well inside the ingest cap with its additions");

  const p = emitted("pulse");
  ok(p.totalsHistory && p.totalsHistory.status === "ok" && p.totalsHistory.n >= 60,
    "pulse.totalsHistory carries a year of sessions for its z");
  ok(p.totals && Array.isArray(p.totals.rows) && p.totals.rows.length <= 20,
    "while pulse.totals keeps the twenty sessions its renderers rank");

  const cx = readdirSync(dir).filter((f) => /^p-card-x-/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  ok(cx.length > 0, `the pipeline emits card-x payloads (${cx.length})`);
  for (const c of cx) {
    ok(typeof c.ticker === "string" && c.fresh && !("panels" in c), `card-x:${c.ticker} is its own key, not a card`);
    ok(c.scope === "index" || ["short", "insiders", "earnings"].some((k) => c[k]),
       `card-x:${c.ticker} carries at least one ownership part, unless it is an index dossier the vol leg alone writes`);
    ok(Buffer.byteLength(JSON.stringify(c)) <= 100 * 1024, `card-x:${c.ticker} fits its cap`);
  }

  for (const t of ["SPY", "QQQ", "IWM"]) {
    const card = emitted("card:" + t);
    ok(card && card.depth === "index", `card:${t} is an index dossier`);
    ok(card.panels && card.panels.gamma && card.panels.context, `card:${t} carries the card panels`);
  }

  const { LIVE_KEYS } = await import("../shared/flows-live.js");
  const live = (key) => {
    const file = join(dir, "p-" + key.replace(":", "-") + ".json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  };
  const SILENCES = new Set(["ok", "quiet", "unavailable", "unreadable", "prior", "pending"]);
  for (const key of Object.keys(LIVE_KEYS).filter((k) => LIVE_KEYS[k].writer === "actions")) {
    const p = live(key);
    ok(p && p.key === key, `the dry run emits ${key} — publisher-pinned until a renderer reads it`);
    ok(p.fresh && p.fresh.v === 1 && typeof p.fresh.readAt === "string" && p.fresh.source === "actions" &&
       p.fresh.cadenceS === LIVE_KEYS[key].cadenceS && p.fresh.session === p.session,
       `${key} carries the fresh envelope the Worker turns into X-Fresh-* headers`);
    ok(Buffer.byteLength(JSON.stringify(p)) <= LIVE_KEYS[key].maxBytes, `${key} is inside its registered cap`);
  }
  const b = live("live:breadth");
  for (const [sector, row] of Object.entries(b.sectors.rows)) {
    ok(SILENCES.has(row.status) && (row.status !== "ok" ||
       (row.ncp.length === b.sectors.t.length && row.npp.length === b.sectors.t.length && row.net.length === b.sectors.t.length)),
       `live:breadth ${sector} is aligned to the one shared time axis, or names its silence`);
  }
  ok(Object.hasOwn(b.dte.share, "value") && Object.hasOwn(b.dte.share, "reason"),
     "the 0DTE share carries its value beside the reason it may be null");
  const st = live("live:strips");
  ok(Object.values(st.rows).every((r) => r.length === st.fields.length) &&
     st.fields.every((f) => typeof st.units[f] === "string"),
     "every strip row is a column vector of the published fields, and every field names its unit");
  const se = live("live:strips:series");
  ok(Object.values(se.cols).every((col) => Object.values(col).every((a) => a.length === se.t.length)) &&
     ["px", "net", "gex", "iv"].every((c) => typeof se.scale[c] === "number"),
     "every series column has one value per read instant, and states the integer scale it is stored in");
  const al = live("live:alerts");
  for (const f of ["rows", "seen", "record", "readAt", "readDay", "refreshed", "vendorLimit", "readTruncated", "cursor"]) {
    ok(Object.hasOwn(al, f), `live:alerts carries \`${f}\` so the Worker can serve it in place of the nightly feed`);
  }
  eq(al.refreshed, "intraday", "and says it is the intraday union");
  const gx = live("live:gex");
  ok(Object.values(gx.names).every((n) => typeof n.readAt === "string" &&
     (!n.t || ["px", "gOi", "gVol", "gDir"].every((f) => n[f].length === n.t.length))),
     "every gamma name carries its own read time, and a series only when it was read this run");
  const tp = live("live:tape");
  ok(["totals", "netImpact", "darkpool"].every((f) => SILENCES.has(tp[f].status)),
     "each tape feed states its own silence");
  const vl = live("live:vol");
  ok(vl.vix.status === "unavailable" && typeof vl.vix.reason === "string", "the plan-gated VIX curve is named, not blank");
  const mv = live("live:movers");
  ok(typeof mv.basis === "string" && Array.isArray(mv.up) && Array.isArray(mv.down), "movers name their universe");
  const hb = live("live:heartbeat");
  ok(hb.run && Number.isInteger(hb.run.calls) && hb.run.keys && typeof hb.run.finishedAt === "string",
     "the heartbeat is the run's ledger: calls, bytes per key, and when it finished");
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
  `and the market-wide keys whose renderers have not been written yet pinned on the ` +
  `publisher's side while that is still free to fix: the sector option lean's three reads ` +
  `and its measured zero, its vocabulary proven DISJOINT from the sector momentum key it ` +
  `must never be merged with, and the news tape's four counts, its stated ordering and the ` +
  `vendor stamp on every row beside the instant we read them; and the volatility dossiers (card-x), the ` +
  `card's x.vol summary and the regime's vol radar pinned field by field on every arm they are emitted on; and the per-name card-x and hist ` +
  `keys pinned the same way, every section's readable arm, silence codes, units and packed series; and the live layer's ten Tier 2 ` +
  `keys pinned the same way: a fresh envelope on each, series aligned to their axes, units and ` +
  `scales stated, and every silence named`);
