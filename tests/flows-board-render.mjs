/* =============================================================
   flows-board-render.mjs — the board's control bar, which did not
   exist.

   THIS SUITE IS WRITTEN BECAUSE ITS ABSENCE IS WHAT KILLED THE
   FEATURE. assets/js/flows-board.js carries ~130 lines building a
   ticker filter, an eight-way order select and a "8 of 63 names
   match" denominator — commented, argued, and correct. None of it
   ever entered the DOM on /flows/long/ or /flows/short/, because
   shared/flows-pages.js served flows-board.js WITHOUT serving
   flows-ui.js, and buildControls() opens:

       if (!host || !UI || typeof UI.searchBox !== "function" …) return;

   The guard is right. A page that cannot build its controls must not
   throw. But a correct guard over an absent dependency is SILENCE,
   and silence is indistinguishable from a page that was never meant
   to have controls. Nothing failed, nothing logged, and the route
   looked finished — because the part that was missing was the part
   that would have drawn itself.

   Grep the suites as they stood: `fb-controls`, `fbQ`, `fbSort` and
   `fb-count` appeared in NONE of them. The board had a render test
   for its rows and none for its chrome, so the chrome could be
   deleted by omission and every suite stayed green.

   SO THE FIRST ASSERTION HERE IS THE DEPENDENCY ITSELF, not a
   symptom of it. `window.FlowsUI` being undefined on this route is
   the cause; a missing `#fbQ` is one of several possible effects, and
   a suite that only tests the effect reports a broken control bar
   when what broke was a script tag. Both are pinned, in that order,
   so the failure names the thing to fix.

   THE TWO BOARDS DIFFER IN ONE PROPERTY ON PURPOSE. `board:long`
   carries `dr` and `nw` on its rows; `board:short` carries neither —
   the cold-memory state of any morning after a store reset. The
   select's own comment says an order the payload cannot produce is
   not offered, "because an option that silently leaves the board in
   the published order is a control that lies about having done
   something". That is a branch, so it gets a board that reaches it.
   ============================================================= */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TOKEN = "board-token-aaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;
const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const put = (key, bodyObj) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(bodyObj),
});

/* EIGHT NAMES, AND THE FILTER TEST TURNS ON TWO OF THEM. "NVDA" and
   "NVAX" both begin NV and nothing else does, so typing NV must leave
   exactly two — a filter that matched one name could be passed by an
   implementation that only ever shows the first hit. */
const TICKERS = ["NVDA", "NVAX", "AAPL", "AMD", "MSFT", "GOOG", "INTC", "TSLA"];

const boardRow = (t, i, warm) => ({
  t, r: i + 1, s: 90 - i * 7, cnv: 80 - i * 3,
  px: 100 + i, chg: 0.01, purity: 0.02,
  gRegime: i % 2 ? "short" : "long", gFlipDist: -0.1 - i / 100,
  netPrem: (i % 2 ? -1 : 1) * (1e7 - i * 1e5),
  fam: { F: 10, P: 20, D: 30, V: 40, O: 50 },
  /* edte IS ON BOTH BOARDS. Days to earnings comes from the vendor's
     calendar, not from the previous session's board, so a cold memory
     does not remove it — and putting it only on the warm rows made the
     two boards differ in THREE properties while the assertion below
     reasoned about two. The first run caught that: 3 !== 2. A fixture
     whose control differs in more ways than the test names cannot say
     which difference produced the result. */
  edte: 20 + i,
  /* THE ONE DIFFERENCE BETWEEN THE TWO BOARDS. Warm rows remember the
     previous session; cold ones have no memory to compare against, so
     `dr` and `nw` are absent rather than 0 and false — an unmeasured
     climb is not a climb of zero places. */
  ...(warm ? { dr: 5 - i, nw: i === 0 } : {}),
});

const board = (side, warm) => ({
  side, generatedAt: new Date().toISOString(), sessionDate: "2026-09-03",
  status: "ok", universe: 264, enriched: 60,
  rows: TICKERS.map((t, i) => boardRow(t, i, warm)),
});

await put("board:long", board("long", true));
await put("board:short", board("short", false));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.context().addCookies([
  { name: "flows_session", value: token, url: server.baseURL }]);

/* ---- 1. the dependency, before anything that depends on it ---------- */

await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");

const uiShape = await page.evaluate(() => {
  const U = window.FlowsUI;
  if (!U) return null;
  return { searchBox: typeof U.searchBox, sortSelect: typeof U.sortSelect, el: typeof U.el };
});
ok(uiShape !== null,
   "window.FlowsUI is defined on /flows/long/ — the board reads it at module scope " +
   "(flows-board.js:36) and every control below is downstream of this one fact, so it is " +
   "asserted first and on its own: an undefined library is a missing script tag, while a " +
   "missing #fbQ could be any of a dozen things");
eq(uiShape && uiShape.searchBox, "function",
   "FlowsUI.searchBox is callable — buildControls() tests this exact typeof before proceeding");
eq(uiShape && uiShape.sortSelect, "function",
   "FlowsUI.sortSelect is callable — the second half of the same guard");

/* ---- 2. the controls themselves ------------------------------------ */

