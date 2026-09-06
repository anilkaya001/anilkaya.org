/* =============================================================
   flows-ticker-contract.mjs — /flows/ticker/, in a real browser.

   THE PANEL THIS PAGE EXISTS FOR HAD NEVER BEEN DRAWN. Four chain
   panels have been published in every card since the chain leg
   shipped and no renderer touched them, which is a defect no test
   could have caught: every payload assertion passed, every byte was
   on the wire, and the product simply did not show them. The
   registry assertions below are the ones that would have.

   ON FIXTURES. Every card here starts as one the pipeline's OWN
   emitter produced — the rule tests/flows-sections-contract.mjs
   states as "the fixture crosses the wire boundary". Where a state
   does not occur in any emitted card, the fixture is an emitted card
   with ONE NAMED FIELD MUTATED, and the mutation is the point of the
   test. A fixture written from the same assumption as the code
   proves only that the assumption is self-consistent; this repo has
   paid for that five times.
   ============================================================= */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import {
  TICKER_PANELS, TICKER_PANEL_KEYS, SENTINEL_KEYS, TICKER_GROUPS, PANEL_TIERS,
  STATION_SIDE_COUNTS,
} from "../shared/flows-panels.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ---------- fixtures: real emitted cards ------------------------- */

/* The emitter writes one file per card. Running it here rather than
   committing a fixture is what keeps "the fixture crosses the wire boundary"
   true as the payload evolves — a committed card would freeze the schema of
   the day it was captured. */
const EMIT_DIR = path.join(ROOT, "tests", ".ticker-emit");
fs.rmSync(EMIT_DIR, { recursive: true, force: true });
fs.mkdirSync(EMIT_DIR, { recursive: true });
const { execFileSync } = await import("node:child_process");
execFileSync(process.execPath,
  [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", EMIT_DIR + "/"],
  { stdio: "ignore" });

const cards = fs.readdirSync(EMIT_DIR)
  .filter((f) => f.startsWith("-card-"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(EMIT_DIR, f), "utf8")));
ok(cards.length >= 5, `the emitter produced ${cards.length} cards to test against`);

/* CHECKED HERE BECAUSE THE FILTER BELOW LEANS ON IT: it demands every
   TICKER_PANEL_KEYS key on a card, so a leaked sentinel matches no card and
   the suite dies on "0 do", a sentence about the chain leg.

   AND IT IS A TAUTOLOGY FOR ONE DRIFT, A REAL CHECK FOR THE OTHER: since
   TICKER_PANEL_KEYS is DERIVED by filtering on SENTINEL_KEYS, shrinking that
   set cannot fire it. It catches the registry gaining a __key nobody added to
   SENTINEL_KEYS — which is the drift that actually happens. */
for (const k of SENTINEL_KEYS) {
  ok(!TICKER_PANEL_KEYS.includes(k), `the sentinel "${k}" is not a card.panels key`);
}

const withChain = cards.filter((c) =>
  TICKER_PANEL_KEYS.every((k) => c.panels && c.panels[k]) &&
  ["ivSurface", "skewTerm", "topContracts", "aggressor"]
    .every((k) => c.panels[k].status === "ok"));
ok(withChain.length > 0,
   `at least one emitted card carries all four chain panels (${withChain.length} do)`);

const truncated = cards.filter((c) =>
  c.panels && c.panels.ivSurface && c.panels.ivSurface.coverage &&
  c.panels.ivSurface.coverage.truncated === true);

/* ---------- 1. registry integrity, before any browser ------------- */
{
  /* THE DRAW TABLE AND THE REGISTRY MUST NAME THE SAME PANELS, in both
     directions. A drawer with no registry entry never mounts and is dead code
     nobody notices; a registry entry with no drawer is a panel that renders a
     visible "no renderer is registered" notice, which is survivable but is a
     bug. Parsed from the source because DRAW lives inside the controller's
     IIFE — the invariant is a source-level one, and reading it out of a
     running page would only prove the page ran. */
  const src = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
  const block = src.slice(src.indexOf("const DRAW = {"));
  const drawBody = block.slice(0, block.indexOf("\n  };"));
  const drawKeys = new Set(
    [...drawBody.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));

  const regKeys = new Set(TICKER_PANELS.map((p) => p.key));
  for (const k of regKeys) {
    ok(drawKeys.has(k), `registry panel "${k}" has an entry in the controller's DRAW table`);
  }
  for (const k of drawKeys) {
    ok(regKeys.has(k), `DRAW entry "${k}" is a panel the registry actually mounts`);
  }
  eq(drawKeys.size, regKeys.size, "the two panel lists are the same size");

  /* AND THE CHROME TABLE, THE SAME WAY AND FOR A NEWER REASON. PANEL_CHROME
     used to WRITE data-group and data-tier, so the rendered DOM WAS the table.
     The worker emits both now and the table only CHECKS — so the DOM
     comparison further down would pass with this table wrong, the only symptom
     a console error nothing reads. Read out of the source instead. */
  const chromeBlock = src.slice(src.indexOf("const PANEL_CHROME = {"));
  const chromeBody = chromeBlock.slice(0, chromeBlock.indexOf("\n  };"));
  const chrome = new Map(
    [...chromeBody.matchAll(
      /^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*group:\s*"([a-z]+)",\s*tier:\s*"([a-z]+)"/gm)]
      .map((m) => [m[1], { group: m[2], tier: m[3] }]));
  eq(chrome.size, TICKER_PANELS.length,
     `the controller's chrome table names every registry panel (${chrome.size} of ` +
     `${TICKER_PANELS.length}) — an entry that stopped parsing would silently shrink this ` +
     `comparison rather than fail it`);
  for (const p of TICKER_PANELS) {
    const got = chrome.get(p.key);
    ok(got, `the controller's chrome table has an entry for "${p.key}"`);
    if (!got) continue;
    eq(got.group, p.group, `and puts "${p.key}" in the registry's group`);
    eq(got.tier, p.tier, `and gives "${p.key}" the registry's tier`);
  }
  for (const key of chrome.keys()) {
    ok(regKeys.has(key),
       `the chrome entry "${key}" is a panel the registry mounts — an entry for a panel that ` +
       `is not on the page makes mountChrome report a disagreement on every paint`);
  }

  /* ---------- the pairing, checked without a browser -----------------
     A GRID ROW IS AS TALL AS ITS TALLEST MEMBER, so two panels sharing a row
     share a height whether or not they have that much to say. Which panels
     are adjacent in this registry therefore decides how much blank ground the
     page opens, and that made the order a matching problem rather than a
     preference. Measured intrinsic heights (six names x four widths, mounted
     with the stretch removed) put today's worst row mismatch at 704px; the
     order this file now carries measures 233px.

     THE HEIGHTS ARE CHECKED IN, AND THAT IS THE COMPROMISE THIS ASSERTION
     MAKES. They are a property of what each panel draws, so they can drift
     from the table below without anything here noticing — a renderer that
     grows a panel by 300px would not fail this check. What it does catch is
     the thing that actually happens: somebody reorders the registry for an
     editorial reason and silently reintroduces a mismatch nobody measured.
     Re-derive the table with tests/_rows.mjs when a drawer changes shape.

     NO BROWSER, DELIBERATELY. This is arithmetic over a list, so it runs in
     milliseconds and fails with the two panel names in the message — which is
     what makes it usable while somebody is editing the order. */
  const PANEL_H = {
    __stats: 330, levels: 313, displacement: 360, context: 350, scoreOverlay: 506,
    deltaExposure: 416, charm: 435, vanna: 435, congress: 632, calendar: 520,
    aggressor: 550, pricedMove: 584, surface: 668, ivSurface: 640, oiDeltas: 661,
    marketRank: 865, path: 712, darkpool: 688, gamma: 795, skewTerm: 829,
    volContext: 756, topContracts: 1044, __score: 1034,
  };
  eq(Object.keys(PANEL_H).length, TICKER_PANELS.length,
     `the measured-height table covers every registry panel (${Object.keys(PANEL_H).length} ` +
     `of ${TICKER_PANELS.length}) — a panel missing from it would be skipped by the pairing ` +
     `check below rather than fail it`);
  for (const p of TICKER_PANELS) {
    ok(Object.hasOwn(PANEL_H, p.key), `the height table knows "${p.key}"`);
  }
  /* THE LIMIT IS 200, AND ONE STATION IS EXEMPT BY NAME.
     Every pairing this file can reach now measures 172px or less. 200 leaves
     a drawer room to grow without a false failure and refuses the 704px and
     482px pairings this order was chosen to end.

     `context` IS EXEMPT AT 515px AND THE EXEMPTION IS THE POINT. Three rules
     already argued in shared/flows-panels.js pin that station's order —
     `context` is its group's lead so it comes first, `marketRank` must sit
     directly under it (asserted below), and `congress` is the only other
     member — and every ordering that fixes the 515px stretch breaks one of
     them. So the number is recorded here rather than quietly accommodated by
     a limit loose enough to swallow it: an editorial decision would be needed
     to close it, and a test is not entitled to make one. If the station's
     order changes, this exemption's own assertion fails and somebody has to
     decide again. */
  const PAIR_LIMIT = 200;
  const EXEMPT = { context: 515 };
  eq(TICKER_PANELS.filter((p) => p.group === "context").map((p) => p.key).join(","),
     "context,marketRank,congress",
     "the context station still holds the order its 515px exemption was granted for — " +
     "change it and the exemption is void, because it was granted to THIS arrangement " +
     "and not to the station");
  for (const g of TICKER_GROUPS) {
    const limit = EXEMPT[g.key] || PAIR_LIMIT;
    /* Span-2 panels own their row, so they never share a height with anyone;
       at two columns the rest pair off in registry order. */
    const solo = TICKER_PANELS.filter((p) => p.group === g.key && p.span !== 2);
    for (let i = 0; i + 1 < solo.length; i += 2) {
      const [a, b] = [solo[i], solo[i + 1]];
      const gap = Math.abs(PANEL_H[a.key] - PANEL_H[b.key]);
      ok(gap <= limit,
         `${g.key}: "${a.key}" (${PANEL_H[a.key]}px) and "${b.key}" (${PANEL_H[b.key]}px) are ` +
         `row-mates at two columns, so the shorter is stretched ${gap}px — past the ${limit}px ` +
         `a panel can fill honestly. Reorder the station, or widen the panel whose layout ` +
         `can absorb width (see the span note in shared/flows-panels.js — widening the TALL ` +
         `one is the obvious move and it is usually the wrong one)`);
    }
    /* NO "THE ODD ONE OUT MUST BE THE SHORTEST" RULE, and dropping it was a
       finding rather than a concession. It follows from the UNCONSTRAINED
       matching optimum, and this registry is not unconstrained: three argued
       adjacency contracts and the lead-is-first rule pin most of the order
       already. In `context` the shortest panel is the lead and must come
       first, so the rule and the contracts cannot both hold — and the
       contracts are the ones with reasons written next to them. The pair
       limit above is what survives, because it constrains the thing that
       actually hurts a reader. */
  }

  /* Every registry key other than the score sentinel names a real payload
     panel. This is the assertion that would have caught four published,
     served, undrawn panels. */
  for (const card of withChain) {
    for (const k of TICKER_PANEL_KEYS) {
      ok(Object.hasOwn(card.panels, k),
         `${card.ticker}: the emitted card carries panel "${k}"`);
    }
  }
  /* NEITHER SENTINEL LEAKS INTO THE PAYLOAD-KEY LIST, asserted over the SET
     rather than one string because the exclusion used to read `!== SCORE_KEY`
     — a shape that admits the second sentinel silently. The failure that
     produces is the misleading part, and it was measured: with `__stats` in
     TICKER_PANEL_KEYS the fixture filter finds no usable card and the suite
     dies at "all four chain panels (0 do)", about the chain leg on a run where
     it is fine. Hence the same exclusion above that filter, where it fails
     first; the rest of the contract is here. */
  eq(SENTINEL_KEYS.size, 2,
     "the registry declares both sentinels — the score derivation and the key statistics");
  for (const key of SENTINEL_KEYS) {
    ok(TICKER_PANELS.some((p) => p.key === key),
       `the sentinel "${key}" is a panel the registry actually mounts`);
    ok(!TICKER_PANEL_KEYS.includes(key),
       `and "${key}" is excluded from the payload-key list — it is drawn from the card's ` +
       `top level or from the other panels, never from card.panels["${key}"], so a card ` +
       `that does not carry it is not a card that is missing anything`);
  }

  /* ---------- AND THE OTHER DIRECTION, which is the one that was missing.

     The assertion above catches a registry entry with no payload behind it.
     It does NOT catch the reverse — a panel the pipeline publishes on every
     card that no registry entry mounts — and that is the failure this file's
     own header describes: four chain panels shipped for weeks, on the wire,
     costing vendor calls, and simply not drawn.

     It happened again while this suite was passing. `vanna`, `charm` and
     `deltaExposure` were added to buildCard, published on every emitted card,
     and reached no page. Nothing failed, because nothing looked this way.

     A panel may be published and undrawn only by being named below, with a
     reason. That keeps the omission an argued decision rather than the silent
     default it was. The list is empty today and that is the point: every
     panel this pipeline pays for is on a page. */
  const DELIBERATELY_UNDRAWN = new Map([
    /* e.g. ["someKey", "why the ticker page is not where this belongs"] */
  ]);
  for (const card of withChain) {
    for (const key of Object.keys(card.panels)) {
      if (DELIBERATELY_UNDRAWN.has(key)) continue;
      ok(TICKER_PANEL_KEYS.includes(key),
         `${card.ticker}: published panel "${key}" is mounted by the registry — a panel on ` +
         `the wire that no page draws is a vendor call nobody reads`);
    }
  }
  for (const [key, why] of DELIBERATELY_UNDRAWN) {
    ok(typeof why === "string" && why.length > 20,
       `the exemption for "${key}" states a real reason rather than a placeholder`);
    ok(!TICKER_PANEL_KEYS.includes(key),
       `and "${key}" is genuinely not in the registry — a stale exemption is a comment ` +
       `that has stopped being true`);
  }

  /* Ids are unique, or getElementById silently returns the first and one
     panel draws into another's box. */
  const ids = TICKER_PANELS.map((p) => p.id);
  eq(new Set(ids).size, ids.length, "every registry id is unique");
  for (const p of TICKER_PANELS) {
    ok(p.question && p.question.trim().length > 8, `panel "${p.key}" states a real question`);
    ok(p.title && p.title.trim().length > 2, `panel "${p.key}" has a title`);
    ok(p.span === 1 || p.span === 2, `panel "${p.key}" has a legal span`);
  }

  /* THE ALIGNMENT REQUIREMENT AND THE LAYOUT MUST NOT MAKE EACH OTHER
     IMPOSSIBLE. The term line's j-th bar centre has to coincide with the
     surface's j-th column centre, which can only hold if the two panels mount
     at the SAME host width — so both must be span 2 and adjacent. At span 1
     and span 2 the hosts are 424px and 896px at a 1216px viewport and no
     amount of arithmetic in either drawer could align them. */
  const iIvs = TICKER_PANELS.findIndex((p) => p.key === "ivSurface");
  const iTerm = TICKER_PANELS.findIndex((p) => p.key === "skewTerm");
  eq(TICKER_PANELS[iIvs].span, 2, "the IV surface spans both columns");
  eq(TICKER_PANELS[iTerm].span, 2, "and so does the term line, or they can never align");
  eq(iTerm, iIvs + 1, "and they are adjacent, so they mount at the same width");

  /* THE THREE WAVE-2 STOCK PANELS ARE SINGLE-COLUMN BY CONTRACT: the
     landscape tiers (two columns at 76rem, three at 110rem) slot them as
     single cells, and a span-2 entry here would silently re-argue that
     layout from the registry. */
  for (const key of ["darkpool", "oiDeltas", "volContext"]) {
    const p = TICKER_PANELS.find((x) => x.key === key);
    ok(p, `the registry mounts the ${key} panel`);
    eq(p.span, 1, `${key} is a single-column panel at every landscape tier`);
  }

  /* The pipeline's shed ladder drops panels by key when a card is over the
     100KB self-check. A key it can shed that the registry does not mount
     would be shed into a panel nobody draws. */
  const pipe = fs.readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8");
  /* THE SLICE IS THE LADDER'S OWN DECLARATION, AND IT USED NOT TO BE — this
     block read `pipe.slice(indexOf("dropped to fit the payload cap") - 400,
     indexOf("shed ") + 200)`, which looks like a window around the ladder and
     is not: "shed " matches inside "publi_shed under_" 431KB EARLIER, so the
     end index came out below the start and slice returned "". Every assertion
     here was made zero times. Anchored on the code now, and COUNTED below. */
  const shedFrom = pipe.indexOf("const shed = [");
  ok(shedFrom > 0, "the pipeline still declares its shed ladder as `const shed = [`");
  const shedBlock = pipe.slice(shedFrom, pipe.indexOf("\n      ];", shedFrom));
  /* THE KEY PATTERN ADMITS AN UNDERSCORE ON PURPOSE. It was [a-zA-Z]+, which
     cannot match `__stats` at all — so a sentinel added to the ladder would
     not have failed this assertion, it would have been INVISIBLE to it, and
     the ladder would have gone on naming a key it can never drop. A guard
     whose pattern excludes the shape it is guarding against is not a guard. */
  let shedNamed = 0;
  for (const m of shedBlock.matchAll(/\[\s*"([A-Za-z_][A-Za-z0-9_]*)",\s*"dropped to fit/g)) {
    shedNamed++;
    ok(regKeys.has(m[1]), `the pipeline's shed ladder only names registry panels ("${m[1]}")`);
    /* AND NEVER A SENTINEL. Shedding is `card.panels[key] = {status:
       "unavailable", …}` on a card over the 100KB cap; a sentinel has no
       card.panels entry, so the ladder would INVENT one — an unavailability
       for a panel the pipeline does not publish, saving no bytes, telling
       every reader a panel drawn from the top level was dropped to fit. */
    ok(!SENTINEL_KEYS.has(m[1]),
       `and never a sentinel ("${m[1]}") — there is no card.panels entry for it to shed, ` +
       `so a drop would fabricate an unavailability and save nothing`);
  }
  ok(shedNamed >= 5,
     `the shed ladder was actually read (${shedNamed} entries) — a slice that stopped ` +
     `matching passes this block by making none of it`);
}

/* ---------- the browser ------------------------------------------ */

const pageHTML = FLOWS_PAGES.tickerPage({ username: "test" })
  .replace(/<script[^>]*><\/script>/g, "");
const panelsSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-panels.js"), "utf8");
const tickerSrc = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");

/* ---------- ONE FOLD, ONE LEAD, ONE FILE --------------------------

   THE DISCLOSURE AND THE PROMOTED READING WERE BORN HERE, in flows-ticker.js,
   because /flows/ticker/ was the only page that had them. They now live in
   flows-panels.js, which this route and three others load and which the card
   dialog draws from — so the twelve renderers that led with their method can
   fold it, and a panel cannot fold on the page while staying unfolded in the
   dialog that draws the same function.

   THIS IS A SOURCE-LEVEL ASSERTION ON PURPOSE, and it is the one thing the
   runtime cannot show. A second `<details class="ft-how">` built in this file
   would draw an identical panel and pass every rendering assertion below it,
   and would then be a second answer to "how long is a wall" — the failure
   flows-panels.js's own header was written against when 2,040 lines were
   nearly copied rather than moved. A duplicate a test compares is a
   projection; a duplicate a test cannot see is a drift. */
{
  ok(/class="ft-how"|"ft-how"/.test(panelsSrc),
     "flows-panels.js builds the disclosure — it is the module both the ticker grid and the " +
     "card dialog draw through, so the fold is available on all four routes that load it");
  eq((tickerSrc.match(/el\("details", "ft-how"\)/g) || []).length, 0,
     "and flows-ticker.js builds none of its own; it destructures appendMethod out of P " +
     "instead, so the wall threshold is decided in exactly one place");
  for (const name of ["appendMethod", "leadReading"]) {
    ok(new RegExp("panelHead, panelWidth, [^\\n]*" + name).test(panelsSrc),
       `flows-panels.js exports ${name} on window.FlowsPanels — an export that goes missing ` +
       "fails here rather than only on the page that consumes it");
  }
  ok(/appendMethod, leadReading,\n  \} = P;/.test(tickerSrc),
     "and flows-ticker.js reads both back out of the module rather than restating them");
  /* THE ADAPTER IS ALLOWED AND THE COPY IS NOT. appendNotes stays here because
     the eight drawers below own plain prose; it holds no threshold and no
     <details> of its own, which is exactly what the two assertions above
     measure. */
  ok(/function appendNotes\(host, notes, summary\) \{\n\s*appendMethod\(/.test(tickerSrc),
     "the string-shaped appendNotes that stayed is a four-line adapter over the moved " +
     "appendMethod, not a second implementation of the fold");
  ok(!/NOTE_WALL_CHARS/.test(tickerSrc),
     "and the wall threshold itself is not restated in this file at all — two numbers named " +
     "\"how long is too long\" is two answers a reader would have to reconcile");
}

/* ---------- THE STRUCTURE IS IN THE SERVED BYTES ------------------

   READ OFF THE STRING, BEFORE A BROWSER EXISTS, because that is the claim.
   Everything below used to be built by assets/js/flows-ticker.js on first
   paint — headings, index, every panel's group and tier — so a reader with a
   slow card got 23 identical boxes in no sections. A browser assertion cannot
   tell "served" from "built in the first frame"; this runs no script. */
{
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const served = FLOWS_PAGES.tickerPage({ username: "test" });

  eq((served.match(/<section class="ft-station"/g) || []).length, TICKER_GROUPS.length,
     `the served page carries all ${TICKER_GROUPS.length} stations`);
  for (const g of TICKER_GROUPS) {
    ok(served.includes(`id="ftst-${g.key}" role="tabpanel"`),
       `station ${g.key} is served as a tabpanel with its own id`);
    ok(served.includes(`data-group="${g.key}" data-side="${g.key}"`),
       `and carries both its registry group and its ?s= address (${g.key})`);
    ok(served.includes(esc(g.blurb)),
       `and the group's own sentence is in the bytes (${g.key}) — not fetched, not built`);
    ok(served.includes(`>${esc(g.label)} <span`),
       `and its tab prints the label (${g.label})`);
  }

  for (const p of TICKER_PANELS) {
    /* THE QUESTION, VISIBLE, IN THE DOCUMENT. It was already a data-question
       attribute, which no reader can see, and drawn by the renderer after the
       card landed. Both still are; this is the only copy before the fetch. */
    ok(served.includes(`<p class="ft-panel-q">${esc(p.question)}</p>`),
       `panel ${p.key}'s question is served as visible prose, not only as an attribute`);
    ok(served.includes(`data-question="${esc(p.question)}"`),
       `and still as the attribute the drawers are handed (${p.key})`);
    ok(served.includes(`data-group="${p.group}" data-tier="${p.tier}"`),
       `panel ${p.key} is served already in its group and tier`);
    ok(served.includes(`id="panel-${p.key}"`),
       `and with the fragment id a link names it by (${p.key}), so a deep link resolves ` +
       `before any script runs`);
    ok(served.includes(`<p class="ft-panel-one" id="${p.id}One"></p>`),
       `panel ${p.key} carries an EMPTY one-line slot — a placeholder with words in it is ` +
       `a sentence a reader would believe`);
    const marked = new RegExp(
      `id="panel-${p.key}"[\\s\\S]{0,200}?data-sentinel`).test(served);
    eq(marked, SENTINEL_KEYS.has(p.key),
       `panel ${p.key} is marked data-sentinel exactly when the registry says so — the ` +
       `browser cannot import SENTINEL_KEYS, so this is how the walk knows not to tell a ` +
       `reader their card "predates" a panel no payload has ever carried`);
  }

  /* `.fc-q` is what a RENDERER emits; one in the served bytes would mean a
     pre-drawn panel, and the visible question above a duplicate. */
  ok(!served.includes('class="fc-q"'),
     "no renderer's own question is in the served bytes — the served copy stands alone " +
     "until a card lands");

  /* THE BAND: SEVEN SLOTS, EACH ONCE, EACH EMPTY, EACH HIDDEN. Emitted now so
     PR 4 fills slots rather than inventing them; it costs no height until
     then, and .ft-band carries no margin either. */
  for (const id of ["ftFrom", "ftSector", "ftAtr", "ftRankNav", "ftFind", "ftPrem", "ftEarn"]) {
    eq((served.match(new RegExp(`id="${id}"`, "g")) || []).length, 1,
       `the band slot ${id} is served exactly once`);
    /* The element's own attribute list, id to end of start tag — never a
       fixed character window, which is how the first draft of this assertion
       read a `hidden` belonging to the NEXT element. */
    const at = served.indexOf(`id="${id}"`);
    const close = served.indexOf(">", at);
    const attrs = served.slice(at, close);
    ok(/\bhidden\b/.test(attrs),
       `and ${id} is served hidden — a VISIBLE empty slot claims a measurement was taken ` +
       `and came back with nothing, a different fact from "not yet painted"`);
    ok(!/\bvalue=/.test(attrs), `and carries no value of its own (${id})`);
    /* AND IT IS EMPTY. `ftFind` is an <input>, which is void and has no
       content to be empty of — its emptiness is the missing `value` above. */
    if (id !== "ftFind") {
      eq(served.slice(close + 1, close + 3), "</",
         `and ${id} is served with nothing inside it`);
    }
  }
  ok(served.includes('<datalist id="ftFindNames"></datalist>'),
     "the find box's datalist is served empty beside it");
  ok(served.includes('id="ftBar"') && served.includes('class="ft-tabs" role="tablist"'),
     "the sticky bar and its tablist are served rather than built on first paint");
}

/**
 * Mount the real page markup, stub the two fetches, and let the real
 * controller paint a real card.
 *
 * THE FETCH IS STUBBED, NOT THE CONTROLLER. Feeding a card straight into a
 * private paint() hook would skip readTicker, the 401 branch, the pending
 * discrimination and the header wiring — every part of this file that decides
 * WHICH state the reader gets. The stub answers the two real endpoints.
 */
async function mount(page, card,
                     { ticker = null, boards = null, hash = "", events = null,
                       html = null, station = "all" } = {}) {
  await page.addInitScript(({ card, boards, events }) => {
    window.__requested = [];
    window.fetch = (url) => {
      window.__requested.push(String(url));
      /* THE TWO SIDES ARE DIFFERENT REQUESTS, and answering both with the
         same payload double-counts every name in the picker — which is a
         defect in this stub, not in the page. `boards` stands for the LONG
         side; the short side answers empty unless a test says otherwise. */
      const u = String(url);
      /* THE FUNNEL IS ITS OWN ENDPOINT and must be answered as one: it carries
         no "side", so without this arm it fell through to the short board and
         answered every gated-name question with an empty board payload. */
      const body = u.includes("/api/flows/card")
        ? card
        : u.includes("/api/flows/events")
          ? (events || { rows: [], status: "pending" })
          : (u.includes("side=long") ? (boards || { rows: [], status: "pending" })
                                     : { rows: [], status: "pending" });
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => String(Date.now()) },
        json: () => Promise.resolve(JSON.parse(JSON.stringify(body))),
      });
    };
  }, { card, boards, events });
  /* THE HASH IS PART OF THE URL THE READER WAS SENT, so it has to be on the
     goto rather than assigned afterwards: the controller reads it once the
     card has painted, and a hash set after load would test a different code
     path from the one a pasted link exercises. */
  /* ?s= IS PART OF THAT URL TOO. The stations switch, so which one is open is
     an address a reader can be sent, and a test that set it after load would
     exercise the tab handler rather than the arriving-reader path.

     IT DEFAULTS TO `all`, AND THAT IS NOT A CONVENIENCE. Every check in this
     file older than the switcher was written against a page holding all 23
     panels in one document: they click a zoom button on `gamma`, measure a
     chart in `tape`, read a silence in `context`. `?s=all` IS that page — the
     same markup, the same widths, the same draw — so defaulting to it leaves
     53 mounts asserting exactly what they asserted before, rather than 53
     rewrites each of which could quietly weaken one.

     WHAT THAT LEAVES UNCOVERED IS THE PAGE A READER ACTUALLY ARRIVES ON, so
     section 2b passes `station: null` to get the default address and asserts
     there: one station open, the right one, its charts at one-to-one, and the
     deep link, Back and unknown-?s= paths. A reader's first screen is checked
     in exactly one place, deliberately, rather than assumed in fifty-three. */
  const query = [
    ticker ? "t=" + encodeURIComponent(ticker) : null,
    station ? "s=" + encodeURIComponent(station) : null,
  ].filter(Boolean).join("&");
  const url = "https://example.test/flows/ticker/" +
    (query ? "?" + query : "") + (hash ? "#" + hash : "");
  /* `html` IS FOR ONE THING ONLY: serving DELIBERATELY WRONG markup, so a
     check that exists to notice it can be proven to. Everyone else gets the
     page the worker emits. */
  await page.route("**/*",
    (route) => route.fulfill({ contentType: "text/html", body: html || pageHTML }));
  await page.goto(url);
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/base.css") });
  await page.addStyleTag({ path: path.join(ROOT, "assets/css/flows.css") });
  await page.addScriptTag({ content: panelsSrc });
  await page.addScriptTag({ content: tickerSrc });
  await page.waitForFunction(() => {
    const g = document.getElementById("ftGrid");
    return g && (!g.hidden || document.getElementById("ftStatus").textContent !== "Loading the name…");
  }, null, { timeout: 5000 });
}

