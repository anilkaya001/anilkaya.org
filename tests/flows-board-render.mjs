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
   envelope the Worker answers with (worker.js:2605) both when the board row is
   absent and when the D1 read THREW, so the page under test reads the same
   bytes either cause produces. */
await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForFunction(() => !!document.querySelector('[data-empty="unavailable"]'));
const railPending = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="long"]');
  return {
    text: el ? el.textContent : null,
    hidden: el ? el.hidden : null,
    msg: document.querySelector('[data-empty="unavailable"]').textContent,
  };
});
ok(/No board is available for this side/.test(railPending.msg),
   "the pending payload reaches the branch that says no board is available — the badge is being " +
   "read BESIDE that sentence, so the sentence is confirmed on screen rather than assumed");
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
    msg: document.querySelector('[data-empty="quiet"]').textContent,
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

/* ---- 11. nothing threw along the way -------------------------------- */

eq(errors.length, 0,
   "no page error and no console error across both board routes: " + errors.join(" | "));

await browser.close();
await server.stop();

console.log(`✓ flows-board-render: ${checks} assertions — the control bar exists at all, the ` +
  `library it depends on is named before its symptoms, a denominator that stays silent until ` +
  `it has something to say, a measured zero match distinguished from an empty board, orders ` +
  `withheld exactly when the payload cannot produce them, a rail badge that is silent on a ` +
  `pending board, prints its measured zero on a quiet one and its whole POOL on a board the ` +
  `length cap truncated — the same number the sentence beside it reconciles against — and no ` +
  `overflow at 320px`);