const controls = await page.evaluate(() => {
  const wrap = document.querySelector(".fb-controls");
  if (!wrap) return null;
  const q = document.querySelector("#fbQ");
  const s = document.querySelector("#fbSort");
  const c = document.querySelector(".fb-count");
  return {
    wrap: true,
    q: !!q, s: !!s, c: !!c,
    /* A SIBLING OF .flows-controls, NOT A CHILD — the file's own comment
       records that as a child it grew a horizontal scrollbar at 352px
       against a 320px viewport, because a flex item's min-width is auto
       and a native select's min-content is its widest option. */
    isSibling: !!(wrap.parentNode && wrap.previousElementSibling &&
                  wrap.previousElementSibling.classList.contains("flows-controls")),
    countHidden: c ? c.hidden : null,
    countRole: c ? c.getAttribute("role") : null,
    options: s ? Array.from(s.options).map((o) => o.value) : null,
  };
});

ok(controls !== null,
   "the board's control bar is in the DOM on /flows/long/ — this is the assertion whose " +
   "absence let ~130 lines of finished code ship dead on the two busiest routes in the section");
ok(controls.q, "the ticker filter #fbQ exists");
ok(controls.s, "the order select #fbSort exists");
ok(controls.c, "the match denominator .fb-count exists");
ok(controls.isSibling,
   "the control wrap is a SIBLING of .flows-controls rather than a child — as a child it is a " +
   "flex item whose min-width is auto, which for a box holding a native <select> is that " +
   "select's widest option in 16px mono, and the page grew a horizontal scrollbar at 352px");

/* ---- 3. the denominator is silent until it has something to say ----- */

eq(controls.countHidden, true,
   "with no filter typed the count is HIDDEN rather than reading “8 of 8” — a count of " +
   "everything against everything teaches the eye to skip the line on the session it matters");
eq(controls.countRole, "status",
   "the count carries role=status, so a filter that narrows to nothing is announced: that is " +
   "the case where no rows remain on screen to notice");

/* ---- 4. the filter narrows, and states what it narrowed FROM -------- */

await page.fill("#fbQ", "NV");
await page.waitForFunction(() => document.querySelectorAll(".fd-card").length === 2);

const filtered = await page.evaluate(() => ({
  cards: document.querySelectorAll(".fd-card").length,
  count: document.querySelector(".fb-count").textContent,
  hidden: document.querySelector(".fb-count").hidden,
}));
eq(filtered.cards, 2, "typing NV leaves exactly the two names that begin NV (NVDA, NVAX)");
eq(filtered.hidden, false, "the count is shown once a filter is set");
ok(/\b2 of 8 names match\b/.test(filtered.count),
   "the count states the POPULATION the two came out of — “" + filtered.count + "”. Two rows " +
   "on their own are the same shape as a board with two names on it, and a list that " +
   "truncates without saying so reads as a population");
ok(filtered.count.includes("“NV”"),
   "the count echoes what was typed, in quotes, so the reader can see the filter that produced it");

/* ---- 5. a filter matching nothing is not an empty board ------------- */

await page.fill("#fbQ", "ZZZZ");
await page.waitForFunction(() => document.querySelectorAll(".fd-card").length === 0);
const none = await page.evaluate(() => {
  const msg = document.querySelector(".fb-msg, [data-state='filtered'], .flows-msg");
  return {
    count: document.querySelector(".fb-count").textContent,
    body: document.body.innerText,
    msg: msg ? msg.textContent : null,
  };
});
ok(/\b0 of 8 names match\b/.test(none.count),
   "a filter matching nothing reads “0 of 8” rather than going blank — the zero is MEASURED " +
   "(eight rows were tested and none matched), which is a different statement from a board " +
   "that published nothing");
ok(/still loaded|clear the field/i.test(none.body),
   "the page says the rows are still loaded and the field can be cleared, so a typed filter is " +
   "not read as an outage");

/* ---- 6. clearing restores, with no refetch -------------------------- */