/** Every panel's rendered state, read out of the DOM rather than from source. */
function sweepPanels() {
  const out = [];
  for (const section of document.querySelectorAll(".ft-panel[data-panel]")) {
    const host = section.querySelector("div");
    /* DECORATIVE SVGs ARE EXCLUDED, and the exclusion is the aria-hidden
       attribute the markup already sets rather than a size heuristic. The
       path panel's legend swatches are 26x10 marks that mean nothing on
       their own and are correctly hidden from the accessibility tree; an
       aria-label on one would make a screen reader announce a colour chip. */
    const svgs = [...host.querySelectorAll("svg")]
      .filter((s) => s.getAttribute("aria-hidden") !== "true");
    const decorative = [...host.querySelectorAll('svg[aria-hidden="true"]')];
    let minText = Infinity, clipped = false;
    for (const svg of svgs) {
      const box = svg.getBoundingClientRect();
      for (const t of svg.querySelectorAll("text")) {
        const r = t.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.height > 0) minText = Math.min(minText, r.height);
        /* TWO PIXELS, not zero. Text metrics carry sub-pixel rounding and a
           glyph's ink box is not its advance box, so a strict edge test
           reports overhang on captions that are visually flush. */
        if (r.left < box.left - 2 || r.right > box.right + 2) clipped = true;
      }
    }
    out.push({
      key: section.dataset.panel,
      question: section.dataset.question || "",
      /* THE QUESTION THE DRAWER PRINTED, not the one the markup carries. The
         two are different facts and only the second was ever read here: a
         drawer handed the CARD where it expected the question stringifies it
         into its own heading and the attribute stays perfect. */
      drawnQ: host.querySelector(".fc-q") ? host.querySelector(".fc-q").textContent : "",
      dead: !!host.querySelector(".fc-dead"),
      empty: host.childElementCount === 0,
      wide: section.classList.contains("is-wide"),
      boxW: Math.round(section.getBoundingClientRect().width),
      /* THE HOST'S OWN WIDTH, REPORTED SO A FAILURE NAMES ITS CAUSE.
         Every drawing is sized from this number (panelWidth reads the host's
         box), so when the 1:1 scale assertion below breaks, the question is
         always "did the host change width?" — and until this was carried out
         of the page, answering it meant re-running the sweep by hand. It is
         the measurement the .fc-panel flex-column rule is checked against.
         Floored, not rounded, because panelWidth() floors: rounding here
         would report a 282.6px host as 283 and disagree with the drawing by
         a pixel that is only in this file. */
      hostW: Math.floor(host.getBoundingClientRect().width),
      /* Is the panel's table bounded, and did bounding it lose a row? Both
         halves are needed: a scroller that fits everything proves nothing,
         and a bound that truncated would look identical from the outside. */
      wrapBound: [...host.querySelectorAll(".fc-tablewrap")].map((w) => [
        Math.round(w.scrollHeight), Math.round(w.clientHeight),
        w.querySelectorAll("tbody tr").length,
      ]),
      minText: minText === Infinity ? null : Math.round(minText * 10) / 10,
      clipped,
      /* UNROUNDED. The assertion downstream is "within a pixel", so rounding
         here would hand it a number already a half-pixel off and turn its own
         tolerance into a second one. */
      scales: svgs.map((s) => {
        const vb = (s.getAttribute("viewBox") || "").split(/\s+/);
        return [Number(vb[2]), s.getBoundingClientRect().width,
                getComputedStyle(s).transform];
      }),
      labelled: svgs.every((s) => !!s.getAttribute("aria-label") && s.getAttribute("role") === "img"),
      unlabelled: svgs.filter((s) => !s.getAttribute("aria-label")).length,
      svgCount: svgs.length,
      /* A decorative mark must carry NEITHER a role nor a label, or it is
         announced twice — once as itself and once as part of its caption. */
      decorativeClean: decorative.every(
        (s) => !s.getAttribute("aria-label") && s.getAttribute("role") !== "img"),
    });
  }
  return out;
}