const requestsBefore = [];
page.on("request", (r) => { if (/\/api\/flows\//.test(r.url())) requestsBefore.push(r.url()); });
await page.fill("#fbQ", "");
await page.waitForFunction(() => document.querySelectorAll(".fd-card").length === 8);
const restored = await page.evaluate(() => ({
  cards: document.querySelectorAll(".fd-card").length,
  hidden: document.querySelector(".fb-count").hidden,
}));
eq(restored.cards, 8, "clearing the field brings all eight names back");
eq(restored.hidden, true, "and the count goes silent again with no filter set");
eq(requestsBefore.length, 0,
   "clearing the filter spends NO network call — the rows never left currentRows, and a filter " +
   "that refetches is a filter that costs the reader a round trip per keystroke");

/* ---- 7. an order the payload cannot produce is not offered ---------- */

const warmOptions = controls.options;
ok(warmOptions.includes("dr:desc"),
   "the warm board offers “biggest climb since the previous board” — its rows carry dr");
ok(warmOptions.includes("nw:desc"),
   "and “new to this side first” — its rows carry nw");
ok(warmOptions.includes(""),
   "the published rank is offered, spelled by the empty value the way ?view=deck is spelled " +
   "by absence");

await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const coldOptions = await page.evaluate(() => {
  const s = document.querySelector("#fbSort");
  return s ? Array.from(s.options).map((o) => o.value) : null;
});
ok(coldOptions !== null, "the control bar is built on /flows/short/ too, not only on long");
ok(!coldOptions.includes("dr:desc"),
   "the cold board does NOT offer the climb order — no row carries dr, and an option that " +
   "silently leaves the board in the published order is a control that lies about having " +
   "done something");
ok(!coldOptions.includes("nw:desc"),
   "nor the new-to-this-side order, for the same reason");
ok(coldOptions.includes("s:desc") && coldOptions.includes("t:asc"),
   "the orders the payload CAN produce are still offered — the gate is per option, not a " +
   "blanket refusal to build the select");
eq(warmOptions.length - coldOptions.length, 2,
   "exactly two orders are withheld on a cold memory, so a future column that quietly stops " +
   "being offered fails here rather than disappearing");

/* ---- 8. the select actually reorders ------------------------------- */

await page.selectOption("#fbSort", "t:asc");
await page.waitForFunction(() =>
  document.querySelector(".fd-card") &&
  /AAPL/.test(document.querySelector(".fd-card").innerText));
const ordered = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".fd-card"))
    .map((c) => (c.innerText.match(/\b[A-Z]{2,5}\b/) || [""])[0]));
const alphabetical = TICKERS.slice().sort();
eq(ordered[0], alphabetical[0],
   "choosing “ticker, A to Z” actually reorders the deck — the select is wired to " +
   "applySortValue and not merely rendered");

/* ---- 9. the invariant the control bar was shaped around ------------- */

await page.setViewportSize({ width: 320, height: 800 });
await page.waitForTimeout(120);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1,
   `no horizontal overflow at 320px with the controls present (measured ${overflow}px). This is ` +
   "the measurement the sibling placement and the .st-field min-width:0 both exist for, and it " +
   "is the one that regressed to 352px when the wrap was a flex child");

/* ---- 10. the rail badge states only what this side MEASURED --------- */

/* Back to the width at which the rail is a column. Section 9 left the page at
   320px, where the rail is a horizontal drawer; the readings below take the
   slot's own `hidden` property rather than its computed visibility, so the
   width cannot change the answer — but a badge certified only at a width where
   the rail is a different component is a badge nobody has checked. */
await page.setViewportSize({ width: 1280, height: 1000 });

/* IT FILLS AT ALL, FIRST. Everything after this asserts the badge staying
   silent or printing a zero, and all of that passes against a slot nothing
   ever writes — including on a page whose fetch died. Read while the store
   still holds the eight-name board, so the two silences below are known to be
   choices rather than the absence of a fill. */
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const railFull = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="long"]');
  return { text: el ? el.textContent : null, hidden: el ? el.hidden : null };
});
eq(railFull.text, "8",
   "the rail badge for this side is filled by the page — the nav is served with the slot empty " +
   "and hidden because filling it there would cost a D1 row read per page view for a number the " +
   "page is about to fetch anyway, so the controller holding the payload fills it. This board " +
   "publishes no `cleared`, so 8 here is also the FALLBACK arm: a board written before that " +
   "field existed has nothing but its rows to state, and the section below is the one that " +
   "proves the field is preferred when it is there");
eq(railFull.hidden, false, "and the slot is shown once it has a measurement in it");

/* THE PENDING CASE IS WRITTEN, NOT ARRANGED BY DELETION. This is the exact
   envelope the Worker answers with for a board row that is ABSENT (worker.js,
   the board route). A D1 read that THREW answers the same shape with
   `reason: "read-failed"` on it, and section 12 feeds that one separately —
   the two used to be byte-identical, which is why this page once hedged one
   sentence across both causes. */
await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
/* Waited for by CLASS, asserted by KIND: a wait keyed to the right kind would
   report a collapsed silence as a timeout rather than as the assertion below. */
await page.waitForFunction(() => !!document.querySelector("p.fb-empty[data-empty]"));
const railPending = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="long"]');
  const p = document.querySelector("p.fb-empty[data-empty]");
  return {
    text: el ? el.textContent : null,
    hidden: el ? el.hidden : null,
    kind: p.getAttribute("data-empty"),
    msg: p.textContent,
  };
});
eq(railPending.kind, "pending",
   "the absent-row envelope is tagged PENDING — “not published yet” — and no longer wears the " +
   "dagger that means “published, and this field is not on it”");
ok(/No board has been published for this side yet/.test(railPending.msg),
   "the pending payload reaches the branch that says no board has been published — the badge is " +
   "being read BESIDE that sentence, so the sentence is confirmed on screen rather than assumed");
eq(railPending.hidden, true,
   "the badge stays HIDDEN on a pending board. The fill at flows-board.js:1811 runs BEFORE the " +
   "pending branch at :1840, and a pending payload has rows.length 0 by construction, so the " +
   "unguarded String(rows.length) it replaced put a “0” in the rail beside a page saying the " +
   "pipeline may never have published — a confident count of a market nobody measured");
eq(railPending.text, "",
   "and the slot holds no text at all: a hidden element carrying “0” prints that zero the moment " +
   "anything — a stylesheet, a reading tool, a future rail — disagrees about `hidden`");

/* THE OTHER HALF OF THE SAME RULE, and why the guard here is not the
   `if (slot && rows.length)` flows-watch.js:434 uses. On a board a zero can be
   a MEASUREMENT — names were scored and none of them cleared the dead band —
   and suppressing it would report a working quiet session as an outage. The
   fixture is the cold board with its rows taken away and a scored count added,
   so `scored` is the only thing separating it from the payload above. */
await put("board:short", {
  ...board("short", false), rows: [], deadBand: 1, scored: 130, neutral: 124,
});
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForFunction(() => !!document.querySelector('[data-empty="quiet"]'));
const railQuiet = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="short"]');
  return {
    text: el ? el.textContent : null,
    hidden: el ? el.hidden : null,
    /* THE PARAGRAPH, NOT THE FIRST MARKED ELEMENT. The status line above the
       deck now carries the same data-empty, and it comes first in the DOM. */
    msg: document.querySelector('p.fb-empty[data-empty="quiet"]').textContent,
  };
});
ok(/130 names were scored/.test(railQuiet.msg),
   "the measured-empty payload reaches the quiet branch, the one silence of the three that is a " +
   "statement about the market rather than about the plumbing");
eq(railQuiet.text, "0",
   "a session that scored 130 names and placed none on this side badges “0”, because here the " +
   "zero IS the reading — which is what `rows.length || isNum(payload.scored) > 0` buys over the " +
   "bare `rows.length` the watch rail can afford");
eq(railQuiet.hidden, false,
   "and that zero is VISIBLE: a rail that hides a measured emptiness collapses a quiet session " +
   "into an outage, the same error as the pending case with its sign reversed");

/* ---- 10-bis. the badge counts the POPULATION, not the page ---------- */

/* THE DEFECT THIS SECTION EXISTS FOR, and it survived every fixture above.
   The publisher derives two counts from one list — `cleared`, the side's whole
   pool past the dead band, and `shed`, what the board's length cap could not
   hold (flows-pipeline.mjs:5687) — and the status line has printed "4 more
   cleared the band and did not fit (93 of 97 shown)" since those fields
   shipped. The badge filled from rows.length, so the rail read 93 directly
   above a sentence saying 97 of them existed. One page, one quantity, two
   numbers, and the smaller one in the element a reader uses to decide whether
   the section is worth opening at all.

   ONLY A BOARD WHOSE `cleared` STRICTLY EXCEEDS ITS ROWS CAN CATCH IT. On
   every other fixture in this file the two are equal — the eight-name board
   publishes no cleared at all — so each of them passes against the defect and
   against the fix alike, which is exactly how the defect reached the line the
   previous commit rewrote. Eight rows out of a pool of twelve, four shed. */
await put("board:long", {
  ...board("long", true), deadBand: 20, scored: 130, neutral: 118,
  cleared: 12, shed: 4,
});
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const capped = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="long"]');
  return {
    text: el ? el.textContent : null,
    hidden: el ? el.hidden : null,
    cards: document.querySelectorAll(".fd-card").length,
    status: document.getElementById("flowsStatus").textContent,
  };
});
eq(capped.cards, 8,
   "the page draws the eight rows the payload published, so it really is an excerpt of the " +
   "twelve names that payload says cleared the band — a fixture where the two counts agreed " +
   "could not tell the badge's two candidate sources apart");
eq(capped.text, "12",
   "and the rail badges TWELVE, the population the publisher measured, rather than the eight " +
   "this board had room for. A badge that silently means “as many as we chose to draw” is the " +
   "truncation defect one element wide");
eq(capped.hidden, false, "shown, because there is a measured population behind it");

/* THE TWO NUMBERS ARE READ OFF THE PAGE AND COMPARED WITH EACH OTHER, not
   each with a literal this file picked. A later change that moves one of them
   moves either the badge or the sentence, and this is the assertion that
   notices they have stopped agreeing — which is the whole subject of the fix
   and the one part a pair of hard-coded 12s would not defend. */
const said = /\((\d+) of (\d+) shown\)/.exec(capped.status);
ok(said, `the status line states the pool it is an excerpt of at all (${capped.status})`);
eq(said && said[2], capped.text,
   "the population in the sentence and the population in the badge are the SAME number. " +
   "flows-events.js:1126 states the rule for two routes — “two routes wording one quantity " +
   "differently is how a reader concludes there are two quantities” — and two ELEMENTS on one " +
   "page are no better than two routes");
eq(said && said[1], String(capped.cards),
   "while the numerator in that sentence is the rows actually drawn, so the clause reconciles " +
   "the page against the pool instead of restating either of them twice");