const browser = await chromium.launch();
try {
  /* ---------- 2. every panel renders, at all three widths ---------- */
  /* 1840px is past the 110rem tier, where the grid opens its third column;
     every assertion in this loop — no clipped type, no sideways scroll, one
     viewBox unit one CSS pixel — must hold there too. */
  for (const width of [320, 1280, 1840]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    /* EVERY STATION IN FLOW, BECAUSE THE INVARIANT IS ABOUT EVERY PANEL. The
       stations switch now, so on the default address four of the five are
       `hidden` and a hidden element measures a zero-width box — which is what
       this sweep saw the first time it ran against the switcher: "320px gamma:
       drawn 282, rendered 0.00". That is not a chart at the wrong scale, it is
       a chart with no box, and asserting one-to-one against it would be
       asserting nothing. `?s=all` is the address that puts all five back, and
       it is the same layout the page had before a station could hide, so what
       this loop measures is unchanged. The switcher's own effect on scale is
       asserted separately, below, on the station that IS open. */
    await mount(page, card, { ticker: card.ticker, station: "all" });

    eq(errors.length, 0, `${width}px: the ticker page paints a real card without throwing (${errors.join("; ")})`);

    const swept = await page.evaluate(sweepPanels);
    eq(swept.length, TICKER_PANELS.length, `${width}px: every registry panel is mounted`);

    for (const p of swept) {
      /* NO PANEL IS SILENTLY BLANK. An empty host is neither a chart nor an
         explanation — it is the one state a reader cannot tell from a broken
         page, and it is exactly what an unhandled tagged-union branch makes. */
      ok(!p.empty, `${width}px ${p.key}: renders content or an explicit unavailable notice`);
      ok(p.question.length > 0, `${width}px ${p.key}: its question reached the DOM`);

      /* NO PANEL HEADS ITSELF WITH A STRINGIFIED OBJECT.

         DRAW calls every drawer as (host, panel, card, question, mount) on the
         argument that "the widest signature is safe for all of them", which
         holds only while every drawer DECLARES that order. renderOverlay was
         declared (host, join, questionIn), so the CARD landed in the question
         slot and "Score over price" printed "[object Object]" as its question
         on every ticker page, for every name. The attribute was perfect
         throughout, which is why the assertion above could not see it. */
      ok(!p.drawnQ.includes("[object"),
         `${width}px ${p.key}: the question it DREW is a sentence, not a stringified ` +
         `object ("${p.drawnQ.slice(0, 56)}")`);
      eq(p.drawnQ, p.question,
         `${width}px ${p.key}: draws the registry's question verbatim — the one this ` +
         "page's markup handed it, not the drawer's own hardcoded fallback, which is how " +
         "one drawing wore two different questions while a card dialog drew these same " +
         "renderers with no question at all");
      if (p.dead) continue;

      if (p.minText !== null) {
        ok(p.minText >= 8,
           `${width}px ${p.key}: axis type renders at its intended size (${p.minText}px)`);
      }
      eq(p.clipped, false, `${width}px ${p.key}: draws no text outside its own canvas`);
      if (p.svgCount) {
        ok(p.labelled,
           `${width}px ${p.key}: every non-decorative chart carries role=img and an ` +
           `aria-label (${p.unlabelled} without one)`);
      }
      ok(p.decorativeClean,
         `${width}px ${p.key}: decorative marks stay out of the accessibility tree`);

      /* ONE VIEWBOX UNIT IS ONE CSS PIXEL. A viewBox fixed in absolute units
         under width:100% scales the type down with the drawing — 9px axis
         type became 4.6 CSS px on the card panels, silently, because nothing
         overflows when everything shrinks together.

         WITHIN A PIXEL, NOT WITHIN 15%. The old band let both known failures
         through: the card dialog's 1.023 stretch, and a 0.940 SQUEEZE this
         band was written over — panelWidth floored every drawing at 300 units
         and a 320px viewport gives this page a 282px host, so all twelve
         charts were shrunk by base.css's `svg { max-width: 100% }` and the
         suite called it one-to-one. A tolerance wide enough to hold a defect
         is not a measurement of the invariant it names. Subpixel either way
         is layout rounding; anything more is a drawing at the wrong scale. */
      for (const [vb, rendered, transform] of p.scales) {
        ok(vb > 0, `${width}px ${p.key}: the chart declares a viewBox width`);
        ok(Math.abs(rendered - vb) < 1,
           `${width}px ${p.key}: one viewBox unit is one CSS pixel — drawn ${vb}, ` +
           `rendered ${rendered.toFixed(2)} (${(rendered / vb).toFixed(4)})`);
        eq(transform, "none", `${width}px ${p.key}: the chart is drawn, never CSS-scaled`);
        /* AND THE DRAWING NEVER OUTGREW THE HOST IT SITS IN.
           NOT `vb === hostW`. That was this assertion's first form and the
           suite refused it inside a minute: volContext draws a 220-unit strip
           into a 454px host on purpose, and several panels size a mark to its
           content rather than to the box. Drawing at full host width is a
           choice a renderer makes, not an invariant — so asserting it would
           have pinned a preference and called it a contract.

           What IS an invariant is the direction. base.css gives every svg
           `max-width: 100%`, so a drawing WIDER than its host is not clipped
           and does not overflow: it is silently scaled down, and one viewBox
           unit stops being one CSS pixel with nothing on the page to show it.
           The scale check above cannot see it either — viewBox and rendered
           width still agree, because the shrink moves both.

           This is the assertion the .fc-panel flex-column rule is checked
           against. A column flex item's cross size is the container's content
           box, the same used width a block child had; if that ever stops
           being true the host narrows under a drawing already measured
           against the old number, and this is the line that says so. */
        ok(vb <= p.hostW + 1,
           `${width}px ${p.key}: the drawing is never wider than its host, or ` +
           `max-width:100% shrinks it and one unit stops being one pixel — ` +
           `viewBox ${vb}, host ${p.hostW}`);
      }

      /* A TABLE THAT SHARES A ROW IS BOUNDED, AND BOUNDING IT LOST NOTHING.
         Both halves, because either alone passes on a defect: a scroller that
         happens to fit everything proves no bound exists, and a bound that
         had truncated its list would look identical from outside the box.
         `congress` is why the rule exists — 464px to 1371px across ten names,
         a 2.95x swing on a span-1 panel whose row-mates are `context` (350px)
         and `marketRank`. Span-2 panels are exempt in the stylesheet and so
         are exempt here: they own their row, so their length costs no one. */
      if (!p.wide) {
        for (const [scrollH, clientH, rows] of p.wrapBound) {
          ok(clientH <= 417,
             `${width}px ${p.key}: a span-1 panel's table is bounded, so its ` +
             `row-mates are not stretched by a vendor's row count (${clientH}px)`);
          if (scrollH > clientH) {
            ok(rows > 0,
               `${width}px ${p.key}: the bounded table still holds its rows — ` +
               `bounded is not truncated (${rows} row(s) in ${scrollH}px of scroll)`);
          }
        }
      }
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, `${width}px: the page itself never scrolls sideways (${overflow}px over)`);

    /* THE WIDE PANELS REALLY SPAN, above the breakpoint. Below it every panel
       is one column and the comparison is meaningless. */
    if (width >= 1280) {
      const wide = swept.filter((p) => p.wide);
      const narrow = swept.filter((p) => !p.wide);
      ok(wide.length > 0 && narrow.length > 0, "1280px: the grid mixes wide and narrow panels");
      const narrowW = Math.max(...narrow.map((p) => p.boxW));
      for (const p of wide) {
        ok(p.boxW > narrowW * 1.8,
           `1280px ${p.key}: is-wide really spans both columns (${p.boxW} vs ${narrowW})`);
      }
      /* The alignment precondition, measured rather than assumed. */
      const ivs = swept.find((p) => p.key === "ivSurface");
      const term = swept.find((p) => p.key === "skewTerm");
      ok(Math.abs(ivs.boxW - term.boxW) <= 1,
         `1280px: the surface and the term line mount at the same width (${ivs.boxW} vs ${term.boxW})`);

      /* THE COLUMNS THEMSELVES LINE UP — and the assertion is written the way
         it is because the obvious form of it is ILL-FORMED on the case this
         page was built for.

         The spec claimed skewTerm.points IS ivSurface.expiries in the same
         order, citing shared/flows-chain.js, where it is true. The PIPELINE
         then splices two different calls together: on a truncated chain it
         keeps the broad-call ivSurface and replaces skewTerm wholesale with a
         second single-expiry read (flows-pipeline.mjs, the recovery leg). The
         two panels stop sharing a column list at exactly that point —
         measured, freshly emitted: 8 surface expiries against 1 term point.
         A per-index sweep of both arrays is then comparing different things,
         not failing.

         So the term drawer borrows the surface's column POSITIONS by matching
         expiry, never its levels, and what is asserted here is what a reader
         can actually see: every term column centre sits on a surface column
         centre. On the spliced card that is one marker under the right
         column; on a clean card it is all of them. */
      const align = await page.evaluate(() => {
        const xs = (sel, attr) => [...document.querySelectorAll(sel)]
          .map((n) => Number(n.getAttribute(attr)))
          .filter((v) => Number.isFinite(v));
        return {
          surface: xs('.ft-panel[data-panel="ivSurface"] text.fts-exp', "x"),
          term: xs('.ft-panel[data-panel="skewTerm"] .ftm-dot', "cx"),
        };
      });
      ok(align.surface.length > 0, "1280px: the surface draws column heads to align against");
      if (align.term.length) {
        for (const cx of align.term) {
          const nearest = Math.min(...align.surface.map((x) => Math.abs(x - cx)));
          ok(nearest <= 1,
             `1280px: a term marker at ${cx.toFixed(1)} sits on a surface column ` +
             `(nearest ${nearest.toFixed(2)}px)`);
        }
      }
    }

    /* THE 110rem TIER. The shell caps content at 78rem, so the third column
       buys DENSITY rather than width: three tracks inside the same content
       box, every span-1 host still above the 300 chart floor, and .is-wide
       still `1 / -1` across all three — the same span rule, not a new one. */
    if (width >= 1840) {
      /* READ OFF A STATION, NOT OFF #ftGrid: the track list moved down a
         level with the five <section>s, and .ft-grid's computed
         grid-template-columns is "none" now, so this would count zero. */
      const tracks = await page.evaluate(() =>
        [...document.querySelectorAll(".ft-station")].map((s) =>
          getComputedStyle(s).gridTemplateColumns
            .split(" ").filter((t) => parseFloat(t) > 0).length));
      eq(tracks.join(","), new Array(TICKER_GROUPS.length).fill(3).join(","),
         `${width}px: every station opens its third column at the 108rem tier (${tracks})`);
    }
    await page.close();
  }

  /* ---------- 2b. the stations SWITCH -------------------------------

     THE READER THIS REPLACED WAS 11,468px OF SCROLL at 1440 and 19,978px at
     390 — 23 panels stacked, and a tab row that anchored into them rather
     than switching between them, so choosing Convexity moved the reader four
     thousand pixels and left the other four stations underneath. These
     assertions are about the switch itself; section 2 above measures the
     drawing, which is why it asks for ?s=all.

     THE ONE THING THAT COULD GO WRONG SILENTLY is scale. A panel drawn while
     its station is hidden measures a zero-width host, and base.css's
     `svg { max-width: 100% }` would then paint it at whatever size it landed
     at without overflowing anything. So the last assertion here is the same
     one-to-one rule section 2 applies, taken on the station that is actually
     open on the DEFAULT address, where four stations are hidden. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker, station: null });
    eq(errors.length, 0,
       `the switcher paints without throwing (${errors.join("; ")})`);

    const shown = () => page.evaluate(() => {
      const out = { open: [], hidden: [], selected: [], current: [], url: location.search };
      for (const s of document.querySelectorAll(".ft-station[data-group]")) {
        (s.hidden ? out.hidden : out.open).push(s.dataset.group);
      }
      for (const a of document.querySelectorAll("#ftBar [data-side]")) {
        if (a.getAttribute("aria-selected") === "true") out.selected.push(a.dataset.side);
        if (a.getAttribute("aria-current") === "true") out.current.push(a.dataset.side);
      }
      return out;
    });

    const first = await shown();
    eq(first.open.length, 1,
       `on arrival exactly one station is in the document (${first.open.join(", ") || "none"})`);
    eq(first.hidden.length, 4,
       `and the other four are out of it (${first.hidden.length} hidden)`);
    eq(first.selected.join(","), first.open[0],
       `the tab marked selected is the station that is open (${first.selected.join(",")} vs ${first.open[0]})`);

    /* A CLICK SWITCHES, AND DOES NOT SCROLL TO SOMETHING FOUR THOUSAND PIXELS
       DOWN — the station it names is the only one left in the flow. */
    await page.click('.ft-tab[data-side="convexity"]');
    const after = await shown();
    eq(after.open.join(","), "convexity",
       `clicking a tab makes its station the only one open (${after.open.join(", ")})`);
    ok(after.url.includes("s=convexity"),
       `and the URL says which station a reader is looking at (${after.url})`);

    /* BACK IS AN UNDO, because a click is an act. The scroll observer replaces
       its entry instead, or Back would walk a reader through every station
       they merely scrolled past. */
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector(
      '.ft-station[data-group="convexity"]') || document.querySelector(
      '.ft-station[data-group="convexity"]').hidden, null, { timeout: 4000 });
    const back = await shown();
    eq(back.open.join(","), first.open[0],
       `Back returns to the station the reader came from (${back.open.join(", ")})`);

    /* ?s=all IS THE WAY BACK TO ONE PAGE, and it is what keeps find-in-page and
       printing from silently losing four fifths of the name. */
    const allPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(allPage, card, { ticker: card.ticker, station: "all" });
    const every = await allPage.evaluate(() =>
      [...document.querySelectorAll(".ft-station[data-group]")].filter((s) => !s.hidden).length);
    eq(every, 5, `s=all puts every station back in the document (${every} of 5)`);
    await allPage.close();

    /* AN ADDRESS NO STATION ANSWERS TO IS NOT OBEYED. Hiding all five because a
       reader mistyped the query is the one outcome worse than ignoring them. */
    const badPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(badPage, card, { ticker: card.ticker, station: "not-a-station" });
    const bad = await badPage.evaluate(() =>
      [...document.querySelectorAll(".ft-station[data-group]")].filter((s) => !s.hidden)
        .map((s) => s.dataset.group));
    eq(bad.length, 1, `an unknown ?s= opens one station rather than none (${bad.join(", ")})`);
    await badPage.close();

    /* A DEEP LINK OPENS THE STATION THAT HOLDS THE PANEL. Scrolling to an
       element inside a hidden station scrolls to something with no box, which
       is how a link to panel 14 becomes a link to the top of the page. */
    const deepPage = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    await mount(deepPage, card, { ticker: card.ticker, hash: "panel-gamma", station: null });
    const deep = await deepPage.evaluate(() => {
      const panel = document.getElementById("panel-gamma");
      const station = panel && panel.closest(".ft-station");
      return { group: station && station.dataset.group, hidden: !station || station.hidden };
    });
    eq(deep.hidden, false,
       `a deep link to a panel opens the station that holds it (${deep.group})`);
    await deepPage.close();

    /* WHICH ADDRESS WINS, ON ALL SIX COMBINATIONS. Two things can name a
       station — `?s=` and the hash — and nothing asserted which of them ranked
       higher, so the answer was free to be wrong: `?s=all#ftg-convexity` opened
       ONE station, because honourHash ran while the selection was still null,
       its guard passed, and it chose before the query had been read. The reader
       asked for five and got one. The rule is: an explicit ?s= wins, a hash
       decides when ?s= is silent, and a hash naming a PANEL wins over ?s= —
       otherwise a link someone was sent lands on a station that does not hold
       it. This table is the only thing that keeps those three straight. */
    for (const [query, want] of [
      ["&s=all#ftg-convexity", "signal,convexity,volatility,tape,context"],
      ["&s=all", "signal,convexity,volatility,tape,context"],
      ["#ftg-convexity", "convexity"],
      ["", "signal"],
      ["&s=volatility#panel-gamma", "convexity"],
      ["&s=bogus", "signal"],
    ]) {
      const p = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const hash = query.includes("#") ? query.slice(query.indexOf("#") + 1) : "";
      const sParam = /[?&]s=([^#&]*)/.exec(query);
      await mount(p, card, {
        ticker: card.ticker, hash,
        station: sParam ? decodeURIComponent(sParam[1]) : null,
      });
      const open = await p.evaluate(() =>
        [...document.querySelectorAll(".ft-station[data-group]")]
          .filter((s) => !s.hidden).map((s) => s.dataset.group).join(","));
      eq(open, want, `?t=X${query || " (no station named)"} opens ${want} (${open || "none"})`);
      await p.close();
    }

    /* THE SCALE RULE, ON THE STATION THAT IS OPEN WHILE FOUR ARE HIDDEN. */
    const scales = await page.evaluate(() => {
      const out = [];
      for (const s of document.querySelectorAll(".ft-station[data-group]")) {
        if (s.hidden) continue;
        for (const svg of s.querySelectorAll("svg")) {
          const vb = (svg.getAttribute("viewBox") || "").split(/\s+/);
          if (vb.length !== 4) continue;
          out.push([s.dataset.group, Number(vb[2]), svg.getBoundingClientRect().width]);
        }
      }
      return out;
    });
    ok(scales.length > 0, `the open station draws at least one chart (${scales.length})`);
    for (const [group, vb, rendered] of scales) {
      ok(Math.abs(rendered - vb) < 1,
         `switched: one viewBox unit is one CSS pixel in the open station ` +
         `(${group}: drawn ${vb}, rendered ${rendered.toFixed(2)})`);
    }
    await page.close();
  }

  /* ---------- 2c. key statistics, gathered and not re-derived ---------

     THE FIXTURE CORPUS CANNOT FAIL THIS ONE, which is why the payloads below
     are built here. All 50 emitted cards carry the same latest ivRank —
     52.15 on 2026-08-28, every one — so a keyStats that read a shared object,
     or the wrong card entirely, would render exactly what a correct one does
     and this check would pass while proving nothing. Distinct values are the
     only thing that can tell those apart.

     AND THE ROW ORDER IS THE TRAP. ivRank.rows arrives NEWEST-first while the
     score-over-price panel's own note says its series "both run oldest first",
     so the ordering a reader of this repo would assume is the opposite of the
     one this payload uses. `rows[rows.length - 1]` would publish a rank
     measured 60 sessions ago as today's — a number that is wrong by two
     months and looks entirely reasonable. The rows below are deliberately
     shuffled so that neither the first nor the last is the newest: only a
     scan by date gets this right. */
  {
    const base = JSON.parse(JSON.stringify(withChain[0]));
    base.atr = 2.5;
    base.gammaFlip = 101.25;
    base.panels.levels = {
      status: "ok", spot: 100, atr: 2.5,
      levels: [
        { kind: "max_pain", label: "Max pain", px: 105, distPct: 0.05, distAtr: 2 },
        { kind: "put_wall", label: "Put wall", px: 90, distPct: -0.1, distAtr: -4 },
        { kind: "call_wall", label: "Call wall", px: 120, distPct: 0.2, distAtr: 8 },
      ],
    };
    base.panels.pricedMove = { status: "ok", movePerc: 0.0731 };
    base.panels.volContext = {
      status: "ok",
      ivRank: {
        status: "ok", rankUnit: "percent 0-100, as published",
        rows: [
          { date: "2026-05-01", rank1y: 11.1 },
          { date: "2026-08-28", rank1y: 73.4 },
          { date: "2026-07-15", rank1y: 44.4 },
        ],
      },
    };

    const read = async (card) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      await mount(page, card, { ticker: card.ticker });
      const out = await page.evaluate(() => {
        const host = document.getElementById("ftStats");
        if (!host) return null;
        const rows = {};
        for (const stat of host.querySelectorAll(".fc-stat")) {
          const dd = stat.querySelector("dd");
          rows[stat.querySelector("dt").textContent] = {
            text: dd.textContent, empty: dd.dataset.empty || null, why: dd.title || "",
          };
        }
        return rows;
      });
      await page.close();
      return out;
    };

    const r = await read(base);
    ok(r && Object.keys(r).length >= 8,
       `key statistics draws its rows rather than a pending note (${r ? Object.keys(r).length : 0})`);
    eq(r.Spot.text, "$100.00", `spot is this card's spot (${r.Spot.text})`);
    eq(r.ATR.text, "$2.50", `the ATR is this card's (${r.ATR.text})`);
    eq(r["Max pain"].text, "$105.00 · +2.00\u03c3",
       `a wall carries its price AND its distance in ATR, the unit that compares ` +
       `across names where a percentage does not (${r["Max pain"].text})`);
    eq(r["Put wall"].text, "$90.00 · \u22124.00\u03c3",
       `and a wall below spot is signed (${r["Put wall"].text})`);
    eq(r["Gamma flip"].text, "$101.25", `the flip when it is published (${r["Gamma flip"].text})`);
    eq(r["Priced move"].text, "\u00b17.3%", `the priced move (${r["Priced move"].text})`);
    eq(r["IV rank"].text, "73.4% · 2026-08-28",
       `THE RANK IS PICKED BY DATE, NOT BY INDEX — 73.4 on 2026-08-28 is the ` +
       `newest of three deliberately shuffled rows; 11.1 would mean rows[0] and ` +
       `44.4 would mean the last row (${r["IV rank"].text})`);

    /* THE FLIP IS ABSENT ON 31 OF THE 50 CARDS A DRY RUN EMITS, so this is the
       common path and not an edge. It takes the gamma panel's OWN sentence:
       one fact explained two ways is the same defect as two facts sharing one
       explanation, read from the other end. */
    const noFlip = JSON.parse(JSON.stringify(base));
    noFlip.gammaFlip = null;
    const q = await read(noFlip);
    eq(q["Gamma flip"].empty, "quiet",
       `a card with no published flip says so under the quiet mark rather than ` +
       `printing a bare dash (${q["Gamma flip"].empty})`);
    ok(/does not change sign/.test(q["Gamma flip"].why),
       `and gives the gamma panel's own reason for it (${q["Gamma flip"].why})`);

    /* A PANEL THAT COULD NOT BE READ IS NOT A MARKET WITH NOTHING TO SAY. */
    const dead = JSON.parse(JSON.stringify(base));
    dead.panels.volContext = { status: "unavailable", reason: "The vendor returned no volatility history." };
    const d = await read(dead);
    eq(d["IV rank"].empty, "unavailable",
       `an unreadable source panel makes its row unavailable, never quiet (${d["IV rank"].empty})`);
    eq(d.Spot.empty, null,
       `and it does not silence the rows that came from panels that DID publish ` +
       `(spot: ${JSON.stringify(d.Spot)})`);
  }

  /* ---------- 2d. a long table is bounded, and bounding it lost nothing --
     THE PAYLOAD IS BUILT HERE BECAUSE THE CORPUS CANNOT REACH THE CASE. The
     richest emitted card carries twelve congressional trades, which draw to
     roughly 360px — under the 26rem bound, so the width sweep's own check of
     this rule never takes its scrolling branch. An assertion that cannot fire
     on any fixture the suite owns is not a check, and this file has been
     bitten by that shape before. Forty rows is past the bound on any width.

     WHY THIS PANEL. `congress` is the reason the stylesheet rule exists: it
     measures 464px to 1371px across ten names, a 2.95x swing, and it is a
     span-1 panel whose row-mates are `context` (350px) and `marketRank`. A
     grid row is as tall as its tallest member, so before the bound one
     vendor's filing count set the height of two panels that have nothing to
     do with disclosure — 1,003px of blank ground opened under both.

     BOUNDED IS NOT TRUNCATED, AND BOTH HALVES ARE ASSERTED. Either alone
     passes on a defect: a scroller that happens to fit everything proves no
     bound exists, and a bound that had dropped rows would look identical from
     outside the box. So the box is measured AND every member name is looked
     for in the text. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const long = JSON.parse(JSON.stringify(withChain[0]));
    const members = Array.from({ length: 40 }, (_, i) => `Representative Number ${i + 1}`);
    long.panels.congress = {
      status: "ok", asOf: "2026-08-24", total: 40, buys: 20, sells: 20,
      medianLagDays: 31,
      trades: members.map((member, i) => ({
        member, chamber: i % 2 ? "senate" : "house",
        issuer: "Synthetic Holdings Inc", side: i % 2 ? "buy" : "sell",
        txnDate: "2026-07-0" + ((i % 9) + 1), filedDate: "2026-08-0" + ((i % 9) + 1),
        lagDays: 30 + i, amountLow: 1000 * (i + 1), amountHigh: 15000 * (i + 1),
      })),
    };
    await mount(page, long, { ticker: long.ticker, station: "all" });
    eq(errors.length, 0, `a forty-row disclosure list paints without throwing (${errors.join("; ")})`);

    const seen = await page.evaluate(() => {
      const panel = document.querySelector('.ft-panel[data-panel="congress"]');
      const wrap = panel && panel.querySelector(".fc-tablewrap");
      return {
        found: !!wrap,
        clientH: wrap ? Math.round(wrap.clientHeight) : null,
        scrollH: wrap ? Math.round(wrap.scrollHeight) : null,
        rows: wrap ? wrap.querySelectorAll("tbody tr").length : 0,
        text: panel ? panel.textContent : "",
        /* The panel's own box, which is what a row-mate is stretched to. */
        panelH: panel ? Math.round(panel.getBoundingClientRect().height) : null,
        focusable: wrap ? wrap.tabIndex : null,
        region: wrap ? wrap.getAttribute("role") : null,
      };
    });

    ok(seen.found, "the disclosure table is inside a wrapper that can be bounded");
    ok(seen.scrollH > seen.clientH,
       `forty rows really overflow the bound, so this case exercises it — ` +
       `${seen.scrollH}px of table in ${seen.clientH}px of box`);
    ok(seen.clientH <= 417,
       `the wrapper is bounded at 26rem, so a filing count cannot set the row's ` +
       `height (${seen.clientH}px)`);
    eq(seen.rows, 40,
       `every disclosed trade is still in the DOM — bounded, never truncated (${seen.rows})`);
    const missing = members.filter((m) => !seen.text.includes(m));
    eq(missing.length, 0,
       `and every member is still findable by find-in-page, including the ones ` +
       `below the fold (${missing.slice(0, 3).join(", ")})`);
    /* A SCROLLER A KEYBOARD CANNOT REACH IS A TRAP, and bounding the box is
       what creates one. Both attributes are set by the renderer already; this
       asserts the bound did not arrive without them. */
    eq(seen.focusable, 0, `the bounded region is reachable by keyboard (tabIndex ${seen.focusable})`);
    eq(seen.region, "region", `and announces itself as a region (${seen.region})`);
    ok(seen.panelH < 900,
       `the panel that was measured at 1371px no longer sets its row from the ` +
       `vendor's row count (${seen.panelH}px)`);
    await page.close();
  }

  /* ---------- 3. the minus sign, on numbers only ------------------ */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    /* SCOPED TO NUMERIC STRINGS. A page-wide "contains no U+002D" assertion is
       UNSATISFIABLE here: every expiry is an ISO date and the surface prints
       `expiry.slice(5)` = "08-31", so 57 of 115 strings in a real card carry
       an ASCII hyphen legitimately. A guaranteed-red assertion gets deleted,
       not fixed. */
    const bad = await page.evaluate(() => {
      const out = [];
      const numeric = /^[−+-]?[\d.,]+\s*[%σd]?$/;
      const nodes = [...document.querySelectorAll(".ft-panel .c-num, .ft-panel .fc-reading"),
                     ...document.querySelectorAll(".ft-panel svg text")];
      for (const n of nodes) {
        const t = (n.textContent || "").trim();
        if (!t || !numeric.test(t)) continue;
        if (t.includes("-")) out.push(t);
      }
      return out;
    });
    eq(bad.length, 0, `every numeric cell uses U+2212, not a hyphen (${bad.slice(0, 5).join(", ")})`);
    await page.close();
  }

  /* ---------- 4. the enlarge dialog redraws, and never shrinks ----- */
  for (const width of [1280, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });

    /* EVERY REGISTRY KEY, NOT A HAND-PICKED FOUR, and the four are why.

       This list read ["aggressor", "ivSurface"] and could not see the defect
       it was written for: `gamma` and `path` each carried their own inlined
       `Math.min(760, …)` — the retired dialog's ceiling — so at 1280px, where
       a span-1 host is ~456 units, the enlarged copy capped at 760 against the
       912 the assertion below asks for. Adding those two keys fixed the list
       for the two panels somebody had already found.

       A HAND-WRITTEN LIST OF PANELS IS THE DEFECT shared/flows-panels.js WAS
       CREATED TO CLOSE, one level up: a panel not named here is one whose
       enlarge nobody checks, and reading the list cannot tell you that. It is
       derived from the registry now, and a panel with no chart is skipped by
       MEASUREMENT — `gridW` is 0 — rather than by omission. */
    for (const key of TICKER_PANELS.map((p) => p.key)) {
      const section = TICKER_PANELS.find((p) => p.key === key);
      const gridW = await page.evaluate((k) => {
        const s = document.querySelector('.ft-panel[data-panel="' + k + '"] svg');
        return s ? Number((s.getAttribute("viewBox") || "0 0 0 0").split(/\s+/)[2]) : 0;
      }, key);
      if (!gridW) continue;

      await page.click('.ft-panel[data-panel="' + key + '"] .ft-zoom-open');
      await page.waitForFunction(
        () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
      const zoomed = await page.evaluate(() => {
        const s = document.querySelector("#ftZoomHost svg");
        const vb = Number((s.getAttribute("viewBox") || "0 0 0 0").split(/\s+/)[2]);
        return { vb, rendered: s.getBoundingClientRect().width,
                 transform: getComputedStyle(s).transform };
      });

      /* SPAN-AWARE, because a flat 2x threshold FAILS BY CONSTRUCTION on
         exactly the two panels the button matters most for: an is-wide grid
         panel is already 896px and the dialog host is ~1113px, a 1.24x gain
         that is real and is not two. */
      if (section.span === 1) {
        ok(zoomed.vb >= gridW * 2,
           `${width}px ${key}: a span-1 panel at least doubles when enlarged (${gridW} to ${zoomed.vb})`);
      } else {
        ok(zoomed.vb > gridW,
           `${width}px ${key}: a span-2 panel still grows when enlarged (${gridW} to ${zoomed.vb})`);
      }
      /* ENLARGE MUST NEVER SHRINK. With width:min(74rem,96vw) the dialog host
         is 1129.6px while an is-wide grid panel at >=1328px is 1136px — the
         button would have made the two widest panels SMALLER. */
      ok(zoomed.vb >= gridW,
         `${width}px ${key}: enlarging never shrinks the drawing (${gridW} to ${zoomed.vb})`);
      /* showModal() on a display:none element gives clientWidth 0 in the same
         tick, so a drawer called without the rAF falls back to the
         unmeasurable-host 560 and the enlarged panel is drawn at a width the
         dialog does not have. */
      ok(zoomed.vb > 600, `${width}px ${key}: the zoom draw measured a real host`);
      /* THE SPAN-INDEPENDENT ANTI-transform:scale() TEST. A scaled
         implementation gives a ratio near 2.6 and a non-none transform, and
         passes every other assertion in this suite.

         WITHIN A PIXEL, for the reason the grid sweep is: a 15% band holds
         both known failures — the dialog's own 1.023 stretch, and the 0.999
         squeeze a 2px staleness BORDER put on every panel after they had
         been measured. */
      ok(Math.abs(zoomed.rendered - zoomed.vb) < 1,
         `${width}px ${key}: the enlarged chart is redrawn at its host's width, not ` +
         `scaled — drawn ${zoomed.vb}, rendered ${zoomed.rendered.toFixed(2)}`);
      eq(zoomed.transform, "none", `${width}px ${key}: no CSS transform on the enlarged chart`);

      /* EVERY <defs> ID IS UNIQUE WHILE BOTH COPIES EXIST. url(#id) resolves
         to the first match in document order, so a duplicated pattern id
         silently gives the zoomed drawing the grid drawing's tile. */
      const dup = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((n) => n.id);
        const seen = new Set(), dupes = [];
        for (const id of ids) { if (seen.has(id)) dupes.push(id); seen.add(id); }
        return dupes;
      });
      eq(dup.length, 0,
         `${width}px ${key}: no id is duplicated while the zoom dialog is open (${dup.join(", ")})`);

      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => !document.getElementById("ftZoom").open, null, { timeout: 2000 });
    }
    eq(errors.length, 0, `${width}px: the enlarge cycle throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 5. the three page-level states --------------------- */
  {
    /* NO NAME IS THE INDEX, NOT AN ERROR — and it must not fetch a card. */
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    /* THE FIXTURE IS THE SHAPE THE PIPELINE ACTUALLY WRITES, and the previous
       one was not. It carried `dp: 0` on the row with no card — a value this
       payload has never held. flows-pipeline.mjs stamps `row.dp = 1` on the
       deep set and writes NOTHING on the rest, and publishes the count as
       `deep` beside `deepRule`. Written the old way, the fixture agreed with
       the controller's `row.dp === 0` test and both were wrong about the wire:
       on a live board 21 of 44 rows were listed as openable and were not.
       A fixture written from the same assumption as the code proves only that
       the assumption is self-consistent. */
    await mount(page, withChain[0], {
      ticker: null,
      boards: { deep: 1, rows: [{ t: "AAA", r: 1, s: 42, dp: 1 }, { t: "BBB", r: 2, s: 30 }] },
    });
    const state = await page.evaluate(() => ({
      status: document.getElementById("ftStatus").textContent,
      pickerShown: !document.getElementById("ftPicker").hidden,
      gridShown: !document.getElementById("ftGrid").hidden,
      rows: document.querySelectorAll("#ftPickerBody tr").length,
      names: [...document.querySelectorAll("#ftPickerBody .ft-link")].map((a) => a.textContent),
      note: document.getElementById("ftPickerNote").textContent,
      requested: window.__requested.slice(),
    }));
    ok(state.pickerShown, "with no ?t= the page shows the picker");
    ok(!state.gridShown, "and hides the panel grid");
    ok(!state.status.toLowerCase().includes("error"), "and calls it a choice, not an error");
    eq(state.requested.filter((u) => u.includes("/api/flows/card")).length, 0,
       "and spends no card read at all");
    /* A NAME WITH NO CARD GETS NO ROW. A link that usually leads to "no card
       for this name" is worse than no link. */
    eq(state.rows, 1,
       "only the names the board stamped with a card are listed — a row the run went " +
       "deep on carries dp:1 and one it did not carries no dp at all");
    eq(state.names.join(","), "AAA", "and it is the stamped one that is listed");
    /* AND THE NOTE IS TRUE OF THE LIST UNDER IT. It used to promise "every
       name today's board went deep enough on to build a card for" above a list
       that was every row on the board. */
    ok(/ranks 2 names/.test(state.note) && /card for 1 of them/.test(state.note),
       `the note counts the list against the board it came from (${state.note})`);
    ok(/not listed/.test(state.note),
       "and says what happened to the row it dropped rather than leaving the reader to " +
       "notice the board is longer than the list");
    await page.close();
  }
  {
    /* AN OLD BOARD HAS NO `dp` ON ANY ROW, and absent-on-every-row is not
       false-on-every-row. Assets deploy the moment main moves and the pipeline
       runs the next morning, so there is always a day when this JavaScript
       reads a board written before the flag existed — and treating that as
       "no name has a card" would empty the index of a section whose whole
       purpose is opening those cards. The test is the published `deep` count,
       not the row. */
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await mount(page, withChain[0], {
      ticker: null,
      boards: { rows: [{ t: "AAA", r: 1, s: 42 }, { t: "BBB", r: 2, s: 30 }] },
    });
    const state = await page.evaluate(() => ({
      rows: document.querySelectorAll("#ftPickerBody tr").length,
      note: document.getElementById("ftPickerNote").textContent,
    }));
    eq(state.rows, 2,
       "a board that publishes no `deep` count lists every row rather than none");
    ok(/does not publish/.test(state.note),
       `and the note says the flag is unpublished rather than promising a card (${state.note})`);
    ok(/may still open a page with no card/.test(state.note),
       "naming the risk it cannot rule out, instead of a claim it cannot check");
    await page.close();
  }
  {
    /* THE THREE PENDING STATES ARE DIFFERENT FACTS and must read differently.

       THE THIRD ONE USED TO BE TOLD AS THE FIRST. A name the board RANKS but
       built no card for is not a card lagging its row: the run never intended
       to build one, because a card costs two vendor calls it spends only on
       the names furthest from neutral. "Its card has not landed yet" invited a
       reload that will never produce one, and on a live board that was 21 of
       44 names on the long side. */
    const pendingCases = [
      [{ deep: 1, rows: [{ t: "ZZZ", r: 1, s: 5, dp: 1 }] }, "has not landed",
       "a card that really is lagging its row"],
      [{ deep: 1, rows: [{ t: "QQQ", r: 1, s: 5, dp: 1 }] }, "not on today",
       "a name the board does not carry at all"],
      [{ deep: 1, rows: [{ t: "AAA", r: 1, s: 9, dp: 1 }, { t: "ZZZ", r: 2, s: 5 }] },
       "built no card for it", "a name the board RANKS and this run built no card for"],
    ];
    for (const [boards, want, what] of pendingCases) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, { status: "pending", ticker: "ZZZ" }, { ticker: "ZZZ", boards });
      const status = await page.evaluate(
        () => document.getElementById("ftStatus").textContent);
      ok(status.includes(want), `${what} says so specifically ("${want}")`);
      await page.close();
    }
    {
      /* AND THE THIRD ONE NAMES THE RANK INSIDE THE SIDE'S OWN POPULATION,
         never inside the count of rows this page kept. */
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, { status: "pending", ticker: "ZZZ" }, {
        ticker: "ZZZ",
        boards: { deep: 1, rows: [{ t: "AAA", r: 1, s: 9, dp: 1 }, { t: "ZZZ", r: 2, s: 5 }] },
      });
      const state = await page.evaluate(() => ({
        status: document.getElementById("ftStatus").textContent,
        rows: document.querySelectorAll("#ftPickerBody tr").length,
      }));
      ok(/2 of 2 on the bullish side/.test(state.status),
         `the rank is stated against the whole side, not against the carded half ` +
         `(${state.status})`);
      ok(!/has not landed|briefly lag/.test(state.status),
         "and never as a lag, because reloading cannot produce a card the run did not " +
         "budget for");
      eq(state.rows, 1,
         "while the list beside it holds only the name that does have a card");
      await page.close();
    }
  }
  {
    /* ?t=nvda IS THE NVDA PAGE. The Worker uppercases before testing its own
       ticker pattern; routing lowercase to "choose a name" would break every
       hand-typed URL and contradict the deep link the dialog already ships. */
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const card = withChain[0];
    await mount(page, card, { ticker: String(card.ticker).toLowerCase() });
    const requested = await page.evaluate(() => window.__requested.slice());
    ok(requested.some((u) => u.includes("t=" + card.ticker)),
       "a lowercase ?t= is uppercased and fetched, not sent to the picker");
    await page.close();
  }
  {
    /* A HOSTILE ?t= NEVER REACHES A FETCH. */
    for (const bad of ["../etc", "", "!!!"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await mount(page, withChain[0], { ticker: bad, boards: { rows: [] } });
      const requested = await page.evaluate(() => window.__requested.slice());
      eq(requested.filter((u) => u.includes("/api/flows/card")).length, 0,
         `?t=${JSON.stringify(bad)} is rejected before any fetch`);
      await page.close();
    }
  }

  /* ---------- 6. legacy and unavailable payloads ------------------ */
  {
    /* A CARD FROM BEFORE THE CHAIN LEG carries no ivSurface KEY AT ALL —
       `undefined`, not {status:"unavailable"} — and the two must not be
       conflated: one is a card built before the panel existed, the other is
       this run declining to publish and carrying its own reason. */
    const legacy = JSON.parse(JSON.stringify(withChain[0]));
    delete legacy.panels.ivSurface;
    legacy.panels.aggressor = { status: "unavailable", reason: "the vendor reported no aggressor split." };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, legacy, { ticker: legacy.ticker });
    const said = await page.evaluate(() => ({
      ivs: document.querySelector('.ft-panel[data-panel="ivSurface"] .fc-dead').textContent,
      aggr: document.querySelector('.ft-panel[data-panel="aggressor"] .fc-dead').textContent,
    }));
    ok(said.ivs.includes("before the option chain leg"),
       "an absent panel key says the card predates the panel");
    ok(said.aggr.includes("no aggressor split"),
       "an unavailable panel prints the builder's own reason verbatim");
    eq(errors.length, 0, "neither absence throws");
    await page.close();
  }

  /* ---------- 6b. the three stock panels: readings ----------------- */
  {
    /* THE FIXTURE IS AN EMITTED CARD WITH NAMED FIELDS MUTATED, and each
       mutation is the point of its own test. The emitted corpus carries no
       cancelled print, no null oiUpDays beside real counters on row 0, and
       no pinned rank value — those states are staged by name. */
    const base = withChain.find((c) =>
      c.panels.darkpool.status === "ok" &&
      c.panels.oiDeltas.status === "ok" &&
      c.panels.volContext.status === "ok" &&
      c.panels.volContext.term.status === "ok" &&
      c.panels.volContext.ivRank.status === "ok");
    ok(base, "an emitted card carries all three stock panels with data");
    const card = JSON.parse(JSON.stringify(base));
    card.panels.darkpool.rows[0].canceled = true;          // the tape's cancel flag, staged
    card.panels.oiDeltas.rows[0].oiUpDays = null;          // an unpublished counter, staged
    card.panels.volContext.ivRank.rows[0].rank1y = 57.5;   // a pinned headline the drawer must not rescale
    card.panels.volContext.ivRank.rows[5].rank1y = null;   // a guaranteed gap for the strip

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const dp = card.panels.darkpool;
    const oi = card.panels.oiDeltas;
    const vc = card.panels.volContext;
    /* The strip's segment count, computed from the payload the way the
       drawer must draw it: oldest first, a segment only between ADJACENT
       measured sessions. The staged null guarantees the count is strictly
       below n − 1, so a drawer that bridges gaps (or zeroes them) fails. */
    const series = vc.ivRank.rows.slice().reverse()
      .map((r) => (typeof r.rank1y === "number" && Number.isFinite(r.rank1y) ? r.rank1y : null));
    let wantSegments = 0;
    for (let i = 0; i + 1 < series.length; i++) {
      if (series[i] !== null && series[i + 1] !== null) wantSegments++;
    }
    ok(wantSegments < series.length - 1,
       "the fixture really carries a gap for the strip to refuse to bridge");

    const got = await page.evaluate(() => {
      const panelOf = (key) =>
        document.querySelector('.ft-panel[data-panel="' + key + '"] > div');
      const text = (root, sel) => {
        const n = root.querySelector(sel);
        return n ? n.textContent : null;
      };
      const dpHost = panelOf("darkpool");
      const oiHost = panelOf("oiDeltas");
      const vcHost = panelOf("volContext");
      /* Everything a panel SAYS, tooltips included, for the vocabulary sweep. */
      const saidBy = (root) => root.textContent + " " +
        [...root.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" ");
      return {
        dpRows: dpHost.querySelectorAll(".fdp-table tbody tr").length,
        dpTags: [...dpHost.querySelectorAll(".fdp-tag")].map((n) => n.textContent),
        /* The first TEXT node only: a cancelled row's cell is "HH:MM" plus its
           tag element, and the clock claim is about the clock. */
        dpTimes: [...dpHost.querySelectorAll(".fdp-time")]
          .map((n) => (n.firstChild ? n.firstChild.textContent : "")),
        dpQuotes: [...dpHost.querySelectorAll(".fdp-quote")].map((n) => n.textContent),
        dpCount: text(dpHost, ".fdp-count"),
        dpNotes: [...dpHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        oiContracts: [...oiHost.querySelectorAll(".foi-oc")].map((n) => n.textContent),
        oiChanges: [...oiHost.querySelectorAll(".foi-chg")].map((n) => n.textContent),
        oiGrowth: [...oiHost.querySelectorAll(".foi-growth")].map((n) => n.textContent),
        oiStreaks: [...oiHost.querySelectorAll(".foi-streaks")]
          .map((n) => [...n.querySelectorAll(".foi-streak")].map((s) => s.textContent)),
        oiCount: text(oiHost, ".foi-count"),
        oiNotes: [...oiHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        oiSaid: saidBy(oiHost),
        rankHead: text(vcHost, ".fvc-rank"),
        rankN: text(vcHost, ".fvc-rank-n"),
        axisLabels: [...vcHost.querySelectorAll(".fvc-axis")].map((n) => n.textContent),
        dots: vcHost.querySelectorAll(".fvc-dot").length,
        curvePoints: (vcHost.querySelector(".fvc-line") || { getAttribute: () => "" })
          .getAttribute("points"),
        miniRows: vcHost.querySelectorAll(".fvc-mini tbody tr").length,
        miniIvs: [...vcHost.querySelectorAll(".fvc-mini tbody tr td:nth-child(2)")]
          .map((n) => n.textContent),
        segments: vcHost.querySelectorAll(".fvc-spark-l").length,
        sparkDots: vcHost.querySelectorAll(".fvc-spark-d").length,
        vcNotes: [...vcHost.querySelectorAll(".fc-note")].map((n) => n.textContent).join(" "),
        vcSaid: saidBy(vcHost),
      };
    });

    /* --- darkpool: the table is the payload, row for row -------------- */
    eq(got.dpRows, dp.rows.length, "darkpool draws one row per published print");
    ok(got.dpTimes.every((t) => /^\d{2}:\d{2}$/.test(t) || t === "—"),
       `every time cell is HH:MM off the tape's own timestamp (${got.dpTimes[0]})`);
    /* THE CANCEL FLAG HAS ONE HONEST RENDERING: a tag on true, NOTHING on
       false and on null — a "live" badge on the false rows would turn the
       null rows' bare absence into a claim. */
    const wantTags = dp.rows.filter((r) => r.canceled === true).length;
    eq(got.dpTags.length, wantTags, "exactly the cancelled prints carry the tag");
    ok(got.dpTags.every((t) => t === "cancelled"), "and the tag says what the flag says");
    const iBoth = dp.rows.findIndex((r) => r.bid !== null && r.ask !== null);
    const iNone = dp.rows.findIndex((r) => r.bid === null || r.ask === null);
    if (iBoth !== -1) {
      ok(/^\d+\.\d{2} \/ \d+\.\d{2}$/.test(got.dpQuotes[iBoth]),
         `a quoted print shows bid and ask side by side ("${got.dpQuotes[iBoth]}")`);
    }
    if (iNone !== -1) {
      eq(got.dpQuotes[iNone], "—",
         "a print missing either side of the quote shows the dash, never half a spread");
    }
    /* The capped-list line, in the shaper's own numbers. Every emitted card
       sheds and counts out today, so both clauses are exercised. */
    if (dp.shed > 0) {
      ok(got.dpCount && got.dpCount.includes(dp.rows.length + " kept of " + dp.seen),
         `the caption states ${dp.rows.length} kept of ${dp.seen}`);
    }
    if (dp.unpriced > 0) {
      ok(got.dpCount && got.dpCount.includes("+" + dp.unpriced + " unpriced print"),
         "and counts the unpriced prints out rather than seating them");
    }
    ok(got.dpNotes.includes(dp.note.slice(0, 60)),
       "the payload's own darkpool note is rendered, not paraphrased");

    /* --- oiDeltas: signed changes, vendor counters, vendor prose ------- */
    eq(got.oiContracts.length, oi.rows.length, "oiDeltas draws one row per published change");
    ok(/^[CP] [\d.]+ · \d{2}-\d{2}$/.test(got.oiContracts[0]),
       `the contract cell is built from cp, strike and expiry ("${got.oiContracts[0]}")`);
    /* THESE READ `r.diff` NOW, AND THE BLOCK ASSERTS IT FOUND SOMETHING.
       They used to read `r.change`, the field that carried the vendor's
       oi_change — a RATIO drawn as a contract count. Renaming it to `diff`
       and `ratio` left these two findIndex calls looking for a key nothing
       has, so both returned -1 and both `if` bodies silently stopped running:
       the suite kept passing while testing nothing, which is the same shape
       as the six [message, condition] assertions fixed in flows-legacy-payload
       tonight. A guarded assertion needs a guard on the guard. */
    const iNeg = oi.rows.findIndex((r) => typeof r.diff === "number" && r.diff < 0);
    const iPos = oi.rows.findIndex((r) => typeof r.diff === "number" && r.diff > 0);
    ok(iNeg !== -1 || iPos !== -1,
       "the emitted corpus carries at least one signed open-interest difference, so the " +
       "two sign assertions below are about rows that exist rather than about nothing");
    if (iNeg !== -1) {
      ok(got.oiChanges[iNeg].startsWith("−"),
         `a negative difference leads with U+2212 ("${got.oiChanges[iNeg]}")`);
    }
    if (iPos !== -1) {
      ok(got.oiChanges[iPos].startsWith("+"),
         `a positive difference leads with its sign ("${got.oiChanges[iPos]}")`);
    }
    /* AND THE RATIO IS A RATIO ON THE PAGE. Every drawn growth cell either is
       the em dash or carries a percent sign — the one mark that stops this
       column being read as the contract count next to it. */
    ok(got.oiGrowth.length === oi.rows.length &&
       got.oiGrowth.every((t) => t === "\u2014" || /%$/.test(t)),
       `every growth cell carries its unit or says nothing (${got.oiGrowth.join(" ")})`);
    /* Row 0's oiUpDays was staged to null: its ↑OI half is the dash, and its
       V>OI half still renders — a missing counter is not a streak of zero
       and must not take its neighbour down with it. */
    eq(got.oiStreaks[0][0], "—", "a null counter is the dash, never a zero");
    ok(/^\d+d V>OI$/.test(got.oiStreaks[0][1]),
       `while the sibling counter still renders ("${got.oiStreaks[0][1]}")`);
    const iBothStreaks = oi.rows.findIndex((r, i) => i > 0 &&
      typeof r.oiUpDays === "number" && typeof r.volGtOiDays === "number");
    if (iBothStreaks !== -1) {
      ok(/^\d+d ↑OI$/.test(got.oiStreaks[iBothStreaks][0]),
         `a published counter renders as the vendor's own streak ("${got.oiStreaks[iBothStreaks][0]}")`);
    }
    if (oi.shed > 0) {
      ok(got.oiCount && got.oiCount.includes(oi.rows.length + " kept of " + oi.seen),
         "the oiDeltas caption states the capped list");
    }
    ok(got.oiNotes.includes("selection rule"),
       "the vendor-selection caveat reaches the reader from the payload's note");
    ok(got.oiNotes.includes(oi.note.slice(0, 60)),
       "and it is the note verbatim, not a paraphrase");

    /* --- volContext: the rank is NEVER rescaled ------------------------ */
    eq(got.rankN, "57.5",
       "the pinned rank renders as its own number — 0.6 or 5750 here is the rescale " +
       "this vendor's rank fields have already burned once");
    ok(got.rankHead.includes("57.5 / 100"), "and the headline states the unit's ceiling");
    eq(got.dots, vc.term.rows.length, "the term curve dots every listed expiry");
    eq((got.curvePoints || "").split(" ").length, vc.term.rows.length,
       "and the polyline runs through all of them");
    eq(got.axisLabels.length, 2, "the y rail is labelled at min and max");
    ok(got.axisLabels.every((t) => /^\d+%$/.test(t)),
       `both labels are whole percents (${got.axisLabels.join(", ")})`);
    eq(got.miniRows, Math.min(4, vc.term.rows.length),
       "the mini-table holds the first four expiries");
    ok(got.miniIvs.every((t) => /^\d+\.\d%$/.test(t) || t === "—"),
       `mini-table volatilities are percents to one decimal (${got.miniIvs[0]})`);
    /* THE STRIP'S GAPS ARE GAPS. Segment count is computed from the payload
       the way the drawer must draw it; a drawer that bridges a null (or
       draws it at zero) lands on n − 1 and fails by count. */
    eq(got.segments, wantSegments,
       `the rank strip draws a segment only between adjacent measured sessions ` +
       `(${got.segments} of a bridged ${series.length - 1})`);
    ok(got.sparkDots >= 1, "and the newest measured session carries its dot");
    ok(got.vcNotes.includes(vc.note.slice(0, 60)),
       "the volContext note is rendered from the payload");

    /* --- vocabulary: the darkpool words stay in the darkpool panel ----- */
    /* "print"/"trade" are accurate for reported equity executions and are
       allowed THERE; the other two panels describe clearing snapshots and
       quotes, and may not borrow them. The side-attribution words are banned
       in all three by the same refusals the payload's notes state. */
    for (const [key, said] of [["oiDeltas", got.oiSaid], ["volContext", got.vcSaid]]) {
      ok(!/print|trade|bought|sold|buyer|seller|whale|institutional|smart money/i.test(said),
         `${key} never borrows the tape's vocabulary or attributes a side`);
    }
    eq(errors.length, 0, `the stock panels render without throwing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6c. the three stock panels: silences ----------------- */
  {
    /* THE THREE SILENCES, one per panel, same construction as section 6:
       an emitted card with one named mutation each. `undefined` predates
       the deep feeds — a DIFFERENT wave from the chain four, and the
       sentence must date the absence by its own wave. "unavailable"
       carries the builder's reason verbatim. "quiet" is an ordinary
       reading and must not wear the Unavailable banner. */
    const legacy = JSON.parse(JSON.stringify(withChain[0]));
    delete legacy.panels.darkpool;
    legacy.panels.oiDeltas = {
      status: "unavailable", reason: "the feed could not be read this run",
      note: legacy.panels.oiDeltas.note,
    };
    legacy.panels.volContext = {
      status: "quiet",
      term: { status: "quiet", rows: [], seen: 0, cap: 16, shed: 0 },
      ivRank: { status: "quiet", rows: [], seen: 0, cap: 60, shed: 0,
        rankUnit: "percent 0-100, as published" },
      note: legacy.panels.volContext.note,
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, legacy, { ticker: legacy.ticker });
    const said = await page.evaluate(() => {
      const host = (key) => document.querySelector('.ft-panel[data-panel="' + key + '"] > div');
      const vc = host("volContext");
      return {
        dark: host("darkpool").querySelector(".fc-dead").textContent,
        oi: host("oiDeltas").querySelector(".fc-dead").textContent,
        vcQuiet: vc.querySelector('[data-empty="quiet"]') !== null,
        vcDead: vc.querySelector(".fc-dead") !== null,
        vcText: vc.textContent,
      };
    });
    ok(said.dark.includes("before the per-name deep feeds"),
       "an absent stock key dates the card by ITS wave, not the chain leg's");
    ok(said.oi.includes("the feed could not be read this run"),
       "an unavailable stock panel prints the builder's reason verbatim");
    ok(said.vcQuiet, "a quiet panel is marked data-empty=quiet");
    ok(!said.vcDead, "and never wears the Unavailable banner");
    eq(errors.length, 0, "none of the three silences throws");
    await page.close();
  }
  {
    /* EACH HALF OF volContext SURVIVES THE OTHER'S ABSENCE — the payload's
       own design ("a name with a curve but no rank history is half a panel,
       not an unavailable one"), asserted from the reader's side. */
    const half = JSON.parse(JSON.stringify(withChain.find((c) =>
      c.panels.volContext.status === "ok" && c.panels.volContext.ivRank.status === "ok")));
    half.panels.volContext.term = { status: "quiet", rows: [], seen: 0, cap: 16, shed: 0 };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, half, { ticker: half.ticker });
    const got = await page.evaluate(() => {
      const vc = document.querySelector('.ft-panel[data-panel="volContext"] > div');
      return {
        termQuiet: vc.querySelector('.fvc-termhalf [data-empty="quiet"]') !== null,
        curve: vc.querySelector(".fvc-line") !== null,
        rank: (vc.querySelector(".fvc-rank") || { textContent: "" }).textContent,
      };
    });
    ok(got.termQuiet, "a quiet term half says so under its own heading");
    ok(!got.curve, "and draws no curve");
    ok(/\/ 100/.test(got.rank), "while the rank half still states its reading");
    eq(errors.length, 0, "the half-silence throws nothing");
    await page.close();
  }


  /* ---------- 6c'. the market-wide standing: three arms, one date ------

     THE PANEL THIS SUITE CARES MOST ABOUT GETTING WRONG. Every other panel
     on the page reports a measurement of ONE name; this one reports where
     that name sits among all the others, and there are exactly three ways to
     turn that into a lie a reader would act on:

       reading an absence as a silence — the two feeds are SELECTIONS, and a
       name outside one still had open interest and still had prints;

       reading yesterday's cross-section as today's — the vendor updates its
       market-wide open-interest feed at about 06:45 ET and this pipeline
       runs at 05:15, so the ranking is normally the PREVIOUS session's;

       reading a rank without its population — "14th" is not a reading, "14th
       of 40" is.

     Each has an assertion below, taken off the rendered DOM rather than off
     the payload, because the payload has been right and the page wrong
     before. */
  {
    const base = withChain.find((c) =>
      c.panels.marketRank &&
      c.panels.marketRank.status === "ok" &&
      c.panels.marketRank.feeds.oiChange.status === "ok" &&
      c.panels.marketRank.feeds.darkpool.status === "ok");
    ok(base, "an emitted card places in both market-wide feeds");
    const card = JSON.parse(JSON.stringify(base));
    /* A NEGATIVE OPEN-INTEREST CHANGE, STAGED. The emitted corpus ranks
       descending, so its top rows are positive and the sign glyph on the
       negative side would never be drawn by a card that ranks at all. */
    card.panels.marketRank.feeds.oiChange.value = -4200;

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const got = await page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
      const blocks = [...host.querySelectorAll(".fmr-block")];
      const textOf = (n) => (n ? n.textContent : null);
      return {
        blocks: blocks.length,
        heads: blocks.map((b) => textOf(b.querySelector(".fmr-h"))),
        ranks: blocks.map((b) => textOf(b.querySelector(".fmr-rank"))),
        vals: blocks.map((b) => textOf(b.querySelector(".fmr-val"))),
        valClasses: blocks.map((b) => (b.querySelector(".fmr-val") || { className: "" }).className),
        when: blocks.map((b) => textOf(b.querySelector(".fmr-when"))),
        cut: blocks.map((b) => textOf(b.querySelector(".fmr-cut"))),
        cover: blocks.map((b) => textOf(b.querySelector(".fmr-cover"))),
        /* EVERYTHING A BLOCK SAYS, tooltips included, for the vocabulary
           sweep — the same `saidBy` shape the stock panels use, because a
           claim hidden in a title attribute is still a claim. */
        blockText: blocks.map((b) => b.textContent + " " +
          [...b.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" ")),
        empties: [...host.querySelectorAll("[data-empty]")].map((n) => n.getAttribute("data-empty")),
        all: host.textContent + " " +
          [...host.querySelectorAll("[title]")].map((n) => n.getAttribute("title")).join(" "),
      };
    });

    eq(got.blocks, 2, "both market-wide feeds get their own block, because they carry " +
       "different populations, different orderings and different sessions");
    ok(/Open-interest/.test(got.heads[0]) && /Off-exchange/.test(got.heads[1]),
       "each under its own heading");

    /* A RANK IS NEVER PRINTED ALONE. */
    for (let i = 0; i < 2; i++) {
      ok(/\d+ of \d+/.test(got.ranks[i] || ""),
         `${got.heads[i]}: the rank is printed with the population it sits inside ` +
         `("${got.ranks[i]}") — a bare ordinal is a number a reader cannot size`);
    }

    /* SIGN IN THE GLYPH, and the tone class only decorates it. */
    ok(got.vals[0].startsWith("−"),
       `a negative open-interest change leads with U+2212 ("${got.vals[0]}"), so the reading ` +
       "survives greyscale and a printout");
    ok(/is-down/.test(got.valClasses[0]),
       "with the tone class as decoration on top of a sign that is already in the text");
    ok(/contract/.test(got.vals[0]),
       `and the unit travels with the number ("${got.vals[0]}")`);

    /* THE SESSION THE RANKING IS FROM. The emitted corpus reproduces the
       05:15-against-06:45 gap, so this is the branch a live run takes. */
    ok(/NOT the session this card describes/.test(got.when[0]),
       `the panel says outright that the ranking is from another session ("${got.when[0]}")`);
    ok(new RegExp(card.panels.marketRank.feeds.oiChange.asOf).test(got.when[0]),
       "naming the feed's own date rather than the card's");

    /* THE CUT, IN THE UNITS EACH FEED EARNS: a value for the ranked-by-size
       feed and a TIME for the ranked-by-recency one. */
    ok(/last place in the feed held/.test(got.cut[0]),
       `the open-interest block quotes the value at the last place ("${got.cut[0]}")`);
    ok(/reaches back to/.test(got.cut[1]),
       `and the print block quotes the time the window reaches back to, which is the fact ` +
       `that decides whether a name could have been in a recency list ("${got.cut[1]}")`);

    /* THE COVERAGE OF THE JOIN, ON THE CARD. */
    for (let i = 0; i < 2; i++) {
      ok(/\d+ of \d+ names? carrying a card/.test(got.cover[i] || ""),
         `${got.heads[i]}: the panel states how much of the board this join reached ` +
         `("${got.cover[i]}")`);
    }

    /* NO TONE ON A READING WITH NO DIRECTION. A print's dollar size is a
       magnitude the tape attributes to nobody, so the money cell carries no
       polarity class at all — the signed open-interest cell above does, and
       its sign is in the glyph before the class touches it. */
    ok(/is-up|is-down|is-flat|is-unknown/.test(got.valClasses[0]),
       "the signed open-interest reading carries a tone class");
    ok(!/is-up|is-down|is-flat|is-unknown/.test(got.valClasses[1]),
       `and the print's dollar size carries none ("${got.valClasses[1]}") — the tape ` +
       "attributes no side, so a tint would invent one");

    /* NO CLAIM THIS PANEL CANNOT MAKE.

       IDENTITY AND INTENT ARE BANNED THROUGHOUT, exactly as they are in the
       payload notes these feeds already ship (shared/flows-pulse.js). And
       the tape's own vocabulary is allowed ONLY where the rows really are
       reported executions: the open-interest half is two clearing snapshots
       and may not borrow "print" or "trade" from its neighbour, which is the
       same boundary the three stock panels hold one section down. */
    const IDENTITY = /\b(whale|smart money|institutional|bought|sold|buyer|seller|paid|bullish|bearish)\b/i;
    const idHit = IDENTITY.exec(got.all);
    ok(!idHit,
       `the panel never attributes a side, an identity or an intent (found "${idHit && idHit[1]}") — ` +
       "membership in a market-wide list is not a direction");
    const exHit = /\b(print|prints|trade|trades)\b/i.exec(got.blockText[0]);
    ok(!exHit,
       `and the open-interest half never borrows the tape's vocabulary (found ` +
       `"${exHit && exHit[1]}") — it describes two clearing snapshots, not executions`);
    eq(errors.length, 0, "the panel draws without throwing");
    await page.close();
  }

  {
    /* THE OTHER TWO ARMS, STAGED BY NAME. A measured absence is `quiet` and
       must not wear the Unavailable banner; a feed that could not be read is
       `unavailable` and must; a card from before the join shipped carries no
       key at all and gets ITS OWN wave's sentence rather than the deep
       feeds'. Three silences, three sentences, three tags. */
    const card = JSON.parse(JSON.stringify(withChain[0]));
    const quiet = withChain
      .map((c) => c.panels.marketRank && c.panels.marketRank.feeds.oiChange)
      .find((f) => f && f.status === "quiet");
    ok(quiet, "the emitted corpus contains a name that is in no market-wide list");
    card.panels.marketRank.feeds.oiChange = JSON.parse(JSON.stringify(quiet));
    card.panels.marketRank.feeds.darkpool = {
      status: "unavailable", present: null, feed: "darkpool",
      label: "the market-wide off-exchange print feed",
      reason: "the market-wide off-exchange print feed did not come back this run (timeout)",
    };

    const legacy = JSON.parse(JSON.stringify(withChain[0]));
    delete legacy.panels.marketRank;

    const page = await browser.newPage({ viewport: { width: 320, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker });

    const got = await page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
      const blocks = [...host.querySelectorAll(".fmr-block")];
      return {
        tags: blocks.map((b) => {
          const n = b.querySelector("[data-empty]");
          return n ? n.getAttribute("data-empty") : null;
        }),
        texts: blocks.map((b) => b.textContent),
        /* The silence paragraph on its own, so an assertion about how the
           SENTENCE opens is not reading the block's heading first. */
        said: blocks.map((b) => {
          const n = b.querySelector("[data-empty]");
          return n ? n.textContent.trim() : null;
        }),
        /* THE PANEL MUST NOT TAKE THE PAGE SIDEWAYS AT 320px, and this
           panel is the one at risk: it is the only reading on the page whose
           values are prose-length strings — a unit phrase, a UTC stamp, a
           whole absence sentence — rather than a table inside a scrolling
           wrapper.

           MEASURED AS A SPILL, NOT AS scrollWidth. Every .ft-panel on this
           page reports the same 15px of scrollWidth over clientWidth from
           its own chrome, so a scrollWidth test would fail identically on all
           twenty-two and would be measuring the box rather than the content.
           What matters is whether any descendant's right edge passes the
           panel's own — and, one level up, whether the DOCUMENT scrolls
           sideways at all. */
        spill: (() => {
          const s = document.querySelector('.ft-panel[data-panel="marketRank"]');
          const right = s.getBoundingClientRect().right;
          let worst = 0;
          const walk = (n) => {
            for (const c of n.children) {
              worst = Math.max(worst, c.getBoundingClientRect().right - right);
              walk(c);
            }
          };
          walk(s);
          return Math.round(worst);
        })(),
        pageSideways: document.documentElement.scrollWidth -
                      document.documentElement.clientWidth,
      };
    });

    eq(got.tags[0], "quiet",
       "a name the feed was READ without finding is tagged quiet — the request succeeded and " +
       "the market answered, and only the third silence is a fact about the market");
    /* THE WORD, NOT THE PUNCTUATION AFTER IT. This read /Unavailable\./ and so
       stopped catching anything the moment the lead-ins took an em dash — a
       negative check that matches a stale spelling passes by seeing nothing.

       AND NO BOUNDARY IN FRONT OF IT. The first attempt at this fix wrote
       /\bUnavailable\b/, which is WEAKER here, not stronger: textContent
       concatenates the block's heading straight onto the paragraph, so the
       real string is "Off-exchange printsUnavailable — ..." and there is no
       word boundary between the s and the U. A leading \b would let the
       banner through exactly where this assertion is meant to catch it. */
    ok(!/Unavailable\b/.test(got.texts[0]),
       "and it never wears the Unavailable banner");
    ok(/^Not in this feed\b/.test(got.said[0]),
       "leading instead on the reading itself — the card's other quiet lead-in, \"Nothing " +
       "to report\", is false here: what is being reported is that the feed WAS read and " +
       "this name was not in it");
    ok(/is not in the market-wide open-interest change feed/.test(got.texts[0]),
       `carrying the publisher's own sentence ("${got.texts[0].slice(0, 90)}")`);
    ok(/rows covering/.test(got.texts[0]),
       "which still reports the population the absence was measured against");
    ok(/last place in the feed held|fewer rows than/.test(got.texts[0]),
       "and the cut it did not clear, so a near miss and a name nowhere near it read " +
       "differently");

    eq(got.tags[1], "unavailable", "a feed that did not come back is tagged unavailable");
    ok(/Unavailable\b/.test(got.texts[1]), "and does wear the banner");
    ok(/timeout/.test(got.texts[1]), "with the reason it was given, verbatim");

    ok(got.spill <= 0,
       `at 320px nothing in the panel reaches past the panel's own edge (${got.spill}px)`);
    ok(got.pageSideways <= 0,
       `and the page itself does not scroll sideways with it mounted (${got.pageSideways}px)`);
    await page.close();

    const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    page2.on("pageerror", (e) => errors.push(String(e)));
    await mount(page2, legacy, { ticker: legacy.ticker });
    const said = await page2.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
      const n = host.querySelector("[data-empty]");
      return { tag: n ? n.getAttribute("data-empty") : null, text: host.textContent };
    });
    eq(said.tag, "unavailable", "a card built before the join shipped is an unavailability");
    ok(/before the market-wide join shipped/.test(said.text),
       "dated by ITS OWN wave — telling this reader the card predates the per-name deep " +
       "feeds would be a confident wrong fact about which card they are looking at");
    eq(errors.length, 0, "neither silence throws");
    await page2.close();
  }

  /* ---------- 6d. the open-interest basis note --------------------

     THE CAPTION USED TO MAKE A CLAIM THE PAYLOAD HAD ALREADY REFUTED.
     It read "ΔOI is open_interest − prev_oi: what stuck overnight, as
     against what churned", which asserts two things the vendor never
     states: that the two open-interest counts bracket the same span as
     the volume, and that the span is one night. describeOiBasis exists
     to test the first, and on a live run it found four of eight
     contracts whose open interest moved further than their own volume —
     which cannot happen across one settlement. The measurement was
     logged and thrown away while the page kept asserting the opposite.

     All three verdicts are staged here because the ASYMMETRY is the
     whole reading: exceeding rows falsify the pairing, while zero
     exceeding rows prove nothing at all. A note that phrased the second
     as reassurance would be the confident inference this panel exists
     to avoid, and it would read as the more natural sentence — which is
     exactly why it needs a test and not a comment. */
  {
    const base = withChain.find((c) => c.panels.topContracts.oiBasis);
    ok(base, "an emitted card carries the basis check on its top-contracts panel");

    const staged = (verdict, seen, exceeded) => {
      const c = JSON.parse(JSON.stringify(base));
      c.panels.topContracts.oiBasis = {
        seen, exceeded, exceedShare: seen ? exceeded / seen : null,
        verdict, minVolume: 250,
      };
      return c;
    };

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const read = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="topContracts"] > div');
        const note = host.querySelector(".ftt-oibasis");
        const basis = host.querySelector(".ftt-basis");
        return {
          note: note ? note.textContent : null,
          cls: note ? note.className : null,
          empty: note ? note.getAttribute("data-empty") : null,
          caption: basis ? basis.textContent : "",
          /* Everything the ΔOI column says in its tooltips, which is where
             the overnight claim survived longest. */
          doiTitles: [...host.querySelectorAll(".ftt-doi[title]")]
            .map((n) => n.getAttribute("title")).join(" "),
        };
      });
    };

    const falsified = await read(staged("falsified", 105, 4));
    ok(falsified.note, "a falsified check renders a note beside the table");
    ok(/\b4\b/.test(falsified.note) && /\b105\b/.test(falsified.note),
       "carrying both counts, so the reader can see the share for themselves");
    ok(/250/.test(falsified.note),
       "and the volume floor, so '4 of 105' beside a ten-row table is not a contradiction");
    ok(/NOT/.test(falsified.note),
       "and saying plainly that the two counts are not describing the same span");
    ok(!/inconclusive/i.test(falsified.note),
       "a falsification is not hedged: this is the branch that actually proves something");

    const inconclusive = await read(staged("inconclusive", 105, 0));
    ok(/INCONCLUSIVE/.test(inconclusive.note),
       "a zero count says INCONCLUSIVE in the sentence, not merely in a comment");
    ok(/not evidence/i.test(inconclusive.note),
       "and refuses the reading that finding none confirms the pairing");
    ok(!/aligned\.|confirm|verified/i.test(inconclusive.note),
       "with no word that would let a skimming reader take it as reassurance");

    const nodata = await read(staged("no-data", 0, 0));
    eq(nodata.empty, "quiet",
       "and a check that could not run is the MEASURED silence, not a failure");
    ok(/could not be checked/i.test(nodata.note),
       "saying which of the silences it is");

    /* THE CONTRADICTORY PAYLOAD, which is where the first draft of this
       renderer was wrong. A "falsified" verdict whose count is absent fell
       through to the branch that says "none of 105 exceeded" — a confident
       claim about every contract on the chain, built from a number nobody
       read, and the FRIENDLIER of the two available sentences. That is the
       house defect exactly, and it appeared in the code written to fix an
       instance of it, so it is pinned in both directions. */
    const noCount = await read(staged("falsified", 105, null));
    ok(!/none of/i.test(noCount.note),
       "a verdict with no count never falls through to claiming none exceeded");
    eq(noCount.empty, "unavailable",
       "it is a publisher fault and is tagged as one, not as a measured silence");

    const contradictory = await read(staged("falsified", 105, 0));
    ok(!/none of/i.test(contradictory.note),
       "and a falsified verdict carrying zero exceeding rows is not reported as the quiet half " +
       "of its own contradiction");
    eq(contradictory.empty, "unavailable", "that too is a publisher fault");

    /* THE CAPTION ITSELF. The claim is gone from the prose and from every
       tooltip on the column — a note that contradicts the sentence above it
       would leave the reader to pick, and they would pick the shorter one. */
    for (const got of [falsified, inconclusive, nodata, noCount, contradictory]) {
      ok(!/stuck overnight/i.test(got.caption),
         "the caption no longer claims ΔOI is what stuck overnight against what churned");
      ok(!/overnight/i.test(got.doiTitles),
         "and no ΔOI tooltip names a span the vendor never stamped");
    }
    ok(/spacing|whatever span/i.test(falsified.caption),
       "it says instead that the spacing of the two counts is unstated");

    eq(errors.length, 0, "and none of the three verdicts throws");
    await page.close();
  }

  /* ---------- 6e. the conviction arithmetic ------------------------

     THE PANEL SHOWED THE PARTS AND NEVER THE SUM. Conviction is a weighted
     blend of agreement, source coverage and persistence; this list published
     two of those three terms and the weights lived only in
     shared/flows-features.js, so a reader could see 67%, 5-of-5 and a
     conviction of 76 with no way to connect them — and the missing third
     term could move the composite eleven points with nothing on the card
     accounting for it.

     The line is drawn ONLY when the terms reconstruct the published number.
     An identity that does not close is worse than no identity, because it
     invites trust in a derivation the numbers do not support — so the
     broken cases below must render nothing rather than something wrong. */
  {
    const base = withChain.find((c) => c.conv && c.conv.weights &&
      isFinite(c.conviction) && c.conv.persistence !== null);
    ok(base, "an emitted card carries the full conviction decomposition");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const readMath = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="__score"] > div');
        const math = host.querySelector(".fc-conv-math");
        return { math: math ? math.textContent : null, said: host.textContent };
      });
    };

    const good = await readMath(base);
    ok(good.math, "the arithmetic is stated beside the terms it uses");
    ok(good.math.includes("Conviction " + base.conviction),
       "naming the published composite, so the reader knows which number is being explained");
    /* THE WEIGHTS COME FROM THE PAYLOAD. A renderer restating 0.45/0.35/0.20
       in its own prose is a second copy of a constant that has already moved
       once, and on the day it moves again the page describes arithmetic the
       pipeline did not do — the sector-momentum defect, in prose. */
    for (const [k, w] of Object.entries(base.conv.weights)) {
      ok(good.math.includes(Math.round(w * 100) + "%"),
         `the ${k} weight is the payload's own (${Math.round(w * 100)}%), not a copy in the renderer`);
    }
    ok(/persistence/i.test(good.said),
       "and persistence, the term this panel never showed, is in the stat list");
    ok(/COUNT/.test(good.math) && /steps/.test(good.math),
       "the note says agreement is a count that steps, which is why two nearby " +
       "convictions can differ by a whole axis");

    /* THREE WAYS FOR IT NOT TO CLOSE, and none may draw a line. */
    const mutate = (fn) => { const c = JSON.parse(JSON.stringify(base)); fn(c); return c; };
    const broken = await readMath(mutate((c) => { c.conviction = c.conviction + 7; }));
    ok(!broken.math,
       "a composite the terms do not reconstruct draws no arithmetic at all");
    const noPer = await readMath(mutate((c) => { c.conv.persistence = null; }));
    ok(!noPer.math, "nor does a card missing the third term");
    const noWeights = await readMath(mutate((c) => { delete c.conv.weights; }));
    ok(!noWeights.math, "nor a card published before the weights shipped");
    ok(/Conviction/.test(noWeights.said),
       "though the composite itself still prints — losing the derivation is not losing the number");

    eq(errors.length, 0, "and none of the four states throws");
    await page.close();
  }

  /* ---------- 6f. the score laid over the price -------------------

     THE CHART THE DIRECTIVE ASKED FOR, and the one whose failure mode is
     invisible: two ~40-point series zipped by position draw a smooth,
     plausible, entirely fictional line. The join is tested in
     tests/flows-overlay-contract.mjs against a fixture built to break an
     index join; what is tested HERE is that the drawing tells the truth
     about what the join returned — above all that a gap breaks the line
     rather than being bridged or zeroed. */
  {
    const base = withChain.find((c) =>
      c.panels.scoreOverlay && c.panels.scoreOverlay.status === "ok" &&
      c.panels.scoreOverlay.rows.length >= 6);
    ok(base, "an emitted card carries a joined score overlay");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const readOvl = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="scoreOverlay"] > div');
        const svg = host.querySelector("svg.ovl");
        const score = host.querySelector(".ovl-score");
        return {
          hasSvg: !!svg,
          viewBox: svg ? svg.getAttribute("viewBox") : null,
          par: svg ? svg.getAttribute("preserveAspectRatio") : null,
          box: svg ? (({ width, height }) => ({ width, height }))(svg.getBoundingClientRect()) : null,
          scoreD: score ? score.getAttribute("d") : null,
          dots: host.querySelectorAll(".ovl-dot").length,
          band: !!host.querySelector(".ovl-band"),
          said: host.textContent,
          aria: svg ? svg.getAttribute("aria-label") : null,
          empty: [...host.querySelectorAll("[data-empty]")].map((n) => n.getAttribute("data-empty")),
        };
      });
    };

    const good = await readOvl(base);
    ok(good.hasSvg, "the overlay draws a chart");
    eq(good.par, "xMidYMid meet",
       "with the aspect ratio that keeps one viewBox unit at one CSS pixel — `none` " +
       "scales the axes independently and distorts every slope on the panel");
    /* THE REPOSITORY'S CHART INVARIANT, measured from the visible host. */
    const vbW = Number(good.viewBox.split(/\s+/)[2]);
    const ratio = good.box.width / vbW;
    ok(Math.abs(ratio - 1) < 0.02,
       `one viewBox unit is one CSS pixel (drawn ${vbW}, laid out ${good.box.width.toFixed(1)}, ` +
       `ratio ${ratio.toFixed(3)})`);
    ok(/\bM/.test(good.scoreD), "the score line is drawn");
    ok(good.aria && /sessions from/.test(good.aria),
       "and the chart names its own window to a screen reader");

    /* ---- THE GAP. A hole must break the path, not bridge it. ---- */
    const holed = JSON.parse(JSON.stringify(base));
    const mid = Math.floor(holed.panels.scoreOverlay.rows.length / 2);
    holed.panels.scoreOverlay.rows[mid].score = null;
    holed.panels.scoreOverlay.scored -= 1;
    holed.panels.scoreOverlay.gaps += 1;
    const gapped = await readOvl(holed);
    const moveCount = (d) => (d.match(/M/g) || []).length;
    eq(moveCount(gapped.scoreD), moveCount(good.scoreD) + 1,
       "a hole in the middle splits the score path into one more subpath — the line " +
       "BREAKS rather than bridging a session nobody scored");
    ok(/no score/i.test(gapped.said),
       "and the panel says in words how many sessions carry no score");

    /* ---- A LONE SCORED SESSION BETWEEN TWO HOLES. A one-point subpath has
       no length and renders as nothing at all, so a real measurement would
       simply vanish. It gets a dot instead. ---- */
    const island = JSON.parse(JSON.stringify(base));
    const rows = island.panels.scoreOverlay.rows;
    for (let i = 0; i < rows.length; i++) if (i !== 2) rows[i].score = null;
    island.panels.scoreOverlay.scored = 1;
    island.panels.scoreOverlay.gaps = rows.length - 1;
    const lone = await readOvl(island);
    eq(lone.dots, 1, "a scored session with holes on both sides is drawn as a dot, not lost");

    /* ---- A ZERO IS A READING, NOT A HOLE. ---- */
    const zeroed = JSON.parse(JSON.stringify(base));
    zeroed.panels.scoreOverlay.rows[mid].score = 0;
    const atZero = await readOvl(zeroed);
    eq(moveCount(atZero.scoreD), moveCount(good.scoreD),
       "a measured zero does NOT break the line: it is a name sitting at neutral, " +
       "which is a reading this system publishes and means");

    /* ---- THE TWO EMPTY STATES, which are not the same sentence. ---- */
    const disjoint = JSON.parse(JSON.stringify(base));
    disjoint.panels.scoreOverlay = {
      status: "quiet",
      reason: "the price window and the score window do not share a single session",
      priceSpan: { from: "2027-01-04", to: "2027-03-01", sessions: 42 },
      scoreSpan: { from: "2026-08-03", to: "2026-08-24", sessions: 16 },
      overlap: 0,
    };
    const noOverlap = await readOvl(disjoint);
    ok(!noOverlap.hasSvg, "disjoint windows draw no chart");
    ok(noOverlap.empty.includes("quiet"),
       "and are tagged as the MEASURED silence: both windows were read in full");

    const absent = JSON.parse(JSON.stringify(base));
    absent.panels.scoreOverlay = {
      status: "unavailable",
      reason: "the score track was not assembled this run",
    };
    const noTrack = await readOvl(absent);
    ok(noTrack.empty.includes("unavailable"),
       "while a track that was never assembled is the pipeline-side absence, tagged " +
       "differently — a reader must be able to tell a skipped leg from a name that " +
       "was never on a board");

    eq(errors.length, 0, `the overlay renders without throwing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6g. the second-order Greeks -------------------------

     PAID FOR, PUBLISHED, AND INVISIBLE until now. These three come off a
     vendor call the pipeline was already making, and they sat on every card
     with no renderer — the same failure the four chain panels had, repeated
     while this suite was green, because nothing asserted the payload→registry
     direction. That assertion now exists in §1; this section checks the
     drawing.

     THE SIGN CONVENTION IS THE THING TO GET RIGHT. The payload says the
     vendor's put leg is dealer-signed against its call leg for gamma and
     charm and is NOT for vanna — on the same endpoint. So the two legs must
     never be netted, and this proves the renderer does not net them by
     counting the bars. */
  {
    const base = withChain.find((c) =>
      ["vanna", "charm", "deltaExposure"].every((k) =>
        c.panels[k] && c.panels[k].status === "ok" && c.panels[k].rows.length >= 2));
    ok(base, "an emitted card carries all three second-order Greek ladders with data");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, base, { ticker: base.ticker });

    for (const key of ["vanna", "charm", "deltaExposure"]) {
      const panel = base.panels[key];
      const got = await page.evaluate((k) => {
        const host = document.querySelector('.ft-panel[data-panel="' + k + '"] > div');
        if (!host) return null;
        const svg = host.querySelector("svg.gts");
        const bars = [...host.querySelectorAll(".gts-bar")];
        const zero = host.querySelector(".gts-zero");
        return {
          bars: bars.length,
          calls: bars.filter((b) => b.classList.contains("is-call")).length,
          puts: bars.filter((b) => b.classList.contains("is-put")).length,
          above: bars.filter((b) => b.classList.contains("is-pos")).length,
          below: bars.filter((b) => b.classList.contains("is-neg")).length,
          zeroY: zero ? Number(zero.getAttribute("y1")) : null,
          negBelow: bars.filter((b) => b.classList.contains("is-neg"))
            .every((b) => Number(b.getAttribute("y")) >= (zero ? Number(zero.getAttribute("y1")) - 0.5 : 0)),
          par: svg ? svg.getAttribute("preserveAspectRatio") : null,
          said: host.textContent,
        };
      }, key);

      ok(got, `panel ${key} has a drawing host`);
      /* ONE BAR PER PRESENT LEG, NEVER ONE PER EXPIRY. If the renderer ever
         nets the two legs this count halves, which is the cheapest possible
         detector for the defect the sign convention warns about. */
      let legs = 0;
      for (const r of panel.rows) {
        if (typeof r.call === "number") legs++;
        if (typeof r.put === "number") legs++;
      }
      eq(got.bars, legs,
         `${key}: one bar per PRESENT leg (${legs}), never one per expiry — the two legs ` +
         `are never netted, because the vendor's put convention differs by Greek`);
      ok(got.calls > 0 && got.puts > 0,
         `${key}: both legs are drawn and told apart by class`);
      ok(got.negBelow,
         `${key}: every negative leg is drawn BELOW the zero line — sign lives in position, ` +
         `so it survives greyscale and a printout`);
      eq(got.par, "xMidYMid meet",
         `${key}: one viewBox unit is one CSS pixel`);
      /* THE UNIT IS THE PAYLOAD'S OWN, not a copy in the renderer: three
         panels share one drawer and only the unit distinguishes a per-day
         figure from a per-vol-point one. */
      ok(got.said.includes(panel.unit),
         `${key}: the panel's own published unit is on the page verbatim`);
      ok(got.said.includes(panel.signConvention),
         `${key}: and its sign convention, which is why nothing here is a direction`);
      ok(/[Gg]ross size/.test(got.said),
         `${key}: the total is labelled a SIZE — with two un-nettable legs it cannot be a direction`);
    }

    /* A MEASURED ZERO IS NOT AN ABSENCE, and on this panel the difference is
       a hairline bar versus no bar at all. */
    const zeroed = JSON.parse(JSON.stringify(base));
    zeroed.panels.charm.rows[0].call = 0;
    zeroed.panels.charm.rows[0].put = null;
    await mount(page, zeroed, { ticker: zeroed.ticker });
    const zg = await page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="charm"] > div');
      const bars = [...host.querySelectorAll(".gts-bar")];
      return {
        flats: bars.filter((b) => b.classList.contains("is-flat")).length,
        flatHeight: bars.filter((b) => b.classList.contains("is-flat"))
          .map((b) => Number(b.getAttribute("height"))),
      };
    });
    eq(zg.flats, 1, "a leg measured at exactly zero is still drawn");
    ok(zg.flatHeight.every((h) => h >= 1),
       "as a visible hairline, because a zero-height bar is indistinguishable from the leg " +
       "the vendor never sent — and those are different facts");

    eq(errors.length, 0, `the Greek ladders render without throwing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6h. the page was a dead end -------------------------

     The index renders only when `?t=` is absent, so a reader who had arrived
     on a name could not reach another one without editing the URL — on a
     section whose whole purpose is comparing names against each other.

     THE BOARDS MUST NOT BE FETCHED UNLESS THE CONTROL IS USED. Two requests
     on every ticker page view would be paid by every reader to serve the few
     who switch, and the card is what this page is. That is asserted first,
     because it is the property a later "simplification" would quietly lose. */
  {
    const card = withChain[0];
    const boards = { rows: [{ t: "AAA", r: 1, s: 40, dp: 1 }, { t: "BBB", r: 2, s: 30, dp: 1 }] };
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, card, { ticker: card.ticker, boards });

    const before = await page.evaluate(() =>
      window.__requested.filter((u) => u.includes("/api/flows/board")).length);
    eq(before, 0,
       "loading a named ticker page fetches NO board — the switcher's cost is paid only " +
       "by the readers who use it");

    const btn = await page.evaluate(() => {
      const b = document.getElementById("ftSwitch");
      return b ? { hidden: b.hidden, text: b.textContent } : null;
    });
    ok(btn && !btn.hidden, "but the control is there, in the header, beside the name");

    await page.click("#ftSwitch");
    await page.waitForSelector("#ftPickerBody tr");
    const after = await page.evaluate(() => ({
      fetched: window.__requested.filter((u) => u.includes("/api/flows/board")).length,
      rows: [...document.querySelectorAll("#ftPickerBody .ft-link")].map((a) => a.textContent),
      gridHidden: document.getElementById("ftGrid")
        ? document.getElementById("ftGrid").hidden
        : document.querySelector(".ft-grid").hidden,
      backShown: !document.getElementById("ftBackTo").hidden,
      backText: document.getElementById("ftBackTo").textContent,
      note: document.getElementById("ftPickerNote").textContent,
    }));
    ok(after.fetched > 0, "clicking it fetches the boards, then");
    ok(after.rows.includes("AAA"), "and the index lists the names to switch to");
    ok(after.backShown,
       "opened FROM a name, the picker offers a way back — hiding twenty panels with no " +
       "return is a worse dead end than the one this fixes");
    ok(after.backText.includes(card.ticker),
       `and names it (${after.backText.trim()}), so the reader knows what they are returning to`);
    ok(after.note.includes(card.ticker), "the note says which name they are on");

    /* CLICKING AGAIN MUST NOT RE-FETCH. Opening the switcher twice is not two
       different questions. */
    await page.click("#ftBackTo");
    await page.click("#ftSwitch");
    await page.waitForSelector("#ftPickerBody tr");
    const twice = await page.evaluate(() =>
      window.__requested.filter((u) => u.includes("/api/flows/board")).length);
    eq(twice, after.fetched, "re-opening the switcher re-uses what it already fetched");

    /* AND THE WAY BACK ACTUALLY RESTORES THE PAGE. */
    await page.click("#ftBackTo");
    const restored = await page.evaluate(() => ({
      pickerHidden: document.getElementById("ftPicker").hidden,
      panels: document.querySelectorAll(".ft-panel[data-panel]").length,
      headShown: !document.getElementById("ftHead").hidden,
    }));
    ok(restored.pickerHidden, "going back hides the index");
    ok(restored.headShown, "restores the header");
    ok(restored.panels > 15, `and the panels are still there (${restored.panels})`);

    eq(errors.length, 0, `the switcher throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6i. the overview station opens on the series -------------

     THE LEAD HAS MOVED TWICE AND BOTH MOVES ARE THE SAME ARGUMENT. The score
     derivation used to be entry 21 of 21, below a twenty-panel scroll; it was
     promoted to first because a reader arrives from a board row carrying a
     score. It is second now, under the score-over-price series, because a
     station is what a reader LANDS on and the series is the only panel that
     can say a reading is NEW — the derivation explains a number that has not
     changed since publication, the overlay says what it DID.

     Asserted on the REGISTRY and on the rendered DOM, because the page is
     generated from the registry and a test that only read the registry would
     pass on a page that never mounted it. */
  {
    eq(TICKER_PANELS[0].key, "scoreOverlay",
       "the score-over-price series is the first panel the registry mounts");
    eq(TICKER_PANELS[0].tier, "lead", "and it is the Overview station's lead");
    eq(TICKER_PANELS[1].key, "__score",
       "with the derivation directly under it — demoted, not dropped: still the second " +
       "thing the page says about the number a reader arrived carrying");
    eq(TICKER_PANELS[0].span, 2,
       "the series keeps both columns, because a 60-session line in a 424px host is a " +
       "sparkline and the panel's whole claim is that a reading is new");
    eq(TICKER_PANELS[1].span, 1,
       "and the derivation gives its second column up — five gauges and their weights set " +
       "their own width, and a span-2 host spent the rest on white space");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });
    const order = await page.evaluate(() =>
      [...document.querySelectorAll(".ft-panel[data-panel]")].map((s) => s.dataset.panel));
    eq(order[0], "scoreOverlay",
       "and it is first in the document too — a reader arrives from a board row carrying " +
       "a score, and the first thing the page owes them is what that score has done since");
    eq(order[1], "__score", "with the derivation second in the document as well");
    await page.close();

    /* THE OTHER THREE MOVES, PINNED AS ADJACENCIES rather than as indices. An
       index is wrong the moment a panel is added above it and would then be
       "fixed" by renumbering, which is not the claim. The claim is that these
       pairs answer one question at two resolutions and belong beside each
       other. */
    const at = (key) => TICKER_PANELS.findIndex((p) => p.key === key);
    eq(at("displacement"), at("levels") + 1,
       "where the book is MOVING sits directly under the walls it is moving relative to, " +
       "with the gamma surface — a different question about the same book — no longer " +
       "between them");
    eq(at("path"), at("aggressor") + 1,
       "the session path sits directly under the lifted strikes: the same executions once " +
       "by strike and once by clock, with the fifty-row contract table out from between them");
    eq(at("marketRank"), at("context") + 1,
       "and the market-wide standing sits directly under the name's own year — one question " +
       "at two scales, no longer split by the congressional disclosures");
    eq(TICKER_GROUPS[0].label, "Overview",
       "the first station is labelled Overview: it is the station a reader LANDS on, and " +
       "\"Signal\" named a group of panels rather than a place to arrive");
    eq(TICKER_GROUPS[0].key, "signal",
       "while its key is still `signal`, the ?s= value in every link the boards have sent " +
       "since the card dialog was retired");
  }

  /* ---------- 6j. the registry's chrome reaches the page --------------

     TWENTY-ONE PANELS IN ONE FLAT SCROLL, no index, no group boundaries and
     no way to link a colleague to one of them. The registry now carries a
     `group` and a `tier` for every panel — but `shared/` is never served, so
     the browser cannot import it and the controller keeps a PANEL_CHROME
     projection of the same two fields.

     A PROJECTION IS ONLY SAFE IF SOMETHING COMPARES IT. This is that
     comparison, and it is made against the RENDERED DOM rather than against
     the controller's source: reading the table out of the file would prove
     the two literals match and nothing about whether either reached a panel.
     Both directions, because one direction is how four published panels went
     undrawn for weeks. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const dom = await page.evaluate(() =>
      [...document.querySelectorAll(".ft-panel[data-panel]")].map((s) => ({
        key: s.dataset.panel, group: s.dataset.group, tier: s.dataset.tier, id: s.id,
      })));

    eq(dom.length, TICKER_PANELS.length, "every registry panel is mounted");
    for (let i = 0; i < TICKER_PANELS.length; i++) {
      const want = TICKER_PANELS[i];
      eq(dom[i].key, want.key, `panel ${i} of the DOM is the registry's ${want.key}`);
      /* REGISTRY → DOM. A group or tier that never reaches an element is a
         field the emitter and the controller disagree about. */
      eq(dom[i].group, want.group,
         `${want.key} is mounted in its registry group (${want.group})`);
      eq(dom[i].tier, want.tier,
         `${want.key} wears its registry chrome tier (${want.tier})`);
      /* DOM → REGISTRY. A panel the controller had no chrome entry for would
         mount with no group and no tier at all, and would look like an
         ordinary chart rather than like the omission it is. */
      ok(dom[i].group && dom[i].tier,
         `${want.key} carries BOTH a group and a tier — a panel the controller's ` +
         `chrome table has never heard of mounts with neither`);
      eq(dom[i].id, "panel-" + want.key,
         `${want.key} has its own fragment id, so it can be linked to`);
    }

    /* THE VALUES ARE LEGAL, not merely present. A tier with no stylesheet
       rule is a box with no chrome and a group with no heading is a panel
       that never appears in the index. */
    const groupKeys = TICKER_GROUPS.map((g) => g.key);
    for (const p of TICKER_PANELS) {
      ok(groupKeys.includes(p.group), `panel "${p.key}" names a declared group`);
      ok(PANEL_TIERS.includes(p.tier), `panel "${p.key}" names a declared tier`);
    }

    /* THE GROUPS ARE CONTIGUOUS AND IN THE DECLARED ORDER. Non-contiguous
       groups would make the heading meaningless — a "Tape" heading followed
       by two tape panels, a volatility panel and another tape panel is worse
       than no heading, because it says the boundary is real. */
    const runs = [];
    for (const p of TICKER_PANELS) {
      if (!runs.length || runs[runs.length - 1] !== p.group) runs.push(p.group);
    }
    eq(runs.length, new Set(runs).size,
       `each group is one contiguous run (${runs.join(" ")})`);
    eq(runs.join(","), groupKeys.join(","),
       "and the runs come in the order the group list declares");

    /* EXACTLY ONE LEAD PER GROUP, AND IT IS FIRST. With 21 boxes of identical
       chrome the eye has no way to find the primary reading of a section, so
       the lead wears heavier chrome — which is only true if there is exactly
       one of it and it is the panel the reader meets first. */
    for (const g of TICKER_GROUPS) {
      const members = TICKER_PANELS.filter((p) => p.group === g.key);
      ok(members.length > 0, `group "${g.key}" has panels in it`);
      const leads = members.filter((p) => p.tier === "lead");
      eq(leads.length, 1, `group "${g.key}" has exactly one lead panel`);
      eq(members[0].tier, "lead",
         `and it is the group's first panel (${members[0].key}), not one buried inside it`);
    }
    eq(TICKER_PANELS[0].key, "scoreOverlay",
       "and the very first lead is the score-over-price series");

    /* THE GRID IS FIVE STATIONS AND NOTHING ELSE, each opening with its own
       heading. The headings used to be siblings of the panels, inserted
       between them by the controller; inside the section they name, they let
       a later change hide a group by hiding ONE element rather than a heading
       and then panels counted until the next one. DOM order is still reading
       order and still tab order. */
    const flow = await page.evaluate(() =>
      [...document.getElementById("ftGrid").children].map((n) => ({
        tag: n.tagName, cls: n.className, group: n.dataset.group, side: n.dataset.side,
        role: n.getAttribute("role"), labelledBy: n.getAttribute("aria-labelledby"),
        head: (() => {
          const h = n.querySelector(":scope > .ft-group");
          return h ? { id: h.id, text: h.textContent, group: h.dataset.group } : null;
        })(),
        lead: !!n.querySelector(":scope > .ft-station-lead"),
        keys: [...n.querySelectorAll(":scope > .ft-panel[data-panel]")]
          .map((s) => s.dataset.panel),
        firstChildIsHead: n.firstElementChild &&
          n.firstElementChild.classList.contains("ft-group"),
      })));
    eq(flow.length, TICKER_GROUPS.length,
       `the grid holds exactly the five stations and nothing beside them (${flow.length})`);
    for (let i = 0; i < TICKER_GROUPS.length; i++) {
      const g = TICKER_GROUPS[i];
      const st = flow[i];
      eq(st.cls, "ft-station", `station ${i} is a station`);
      eq(st.group, g.key, `and it is ${g.key}'s, in the order the registry declares`);
      /* THE `?s=` ADDRESS IS ON THE SECTION, not derived at read time. Every
         board row, deck tile and watch row already links here with one. */
      eq(st.side, g.key, `and carries its own ?s= address (${g.key})`);
      eq(st.role, "tabpanel",
         "and is served as a tabpanel — the structure is in the document, not added to it " +
         "by a script, so the served page and the scripted page are the same page");
      eq(st.labelledBy, g.hash, "labelled by its own heading rather than by a repeated string");
      ok(st.firstChildIsHead, `and the heading is the station's first child (${g.key})`);
      ok(st.lead, `the station carries its empty lead slot (${g.key})`);
      eq(st.head.id, g.hash,
         `heading ${i} carries the group's own fragment id (${g.hash}) — a slug computed ` +
         `at render time would break every link the moment a label was reworded`);
      eq(st.head.group, g.key, "and names its own group, which is what the tab row matches on");
      ok(st.head.text.includes(g.label), `and its label (${g.label})`);
      /* THE WHOLE SENTENCE, NOT ITS FIRST FORTY CHARACTERS. This guarded a
         second copy of all five sentences kept in the controller; that copy
         is gone — the worker emits them straight from the registry — and the
         assertion stays, because what it pins now is that the blurb REACHES
         the page intact rather than truncated or escaped into something else
         on the way. */
      eq(st.head.text, g.label + g.blurb,
         `and the group's own published sentence in full, verbatim (${g.key})`);
      eq(st.keys.join(","),
         TICKER_PANELS.filter((p) => p.group === g.key).map((p) => p.key).join(","),
         `and the station holds exactly its own panels, in registry order (${g.key})`);
      eq(st.keys.length, STATION_SIDE_COUNTS[g.key],
         `and as many of them as STATION_SIDE_COUNTS says (${g.key})`);
    }
    eq(flow.reduce((n, s) => n + s.keys.length, 0), TICKER_PANELS.length,
       "and between them the five stations hold every panel — a panel in no station is a " +
       "panel no tab can ever reach");

    /* THE TAB ROW. Five served tabs, each naming a station and how many
       panels it holds, plus the one link out of the five. Every href
       resolves: a tab pointing at a renamed heading silently does nothing. */
    const nav = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll(".ft-tabs .ft-tab")].map((a) => ({
        href: a.getAttribute("href"), group: a.dataset.group, side: a.dataset.side,
        role: a.getAttribute("role"), controls: a.getAttribute("aria-controls"),
        selected: a.getAttribute("aria-selected"),
        count: a.querySelector(".ft-tab-n") ? a.querySelector(".ft-tab-n").textContent : null,
        text: a.textContent.trim(),
      }));
      const all = document.querySelector(".ft-all-link");
      const bar = document.querySelector(".ft-bar");
      return {
        tabs,
        dead: tabs.map((t) => t.href).filter((h) => {
          try { return !document.getElementById(decodeURIComponent(h.slice(1))); }
          catch { return true; }
        }),
        deadControls: tabs.map((t) => t.controls).filter((id) => !document.getElementById(id)),
        allText: all ? all.textContent.trim() : null,
        allSide: all ? all.dataset.side : null,
        tablist: document.querySelector(".ft-tabs")
          ? document.querySelector(".ft-tabs").getAttribute("role") : null,
        sticky: bar ? getComputedStyle(bar).position : null,
        holdsHead: !!(bar && bar.contains(document.getElementById("ftHead"))),
        headIsFirst: !!(bar && bar.firstElementChild &&
          bar.firstElementChild.id === "ftHead"),
        holdsTabs: !!(bar && bar.querySelector(".ft-tabs")),
        holdsBand: !!(bar && bar.querySelector(".ft-band")),
      };
    });
    eq(nav.tablist, "tablist", "the station row is a tablist");
    eq(nav.tabs.map((t) => t.href).join(","), TICKER_GROUPS.map((g) => "#" + g.hash).join(","),
       "the tab row lists every station, in reading order");
    eq(nav.tabs.map((t) => t.group).join(","), TICKER_GROUPS.map((g) => g.key).join(","),
       "and each tab names the station it opens");
    eq(nav.dead.length, 0,
       `every tab's anchor resolves to an element (${nav.dead.join(", ")})`);
    eq(nav.deadControls.length, 0,
       `and every aria-controls names a section that exists (${nav.deadControls.join(", ")})`);
    for (const g of TICKER_GROUPS) {
      const tab = nav.tabs.find((t) => t.group === g.key);
      eq(tab.role, "tab", `the ${g.key} tab is a tab`);
      eq(tab.side, g.key, `and carries the ?s= address it will set (${g.key})`);
      eq(tab.controls, "ftst-" + g.key, `and controls its own station (${g.key})`);
      /* NOTHING IS SELECTED WHILE EVERYTHING IS SHOWN. Every station is
         visible in this change, so a tab claiming selection would be a claim
         about the page that is not true of it. */
      eq(tab.selected, "false",
         `and is not selected (${g.key}) — all five stations are open, so none of them is ` +
         `the one a tab has chosen`);
      eq(tab.count, String(STATION_SIDE_COUNTS[g.key]),
         `and prints how many panels it holds (${g.key}), from the one export the station ` +
         `itself is built from — a count written twice is wrong about no panel, only about ` +
         `their number`);
    }
    eq(nav.allText, "All " + TICKER_PANELS.length + " panels",
       `the way out of the five names the real total (${TICKER_PANELS.length})`);
    eq(nav.allSide, "all", "and carries the ?s= value that will mean every station");
    eq(nav.sticky, "sticky",
       "the identity bar is sticky — it used to scroll away after the first panel, " +
       "taking the name, the score and the session date with it");
    ok(nav.holdsHead && nav.holdsTabs && nav.holdsBand,
       "and carries the identity, the tabs and the fixed band, so none outscrolls the rest");
    ok(nav.headIsFirst,
       "with the identity FIRST inside it — the controller moves the served header in at " +
       "the top rather than appending it under the tabs that index it");

    eq(errors.length, 0, `the workspace chrome throws nothing (${errors.join("; ")})`);
    await page.close();

    /* THE JUMP CHIPS ARE A REAL TOUCH TARGET, MEASURED BY HIT-TESTING.

       They are 25px boxes carrying a 44px transparent pseudo-element, which
       is the pattern .ft-zoom-open already uses — and it silently did not
       work here: a box with overflow-x auto has its overflow-y COMPUTED to
       auto, so the strip is a scroll container in BOTH axes and clipped the
       extension back to the chip. Nothing looked wrong; the control simply
       claimed a target it did not have. A geometry assertion on the
       pseudo-element's declared height would have passed on the broken
       version, so this walks the viewport with elementFromPoint and counts
       the rows of pixels that actually hit the anchor. */
    const touch = await browser.newPage({ viewport: { width: 320, height: 900 } });
    await mount(touch, withChain[0], { ticker: withChain[0].ticker });
    const hit = await touch.evaluate(() => {
      const b = document.querySelector(".ft-tab");
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      let span = 0;
      for (let y = Math.round(r.top) - 25; y <= Math.round(r.bottom) + 25; y++) {
        if (document.elementFromPoint(cx, y) === b) span++;
      }
      return { box: Math.round(r.height), span };
    });
    ok(hit.span >= 44,
       `a station tab is at least 44px of hit area at 320px (${hit.span}px over a ` +
       `${hit.box}px box) — the extension is worthless if its own scroll container clips it`);
    await touch.close();
  }

  /* ---------- 6j. the chrome's rules ship in the stylesheet ----------

     THEY USED TO BE INJECTED. assets/js/flows-ticker.js carried a 236-line
     CSS template literal and appended it to document.head on first paint,
     which is integration debt with three costs a test can state:

       - AN INJECTED SHEET IS NEVER FETCHED, so no ?v= reaches it. A reader
         holding a cached bundle got old rules under new markup, and one
         holding a cached flows.css got the reverse. (That the pages ask for
         the stylesheet WITH a version at all is asserted in
         tests/flows-features.mjs; this is the other half — that the rules are
         in the file being versioned.)
       - NO CSS SUITE COULD READ IT. tests/flows-sign.mjs asserts that every
         polarity class a renderer emits resolves to a rule in flows.css; the
         change block's four states were exempt purely by living somewhere
         that suite does not read. A neutral class with no rule is not
         neutral, it is invisible.
       - IT WAS JAVASCRIPT BYTES on the route tests/flows-weight.mjs weighs.

     ASSERTED IN BOTH DIRECTIONS, because either half alone lets the debt
     regenerate: the controller must inject nothing, AND every class the
     chrome actually emits must resolve to a rule in the file the page links.

     THE CLASS LIST IS READ OFF THE BUILT DOM, never typed here. A list would
     go stale the moment a chip was added, and it would go stale silently —
     which is the exact failure mode the injected sheet had. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const sheets = await page.evaluate(() => ({
      styles: document.querySelectorAll("style").length,
      injected: !!document.getElementById("ftWorkspaceCSS"),
      /* Every class on the bar, the change block and the group headings —
         the three regions that exist ONLY because this controller built
         them, and therefore the three whose rules had no other home. */
      classes: (() => {
        const set = new Set();
        const roots = [document.querySelector(".ft-bar"),
                       document.querySelector(".ft-change"),
                       ...document.querySelectorAll(".ft-group")];
        for (const root of roots) {
          if (!root) continue;
          for (const n of [root, ...root.querySelectorAll("*")]) {
            for (const c of n.classList) set.add(c);
          }
        }
        return [...set].sort();
      })(),
    }));

    ok(!sheets.injected,
       "the controller installs no stylesheet of its own — #ftWorkspaceCSS is gone, and with " +
       "it the sheet no cache-busting query string could ever reach");
    eq(sheets.styles, 2,
       `the document carries exactly the two stylesheets this harness added (${sheets.styles}) ` +
       "— base.css and flows.css. A third is a renderer writing CSS at runtime, which is the " +
       "debt this section exists to keep paid off");

    const src = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
    ok(!/createElement\(\s*["']style["']\s*\)/.test(src),
       "and the source builds no <style> element, so the assertion above cannot pass merely " +
       "because a fixture never reached the code path that injects one");
    ok(!/adoptedStyleSheets|insertRule\(/.test(src),
       "nor reaches the CSSOM by the other two doors — adoptedStyleSheets and insertRule are " +
       "the same debt written differently, and both are equally invisible to a CSS suite");

    /* A rule, not merely a mention: the class has to appear as a SELECTOR.
       `\.name` followed by anything that is not a class-name character is
       what distinguishes `.ft-chg-v` the selector from `ft-chg-value` the
       word in a comment — comments are stripped first for the same reason
       tests/flows-sign.mjs strips them. */
    const CSS_TEXT = fs.readFileSync(path.join(ROOT, "assets/css/flows.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    ok(sheets.classes.length >= 20,
       `the chrome emits ${sheets.classes.length} classes to check — read off the built DOM, ` +
       "so a chip added tomorrow is checked tomorrow rather than whenever this list is edited");
    for (const c of sheets.classes) {
      const rule = new RegExp("\\." + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
      ok(rule.test(CSS_TEXT),
         `.${c} resolves to a rule in assets/css/flows.css — the chrome's own classes are in ` +
         "the versioned stylesheet now, not in a string the browser never asked for");
    }
    await page.close();
  }

  /* ---------- 6k. the page leads on CHANGE ----------------------------

     THE PRODUCT IS READ AS AN EARLY WARNING AND THE PAGE OPENED ON A
     SNAPSHOT. Twenty-one panels described one session in enormous detail and
     nothing said what the number had done: no move against the previous
     scored session, no run, no dead-band crossing, no notice that the newest
     reading was three sessions old.

     EVERY FIXTURE BELOW IS AN EMITTED CARD WITH NAMED SCORES MUTATED, and the
     mutation is the branch. A crossing, a multi-session gap and a stale
     reading do not all occur in one dry run, and a fixture that cannot reach
     the branch it certifies is this repository's most repeated mistake. */
  {
    const base = withChain.find((c) =>
      c.panels.scoreOverlay && c.panels.scoreOverlay.status === "ok" &&
      c.panels.scoreOverlay.rows.length >= 6 &&
      typeof c.panels.scoreOverlay.deadBand === "number");
    ok(base, "an emitted card carries a joined overlay with a published dead band");
    const BAND = base.panels.scoreOverlay.deadBand;

    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    /** An emitted card whose last two scored sessions are set by name. */
    const staged = (fn) => {
      const c = JSON.parse(JSON.stringify(base));
      fn(c.panels.scoreOverlay, c.panels.scoreOverlay.rows);
      const ovl = c.panels.scoreOverlay;
      /* The counters are kept honest with the rows the mutation left behind,
         so the overlay panel below the block does not contradict it. A
         mutation that removes `rows` outright is one of the two silences and
         has no counters to keep. */
      if (Array.isArray(ovl.rows)) {
        ovl.scored = ovl.rows.filter((r) => typeof r.score === "number").length;
        ovl.gaps = ovl.rows.length - ovl.scored;
      }
      return c;
    };

    const read = async (card) => {
      await mount(page, card, { ticker: card.ticker });
      return page.evaluate(() => {
        const c = document.getElementById("ftChange");
        const pick = (sel) => {
          const n = c && c.querySelector(sel);
          return n ? n.textContent : "";
        };
        const chip = (id) => {
          const n = document.getElementById(id);
          return n ? { text: n.textContent, empty: n.getAttribute("data-empty") } : null;
        };
        return {
          hidden: !c || c.hidden,
          text: c ? c.textContent : "",
          lead: pick(".ft-chg-lead"),
          event: pick(".ft-chg-e"),
          stale: pick(".ft-chg-stale"),
          empties: c ? [...c.querySelectorAll("[data-empty]")]
            .map((n) => n.getAttribute("data-empty")) : [],
          d1: chip("ftD1"), price: chip("ftPrice"), side: chip("ftSide"),
          flip: (() => {
            const n = document.getElementById("ftFlip");
            return n ? {
              text: n.textContent,
              empty: n.getAttribute("data-empty"),
              cls: n.className,
              title: n.getAttribute("title") || "",
            } : null;
          })(),
        };
      });
    };

    /* THE ORDINARY CASE: the newest scored session and the one before it. */
    const rows = base.panels.scoreOverlay.rows;
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    /* THE GUARD IS AN ASSERTION, NOT AN `if`. It used to be a bare condition
       around five assertions, so an emitted card whose last two sessions were
       not both scored would have skipped them in silence — the block would
       still print a passing suite while certifying nothing. The fixture
       requirement is now stated, and a run that cannot meet it fails here
       instead of quietly shrinking. */
    ok(typeof last.score === "number" && typeof prev.score === "number",
       `the emitted card's last two sessions are both scored (${prev.d}, ${last.d}), so ` +
       "the ordinary-case assertions below actually run");
    {
      const got = await read(base);
      ok(!got.hidden, "the change block is drawn above the panels");
      ok(got.lead.includes(prev.d),
         `the headline names the previous scored session (${prev.d})`);
      ok(/1 session earlier/.test(got.lead),
         "and how many sessions the move spans — a delta without its gap is the defect " +
         "this layer replaced");
      ok(/score points?\b/.test(got.text),
         "the move carries its unit: a bare number is not a reading, and the score is an " +
         "index whose differences are POINTS rather than percent");
      ok(got.d1 && /session/.test(got.d1.text),
         `the sticky header carries the move and its gap too (${got.d1 && got.d1.text})`);

      /* THE DISTANCE TO THE GAMMA FLIP, IN THE HEADER.

         It is the most forward-looking number the card carries, and it used to
         sit at panel 4 of 22 in the de-emphasised `reading` tier while the
         header held a hidden <span id="ftQuote"> that no JavaScript ever wrote
         to. The span is gone; these assertions are what stop the chip going
         the same way — an element nothing tests can be deleted by omission,
         which is exactly how the board's filter died.

         THE FLIP IS STAGED, NOT BORROWED FROM THE CORPUS. The first draft
         asserted against whatever `base` happened to carry and its own
         guard-on-the-guard caught it: the card selected for its overlay
         resolves NO gamma flip, so every assertion here would have passed by
         never running. That is the failure this file names as its most
         repeated mistake, and it fired on the commit that introduced it.
         Staged numbers also let the exact string be asserted rather than a
         pattern that would match a wrong magnitude. */
      const flipCard = JSON.parse(JSON.stringify(base));
      flipCard.panels.levels = {
        status: "ok", spot: 100, atr: 2,
        levels: [{ kind: "gamma_flip", label: "Gamma flip", px: 104,
                   distPct: 0.04, distAtr: 2 }],
      };
      const fg = await read(flipCard);
      ok(fg.flip, "the header carries a flip-distance chip (#ftFlip)");
      ok(fg.flip && /\+4\.0%/.test(fg.flip.text),
         `the distance is drawn from the panel's own measurement, signed and in percent ` +
         `(${fg.flip && fg.flip.text}) — read rather than re-derived, so the header and ` +
         `the levels table cannot disagree about a denominator`);
      ok(fg.flip && /to flip/.test(fg.flip.text),
         "and names what the distance is TO — a signed percent alone, in a header of " +
         "prices and score points, does not say which of them it is measured against");
      ok(fg.flip && /\+2\.00σ/.test(fg.flip.text),
         `and carries the same distance in this name's own ATR (${fg.flip && fg.flip.text}), ` +
         "which is the figure that compares across names: 4% is a routine day in one book " +
         "and a three-sigma move in another");
      ok(fg.flip && /is-above/.test(fg.flip.cls),
         "a flip above spot takes the GEOMETRY class, not the directional palette: the " +
         "levels table already states that above-or-below is a fact about where the price " +
         "is and not a bullish or bearish claim");
      ok(fg.flip && !/is-pos|is-neg/.test(fg.flip.cls),
         "and specifically NOT is-pos/is-neg, which would tint a distance with the " +
         "bull/bear hues and turn a measurement into an opinion");
      ok(fg.flip && /gamma flip at \$104\.00/i.test(fg.flip.title),
         "the title states the level itself, so the percent has a price behind it");

      /* SPOT SITTING ON THE FLIP IS A MEASUREMENT, and the one the page most
         needs to state plainly. The class may round it to the brighter grey —
         emphasis costs nothing — but the WORD must not call it "above spot". */
      const onFlip = JSON.parse(JSON.stringify(flipCard));
      onFlip.panels.levels.levels[0] = { kind: "gamma_flip", label: "Gamma flip",
                                         px: 100, distPct: 0, distAtr: 0 };
      const og = await read(onFlip);
      ok(og.flip && /exactly at spot/i.test(og.flip.title),
         `a distance of exactly zero says the name is sitting ON its flip ` +
         `(${og.flip && og.flip.title.slice(0, 90)}) rather than above it — the two-armed ` +
         "form would have called a measured zero “above spot” at the one moment " +
         "the reading matters most");
    }

    /* NO FLIP RESOLVED IS NOT A DISTANCE OF ZERO. 0% in this slot reads as
       "spot is sitting exactly on the flip", which is the single most
       actionable state the page can report — the precise opposite of a ladder
       that resolved nothing. This is the confident zero in the one slot where
       it would be most expensive, so the branch gets a fixture. */
    /* TWO WAYS TO HAVE NO FLIP, AND THEY ARE NOT THE SAME SENTENCE. A ladder
       that was read and produced no sign change is a MEASUREMENT about this
       name's book; a levels panel that never answered is an absence of one.
       The first draft staged only the second and asserted the first's wording,
       which is how a renderer ends up with one apology for two conditions. */
    {
      const ladderRead = JSON.parse(JSON.stringify(base));
      ladderRead.panels.levels = {
        status: "ok", spot: 100, atr: 2,
        levels: [{ kind: "max_pain", label: "Max pain", px: 98,
                   distPct: -0.02, distAtr: -1 }],
      };
      const got = await read(ladderRead);
      ok(got.flip, "the chip is still drawn when the ladder resolved no flip — a header " +
         "that silently loses a slot teaches the eye that the slot means nothing");
      eq(got.flip && got.flip.empty, "unavailable",
         "and it is TAGGED, so a test never has to parse prose to know which silence this is");
      ok(got.flip && !/%/.test(got.flip.text),
         `and prints no percentage at all (${got.flip && got.flip.text}) — least of all ` +
         "0%, which would claim spot is sitting on a flip that was never found");
      ok(got.flip && /not a distance of zero/i.test(got.flip.title),
         "and the title refuses the inference in as many words: a book with no sign change " +
         "over the strikes read has no flip to be near, which is the opposite of being on one");

      const noPanel = JSON.parse(JSON.stringify(base));
      noPanel.panels.levels = { status: "unavailable", note: "no spot price" };
      const np = await read(noPanel);
      eq(np.flip && np.flip.empty, "unavailable",
         "a levels panel that never answered is tagged the same way to a machine");
      ok(np.flip && /not measured/i.test(np.flip.title),
         `but says something different to a reader (${np.flip && np.flip.title.slice(0, 80)}) ` +
         "— nothing was read here, so there is no finding about this name's book to report");
      ok(np.flip && !/no gamma flip resolved/i.test(np.flip.title),
         "and specifically does NOT claim the ladder resolved nothing, which would be a " +
         "statement about the name made from a panel that did not run");
    }

    /* A MOVE OF EXACTLY ZERO IS A MEASUREMENT. It must read as "unchanged",
       never as an absence and never as a missing reading — the two are one
       keystroke apart in every renderer this repository has shipped. */
    const flat = await read(staged((o, r) => { r[r.length - 1].score = r[r.length - 2].score; }));
    ok(/unchanged/i.test(flat.lead),
       `an identical score reads as unchanged (${flat.lead.slice(0, 90)})`);
    ok(flat.d1 && /^0/.test(flat.d1.text.trim()),
       `and the header chip shows the measured zero (${flat.d1 && flat.d1.text})`);
    ok(!/no move to state/i.test(flat.lead),
       "and is NOT reported as an absence — a measured zero and an unmeasured session " +
       "are different facts");

    /* THE FOUR DEAD-BAND VERDICTS. The band is the board's own membership
       rule, so crossing it is the event and everything else is drift. */
    const cleared = await read(staged((o, r) => {
      r[r.length - 2].score = 0;
      r[r.length - 1].score = BAND + 40;
    }));
    ok(/cleared the dead band/i.test(cleared.event),
       `a name leaving the band is called out as the entry event (${cleared.event})`);
    ok(/actionable/i.test(cleared.event), "in the words the payload's own layer uses");

    const faded = await read(staged((o, r) => {
      r[r.length - 2].score = BAND + 40;
      r[r.length - 1].score = 0;
    }));
    ok(/faded into the dead band/i.test(faded.event),
       `a name entering the band is the exit signal (${faded.event})`);

    const flipped = await read(staged((o, r) => {
      r[r.length - 2].score = BAND + 40;
      r[r.length - 1].score = -(BAND + 30);
    }));
    ok(/flipped/i.test(flipped.event),
       `a sign change outside the band on both ends is a flip (${flipped.event})`);

    const held = await read(staged((o, r) => {
      r[r.length - 2].score = BAND + 40;
      r[r.length - 1].score = BAND + 45;
    }));
    ok(/no crossing/i.test(held.event),
       "and a name that did not cross says so, rather than leaving a blank where the " +
       "event would be");
    ok(held.empties.includes("quiet"),
       "tagged as the MEASURED silence: both ends were scored and neither crossed");

    /* THE BAND ITSELF CAN BE ABSENT, and then the crossing is UNKNOWN rather
       than absent — the friendlier of the two sentences is the wrong one. */
    const noBand = await read(staged((o) => { o.deadBand = null; }));
    ok(/cannot be stated/i.test(noBand.event),
       `an unpublished dead band makes the crossing unknowable, and says so (${noBand.event})`);
    ok(noBand.empties.includes("unavailable"),
       "and tags it as a publisher-side absence, not as a measured one");
    ok(!/no crossing/i.test(noBand.event),
       "it never reports 'no crossing' from a band nobody published — that is a " +
       "confident answer built out of a missing input");

    /* A GAP IS NOT AN OVERNIGHT MOVE. Null the previous session and the same
       delta now spans two sessions with the name unscored in between. */
    const gapped = await read(staged((o, r) => {
      r[r.length - 2].score = null;
      r[r.length - 1].score = BAND + 40;
    }));
    ok(/2 sessions earlier/.test(gapped.lead),
       `the gap is counted and printed (${gapped.lead.slice(0, 120)})`);
    ok(/not an overnight one/i.test(gapped.lead),
       "and the sentence refuses the overnight reading a bare delta would invite");

    /* A STALE READING SAYS SO BEFORE IT SAYS ANYTHING ELSE. */
    const stale = await read(staged((o, r) => { r[r.length - 1].score = null; }));
    ok(/1 session old/.test(stale.stale),
       `a newest session with no score for this name is announced as stale (${stale.stale.slice(0, 110)})`);
    ok(stale.stale.length > 0 && stale.text.indexOf(stale.stale.slice(0, 20)) <
       stale.text.indexOf(stale.lead.slice(0, 20)),
       "and the staleness line comes BEFORE the move, so no reader takes the move for " +
       "this morning's");

    /* THE RUN, AND THE GAP IT REFUSES TO STEP OVER. */
    const broken = await read(staged((o, r) => {
      for (let i = 0; i < r.length; i++) r[i].score = BAND + 10;
      r[r.length - 4].score = null;
    }));
    ok(/consecutive scored sessions on the bullish side/i.test(broken.text),
       "the run states its side and its length");
    ok(/not\s+stepped over that gap/i.test(broken.text),
       "and says it stopped at an unscored session rather than counting through it — " +
       "continuity nobody measured is not continuity");

    /* A NEWEST SCORE OF EXACTLY ZERO IS THE CENTRE OF THE BAND, not a run of
       zero on some side. */
    const atZero = await read(staged((o, r) => { r[r.length - 1].score = 0; }));
    ok(/exactly zero/i.test(atZero.text),
       "a newest score of zero is named as the centre of the dead band");
    ok(!/on the bullish side|on the bearish side/i.test(atZero.text.split("Derived from")[0]),
       "and is not assigned a side it does not hold");

    /* ONE SCORED SESSION IS NOT A MOVE OF ZERO. */
    const lone = await read(staged((o, r) => {
      for (let i = 0; i < r.length - 1; i++) r[i].score = null;
      r[r.length - 1].score = BAND + 5;
    }));
    ok(/no move to state/i.test(lone.lead),
       "a single scored session states the reading and refuses to derive a move from it");
    ok(/not a move of zero/i.test(lone.lead),
       "in the words that rule out the substitution");
    ok(!lone.d1, "and the header carries no move chip at all rather than a zero");

    /* THE THREE SILENCES, one sentence and one tag each. */
    const unavailable = await read(staged((o) => {
      o.status = "unavailable";
      o.reason = "the score track was not assembled this run";
      delete o.rows;
    }));
    ok(unavailable.text.includes("the score track was not assembled this run"),
       "an unavailable track prints the publisher's own reason verbatim");
    ok(unavailable.empties.includes("unavailable"), "and is tagged as a publisher fault");

    const quiet = await read(staged((o) => {
      o.status = "quiet";
      o.reason = "the price window and the score window do not share a single session";
      delete o.rows;
    }));
    ok(quiet.empties.includes("quiet"),
       "two windows read in full and found disjoint is the MEASURED silence");
    ok(!quiet.empties.includes("unavailable"),
       "and never wears the unavailable tag — one is a skipped leg, the other an " +
       "ordinary state for a name new to the board");

    const legacy = JSON.parse(JSON.stringify(base));
    delete legacy.panels.scoreOverlay;
    const predates = await read(legacy);
    ok(/predates|built before/i.test(predates.text),
       `a card from before the overlay dates its own absence (${predates.text.slice(0, 110)})`);
    ok(predates.empties.includes("unavailable"), "and tags it as an absence, not a silence");

    /* THE IDENTITY STRIP. Price, side and score, from the card's own panels —
       and each absence named rather than dashed. */
    const idOk = await read(base);
    ok(/^\$\d/.test(idOk.price.text.trim()),
       `the strip carries the spot the card was measured at (${idOk.price.text})`);
    ok(idOk.side.text.trim().length > 0, `and the side (${idOk.side.text})`);

    /* THE SIDE IS THE CARD'S PUBLISHED SCORE READ AGAINST THE PUBLISHED BAND,
       so the fixture stages the score itself — mutating the overlay's newest
       row would test a different number. A score of +1 with a band of ±1 is
       not a bullish name; it is a name the board declined to rank, and the
       header calling it bullish is exactly the confident reading this product
       exists to refuse. */
    const inside = JSON.parse(JSON.stringify(base));
    inside.score = BAND;
    const inBand = await read(inside);
    ok(/dead band/i.test(inBand.side.text),
       `a score inside the band is not called bullish (${inBand.side.text})`);
    ok(!/bullish|bearish/i.test(inBand.side.text),
       "and is given no side at all, because it holds none");

    const noSpot = JSON.parse(JSON.stringify(base));
    for (const k of ["levels", "pricedMove", "gamma"]) {
      noSpot.panels[k] = { status: "unavailable", reason: "no spot price" };
    }
    const priceless = await read(noSpot);
    eq(priceless.price.empty, "unavailable",
       "a card whose three spot-carrying panels are all unavailable says the price is " +
       "UNAVAILABLE — never $0.00, which is what Number(null) would have produced");
    ok(!/\$0/.test(priceless.price.text), `and prints no dollar figure (${priceless.price.text})`);

    eq(errors.length, 0, `no change-block state throws (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 6l. the shaper itself, on payloads no run produces -------

     changeFrom is the arithmetic the header and the block both read, so it is
     exercised directly as well as through the DOM: a renderer assertion can
     pass on a shaper that returns the right SHAPE and the wrong number. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });
    const got = await page.evaluate(() => {
      const f = window.FlowsPanels.changeFrom;
      const mk = (scores, deadBand) => ({
        status: "ok", deadBand,
        rows: scores.map((s, i) => ({ d: "2026-08-" + String(10 + i).padStart(2, "0"),
          close: 100 + i, score: s })),
      });
      return {
        /* Six sessions, the last two scored one apart. */
        plain: f(mk([5, 6, 7, 8, 9, 12], 1)),
        /* The name is unscored for two sessions before the newest. */
        gapped: f(mk([5, 6, 7, null, null, 12], 1)),
        /* The newest session carries no score: the reading is three old. */
        stale: f(mk([5, 6, 40, null, null, null], 1)),
        /* Inside the band, then outside it. */
        cleared: f(mk([0, 0, 0, 0, 0, 40], 1)),
        /* Outside, then inside. */
        faded: f(mk([40, 40, 40, 40, 40, 0], 1)),
        /* Outside on both ends, opposite signs. */
        flipped: f(mk([40, 40, 40, 40, 40, -40], 1)),
        /* A run broken by an unscored session rather than by a sign change. */
        broken: f(mk([9, 9, null, 9, 9, 9], 1)),
        /* Zero is a reading, not an absence. */
        zero: f(mk([9, 9, 9, 9, 9, 0], 1)),
        /* No band published. */
        bandless: f(mk([0, 0, 0, 0, 0, 40], null)),
        /* Nothing scored at all. */
        empty: f(mk([null, null, null], 1)),
        /* The three non-ok inputs. */
        absent: f(undefined),
        dead: f({ status: "unavailable", reason: "the track was not assembled" }),
        disjoint: f({ status: "quiet", reason: "no shared session" }),
      };
    });

    eq(got.plain.d1.v, 3, "the move is the difference between the two newest scored sessions");
    eq(got.plain.d1.gap, 1, "and an overnight move spans one session");
    eq(got.plain.stale, 0, "a newest session that is scored is not stale");
    eq(got.plain.run, 6, "the run counts every consecutive session on the current sign");
    ok(got.plain.runCapped,
       "and says so when it reached the start of the window — the run may be older than " +
       "this card can see");
    eq(got.plain.ext.hi, 12, "the window high is the largest score in it");
    eq(got.plain.ext.lo, 5, "and the low the smallest");
    eq(got.plain.ext.hiAt, "2026-08-15", "each extreme carries the date it was set on");

    eq(got.gapped.d1.gap, 3,
       "a move over an absence spans every session between the two readings — 3, not 1");
    eq(got.gapped.d1.v, 5, "and is still the difference between the two scored ends");
    eq(got.gapped.run, 1,
       "the run stops at the unscored session rather than counting through it");
    ok(got.gapped.runBroken, "and says which of the two reasons it stopped for");
    ok(!got.gapped.runCapped, "a run that ended at a gap did not end at the window edge");

    eq(got.stale.stale, 3,
       "three unscored sessions after the newest score make the reading three sessions old");
    eq(got.stale.at.d, "2026-08-12", "and the reading itself is dated by ITS session");

    eq(got.cleared.cross, "cleared", "inside the band then outside it is a clearing");
    eq(got.faded.cross, "faded", "outside then inside is a fade");
    eq(got.flipped.cross, "flipped", "outside at both ends on opposite signs is a flip");
    eq(got.plain.cross, null, "and a name that stayed put crossed nothing");
    ok(got.plain.crossKnown,
       "which is KNOWN, because a band was published and both ends were scored");

    eq(got.broken.run, 3, "a run counts back to the gap and stops");
    ok(got.broken.runBroken, "and reports the gap as the reason");

    eq(got.zero.run, 0,
       "a newest score of exactly zero is a run of 0 — the centre of the dead band, not " +
       "a length-zero run on a side it does not hold");
    eq(got.zero.d1.v, -9, "while the move to it is still a measured move");

    eq(got.bandless.band, null, "an unpublished dead band is null, never zero");
    eq(got.bandless.cross, null, "so no crossing is claimed");
    eq(got.bandless.crossKnown, false, "and the renderer is told the difference");
    eq(got.bandless.inside, null,
       "and whether the name sits inside the band is UNKNOWN rather than false");

    eq(got.empty.status, "quiet",
       "a window with no scored session at all is a measured emptiness");
    eq(got.absent.status, "unavailable", "a card with no overlay key predates the panel");
    ok(/built before/.test(got.absent.reason), "and says so");
    eq(got.dead.status, "unavailable", "an unavailable track is a publisher-side absence");
    ok(got.dead.reason.includes("the track was not assembled"),
       "carrying the publisher's own reason");
    eq(got.disjoint.status, "quiet", "and disjoint windows are the measured silence");

    await page.close();
  }

  /* ---------- 6m. deep links, both directions -------------------------

     `location.hash` was read in NO file in this product, so there was no way
     to send a colleague panel 14 — the URL got them the name and a sentence
     told them to scroll. The grid is `hidden` while the card is in flight, so
     the browser's own fragment scroll on load lands on an element with no box
     and does nothing; the controller has to re-run the jump after paint, and
     that is what is asserted here.

     ONE PAGE PER HASH, and the reason is not tidiness. Two goto()s to the
     same path differing only in fragment are a SAME-DOCUMENT navigation:
     Playwright does not reload, mount() injects the two controllers a second
     time into a document that already has them, and the page ends up with two
     of everything. A fresh page per hash is what a reader following a link
     actually gets. */
  {
    const card = withChain[0];
    const target = TICKER_PANELS[TICKER_PANELS.length - 2].key;

    /* THE SCROLL HAS TO SETTLE BEFORE IT IS MEASURED. base.css sets
       `html { scroll-behavior: smooth }`, so a position test that fires the
       moment the target enters the viewport is measuring a page in motion —
       which is how the first draft of this section read a heading at 23px
       against a sticky bar that had not reached its offset yet. Two
       consecutive animation frames at the same offset is settled. */
    const settled = (page) => page.waitForFunction(() => {
      const y = Math.round(window.scrollY);
      const same = window.__lastY === y;
      window.__lastY = y;
      return same && y > 100;
    }, null, { timeout: 8000 });

    const open = async (hash) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker, hash });
      return { page, errors };
    };

    {
      const { page, errors } = await open("panel-" + target);
      await settled(page);
      const landed = await page.evaluate((k) => {
        const s = document.getElementById("panel-" + k);
        const r = s.getBoundingClientRect();
        return {
          top: r.top, focused: document.activeElement === s, scrolled: window.scrollY,
          /* The sticky bar must not be sitting ON the panel the link named. */
          barBottom: document.querySelector(".ft-bar").getBoundingClientRect().bottom,
        };
      }, target);
      ok(landed.scrolled > 200,
         `an incoming #panel-${target} scrolls the page to it (${Math.round(landed.scrolled)}px)`);
      ok(landed.top >= landed.barBottom - 4,
         `and lands BELOW the sticky bar rather than under it (panel ${Math.round(landed.top)}, ` +
         `bar ends ${Math.round(landed.barBottom)})`);
      ok(landed.focused,
         "and focus follows the jump, or a keyboard reader lands on panel 20 and carries " +
         "on tabbing from panel 1");
      eq(errors.length, 0, `a panel deep link throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    /* A GROUP ANCHOR IS THE OTHER HALF OF THE INDEX. */
    {
      const g = TICKER_GROUPS[3];
      const { page, errors } = await open(g.hash);
      await settled(page);
      const grp = await page.evaluate((h) => ({
        scrolled: window.scrollY,
        current: [...document.querySelectorAll(".ft-tab[aria-current='true']")]
          .map((a) => a.getAttribute("href")),
        headTop: document.getElementById(h).getBoundingClientRect().top,
        barBottom: document.querySelector(".ft-bar").getBoundingClientRect().bottom,
        /* AND THE NUMBER EVERY scroll-margin-top IS BUILT FROM, against the
           bar it claims to be: the identity row wraps at a different count
           under the fallback face, so before the controller re-measured on
           document.fonts.ready this read 147 against a 189px bar. */
        said: parseFloat(getComputedStyle(document.getElementById("ftGrid"))
          .getPropertyValue("--ft-bar-h")),
        barIs: document.querySelector(".ft-bar").getBoundingClientRect().height,
      }), g.hash);
      ok(grp.scrolled > 100, "a group anchor scrolls to its heading");
      ok(grp.headTop >= grp.barBottom - 4,
         `and the heading clears the sticky bar rather than hiding behind it ` +
         `(heading ${Math.round(grp.headTop)}, bar ends ${Math.round(grp.barBottom)})`);
      ok(Math.abs(grp.said - grp.barIs) <= 1,
         `and --ft-bar-h is the bar's real height once the webfont has landed ` +
         `(${grp.said} written, ${Math.round(grp.barIs)} measured)`);
      /* AND THE OBSERVER SAYS WHERE YOU ARE. watchGroups() moved from 23 panels
         to 5 stations and nothing bit on it — `current` was collected here and
         never read. Asserted on the BEHAVIOUR, so it survives a rewrite of how
         the observer finds its rows and fails if the marking stops. */
      eq(grp.current.length, 1,
         `exactly one station tab is marked current (${grp.current.join(", ") || "none"})`);
      ok(grp.current[0] && grp.current[0].endsWith("#" + g.hash),
         `and it is the one deep-linked to (${grp.current[0]} for #${g.hash})`);
      eq(errors.length, 0, `a group deep link throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    /* A HOSTILE HASH REACHES getElementById AND NOTHING ELSE. querySelector
       ('#' + hash) throws on anything that is not an identifier, and a throw
       here would take the whole paint down AFTER the card had arrived — the
       worst possible moment, because every panel is already on the page. */
    for (const bad of ["../etc", "panel-<script>", "%%%", "a b c"]) {
      const { page, errors } = await open(encodeURIComponent(bad));
      const alive = await page.evaluate(() =>
        document.querySelectorAll(".ft-panel[data-panel]").length);
      eq(alive, TICKER_PANELS.length, `a hash of ${JSON.stringify(bad)} paints the page anyway`);
      eq(errors.length, 0, `and throws nothing (${errors.join("; ")})`);
      await page.close();
    }

    /* THE OPEN PANEL IS REFLECTED INTO THE URL, and closing puts back what was
       there. replaceState rather than an assignment to location.hash, so
       twenty enlarges do not become twenty back-button steps. */
    {
      const { page, errors } = await open(TICKER_GROUPS[1].hash);
      const before = await page.evaluate(() => location.hash);
      await page.click('.ft-panel[data-panel="gamma"] .ft-zoom-open');
      await page.waitForFunction(
        () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
      const opened = await page.evaluate(() => location.hash);
      eq(opened, "#panel-gamma",
         "enlarging a panel puts that panel in the URL, so a reader can send the chart " +
         "they are looking at");
      await page.keyboard.press("Escape");
      /* WAIT FOR THE HANDLER, NOT FOR THE FLAG.
         `dialog.open` is set to false SYNCHRONOUSLY inside close(); the
         `close` EVENT is queued and fires a task later, and it is that
         handler (flows-ticker.js:4988-4994) which restores the hash and
         returns focus. So a wait on `.open` alone can win the race and read
         location.hash one task too early — which is exactly what happened:
         this assertion passed locally and failed in CI on the same commit,
         reading '#panel-gamma' where it expected the arrival hash. The race
         was always here; a change elsewhere in this file only altered how the
         coin landed.

         FOCUS IS THE THING TO WAIT ON, because it is a DIFFERENT effect of
         the SAME handler — so this is a wait on the handler having run, not a
         wait on the assertion below, which would assert nothing. */
      await page.waitForFunction(
        () => !document.getElementById("ftZoom").open &&
          document.activeElement ===
            document.querySelector('.ft-panel[data-panel="gamma"] .ft-zoom-open'),
        null, { timeout: 3000 });
      const closed = await page.evaluate(() => location.hash);
      eq(closed, before,
         "and closing restores the hash the reader arrived on rather than clearing it");
      /* AND THE WAIT ABOVE IS ITSELF WORTH ASSERTING. Returning focus to the
         button that opened the dialog is what keeps a keyboard reader's place
         in a 23-panel grid; nothing in this file said so until the race made
         it necessary to look. */
      const refocused = await page.evaluate(() => document.activeElement &&
        document.activeElement.closest(".ft-panel[data-panel]").dataset.panel);
      eq(refocused, "gamma",
         "and returns focus to the button that opened it, so a keyboard reader " +
         "keeps their place in the grid");
      eq(errors.length, 0, `the enlarge round trip throws nothing (${errors.join("; ")})`);
      await page.close();
    }
  }

  /* ---------- 6n. a gated name lands on a page that used to deny -----

     EVERY TICKER ON /flows/events/ LINKS HERE, and 57 of the 60 rows on a
     typical funnel payload are gated — so the sentence a reader met most
     often was this one, and both halves of it were wrong for exactly those
     names: "Cards are built only for the names the board publishes, so there
     is nothing to show for this name today — it may be on the watch list."
     A gated name is absent because the board was FORBIDDEN to score it, and
     it cannot be on the watch list, which holds only names that WERE scored
     and landed inside the dead band. */
  {
    const say = async (events) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, { status: "pending", ticker: "ZZZ" }, {
        ticker: "ZZZ",
        boards: { rows: [{ t: "QQQ", r: 1, s: 5, dp: 1 }] },
        events,
      });
      const got = await page.evaluate(() => ({
        text: document.getElementById("ftStatus").textContent,
        href: (document.querySelector("#ftStatus a") || {}).getAttribute
          ? document.querySelector("#ftStatus a").getAttribute("href") : null,
      }));
      eq(errors.length, 0, `the absent-name branch throws nothing (${errors.join("; ")})`);
      await page.close();
      return got;
    };

    const gated = await say({
      gateOrigin: "2026-09-03", gateDays: 12,
      rows: [{ t: "ZZZ", d: "2026-09-08", dte: 5, st: "gated", s: null }],
    });
    ok(gated.text.includes("2026-09-08"),
       `a gated name is told when it reports (${gated.text.slice(0, 120)})`);
    ok(/5 calendar days/.test(gated.text),
       "with the count in its own unit — calendar days, which is what the gate measures in");
    ok(gated.text.includes("2026-09-03"),
       "and the origin the gate counted from, so the number can be checked");
    ok(/BEFORE the composite ran/.test(gated.text),
       "and says the gate fired before any score existed — not that it scored badly");
    ok(/not a low one/.test(gated.text),
       "which is the reading a reader would otherwise take");
    ok(!/it may be on the watch list/.test(gated.text),
       "the false watch-list suggestion is gone");
    ok(/holds only names that were scored/.test(gated.text),
       "and is replaced by what the watch list actually holds");
    eq(gated.href, "/flows/events/",
       "and the page offers the way on, which the old dead end did not");

    const stalled = await say({
      gateOrigin: "2026-09-03", gateDays: 12,
      rows: [{ t: "ZZZ", d: "2026-11-01", dte: 59, st: "eligible", s: null }],
    });
    ok(/eligible/.test(stalled.text),
       `a name that cleared the gate is told which stage it stopped at (${stalled.text.slice(0, 120)})`);
    ok(/cleared the earnings gate/.test(stalled.text),
       "and told that it was NOT gated — the opposite fact from the row above");
    ok(!/BEFORE the composite ran/.test(stalled.text),
       "and never borrows the gated sentence");

    /* THE SILENCE HAS TWO CAUSES AND ONLY THE ONE THAT OPERATED IS NAMED.
       The sentence used to say "that calendar is capped" whatever the payload
       said, and on the emitted funnel the cap did not bind at all — a
       confident wrong cause dressed as caution. The calendar's WINDOW is the
       cause that always applies and it is published, so it is what is stated;
       the cap is added only when `capBound` says it bound. */
    const missing = await say({
      gateOrigin: "2026-09-03", gateDays: 12, windowDays: 21, capBound: false, rows: [],
    });
    ok(/cannot say which stage/.test(missing.text),
       `a name with no funnel row gets no invented stage (${missing.text.slice(0, 120)})`);
    ok(/21 calendar days/.test(missing.text),
       `and is told the window the calendar covers, in its own unit (${missing.text.slice(0, 160)})`);
    ok(/silence here is a missing row, not evidence/.test(missing.text),
       "so its silence is not read as evidence about the name — the reassuring inference " +
       "is the one refused here");
    ok(!/capped/.test(missing.text),
       "and a cap that did NOT bind is not offered as the reason: naming a cause that " +
       "did not operate is the same defect as naming none");

    const cappedOut = await say({
      gateOrigin: "2026-09-03", gateDays: 12, windowDays: 21, capBound: true, rows: [],
    });
    ok(/capped/.test(cappedOut.text),
       `and when the cap DID bind the calendar says so (${cappedOut.text.slice(0, 200)})`);
    ok(/does not reach every name even inside it/.test(cappedOut.text),
       "naming what the cap cost — a window the drawing cannot speak for all of");

    const unread = await say({ status: "pending" });
    ok(/could not be read/.test(unread.text),
       `an unreadable funnel says so rather than guessing (${unread.text.slice(0, 120)})`);
    ok(/not on today/.test(unread.text),
       "while still stating the one thing that IS known: the name is not on the board");
  }

  /* ---------- 6o. the station lays nothing out, the question is
                   served, and the second sentinel says PENDING ---------

     THE TRAP THIS SECTION EXISTS FOR. Wrapping 23 panels in five <section>s
     changes every panel host's containing block, and every chart here is drawn
     at its host's MEASURED width with one viewBox unit held to one CSS pixel.
     A border, a padding or an inline margin on the wrapper is a wrong drawing,
     and the symptom is not overflow: base.css gives every svg `max-width:
     100%`, so an over-wide drawing SHRINKS and 9px axis type renders at 8.

     SO THE BOX IS MEASURED DIRECTLY, because nothing else here CAN see this.
     Section 2 cannot: a uniform inset narrows every host, each drawer
     re-measures its own host and draws at the narrowed width, so one viewBox
     unit is still one CSS pixel; and the surface/term alignment is between two
     hosts in the SAME station, which a station-level inset moves together.
     Measured — `padding-left: 4px` on .ft-station passes every section before
     this one, the 320/1280/1840 sweep included, and fails only here. The fix
     is the stylesheet, never a wider tolerance. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    const errors = [];
    const said = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") said.push(m.text()); });
    await mount(page, withChain[0], { ticker: withChain[0].ticker });

    const boxes = await page.evaluate(() => {
      const grid = document.getElementById("ftGrid");
      const gridBox = grid.getBoundingClientRect();
      return {
        gridDisplay: getComputedStyle(grid).display,
        gridWidth: gridBox.width,
        /* THE BAR CARRIES NO DEAD STRIP: every band slot is hidden, so a
           margin under a 0px row is a blank strip, not a reserved height. */
        bandH: document.getElementById("ftBand").getBoundingClientRect().height,
        bandM: getComputedStyle(document.getElementById("ftBand")).marginBottom,
        allM: getComputedStyle(document.getElementById("ftAll")).marginBottom,
        stations: [...document.querySelectorAll(".ft-station")].map((s) => {
          const cs = getComputedStyle(s);
          const r = s.getBoundingClientRect();
          return {
            group: s.dataset.group, display: cs.display,
            pad: [cs.paddingLeft, cs.paddingRight],
            border: [cs.borderLeftWidth, cs.borderRightWidth],
            margin: [cs.marginLeft, cs.marginRight],
            inset: r.left - gridBox.left, width: r.width,
          };
        }),
        /* span-2 panels in three DIFFERENT stations: if a wrapper laid
           anything out they would stop agreeing. */
        wide: ["surface", "ivSurface", "skewTerm", "topContracts"].map((k) => {
          const host = document.querySelector(`#panel-${k} > div`);
          return [k, host ? Math.round(host.clientWidth * 100) / 100 : null];
        }),
      };
    });
    eq(boxes.gridDisplay, "block",
       "the grid itself lays nothing out any more — the track list moved into the stations, " +
       "because a wrapper between a grid and its items un-grids them");
    eq(boxes.bandH, 0, "the served band measures nothing — every one of its slots is hidden");
    eq(boxes.bandM, "0px", "so it carries no margin under it either, until PR 4 paints it");
    eq(boxes.allM, "0px",
       "and the all-panels link declares no vertical margin, which an inline anchor discards");
    for (const st of boxes.stations) {
      eq(st.display, "grid", `the ${st.group} station is the grid now`);
      eq(st.pad.join(" "), "0px 0px", `and adds no inline padding (${st.group})`);
      eq(st.border.join(" "), "0px 0px", `no inline border (${st.group})`);
      eq(st.margin.join(" "), "0px 0px", `and no inline margin (${st.group})`);
      ok(Math.abs(st.inset) < 0.5,
         `so it starts exactly where the grid starts (${st.group}, ${st.inset.toFixed(2)}px in)`);
      ok(Math.abs(st.width - boxes.gridWidth) < 0.5,
         `and is exactly as wide as the grid (${st.group}, ${st.width.toFixed(2)} vs ` +
         `${boxes.gridWidth.toFixed(2)}), so every panel measures what it did before`);
    }
    const wideW = boxes.wide.filter(([, w]) => w !== null).map(([, w]) => w);
    ok(wideW.length >= 3, "there are span-2 panels in more than one station to compare");
    for (const [key, w] of boxes.wide) {
      ok(w !== null, `${key} has a drawing host`);
      ok(Math.abs(w - wideW[0]) <= 1,
         `${key} mounts at the same width as every other span-2 panel (${w} vs ${wideW[0]}), ` +
         `across three stations — which is what proves the wrapper is not in the layout`);
    }

    /* THE QUESTION IS SERVED AND THE DRAWN COPY IS HIDDEN, NOT DELETED. The
       renderer still emits it — section 2 reads that copy and the enlarge
       dialog has no other — but one sentence must not appear twice in a box. */
    const q = await page.evaluate(() => {
      const s = document.getElementById("panel-gamma");
      const served = s.querySelector(".ft-panel-q");
      const drawn = s.querySelector(".fc-q");
      return {
        servedText: served ? served.textContent : null,
        servedShown: !!(served && served.getClientRects().length),
        drawnText: drawn ? drawn.textContent : null,
        drawnShown: !!(drawn && drawn.getClientRects().length),
      };
    });
    eq(q.servedText, TICKER_PANELS.find((p) => p.key === "gamma").question,
       "the served question is the registry's, verbatim");
    ok(q.servedShown, "and a reader can see it");
    eq(q.drawnText, q.servedText,
       "the renderer still draws the same sentence — deleting the drawn copy would pass " +
       "every assertion here and lose the comparison that catches a drawer handed the card " +
       "where it expected the question");
    ok(!q.drawnShown,
       "and the drawn copy is hidden inside the grid, so the reader is asked the question " +
       "once rather than twice in one box");

    /* THE SECOND SENTINEL DRAWS ITS FIGURES NOW. This block asserted a PENDING
       line while the panel was a placeholder; the placeholder is gone, so the
       assertion that pinned it is replaced rather than relaxed. What has to
       stay true is the part that was never about pending: a sentinel has no
       card.panels entry on ANY card, so it must never fall into the "your card
       predates this panel" branch, and it must never render an empty host.
       What the rows themselves say is asserted in section 2c, against payloads
       built there because the emitted corpus carries one constant IV rank
       across all 50 cards and so cannot fail that check. */
    const stats = await page.evaluate(() => {
      const s = document.getElementById("panel-__stats");
      const host = s.querySelector("div");
      const mark = host.querySelector("[data-empty]");
      return {
        sentinel: s.hasAttribute("data-sentinel"),
        childless: host.childElementCount === 0,
        kind: mark ? mark.getAttribute("data-empty") : null,
        text: host.textContent,
        drawnQ: host.querySelector(".fc-q") ? host.querySelector(".fc-q").textContent : null,
        dead: !!host.querySelector(".fc-dead"),
        quiet: !!host.querySelector(".ft-quiet, .fc-quiet"),
        statRows: host.querySelectorAll(".fc-stat").length,
      };
    });
    ok(stats.sentinel, "the key-statistics panel is marked as a sentinel in the served markup");
    ok(!stats.childless,
       "and it renders something — an empty host is the one state a reader cannot tell from " +
       "a broken page");
    ok(stats.statRows >= 8,
       `it draws the gathered figures rather than a placeholder (${stats.statRows} rows)`);
    ok(stats.kind === null || ["quiet", "pending", "unavailable", "unreadable"].includes(stats.kind),
       `and any figure it cannot show wears one of the four silences, never a bare ` +
       `dash (${stats.kind})`);
    ok(!stats.dead,
       "the panel as a whole wears no Unavailable banner — a source panel that declined " +
       "silences its own row and not the seven beside it");
    ok(!/predates|built before/i.test(stats.text),
       `and it never tells a reader their card predates it (${stats.text.slice(0, 70)}) — ` +
       `no card carries a panels.__stats, so that sentence is false on every card`);
    ok(/Spot/.test(stats.text) && /IV rank/.test(stats.text),
       `and it names the figures it gathered (${stats.text.slice(0, 70)})`);
    eq(stats.drawnQ, TICKER_PANELS.find((p) => p.key === "__stats").question,
       "and it heads itself with the registry's question like every other panel");

    /* THE ENLARGE DIALOG KEEPS THE ONLY QUESTION IT HAS, which is why the hide
       rule is scoped to .ft-grid: the dialog carries no served chrome, so a
       global rule would strip the copy a reader looks hardest at. */
    await page.click('#panel-gamma .ft-zoom-open');
    await page.waitForFunction(
      () => document.querySelectorAll("#ftZoomHost svg").length > 0, null, { timeout: 3000 });
    const zoomQ = await page.evaluate(() => {
      const el = document.querySelector("#ftZoomHost .fc-q");
      return { text: el ? el.textContent : null, shown: !!(el && el.getClientRects().length) };
    });
    eq(zoomQ.text, q.servedText, "the enlarged panel carries the same question");
    ok(zoomQ.shown, "and it is visible there, because it is the only copy in the dialog");

    eq(errors.length, 0, `the station structure throws nothing (${errors.join("; ")})`);
    eq(said.filter((t) => /chrome/.test(t)).length, 0,
       `and mountChrome reports nothing against the markup the worker really serves ` +
       `(${said.join(" | ").slice(0, 140)})`);
    await page.close();

    /* ---- AND THE CHROME CHECK ACTUALLY FIRES -------------------------

       PANEL_CHROME stopped writing data-group and data-tier here and became a
       second opinion held against the served ones. A second opinion nobody
       consults is dead weight, and the source comparison further up proves
       only that the two AGREE — the case in which the reporting path never
       runs. So one panel is served in the wrong group and the console is
       read. The MARKUP is mutated, not the table: mutating the table would
       fail that comparison first and never reach this. */
    {
      const badHTML = pageHTML.replace('data-group="tape" data-tier="chart"',
                                       'data-group="context" data-tier="chart"');
      ok(badHTML !== pageHTML,
         "the mutated markup differs from the served page — a replacement that matched " +
         "nothing would prove the check fires by never testing it");
      const bad = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const cried = [];
      bad.on("console", (m) => { if (m.type() === "error") cried.push(m.text()); });
      await mount(bad, withChain[0], { ticker: withChain[0].ticker, html: badHTML });
      ok(cried.some((t) => /chrome/.test(t) && /path/.test(t) && /context/.test(t)),
         `mountChrome reports the disagreement, naming the panel and both answers ` +
         `(${cried.join(" | ").slice(0, 160)})`);
      await bad.close();
    }
  }

  /* ---------- 7. motion, in both states and both halves ----------- */
  {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    await page.mouse.move(300, 300);
    await page.mouse.move(420, 380);
    await page.mouse.move(540, 460);
    const calm = await page.evaluate(() => {
      const p = document.querySelector(".ft-panel");
      const cs = getComputedStyle(p);
      return {
        duration: cs.transitionDuration,
        after: getComputedStyle(p, "::after").display,
        mx: p.style.getPropertyValue("--mx"),
      };
    });
    eq(calm.duration, "0s", "under reduced motion the panel does not transition");
    eq(calm.after, "none", "and the spotlight layer is not painted");
    eq(calm.mx, "", "and the controller never attaches, so no custom property is written");
    await page.close();
  }
  {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 }, reducedMotion: "no-preference" });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    const box = await page.evaluate(() => {
      const p = document.querySelector(".ft-panel");
      /* SCROLLED INTO VIEW FIRST, and `instant` because base.css sets
         `html { scroll-behavior: smooth }` — a rect read in the same tick as a
         smooth scroll is the rect from before it. The sticky bar and the
         change block now sit above the grid, so the first panel starts below
         the fold at this viewport and a mouse.move to a point outside the
         viewport lands on nothing at all. That is a property of the page, not
         of the spotlight this section is about. */
      p.scrollIntoView({ block: "center", behavior: "instant" });
      const r = p.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    /* 70%/60% of the panel, so a hard-coded 50/50 fails. */
    await page.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.6);
    await page.waitForFunction(
      () => document.querySelector(".ft-panel").style.getPropertyValue("--mx") !== "",
      null, { timeout: 2000 });
    const spot = await page.evaluate(() => {
      const p = document.querySelector(".ft-panel");
      return { mx: Number(p.style.getPropertyValue("--mx")),
               my: Number(p.style.getPropertyValue("--my")) };
    });
    ok(Math.abs(spot.mx - 70) < 6, `the spotlight tracks the pointer horizontally (${spot.mx})`);
    ok(Math.abs(spot.my - 60) < 6, `and vertically (${spot.my})`);
    await page.close();
  }
  {
    /* THE ENLARGE BUTTON IS A 44px TARGET without being a 44px box. */
    const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
    const card = withChain[0];
    await mount(page, card, { ticker: card.ticker });
    /* THE HIT AREA IS MEASURED, NOT RECONSTRUCTED. Deriving it as
       `glyph + 2 * inset` requires knowing the glyph's advance, which is a
       property of the font file and silently different under a fallback —
       and it reads a `top` that is now a percentage. The pseudo-element
       declares its own size; read that. */
    const hit = await page.evaluate(() => {
      const b = document.querySelector(".ft-zoom-open");
      const cs = getComputedStyle(b, "::after");
      const r = b.getBoundingClientRect();
      return {
        h: Math.max(r.height, parseFloat(cs.height) || 0),
        w: Math.max(r.width, parseFloat(cs.width) || 0),
      };
    });
    ok(hit.h >= 44, `the enlarge control is at least 44px tall including its hit extension (${hit.h})`);
    ok(hit.w >= 44, `and at least 44px wide (${hit.w})`);

    /* ZERO HORIZONTAL OVERFLOW AT 320px, ON THE WHOLE PAGE.
    
       tests/regression.mjs holds this invariant for the public routes and
       cannot hold it here: /flows/ is credential-gated and is not in its PAGES
       list. So the page that grew a sticky identity strip, a jump strip, a
       collapsed index of every panel, five group headings and a change block —
       all of them built at runtime by the controller, none of them served —
       had no assertion anywhere that it does not take a phone sideways. The
       strips scroll INSIDE themselves at this width; that is the mechanism,
       and this is the measurement that says it works. */
    const spill = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - window.innerWidth,
      body: document.body.scrollWidth - window.innerWidth,
    }));
    ok(spill.doc <= 1,
       `the painted ticker page does not scroll sideways at 320px (${spill.doc}px)`);
    ok(spill.body <= 1, `and neither does its body (${spill.body}px)`);
    await page.close();
  }

  /* ---------- 7. the reading leads, and the method is still there -----

     THE SURVEY THAT PROMPTED THIS SECTION counted 101,768 characters of
     user-facing prose across the fourteen Flows renderers, 42,151 of them on
     this route, and found `.fc-note` — the METHOD paragraph — emitted 87
     times against 4 emissions of `.fc-reading`, the FINDING. The product led
     with its methodology and buried the number a reader came for.

     THE FIX IS AN ORDERING, NOT A DELETION, AND THIS SECTION IS WHAT KEEPS
     IT ONE. Every assertion below is written in a pair: the finding is
     FIRST, and the method is STILL PRESENT AND STILL REACHABLE. A suite that
     asserted only the first half would pass on a renderer that fixed the
     ordering by throwing the caveats away, which is the one outcome this
     product cannot survive — the honesty discipline is the whole value.

     AND THE SPLIT IS ASSERTED IN BOTH DIRECTIONS TOO. A note that could
     change WHAT THE READING MEANS is on the page with nothing to open; a
     note explaining HOW THE READING WAS MADE is behind a disclosure. Both
     halves are checked on the same panel, because a rule with only the first
     half hides caveats and a rule with only the second is just a wall with a
     lid on it.

     MEASURED OFF THE RENDERED PAGE, never off the source: DOM order by
     compareDocumentPosition, size by getComputedStyle, and "reachable" by
     the text being in `textContent` while its <details> is shut — which is
     the same thing a find-in-page reads. */
  {
    /* One evaluator, reused by every arm below. Returns the shape of one
       panel: what leads it, what qualifies it, what is folded behind the
       disclosure, and the two type sizes that carry the visual hierarchy. */
    const READ = (key) => `(() => {
      const host = document.querySelector('.ft-panel[data-panel="${key}"] > div');
      if (!host) return { missing: true };
      const txt = (n) => (n ? n.textContent.replace(/\\s+/g, " ").trim() : null);
      const folded = (n) => {
        const d = n && n.closest("details");
        return d ? { inDetails: true, open: d.open } : { inDetails: false, open: true };
      };
      const leads = [...host.querySelectorAll(".fc-reading.is-lead")];
      const notes = [...host.querySelectorAll(".fc-note")];
      const firstSvg = host.querySelector("svg");
      const firstStats = host.querySelector(".fc-stats");
      const size = (n) => (n ? parseFloat(getComputedStyle(n).fontSize) : null);
      return {
        leads: leads.map(txt),
        leadSize: size(leads[0]),
        noteSize: size(notes[0]),
        /* 4 === DOCUMENT_POSITION_FOLLOWING: the lead comes BEFORE it. */
        leadBeforeChart: !!(leads[0] && firstSvg &&
          (leads[0].compareDocumentPosition(firstSvg) & 4) === 4),
        leadBeforeStats: !!(leads[0] && firstStats &&
          (leads[0].compareDocumentPosition(firstStats) & 4) === 4),
        leadBeforeNote: !!(leads[0] && notes[0] &&
          (leads[0].compareDocumentPosition(notes[0]) & 4) === 4),
        qualifiers: [...host.querySelectorAll(".fc-note.is-qualifier")]
          .map((n) => ({ text: txt(n), ...folded(n) })),
        notes: notes.map((n) => ({ text: txt(n), ...folded(n) })),
        howSummaries: [...host.querySelectorAll("details.ft-how > summary")].map(txt),
        openByDefault: [...host.querySelectorAll("details.ft-how")].map((d) => d.open),
        /* What a find-in-page sees, disclosures shut and all. */
        all: host.textContent.replace(/\\s+/g, " "),
        marked: [...host.querySelectorAll(".fc-why")].length,
        titled: [...host.querySelectorAll("[title]")]
          .filter((n) => n.textContent.replace(/\\s+/g, " ").trim().length <= 48 &&
                         n.textContent.trim())
          .map((n) => ({ marked: n.classList.contains("fc-why"),
                         tag: n.tagName, text: txt(n) })),
        whyList: (() => {
          const box = host.querySelector("details.ft-why");
          if (!box) return null;
          return {
            open: box.open,
            summary: txt(box.querySelector("summary")),
            terms: [...box.querySelectorAll(".ft-why-t")].map(txt),
            whys: [...box.querySelectorAll(".ft-why-d")].map(txt),
            /* A <summary> is focusable with no tabindex at all — that is the
               point of using one, and it is asserted rather than assumed. */
            summaryTab: box.querySelector("summary").tabIndex,
          };
        })(),
        /* NOBODY GAINED A TAB STOP. 145 new stops between one panel and the
           next is the fix this design refused; if it ever lands, it lands
           here. */
        addedTabStops: [...host.querySelectorAll("[title][tabindex]")].length,
        decoration: (() => {
          const n = host.querySelector(".fc-why:not(.fc-stat)");
          if (!n) return null;
          const cs = getComputedStyle(n);
          return { line: cs.textDecorationLine, style: cs.textDecorationStyle,
                   cursor: cs.cursor };
        })(),
      };
    })()`;

    /* --- 7a. the chain's two vol panels, on a card that publishes both -- */
    {
      const card = withChain[0];
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const st = await page.evaluate(READ("skewTerm"));
      const iv = await page.evaluate(READ("ivSurface"));

      /* THE SKEW AND THE TERM ARE THE PANEL'S FINDING and are now the first
         two things in it. Two lead elements, not one joined paragraph: the
         suite scopes "draws no skew number" to the FIRST .fc-reading, and a
         withheld skew beside a published term has to stay digit-free. */
      eq(st.leads.length, 2,
         `skewTerm leads on its two scalars, each in its own element (${st.leads.length})`);
      ok(/^Skew /.test(st.leads[0]),
         `the skew reading is first and says so ("${(st.leads[0] || "").slice(0, 60)}")`);
      ok(/^Term /.test(st.leads[1]),
         `the term reading second ("${(st.leads[1] || "").slice(0, 60)}")`);
      ok(st.leadBeforeChart,
         "and both come BEFORE the chart in DOM order — the chart is the shape of the " +
         "term structure and the scalars are what a desk carries away from it, so the " +
         "picture is now the reading's evidence rather than its preamble");
      ok(st.leadBeforeNote,
         "and before the first method paragraph, which is the ordering this section exists " +
         "for: 87 method paragraphs against 4 readings was the ratio that named the defect");

      /* THE LARGEST TYPE ON THE PANEL, MEASURED. A reading that leads in DOM
         order but is drawn at note size has changed nothing a reader sees. */
      ok(st.leadSize > st.noteSize,
         `the reading is set larger than the method under it (${st.leadSize}px against ` +
         `${st.noteSize}px) — DOM order alone is invisible to someone scanning a page`);

      /* THE METHOD IS STILL THERE, WORD FOR WORD, ONE CLICK AWAY. The axis
         policy is the paragraph that says why the origin is zero and what
         that costs; it may be folded and it may not be deleted. */
      const axis = st.notes.find((n) => /The origin is ZERO/.test(n.text));
      ok(axis, "the axis policy is still on the panel, in full");
      ok(axis && axis.inDetails,
         "behind the panel's own disclosure rather than in the open — 750 characters of " +
         "how-the-bars-were-drawn is a wall a reader scrolls past, not a rule they read");
      ok(axis && !axis.open,
         "and shut by default, which is the whole saving; an open <details> is a paragraph");
      ok(/The origin is ZERO/.test(st.all),
         "and STILL IN textContent with the disclosure shut, so a find-in-page and a " +
         "screen reader's find both reach it — folded is not hidden");
      ok(st.howSummaries.some((t) => /How to read this term structure/.test(t)),
         `the disclosure names what is under it (${JSON.stringify(st.howSummaries)}) — ` +
         "a summary that says nothing is a click a reader will not spend");

      /* --- ivSurface: a panel that used to state no finding at all ------ */
      eq(iv.leads.length, 1, "the surface leads on exactly one reading");
      ok(iv.leadBeforeChart && iv.leadBeforeStats,
         "before its grid and before its stat list — the steepest cell used to be the " +
         "fourth cell of that list, below the fold on a phone");
      ok(/volatility points (above|below)/.test(iv.leads[0]),
         `and it states the steepest cell with its direction in words ("${iv.leads[0]}")`);
      /* THE SIGN IS IN THE GLYPH BEFORE ANY WORD CARRIES IT. */
      ok(/[−+]\d+\.\d volatility points/.test(iv.leads[0]),
         `carrying the sign as a glyph, U+2212 for a negative ("${iv.leads[0]}")`);
      /* ONE MEASUREMENT, TWO PLACES ON SCREEN, AND THEY MUST AGREE. */
      const pts = /([−+]\d+\.\d) volatility points/.exec(iv.leads[0]);
      ok(pts && iv.all.includes(pts[1] + " pts"),
         `the lead and the "Steepest cell" statistic are the same number (${pts && pts[1]}) ` +
         "— it is measured once, at the top of the drawer, so the sentence a reader reads " +
         "first and the cell they check it against cannot drift apart");

      eq(errors.length, 0, "both inverted panels draw without throwing");
      await page.close();
    }

    /* --- 7b. a measured zero is a reading, and an absence is not -------

       THE HOUSE RULE, ON THE ONE SENTENCE THIS WAVE ADDED. `Number(null)` is
       0, so a surface with no measured skew anywhere and a surface measured
       FLAT are one line of code apart and read identically to a reader. They
       get different sentences and this proves it, in both directions, off
       fixtures mutated by name. */
    {
      const flat = JSON.parse(JSON.stringify(withChain[0]));
      let zeroed = 0;
      flat.panels.ivSurface.skew = flat.panels.ivSurface.skew.map((row) =>
        row.map((v) => (typeof v === "number" && Number.isFinite(v) ? (zeroed++, 0) : v)));
      ok(zeroed > 0, `the flat fixture really carries ${zeroed} measured zeros`);

      const gone = JSON.parse(JSON.stringify(withChain[0]));
      gone.panels.ivSurface.skew = gone.panels.ivSurface.skew.map((row) => row.map(() => null));

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      await mount(page, flat, { ticker: flat.ticker });
      const a = await page.evaluate(READ("ivSurface"));
      ok(/measured flat smile/.test(a.leads[0]),
         `a surface measured flat says so ("${a.leads[0]}")`);
      ok(!/above|below/.test(a.leads[0]),
         "and claims no direction, because a zero has none");
      ok(!/No cell/.test(a.leads[0]),
         "and is never told as an absence — a flat smile is a finding about the book, and " +
         "the difference between it and an unmeasured one is the difference this whole " +
         "product is built to keep");
      ok(a.all.includes("Steepest cell"),
         "the statistic still names the cell the reading came from");
      await page.close();

      const page2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      page2.on("pageerror", (e) => errors.push(String(e)));
      await mount(page2, gone, { ticker: gone.ticker });
      const b = await page2.evaluate(READ("ivSurface"));
      ok(/^No cell on this surface carries a measured distance/.test(b.leads[0]),
         `an unmeasured surface leads on the absence instead ("${b.leads[0]}")`);
      ok(!/flat/.test(b.leads[0]), "and never borrows the flat reading's word");
      ok(!b.all.includes("Steepest cell"),
         "and publishes no steepest cell at all, rather than a confident zero in the slot");
      eq(errors.length, 0, "neither arm throws");
      await page2.close();
    }

    /* --- 7c. the qualifiers stay in the open ---------------------------

       THE HALF THAT MAKES THIS AN ORDERING AND NOT A DELETION. A sentence
       that changes WHAT THE READING MEANS may be moved and may not be
       folded: on a card whose chain the vendor truncated the surface is an
       arbitrary page of the book, and on a card whose skew was withheld the
       reason is the reading. Neither may end up behind a click. */
    if (truncated.length) {
      const card = truncated[0];
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const iv = await page.evaluate(READ("ivSurface"));
      const arb = iv.qualifiers.find((n) => /arbitrary subset of the book/.test(n.text));
      ok(arb, "the truncated surface still says the picture may be an arbitrary slice");
      ok(arb && !arb.inDetails,
         "in the open, with nothing to click — this is the line that says the whole picture " +
         "may be a page of the book rather than the book, and a caveat behind a disclosure " +
         "is a caveat most readers will never meet");
      for (const q of iv.qualifiers) {
        ok(!q.inDetails,
           `no qualifier on the surface is folded ("${q.text.slice(0, 55)}") — the split is ` +
           "by whether a note changes what the reading MEANS, never by how long it is");
      }
      eq(errors.length, 0, "the truncated card draws without throwing");
      await page.close();
    }

    /* A WITHHELD SCALAR, PREFERRED FROM THE CORPUS AND STAGED BY NAME WHEN
       THE RUN DID NOT PRODUCE ONE. The dry run's names mostly quote both
       wings, so the branch that matters most here — a withheld number that
       must still LEAD its panel and must still carry no digit — cannot be
       left to whichever cards happened to build. One named field is mutated
       and the mutation is the point of the test. */
    {
      const found = cards.find((c) => c.panels && c.panels.skewTerm &&
        c.panels.skewTerm.status === "ok" && c.panels.skewTerm.skew === null &&
        c.panels.skewTerm.skewReason);
      const card = JSON.parse(JSON.stringify(found || withChain[0]));
      if (!found) {
        card.panels.skewTerm.skew = null;
        card.panels.skewTerm.skewBasis = null;
        card.panels.skewTerm.skewReason =
          "no listed strike sat within 0.04 of either wing on an expiry past the day floor";
      }
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const st = await page.evaluate(READ("skewTerm"));
      ok(st.leads.length === 2,
         `the panel still leads on two scalars with one of them withheld (${st.leads.length})`);
      ok(/^The wing-to-wing skew is not published/.test(st.leads[0] || ""),
         `and the withheld one LEADS ("${(st.leads[0] || "").slice(0, 60)}") — demoting an ` +
         "absence would make a silence cheaper to ship than a number");
      ok(!/\d/.test(st.leads[0] || ""),
         `carrying no digit at all ("${st.leads[0]}"), because a reader who sees a number ` +
         "where a reason belongs has been told something the chain never said");
      ok(st.leadBeforeChart && st.leadBeforeNote,
         "and it is still first — an absence is a finding and is placed like one");

      const why = st.qualifiers.find((n) =>
        /is not published:|Neither scalar is published/.test(n.text));
      ok(why, "the reason it was withheld is on the panel, verbatim");
      ok(why && !why.inDetails,
         `in the open, beside the reading it explains ("${(why.text || "").slice(0, 60)}")`);
      ok(st.qualifiers.every((q) => !q.inDetails),
         "and so is every other qualifier the panel raised");
      eq(errors.length, 0, "the withheld-scalar card draws without throwing");
      await page.close();
    }

    /* --- 7c-ii. A WITHHELD FIGURE IN THE STAT BLOCK NAMES ITS SILENCE ----

       The two scalars above lead the panel in prose. The three figures under
       the chart do not: they are an em dash in a definition list, and an em
       dash on its own is the one absence this product refuses — it reads the
       same whether the card never carried the field, carried it empty, or
       carried bytes this page could not read as a number.

       THE THREE KINDS ARE STAGED ONTO ONE CARD, because the renderer decides
       between them from the SHAPE of the field and nothing else, and a suite
       that exercised one arm would pass on a renderer that hardcoded that
       arm's word. The at-the-money level is nulled with its reason (a chain
       that was measured and levelled nothing — `quiet`), the moneyness band
       is deleted outright (`unavailable`), and then a second page is drawn
       with the level as a string the chain would never publish
       (`unreadable`).

       MEASURED OFF THE RENDERED PAGE, mark included: `content` on ::after is
       read through getComputedStyle, so a kind whose word ships without a
       CSS rule fails here rather than shipping as faint ink alone. */
    {
      const STATS = `(() => {
        const host = document.querySelector('.ft-panel[data-panel="skewTerm"] > div');
        if (!host) return { missing: true };
        return {
          pairs: [...host.querySelectorAll(".fc-stats .fc-stat")].map((s) => {
            const dd = s.querySelector("dd");
            const cs = getComputedStyle(dd);
            return {
              term: (s.querySelector("dt").textContent || "").trim(),
              value: (dd.textContent || "").replace(/\\s+/g, " ").trim(),
              empty: dd.getAttribute("data-empty"),
              why: dd.getAttribute("title"),
              mark: getComputedStyle(dd, "::after").content,
              rule: cs.borderLeftStyle + " " + cs.borderLeftWidth,
              folded: !!dd.closest("details"),
            };
          }),
        };
      })()`;
      const base = withChain.find((c) => c.panels && c.panels.skewTerm &&
        c.panels.skewTerm.status === "ok");
      ok(base, "an emitted card carries a drawn chain panel to withhold figures from");

      const card = JSON.parse(JSON.stringify(base));
      card.panels.skewTerm.atmIv = null;
      card.panels.skewTerm.atmReason =
        "no expiry past the floor carried an at-the-money contract that traded today";
      delete card.panels.skewTerm.atmBand;

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });
      const st = await page.evaluate(STATS);

      const lvl = st.pairs.find((p) => /^At-the-money level/.test(p.term));
      ok(lvl, "the chain panel states its headline at-the-money level as a labelled figure");
      eq(lvl && lvl.value, "—",
         "and withholds it on a card whose chain levelled nothing");
      eq(lvl && lvl.empty, "quiet",
         `naming the silence it is — measured, and empty (${lvl && lvl.empty}) — where a bare ` +
         "dash would read the same as a field this card never carried");
      eq(lvl && lvl.why, card.panels.skewTerm.atmReason,
         "carrying the chain's own reason verbatim rather than a second wording of it");
      ok(lvl && /solid/.test(lvl.rule) === true,
         `and a hairline rule beside it (${lvl && lvl.rule}) — quiet is the one kind that ` +
         "takes no glyph, so without a rule it would be faint ink alone and faint ink is " +
         "one ink in greyscale");
      ok(lvl && !lvl.folded,
         "in the open: a withholding is never folded behind a disclosure");

      const band = st.pairs.find((p) => /^Moneyness band/.test(p.term));
      ok(band, "the band the level was taken inside is stated beside it");
      eq(band && band.empty, "unavailable",
         `and a card that never published that constant says so (${band && band.empty}), ` +
         "which is a different fact from a chain that measured and found nothing");
      eq(band && band.mark, '"†"',
         `wearing the dagger this site gives that kind (${band && band.mark}) — the mark, ` +
         "not the colour, is what separates it from the level above it");
      ok(band && band.why && band.why.length > 40,
         `with the sentence that says what is missing ("${(band && band.why || "").slice(0, 48)}")`);
      eq(errors.length, 0, "the withheld-figure card draws without throwing");
      await page.close();

      /* AND THE THIRD KIND, which is not the same fact as either of the two
         above: the field IS on the card, and what is on it is not a number. */
      const odd = JSON.parse(JSON.stringify(base));
      odd.panels.skewTerm.atmIv = "n/a";
      odd.panels.skewTerm.atmReason = null;
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errs2 = [];
      p2.on("pageerror", (e) => errs2.push(String(e)));
      await mount(p2, odd, { ticker: odd.ticker });
      const st2 = await p2.evaluate(STATS);
      const lvl2 = st2.pairs.find((p) => /^At-the-money level/.test(p.term));
      eq(lvl2 && lvl2.value, "—",
         "a level that is not a number is withheld rather than printed");
      eq(lvl2 && lvl2.empty, "unreadable",
         `and says the bytes did not read (${lvl2 && lvl2.empty}) rather than that the field ` +
         "was absent, which is the fact that would send a reader to the wrong place");
      eq(lvl2 && lvl2.mark, '"×"',
         `wearing the cross (${lvl2 && lvl2.mark}), so it is not the dagger in greyscale`);
      ok(lvl2 && lvl2.why && lvl2.why.length > 40,
         `and still carries a sentence with no reason on the payload to borrow ` +
         `("${(lvl2 && lvl2.why || "").slice(0, 48)}")`);
      eq(errs2.length, 0, "the unreadable-level card draws without throwing");
      await p2.close();
    }

    /* --- 7d. the market-wide standing leads on where it places ---------- */
    {
      const base = withChain.find((c) =>
        c.panels.marketRank && c.panels.marketRank.status === "ok" &&
        c.panels.marketRank.feeds.oiChange.status === "ok");
      ok(base, "an emitted card places in the market-wide open-interest feed");
      const card = JSON.parse(JSON.stringify(base));

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const got = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
        const txt = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : null);
        /* THE CLASS IS THE BRANCH; THE <details> IS ONLY ITS USUAL EFFECT.
           appendMethod leaves a short method set open — a one-line decoder
           behind a click is a click for nothing — so "is it inside a
           <details>" passes by accident whenever the folded set happens to
           be under the 420-character wall. `is-qualifier` is applied to
           exactly the nodes the renderer put on the OPEN side, so asserting
           on it pins the decision itself rather than one of its outcomes. */
        const folded = (n) => {
          const d = n && n.closest("details");
          return {
            qualifier: !!(n && n.classList.contains("is-qualifier")),
            inDetails: !!d, open: d ? d.open : true,
          };
        };
        return [...host.querySelectorAll(".fmr-block")].map((b) => {
          const lead = b.querySelector(".fc-reading.is-lead");
          const stats = b.querySelector(".fc-stats");
          return {
            lead: txt(lead),
            leadBeforeStats: !!(lead && stats &&
              (lead.compareDocumentPosition(stats) & 4) === 4),
            when: { text: txt(b.querySelector(".fmr-when")),
                    ...folded(b.querySelector(".fmr-when")) },
            cut: { text: txt(b.querySelector(".fmr-cut")),
                   ...folded(b.querySelector(".fmr-cut")) },
            said: { text: txt(b.querySelector(".fmr-said")),
                    ...folded(b.querySelector(".fmr-said")) },
            all: b.textContent.replace(/\s+/g, " "),
          };
        });
      });

      const oi = got[0];
      ok(/^This name ranks \d+ of \d+/.test(oi.lead || ""),
         `the block leads on where the name places, with the population ("${oi.lead}") — a ` +
         "bare ordinal is a number a reader cannot size, and it used to be stated in prose " +
         "underneath four paragraphs of provenance");
      ok(oi.leadBeforeStats,
         "before the figures rather than after them");
      ok(/contract|%|\$/.test(oi.lead || ""),
         `and the unit travels with the value in the sentence ("${oi.lead}")`);

      /* THE SESSION IS THE ONE PIECE OF PROVENANCE THAT CAN INVERT THE
         READING, and the emitted corpus reproduces the 05:15-against-06:45
         gap, so this is the branch a live run takes. */
      ok(/NOT the session this card describes/.test(oi.when.text || ""),
         `the ranking still says outright that it is from another session ("${
           (oi.when.text || "").slice(0, 70)}")`);
      ok(oi.when.qualifier && !oi.when.inDetails,
         "and says it in the open, marked as a qualifier — this is the difference between " +
         "\"ranks 14th across the market today\" and \"ranked 14th yesterday, joined onto " +
         "today's card\", which is the whole reason the line exists");

      /* AND THE PIECE THAT CANNOT. The name is IN the list, so how the list " +
         was cut is method. */
      ok(!oi.cut.qualifier,
         `the cut is NOT a qualifier on a name that placed ("${(oi.cut.text || "").slice(0, 55)}") ` +
         "— the name is in the list, so how the list was cut is method");
      ok(oi.cut.inDetails && !oi.cut.open,
         "and it is folded behind the shut disclosure with the rest of the method");
      ok(/last place in the feed held|reaches back to|no order this run could measure/
        .test(oi.all),
         "and still readable in the block's text with the disclosure shut");
      ok(oi.said.inDetails,
         "so is the sentence about what a cross-section is, which is method by any reading");
      ok(!/This name places \d+ of \d+/.test(oi.all),
         "and the rank is stated ONCE — the prose copy under the figures is gone, because " +
         "two copies of one number are two numbers that can drift");
      eq(errors.length, 0, "the panel draws without throwing");
      await page.close();
    }

    /* --- 7e. the cut is the reading when the name is NOT in the list ----

       THE SAME LINE, THE OTHER SIDE OF THE SPLIT. A name that missed the
       last place by a hair and a name nowhere near it are different
       findings, and on the quiet arm the cut is the only thing on the block
       that tells them apart. It may not be folded there. */
    {
      const card = JSON.parse(JSON.stringify(withChain[0]));
      const quiet = withChain
        .map((c) => c.panels.marketRank && c.panels.marketRank.feeds.oiChange)
        .find((f) => f && f.status === "quiet");
      ok(quiet, "the emitted corpus contains a name that is in no market-wide list");
      card.panels.marketRank.feeds.oiChange = JSON.parse(JSON.stringify(quiet));
      /* AND A FEED THAT AGREES WITH THE CARD'S SESSION, staged by name: the
         one branch on which the session line qualifies nothing and folds.
         The dry run does not produce it — the vendor's market-wide feed is a
         session behind by construction — and a fixture that cannot reach the
         branch it certifies is this repository's most repeated mistake. */
      card.panels.marketRank.feeds.darkpool.sameSession = true;
      card.panels.marketRank.feeds.darkpool.asOfStated = true;
      card.panels.marketRank.feeds.darkpool.asOf = card.sessionDate;

      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const got = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="marketRank"] > div');
        const txt = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : null);
        const folded = (n) => {
          const d = n && n.closest("details");
          return {
            qualifier: !!(n && n.classList.contains("is-qualifier")),
            inDetails: !!d, open: d ? d.open : true,
          };
        };
        return [...host.querySelectorAll(".fmr-block")].map((b) => ({
          cut: { text: txt(b.querySelector(".fmr-cut")),
                 ...folded(b.querySelector(".fmr-cut")) },
          when: { text: txt(b.querySelector(".fmr-when")),
                  ...folded(b.querySelector(".fmr-when")) },
          empty: (b.querySelector("[data-empty]") || {}).getAttribute
            ? b.querySelector("[data-empty]").getAttribute("data-empty") : null,
          all: b.textContent.replace(/\s+/g, " "),
        }));
      });

      eq(got[0].empty, "quiet", "the fixture really renders the quiet arm");
      ok(got[0].cut.qualifier && !got[0].cut.inDetails,
         `the cut is a QUALIFIER on a name that is NOT in the list ("${
           (got[0].cut.text || "").slice(0, 60)}") — there it is the scale of the miss, and a ` +
         "near miss and a name nowhere near the list are different readings. The same line " +
         "is method on the arm above, and the feed decides which");
      ok(got[0].cut.text && got[0].cut.text.length > 20,
         "and it carries its sentence rather than being an empty element");

      ok(!got[1].when.qualifier,
         "the session line is NOT a qualifier where the feed dates itself to this card's " +
         "own session — that branch qualifies nothing");
      ok(got[1].when.inDetails,
         `the session line folds on the ONE branch where it qualifies nothing — the feed ` +
         `dates itself to this card's own session ("${(got[1].when.text || "").slice(0, 60)}")`);
      ok(/the same session this card describes/.test(got[1].all),
         "and is still readable with the disclosure shut");
      eq(errors.length, 0, "both arms draw without throwing");
      await page.close();
    }

    /* --- 7f. an explained element looks explained ----------------------

       ~145 `[title]` TOOLTIPS ACROSS THESE RENDERERS HAD NO VISIBLE
       AFFORDANCE. A reader could not tell an explained cell from an
       unexplained one, so the explanation was reachable only by a mouse that
       happened to rest on the right four characters — and `title` is shown
       on keyboard focus by no browser and has no gesture at all on a touch
       screen. Three assertions: the mark is visible, the mark is on
       everything that has an explanation, and the explanation has a door
       that is not a hover. */
    {
      const card = withChain[0];
      const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await mount(page, card, { ticker: card.ticker });

      const swept = await page.evaluate(() => {
        const out = [];
        for (const section of document.querySelectorAll(".ft-panel[data-panel] > div")) {
          const key = section.parentElement.dataset.panel;
          const titled = [...section.querySelectorAll("[title]")]
            .filter((n) => {
              const t = n.textContent.replace(/\s+/g, " ").trim();
              return t && t.length <= 48;
            });
          const box = section.querySelector("details.ft-why");
          out.push({
            key,
            titled: titled.length,
            unmarked: titled.filter((n) => !n.classList.contains("fc-why"))
              .map((n) => n.tagName + ":" + n.textContent.trim().slice(0, 24)),
            tabbed: [...section.querySelectorAll("[title][tabindex]")].length,
            terms: box ? [...box.querySelectorAll(".ft-why-t")].map((n) => n.textContent) : null,
            whys: box ? [...box.querySelectorAll(".ft-why-d")].map((n) => n.textContent) : null,
            summary: box ? box.querySelector("summary").textContent : null,
            summaryTab: box ? box.querySelector("summary").tabIndex : null,
            boxOpen: box ? box.open : null,
          });
        }
        const mark = document.querySelector(".ft-panel .fc-why:not(.fc-stat)");
        const cs = mark ? getComputedStyle(mark) : null;
        const stat = document.querySelector(".ft-panel .fc-stat.fc-why");
        return {
          panels: out,
          mark: cs ? { line: cs.textDecorationLine, style: cs.textDecorationStyle,
                       cursor: cs.cursor } : null,
          statMark: stat ? {
            self: getComputedStyle(stat).textDecorationLine,
            dt: getComputedStyle(stat.querySelector("dt")).textDecorationLine,
          } : null,
        };
      });

      const titledTotal = swept.panels.reduce((n, p) => n + p.titled, 0);
      ok(titledTotal >= 20,
         `the page really carries explained elements to mark (${titledTotal}) — an assertion ` +
         "about marking nothing would pass on a page that renders nothing");
      const unmarked = swept.panels.flatMap((p) => p.unmarked.map((t) => p.key + " " + t));
      eq(unmarked.length, 0,
         `every explained element carries the affordance (${unmarked.slice(0, 4).join(" | ")}) ` +
         "— an explanation a reader cannot tell is there is the appearance of documentation");

      ok(swept.mark && /underline/.test(swept.mark.line),
         `and the affordance is VISIBLE: a dotted rule under the marked text (${
           JSON.stringify(swept.mark)})`);
      eq(swept.mark && swept.mark.style, "dotted",
         "dotted rather than solid, because a solid underline on this page means a link");
      eq(swept.mark && swept.mark.cursor, "help",
         "with the pointer saying the same thing a second way");

      /* text-decoration PAINTS ACROSS DESCENDANTS AND A CHILD CANNOT TAKE IT
         BACK, so a .fc-stat wrapper carrying the tooltip must never receive
         the rule: it would underline the figure as well as its label. */
      if (swept.statMark) {
        ok(!/underline/.test(swept.statMark.self),
           "a stat wrapper that carries the tooltip is NOT itself underlined — the rule " +
           "would paint across the figure too, and a child cannot take it back");
        ok(/underline/.test(swept.statMark.dt),
           "the mark goes on its label, which is the term the explanation is about");
      }

      /* THE DOOR. One <summary> per panel, natively focusable with no
         tabindex, and every marked term listed under it with its explanation
         in full — so a keyboard or a thumb reaches what a hover reached. */
      const withList = swept.panels.filter((p) => p.terms);
      ok(withList.length >= 3,
         `${withList.length} panels publish a decoder for their marked terms`);
      for (const p of withList) {
        eq(p.terms.length, p.whys.length, `${p.key}: every listed term has an explanation`);
        ok(p.terms.every((t) => t.trim()), `${p.key}: and no term is blank`);
        ok(p.whys.every((w) => w.trim().length > 10),
           `${p.key}: and no explanation is a stub`);
        ok(p.summary.includes("(" + p.terms.length + ")"),
           `${p.key}: the summary counts what is under it ("${p.summary}") — a list that ` +
           "says nothing about its own size is a list a reader opens blind");
        eq(p.summaryTab, 0,
           `${p.key}: the summary is reachable by keyboard with no tabindex of its own`);
        eq(p.boxOpen, false, `${p.key}: and shut until it is asked for`);
      }
      const tabbed = swept.panels.reduce((n, p) => n + p.tabbed, 0);
      eq(tabbed, 0,
         `no explained element became a tab stop (${tabbed}) — tabindex="0" on 145 elements ` +
         "buys the keyboard reader the explanation at the price of 145 stops between them " +
         "and the next panel, and the browser still shows them nothing on focus");
      eq(errors.length, 0, "the sweep throws nothing");
      await page.close();
    }
  }

  /* ---------- 12. units that travel, and one that must not be guessed ----

     TWO FIGURES AND ONE FRACTION, each measured against the payload that
     produced it. Both are honesty defects rather than layout defects, so both
     are read out of the rendered text rather than out of the source. */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const card = withChain.find((c) => c.panels.path && c.panels.path.status === "ok") ||
      withChain[0];
    await mount(page, card, { ticker: card.ticker });

    /* THE SESSION PATH'S TWO TOTALS ARE A CONTRACT COUNT AND A DOLLAR SUM IN
       ONE STAT BLOCK. buildPath published both with no unit anywhere on the
       panel — shared/flows-ask.js refuses to quote netDelta for exactly that
       reason, in those words — so a reader taking "Net delta 39.0K" for
       dollars misread the panel by three orders of magnitude. The units are
       the PAYLOAD'S and the renderer prints them; this asserts the published
       strings reach the page, not that a sentence of some kind is there. */
    const pathPanel = card.panels.path;
    if (pathPanel && pathPanel.status === "ok") {
      ok(typeof pathPanel.netDeltaUnit === "string" && pathPanel.netDeltaUnit.length > 0,
         `the emitted card publishes a unit for path.netDelta ("${pathPanel.netDeltaUnit}")`);
      ok(typeof pathPanel.netPremiumUnit === "string" && pathPanel.netPremiumUnit.length > 0,
         `and one for path.netPremium ("${pathPanel.netPremiumUnit}")`);
      const drawn = await page.evaluate(() => {
        const host = document.querySelector('.ft-panel[data-panel="path"] > div');
        const unit = host.querySelector(".fp-unit");
        return {
          text: host.textContent.replace(/\s+/g, " "),
          unit: unit ? unit.textContent.replace(/\s+/g, " ") : null,
          aria: (host.querySelector("svg[role=img]") || {}).getAttribute
            ? host.querySelector("svg[role=img]").getAttribute("aria-label") : "",
        };
      });
      ok(drawn.unit, "the session path prints a unit sentence under its stat block");
      ok(drawn.unit.includes(pathPanel.netDeltaUnit),
         `and it is the payload's own unit for net delta, verbatim ("${drawn.unit}")`);
      ok(drawn.unit.includes(pathPanel.netPremiumUnit),
         "and the payload's own unit for net premium, verbatim");
      ok(drawn.aria.includes(pathPanel.netDeltaUnit),
         "and the chart's aria-label — the whole panel, to a screen reader — carries the " +
         "delta unit beside the total it labels");
    }
    eq(errors.length, 0, `the unit sweep throws nothing (${errors.join("; ")})`);
    await page.close();
  }

  /* ---------- 13. an IV rank in the wrong unit is withheld, not printed ---

     THE FIXTURE IS AN EMITTED CARD WITH ONE NAMED FIELD MUTATED, and the
     mutation is the point: pricedMove.ivRank is published as a 0-1 fraction
     by ivRankFraction, which itself divides by 100 whenever the vendor answers
     above 1 — a defence written after a rank arrived at 1352. The renderer
     trusted that convention silently and multiplied by 100, so a rank reaching
     it in the OTHER unit this card carries (volContext.ivRank publishes 0-100
     and says so in a rankUnit field) prints "5215% of its year". */
  {
    const base = withChain.find((c) => c.panels.pricedMove &&
      c.panels.pricedMove.status === "ok" && typeof c.panels.pricedMove.ivRank === "number");
    ok(base, "an emitted card publishes a numeric pricedMove.ivRank to mutate");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const readRank = () => page.evaluate(() => {
      const host = document.querySelector('.ft-panel[data-panel="pricedMove"] > div');
      for (const stat of host.querySelectorAll(".fc-stat")) {
        const dt = stat.querySelector("dt"), dd = stat.querySelector("dd");
        if (!/IV rank/i.test(dt.textContent)) continue;
        return { label: dt.textContent, value: dd.textContent.trim(),
                 empty: dd.getAttribute("data-empty"), why: dd.getAttribute("title") || "" };
      }
      return null;
    });

    /* THE FRACTION ARM: the unit and the population are in the label, and the
       figure is stated out of the 100 it is a percentile of. */
    const ok1 = JSON.parse(JSON.stringify(base));
    ok1.panels.pricedMove.ivRank = 0.5215;
    await mount(page, ok1, { ticker: ok1.ticker });
    const good = await readRank();
    ok(good, "the priced move panel carries an IV rank stat");
    ok(/percentile of its own year/.test(good.label),
       `its label states the unit and the population ("${good.label}") — "% of its year" ` +
       "over a bare 52 says neither, and the card carries a second IV rank in the other unit");
    eq(good.value, "52 of 100", "and the figure is stated out of the 100 it is a percentile of");
    eq(good.empty, null, "a reading in the unit this line reads is not marked as a silence");

    /* THE OTHER-UNIT ARM: 52.15 is not a fraction. It must be WITHHELD with
       the cross the taxonomy gives "published bytes this page could not
       parse", never multiplied into a percentage no year can hold. */
    const bad = JSON.parse(JSON.stringify(base));
    bad.panels.pricedMove.ivRank = 52.15;
    await mount(page, bad, { ticker: bad.ticker });
    const wrong = await readRank();
    ok(wrong, "the panel still draws its IV rank stat on the mutated card");
    ok(!/5215|521[0-9]%/.test(wrong.value),
       `a 0-100 rank never reaches the fraction formatter (got "${wrong.value}")`);
    eq(wrong.value, "\u2014", "it is withheld as an em dash rather than printed");
    eq(wrong.empty, "unreadable",
       "and marked unreadable — the field IS published, and these are bytes this page " +
       "could not parse in the unit the line reads. Absent would be `unavailable`, " +
       "which is a different fact and gets a different mark");
    ok(wrong.why.length > 20 && /unit/.test(wrong.why),
       `with the sentence that says which silence it is ("${wrong.why.slice(0, 60)}")`);

    /* AND THE ABSENT ARM IS THE OTHER SILENCE, so the two cannot collapse. */
    const gone = JSON.parse(JSON.stringify(base));
    delete gone.panels.pricedMove.ivRank;
    await mount(page, gone, { ticker: gone.ticker });
    const absent = await readRank();
    eq(absent.value, "\u2014", "an absent rank is an em dash too");
    eq(absent.empty, "unavailable",
       "but marked unavailable, not unreadable: no rank at all and a rank in the wrong " +
       "unit are two different facts about the payload");

    eq(errors.length, 0, `the IV rank arms throw nothing (${errors.join("; ")})`);
    await page.close();
  }

} finally {
  await browser.close();
  fs.rmSync(EMIT_DIR, { recursive: true, force: true });
}