/* THE PRODUCTION SHAPE OF THE MEASURED-QUIET SIDE, which the arm above is
   not: the pipeline publishes `cleared: sides[side].length` on every board, so
   a real quiet side carries a 0 rather than omitting the field, and the arm
   above — written before the field was read here — omits it and therefore only
   ever exercised the fallback.

   THIS ARM IS A SHAPE ARM AND IT DISCRIMINATES NOTHING BY ITSELF, which is
   said here rather than left to be discovered. `cleared` is a length and can
   never be below the rows it produced, so on a quiet side both sources are 0
   and every plausible fill prints the same "0": it passed against the defect
   too. What it holds is the GUARD — keyed on `scored`, not on `cleared` — so a
   later rewrite that keys the guard on the field this commit introduced hides
   the zero and fails here as well as one arm above. */
await put("board:short", {
  ...board("short", false), rows: [], deadBand: 1, scored: 130, neutral: 130,
  cleared: 0, shed: 0,
});
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForFunction(() => !!document.querySelector('[data-empty="quiet"]'));
const railZero = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="short"]');
  return { text: el ? el.textContent : null, hidden: el ? el.hidden : null };
});
eq(railZero.text, "0",
   "a side that scored 130 names and cleared none of them badges the published “0” — the same " +
   "reading the fallback arm above prints, now arriving from the field rather than from the " +
   "absence of it");
eq(railZero.hidden, false, "and it is visible, for the reason the fallback arm already gives");

/* ---- 12. the deck's silences are four, not one ---------------------- */

/* WHAT THIS SECTION MEASURES. showMessage() has stamped data-empty on
   p.fb-empty since the deck view existed, and flows.css scoped every silence
   mark to :is(.flows-empty, .cc-quiet, .ft-quiet) — a list the board's own
   paragraph was never in. Measured on the emitted corpus: a short side that
   scored 100 names and placed none (quiet, a reading about the market) and a
   long side the store had never held (pending) were one centred grey
   sentence, told apart only by reading it. And the Worker answered a
   never-published key and a D1 read that THREW with byte-identical
   envelopes, so the page could not have told THOSE apart even had it tried;
   it tagged both "unavailable", a word the taxonomy reserves for "published,
   and this field is not on it". The Worker now stamps `reason: "read-failed"`
   on the failed read. This suite feeds that envelope by ingesting it — a
   local D1 cannot be made to throw from a browser test — and
   tests/flows-worker-contract.mjs proves the Worker writes it.

   THE ASSERTION IS DISTINCTNESS ON THE MONOCHROME CHANNELS, as in
   flows-motion.mjs: border style and width carry no hue, so four silences
   separable on those two alone survive a greyscale printout. The glyph is
   read as well, because it is the channel a screen magnifier keeps. Each
   fixture is also checked against the taxonomy's own shape — pending dotted,
   unavailable dashed, unreadable a wide solid, quiet a hairline — so a
   future stylesheet that made them four DIFFERENT wrong shapes fails here
   rather than passing a distinctness test. */
const readSilence = () => page.evaluate(() => {
  const p = document.querySelector("p.fb-empty");
  if (!p) return null;
  const cs = getComputedStyle(p);
  const before = getComputedStyle(p, "::before");
  const status = document.getElementById("flowsStatus");
  return {
    kind: p.getAttribute("data-empty"),
    text: p.textContent,
    style: cs.borderLeftStyle,
    width: cs.borderLeftWidth,
    glyph: before.content,
    align: cs.textAlign,
    justify: cs.justifySelf,
    statusKind: status.getAttribute("data-empty"),
    statusText: status.textContent,
  };
});
const silences = {};

/* Every wait below is keyed to the CLASS and every kind is asserted after,
   so a silence that collapses into its neighbour fails on a sentence naming
   the collapse rather than on a thirty-second timeout. */
const waitMessage = () => page.waitForFunction(() => !!document.querySelector("p.fb-empty[data-empty]"));

/* quiet: board:short still holds the scored-130, cleared-0 fixture above. */
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await waitMessage();
silences.quiet = await readSilence();

/* pending: the absent-row envelope, verbatim. */
await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitMessage();
silences.pending = await readSilence();

/* unreadable, from the Worker: the same envelope with the catch path's reason. */
await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending", reason: "read-failed" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitMessage();
silences.unreadable = await readSilence();

/* unavailable: a PUBLISHED board with no rows and no scored population — the
   one case of the three where "not on this payload" is the true sentence. */
await put("board:long", { side: "long", generatedAt: new Date().toISOString(),
  sessionDate: "2026-09-03", status: "ok", rows: [] });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitMessage();
silences.unavailable = await readSilence();

/* unreadable, from the page: the fetch itself did not come back. Aborted at
   the route so the catch in render() runs against a real failed request. */
await page.route("**/api/flows/board*", (r) => r.abort());
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitMessage();
silences.failed = await readSilence();
await page.unroute("**/api/flows/board*");
/* THE ONE FAILURE THIS SUITE CAUSED ON PURPOSE. Chromium logs the aborted
   request as a console error, and section 11 counts every console error as a
   defect — so the abort is claimed here, exactly once, and removed from the
   ledger. A count of zero would mean the route never aborted and the
   "failed" fixture above measured a page that loaded normally. */
const abortedAt = errors.findIndex((e) => /net::ERR_FAILED/.test(e));
ok(abortedAt >= 0, "the aborted board fetch was recorded as the request failure it is");
errors.splice(abortedAt, 1);
eq(errors.filter((e) => /net::ERR_FAILED/.test(e)).length, 0,
   "and it failed exactly once — the unroute took, so nothing after it is measured against a dead API");

for (const kind of ["quiet", "pending", "unreadable", "unavailable"]) {
  eq(silences[kind].kind, kind, `the ${kind} fixture reaches the ${kind} branch and is tagged as such`);
  eq(silences[kind].statusKind, kind,
     `and the status line above the deck carries the same data-empty="${kind}", so the silence is ` +
     `marked where a screen reader is told about it first`);
  eq(silences[kind].align, "left",
     `the marked ${kind} paragraph is set flush left — a left-edge mark on a centred block floats ` +
     `mid-grid, which is the same as no mark`);
  eq(silences[kind].justify, "start",
     `and it starts at the deck's left edge rather than centring in the grid, for the same reason`);
}

const shape = (k) => silences[k].style + " " + silences[k].width + " " + silences[k].glyph;
eq(new Set(["quiet", "pending", "unreadable", "unavailable"].map(shape)).size, 4,
   "the four silences resolve to four different treatments on the board's own paragraph — " +
   ["quiet", "pending", "unreadable", "unavailable"].map((k) => k + "=" + shape(k)).join("; ") +
   " — where before every one of them was the same centred grey sentence");
eq(new Set(["quiet", "pending", "unreadable", "unavailable"]
     .map((k) => silences[k].style + " " + silences[k].width)).size, 4,
   "and they are separable on border STYLE and WIDTH alone, which carry no hue: the monochrome " +
   "printout keeps all four apart");
eq(silences.pending.style, "dotted", "pending is the dotted edge the taxonomy names (still coming)");
eq(silences.pending.glyph, '"…"', "with the ellipsis glyph");
eq(silences.unavailable.style, "dashed", "unavailable is the dashed edge (published, not on it)");
eq(silences.unavailable.glyph, '"†"', "with the dagger");
eq(silences.unreadable.style + " " + silences.unreadable.width, "solid 3px",
   "unreadable is the wide solid edge — the one silence whose remedy is “refresh”");
eq(silences.unreadable.glyph, '"×"', "with the cross");
eq(silences.quiet.style + " " + silences.quiet.width, "solid 1px",
   "quiet is a hairline: a reading about the market, at the same ink as any other note");
eq(silences.quiet.glyph, "none", "and no glyph at all — it is not an alarm");
eq(silences.failed.kind, "unreadable",
   "a fetch that did not come back is tagged UNREADABLE — the catch in render() used to tag it " +
   "“unavailable”, the dagger that means “published, and this field is not on it”, which is the " +
   "opposite of what happened");
eq(shape("failed"), shape("unreadable"),
   "and so it wears the SAME mark as a store read that threw: both are " +
   "“nothing was read”, and the catch in render() used to tag it “unavailable” — the dagger " +
   "that means “published, and this field is not on it”, which is the opposite of what happened");
eq(silences.failed.statusKind, "unreadable", "and the status line says so too on the failed fetch");

/* THE SENTENCES SAY WHICH, in the taxonomy's own words, and no longer hedge. */
ok(/has been published for this side yet/.test(silences.pending.text),
   `pending says the board is not published yet, without guessing at a store fault (${silences.pending.text})`);
ok(/could not be read/.test(silences.unreadable.text),
   `unreadable says the store could not be read (${silences.unreadable.text})`);
ok(/no rows and no scored population/.test(silences.unavailable.text),
   `unavailable says what the published payload lacks (${silences.unavailable.text})`);
for (const kind of ["pending", "unreadable", "unavailable"]) {
  ok(!/Either the pipeline|Actions tab/.test(silences[kind].text),
     `the ${kind} sentence no longer hedges across two causes or sends the reader to a CI tab`);
}

/* A FILTER THAT MATCHES NOTHING IS NOT A SILENCE and gets no edge: the rows
   are here, the reader hid them. Same paragraph, same class, no mark. */
await put("board:long", board("long", true));
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
await page.fill("#fbQ", "ZZZZ");
await page.waitForFunction(() => !!document.querySelector('p.fb-empty[data-empty="filtered"]'));
const filteredMsg = await readSilence();
eq(filteredMsg.style, "none", "the filtered paragraph carries no edge — it is not one of the four silences");
eq(filteredMsg.glyph, "none", "and no glyph");
eq(filteredMsg.statusKind, null, "and the status line above it carries no silence either");

/* ---- 13. the tile foot prints its absence, and hue claims no side ------ */

/* ONE ROW WITH NO PRICED MOVE, beside seven that have one. On the emitted
   long board this was SYN168 — `hm` null because the run had no usable
   30-day implied volatility to scale — and its tile showed an EMPTY foot
   slot: the same appearance as a board published before the field existed.
   The em dash is the mark every other absence on this tile wears. The
   fixture also carries a dispersion and alternates the gamma regime, so the
   two other readings on this line are measured on the same page. */