console.log(`✓ flows-ticker: ${checks} assertions — one registry the markup, the ` +
  `drawers, the chrome and the shed ladder all read, four payloads that shipped for ` +
  `weeks with no renderer finally drawn, an enlarge that redraws rather than scales ` +
  `and cannot shrink the panels it exists for, absent and unavailable told apart, the ` +
  `three stock panels rendering the payload's own numbers and notes with quiet, ` +
  `unavailable and pre-wave absence held apart, a rank that is never rescaled and ` +
  `a strip that never bridges a gap, twenty-three panels served inside five station ` +
  `sections with one lead each, a tab row that counts them from the same export the ` +
  `stations are built from, and two sentinels that reach neither the payload-key list ` +
  `nor the shed ladder they would have fabricated an unavailability in, a page ` +
  `that opens on the overnight move with its gap and its dead-band crossing rather ` +
  `than on a snapshot — with a measured zero told from an unmeasured session in both ` +
  `directions — deep links that survive a hidden grid and a hostile hash, and a gated ` +
  `name that is finally told the gate removed it instead of being pointed at a watch ` +
  `list it cannot be on, and a market-wide standing whose rank never appears without the ` +
  `population it sits inside, whose absence is quiet and carries the cut it missed, and ` +
  `which says on the page that the cross-section it ranks in is a prior session's, and ` +
  `three panels that now lead on their FINDING in the largest type they own with the ` +
  `method folded under it — measured flat told from unmeasured in both directions, ` +
  `every qualifier still in the open with nothing to click, every folded sentence still ` +
  `in textContent for a find-in-page, and every explained element wearing a visible mark ` +
  `whose explanation a keyboard and a thumb can open without adding one tab stop, ` +
  `a question DRAWN rather than merely attributed so a drawer handed the card where it ` +
  `expected the question cannot head a panel with a stringified object, an enlarge ` +
  `checked on EVERY registry panel that draws a chart rather than on a hand-picked four ` +
  `— the list that could not see the two panels still capped at the retired modal's own ` +
  `width — the session ` +
  `path's contract count and dollar sum each carrying the unit the payload publishes ` +
  `for it, and an IV rank in the wrong unit withheld under its own mark rather than ` +
  `multiplied into a percentage no year can hold`);