await put("board:long", {
  ...board("long", true), dispersion: 0.7076, horizonSessions: 10,
  rows: TICKERS.map((t, i) => ({ ...boardRow(t, i, true), hm: i === 0 ? null : 0.0931, hr: 0.0368 })),
});
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const foot = await page.evaluate(() => {
  /* By ticker, not by position: section 8 chose an order, and a fixture read
     at an index pins whichever order happens to be current. */
  const cardOf = (t) => Array.from(document.querySelectorAll(".fd-card"))
    .find((c) => c.querySelector(".fd-tk").textContent === t);
  const rowOf = (t) => Array.from(document.querySelectorAll("#flowsBody tr"))
    .find((tr) => tr.querySelector(".fb-open").textContent === t);
  const unpriced = cardOf("NVDA").querySelector(".fd-move");
  const priced = cardOf("NVAX").querySelector(".fd-move");
  const regimeCell = rowOf("NVAX").children[7];
  return {
    unpriced: {
      text: unpriced.textContent,
      empty: unpriced.getAttribute("data-empty"),
      title: unpriced.getAttribute("title") || "",
      aria: cardOf("NVDA").getAttribute("aria-label") || "",
    },
    priced: { text: priced.textContent, title: priced.getAttribute("title") || "" },
    toned: document.querySelectorAll(".fd-foot .fb-neg, .fd-foot .fb-pos").length,
    shortRegimes: Array.from(document.querySelectorAll(".fd-foot"))
      .filter((f) => /short Γ/.test(f.textContent)).length,
    cell: { text: regimeCell.textContent.trim(), cls: regimeCell.className },
    status: document.getElementById("flowsStatus").textContent,
    statusKind: document.getElementById("flowsStatus").getAttribute("data-empty"),
  };
});
eq(foot.unpriced.text, "±—",
   "a row with hm null prints “±—” in the priced-move slot, never “” — an unmeasured move and a " +
   "missing field must not render the same way, and the em dash is this tile's mark for absence");
eq(foot.unpriced.empty, "unavailable",
   "and the span is tagged unavailable: the board is published, and this field is not on this row");
ok(/no usable 30-day implied volatility/.test(foot.unpriced.title),
   `the title says why the slot is empty rather than leaving a dash to be guessed at (${foot.unpriced.title})`);
ok(/Priced move unavailable\./.test(foot.unpriced.aria),
   "and the card's accessible name says the same, where before a screen reader heard nothing in " +
   "that position — a silence indistinguishable from the field never having existed");
eq(foot.priced.text, "±9.3% priced", "while a measured move still prints as it did");
ok(/over 10 trading sessions/.test(foot.priced.title), "with its horizon in the title");
eq(foot.toned, 0,
   "no tile foot carries fb-neg or fb-pos: a short gamma regime is a dealer-hedging state, not a " +
   "bearish lean, and 36 of 44 tiles on the emitted BULLISH board ended in red “short Γ” — hue " +
   "saying bearish under text that says nothing of the kind");
eq(foot.shortRegimes, 4, "the regime itself is still printed on every short-regime tile (4 of 8 here)");
eq(foot.cell.text, "short Γ", "the table's Γ regime cell still prints the regime");
ok(/fb-flat/.test(foot.cell.cls) && !/fb-neg|fb-pos/.test(foot.cell.cls),
   `and carries the neutral class only, like the 52w, VRP and IVR cells beside it (${foot.cell.cls})`);
ok(/spread 0\.71 composite units \(95th pct of \|residual\|, not the score's scale\)/.test(foot.status),
   "the dispersion travels with its unit and its statistic: 0.71 is the 95th percentile of " +
   "|residual| in composite units, printed beside scores like +59 that are 100·tanh of a scaled " +
   "residual — a bare “spread 0.71 (95th pct)” shared no scale with its neighbours and said so " +
   `nowhere (${foot.status})`);
ok(/1 new to this side since the previously published board/.test(foot.status),
   "the warm board's memory clause is unchanged: one name new, against the row count this same line opens with");
eq(foot.statusKind, null, "a board with rows carries no silence mark on its status line");

/* THE COLD CLAUSE IS GONE. On a board with no memory the status line used to
   add “no comparison with a previously published board” — 200px above the
   note setMemoryNote() draws from the publisher's own sentence. The same
   silence worded twice, and two wordings of one outage is how a reader
   concludes there are two outages. The note is the single statement. */
await put("board:short", board("short", false));
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector(".fd-card");
const cold = await page.evaluate(() => {
  const note = document.querySelector(".fb-memnote");
  return {
    status: document.getElementById("flowsStatus").textContent,
    note: note ? { memory: note.getAttribute("data-memory"), text: note.textContent } : null,
  };
});
ok(cold.note && cold.note.memory === "pre-memory",
   "the cold board draws its memory note — the one statement of the missing comparison");
ok(!/no comparison/i.test(cold.status),
   `and the status line does not restate it in a second wording (${cold.status})`);

/* ---- 14. the quiet sentence states counts and passes no verdict --------- */

/* "which is what a quiet session looks like" was a template, printed
   whatever the numbers were: with the emitted corpus's 3 neutral of 100
   scored it would have called a session with 97 names past the band on the
   other side quiet. And an absent `neutral` printed "all of them landed
   inside the band" — a confident census from a field that was not there. */
await put("board:short", { ...board("short", false), rows: [], deadBand: 1, scored: 100, neutral: 3 });
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForFunction(() => !!document.querySelector('p.fb-empty[data-empty="quiet"]'));
const quietSaid = await page.evaluate(() => document.querySelector("p.fb-empty").textContent);
ok(/cleared the ±1 band this session\. 100 names were scored, 3 of them inside the band; the other side may hold the rest\./.test(quietSaid),
   `the quiet sentence states the band, the scored population and the neutral count, each from its own field (${quietSaid})`);
ok(!/quiet session looks like/.test(quietSaid),
   "and characterises the session as nothing — 3 of 100 inside the band is not a quiet session, " +
   "and the sentence no longer says it is");

await put("board:short", { ...board("short", false), rows: [], scored: 100 });
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForFunction(() => !!document.querySelector('p.fb-empty[data-empty="quiet"]'));
const quietBare = await page.evaluate(() => document.querySelector("p.fb-empty").textContent);
ok(/cleared the dead band this session\. 100 names were scored; the other side may hold the rest\./.test(quietBare),
   `with no band width and no neutral count published, the sentence names neither (${quietBare})`);
ok(!/all of them|inside the band|±/.test(quietBare),
   "and never fills the neutral count with “all” — an absent field is a silence, not a census");

/* ---- 11. EVERY OPENER ON BOTH VIEWS IS A LINK TO THE READER ---------
   Both were <button data-t> that a delegated handler in the retired
   flows-card.js turned into a modal. BOTH VIEWS IN ONE PLACE, because the deck
   and the table are two renderers over one payload — the kind of fact that
   gets fixed in one of them. The table cell also carried a SECOND control, a
   small arrow anchor for the reader who wanted the page instead, and the
   anchor count below is what proves it gone. */
{
  await put("board:long", board("long", true));
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForSelector(".fd-card");
  /* The toggle hides a view, it does not unbuild it, so the table's rows are
     waited on as ATTACHED rather than visible. */
  await page.waitForSelector("#flowsBody tr .fb-open", { state: "attached" });
  const shapes = await page.evaluate(() => {
    const read = (el, t, anchors) => ({
      tag: el.tagName, href: el.getAttribute("href"), t,
      pop: el.getAttribute("aria-haspopup"), dataT: el.dataset.t || null, anchors });
    return {
      deck: Array.from(document.querySelectorAll(".fd-card"),
        (c) => read(c, c.querySelector(".fd-tk").textContent, 0)),
      rows: Array.from(document.querySelectorAll("#flowsBody tr"), (tr) => {
        const cell = tr.querySelector(".fb-tk"), open = cell.querySelector(".fb-open");
        return read(open, open.textContent, cell.querySelectorAll("a").length);
      }),
    };
  });
  ok(shapes.deck.length > 0 && shapes.rows.length > 0,
     `both views rendered rows (${shapes.deck.length} cards, ${shapes.rows.length} rows)`);
  for (const [view, list] of [["deck card", shapes.deck], ["row", shapes.rows]]) {
    for (const o of list) {
      eq(o.tag, "A", `${view} ${o.t}: is an anchor, not a button that opened a modal`);
      eq(o.href, "/flows/ticker/?t=" + o.t + "&s=signal&from=long",
         `${view} ${o.t}: links to its own reader, carrying the side (${o.href})`);
      eq(o.pop, null, `${view} ${o.t}: announces no dialog, because there is none`);
      eq(o.dataT, null, `${view} ${o.t}: carries no data-t for a delegation to find`);
    }
  }
  for (const r of shapes.rows) {
    eq(r.anchors, 1,
       `row ${r.t}: the name cell offers ONE link and not two — the arrow beside the ` +
       "modal-opening button has nothing left to be an alternative to");
  }
}

/* ---- 12. nothing threw along the way -------------------------------- */

eq(errors.length, 0,
   "no page error and no console error across both board routes: " + errors.join(" | "));

await browser.close();
await server.stop();

console.log(`✓ flows-board-render: ${checks} assertions — the control bar exists at all, the ` +
  `library it depends on is named before its symptoms, a denominator that stays silent until ` +
  `it has something to say, a measured zero match distinguished from an empty board, orders ` +
  `withheld exactly when the payload cannot produce them, a rail badge that is silent on a ` +
  `pending board, prints its measured zero on a quiet one and its whole POOL on a board the ` +
  `length cap truncated — the same number the sentence beside it reconciles against — no ` +
  `overflow at 320px, four silences on the deck's own paragraph that are four shapes in ` +
  `greyscale with the Worker's failed read told apart from a never-published side, a priced ` +
  `move that prints its absence, a gamma regime no hue calls bearish, a dispersion that ` +
  `carries its unit, one statement of a cold memory, a quiet sentence that counts and ` +
  `passes no verdict, and every opener on BOTH views an anchor to that name's reader — ` +
  `carrying the side it was read off, announcing no dialog, and offering one link per name ` +
  `rather than the button-plus-arrow pair the retired modal needed`);
