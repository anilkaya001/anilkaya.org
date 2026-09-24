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

const TICKERS = ["NVDA", "NVAX", "AAPL", "AMD", "MSFT", "GOOG", "INTC", "TSLA"];
const SECTORS = ["Technology", "Healthcare", "Technology", "Technology", "Technology",
  "Communication Services", "Technology", "Consumer Cyclical"];

const boardRow = (t, i, warm) => ({
  t, r: i + 1, s: 90 - i * 7, cnv: 80 - i * 3,
  px: 100 + i, chg: 0.01, purity: 0.02, sector: SECTORS[i],
  gRegime: i % 2 ? "short" : "long", gFlipDist: -0.1 - i / 100,
  netPrem: (i % 2 ? -1 : 1) * (1e7 - i * 1e5),
  fam: { F: 10, P: 20, D: 30, V: 40, O: 50 },

  edte: 20 + i,

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

const ROWS = "#flowsBody .bd-row[data-flip]";
const readInfo = async (selector) => {
  await page.click(selector);
  await page.waitForSelector("#fxPop:popover-open");
  const text = await page.$eval("#fxPop", (el) => el.innerText);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#fxPop:popover-open"));
  return text;
};

await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);

const uiShape = await page.evaluate(() => {
  const U = window.FlowsUI;
  if (!U) return null;
  return { segmented: typeof U.segmented, infoButton: typeof U.infoButton, gaugeChip: typeof U.gaugeChip, mount: typeof (U.chart && U.chart.mount) };
});
ok(uiShape !== null,
   "window.FlowsUI is defined on /flows/long/ — the board reads it at module scope and every control " +
   "below is downstream of this one fact, so it is asserted first and on its own: an undefined library " +
   "is a missing script tag, while a missing #fbQ could be any of a dozen things");
eq(uiShape && uiShape.segmented, "function", "FlowsUI.segmented is callable — the List | Map switch is built from it");
eq(uiShape && uiShape.infoButton, "function", "FlowsUI.infoButton is callable — every sentence the board used to paint lives behind one");
eq(uiShape && uiShape.gaugeChip, "function", "FlowsUI.gaugeChip is callable — the summary track is built from it");
eq(uiShape && uiShape.mount, "function", "FlowsUI.chart.mount is callable — the board map draws through it");

const controls = await page.evaluate(() => {
  const tools = document.querySelector("#bdTools");
  const q = document.querySelector("#fbQ");
  const s = document.querySelector("#fbSort");
  const c = document.querySelector(".fb-count");
  return {
    tools: !!tools,
    q: !!q, s: !!s, c: !!c,
    inTools: !!(tools && q && s && tools.contains(q) && tools.contains(s)),
    qSize: q ? parseFloat(getComputedStyle(q).fontSize) : 0,
    countHidden: c ? c.hidden : null,
    countRole: c ? c.getAttribute("role") : null,
    options: s ? Array.from(s.options).map((o) => o.value) : null,
  };
});

ok(controls.tools,
   "the board's control row is in the DOM on /flows/long/ — this is the assertion whose absence once let " +
   "~130 lines of finished code ship dead on the two busiest routes in the section");
ok(controls.q, "the ticker filter #fbQ exists");
ok(controls.s, "the order select #fbSort exists");
ok(controls.c, "the match denominator .fb-count exists");
ok(controls.inTools,
   "both controls sit in the card's own wrapping tools row, where a native <select>'s widest option cannot " +
   "set the width of a flex parent — the defect that grew a horizontal scrollbar at 352px when the controls " +
   "were a flex child of the lede. The 320px measurement below is the proof");
ok(controls.qSize >= 15,
   `the filter's text is at least 15px on a fine pointer (${controls.qSize}px) and 16px on a coarse one, so iOS never zooms into it`);

eq(controls.countHidden, true,
   "with no filter typed the count is HIDDEN rather than reading “8 of 8” — a count of " +
   "everything against everything teaches the eye to skip the line on the session it matters");
eq(controls.countRole, "status",
   "the count carries role=status, so a filter that narrows to nothing is announced: that is " +
   "the case where no rows remain on screen to notice");

await page.fill("#fbQ", "NV");
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, ROWS);

const filtered = await page.evaluate((sel) => ({
  rows: document.querySelectorAll(sel).length,
  count: document.querySelector(".fb-count").textContent,
  hidden: document.querySelector(".fb-count").hidden,
}), ROWS);
eq(filtered.rows, 2, "typing NV leaves exactly the two names that begin NV (NVDA, NVAX)");
eq(filtered.hidden, false, "the count is shown once a filter is set");
ok(/\b2 of 8 names match\b/.test(filtered.count),
   "the count states the POPULATION the two came out of — “" + filtered.count + "”. Two rows " +
   "on their own are the same shape as a board with two names on it, and a list that " +
   "truncates without saying so reads as a population");
ok(filtered.count.includes("“NV”"),
   "the count echoes what was typed, in quotes, so the reader can see the filter that produced it");

await page.fill("#fbQ", "ZZZZ");
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 0, ROWS);
const none = await page.evaluate(() => {
  const msg = document.querySelector('#flowsBody [data-empty="filtered"]');
  return {
    count: document.querySelector(".fb-count").textContent,
    msg: msg ? msg.textContent : null,
    clear: !!(msg && msg.querySelector("button")),
  };
});
ok(/\b0 of 8 names match\b/.test(none.count),
   "a filter matching nothing reads “0 of 8” rather than going blank — the zero is MEASURED " +
   "(eight rows were tested and none matched), which is a different statement from a board " +
   "that published nothing");
ok(none.msg !== null && /No match/.test(none.msg) && none.clear,
   "the empty filter says No match and offers Clear beside it, so a typed filter is not read as an " +
   `outage and the way back is one tap (${none.msg})`);

await page.click('#flowsBody [data-empty="filtered"] button');
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 8, ROWS);
eq(await page.inputValue("#fbQ"), "", "Clear empties the field it answers for");
await page.fill("#fbQ", "ZZZZ");
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 0, ROWS);

const requestsBefore = [];
page.on("request", (r) => { if (/\/api\/flows\//.test(r.url())) requestsBefore.push(r.url()); });
await page.fill("#fbQ", "");
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 8, ROWS);
const restored = await page.evaluate((sel) => ({
  rows: document.querySelectorAll(sel).length,
  hidden: document.querySelector(".fb-count").hidden,
}), ROWS);
eq(restored.rows, 8, "clearing the field brings all eight names back");
eq(restored.hidden, true, "and the count goes silent again with no filter set");
eq(requestsBefore.length, 0,
   "clearing the filter spends NO network call — the rows never left memory, and a filter " +
   "that refetches is a filter that costs the reader a round trip per keystroke");

await page.fill("#fbQ", "HEALTH");
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 1, ROWS);
eq(await page.$eval(ROWS + " .bd-open", (a) => a.textContent), "NVAX",
   "a word of three letters or more also finds a sector — HEALTH leaves the one Healthcare name");
await page.fill("#fbQ", "");
await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 8, ROWS);

const warmOptions = controls.options;
ok(warmOptions.includes("dr:desc"),
   "the warm board offers “climb since the previous board” — its rows carry dr");
ok(warmOptions.includes("nw:desc"),
   "and “new to this side first” — its rows carry nw");
ok(warmOptions.includes(""),
   "the published rank is offered, spelled by the empty value the way ?view=list is spelled by absence");

{
  const shape = await page.evaluate((sel) => {
    const rows = [...document.querySelectorAll(sel)];
    const head = [...document.querySelectorAll("#bdHead [role=columnheader]")];
    return {
      head: head.length,
      cells: rows.map((r) => r.querySelectorAll(":scope > [role=cell]").length),
      sectors: rows.map((r) => (r.querySelector(".bd-sg") || { getAttribute: () => null }).getAttribute("aria-label")),
      table: document.querySelector("#bdTable").getAttribute("role"),
      rowgroup: document.querySelector("#flowsBody").getAttribute("role"),
    };
  }, ROWS);
  eq(shape.table, "table", "the board is announced as a table");
  eq(shape.rowgroup, "rowgroup", "and its body as the rowgroup #flowsBody");
  ok(shape.cells.every((n) => n === shape.head),
     `every row has exactly as many cells as the header has columns (${shape.head}) — a row one cell ` +
     "short puts every heading one column off the value beneath it, silently");
  assert.deepEqual(shape.sectors, SECTORS,
    "each row carries its sector as a glyph whose accessible name is the sector itself"); checks++;
}

{
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#bdHead [data-col="siP"]')).display !== "none");
  const align = await page.evaluate(() => {
    const row = document.querySelector("#flowsBody .bd-row[data-flip]");
    const head = (k) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(`#bdHead [data-col="${k}"] .bd-hs`).firstChild);
      return range.getBoundingClientRect();
    };
    const cell = (k) => row.querySelector(`[data-col="${k}"]`).getBoundingClientRect();
    const right = ["cnv", "px", "netPrem", "hm", "ivr", "vrpP", "siP"].map((k) => [k, Math.abs(head(k).right - cell(k).right)]);
    const score = Math.abs(head("s").left - row.querySelector('[data-col="s"] .bd-v').getBoundingClientRect().left);
    const g = [...document.querySelectorAll('#flowsBody [data-col="g"] .bd-g')];
    const text = (regime) => [...new Set(g.filter((n) => n.dataset.regime === regime).map((n) => n.textContent))];
    return { right, score, long: text("long"), short: text("short") };
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  eq(align.right.length, 7, "all seven right-aligned columns are on screen at a desk width to be measured");
  for (const [k, off] of align.right) {
    ok(off <= 1.5,
       `the ${k} heading ends where its figures end (${off.toFixed(1)}px apart): a sort arrow that takes up room ` +
       "beside a right-aligned heading pushes it off the column it names");
  }
  ok(align.score <= 1.5,
     `and Score starts where its figures start (${align.score.toFixed(1)}px apart) rather than centring over a ` +
     "left-aligned column");
  ok(align.long.length === 1 && align.short.length === 1 && align.long[0] !== align.short[0],
     `the gamma regimes differ in their glyph and not only in hue (long ${align.long}, short ${align.short}), ` +
     "so a reader without colour still tells a damping book from an amplifying one");
  ok(/^\+/.test(align.long[0]) && /^\u2212/.test(align.short[0]), "positive gamma for long, a real minus for short");

  const stale = await page.evaluate(() => {
    const b = document.getElementById("bdStale");
    return b ? { kind: b.dataset.stale, inTitle: !!b.closest(".ui-mod-t"), state: b.dataset.state } : null;
  });
  ok(stale && stale.kind === "session" && stale.inTitle && stale.state === "stale",
     `a board whose session is weeks old wears the stale glyph in its title, stamped with WHICH outage it is (${JSON.stringify(stale)})`);
  const staleSaid = await readInfo("#bdStale");
  ok(/2026-09-03 session/.test(staleSaid), `and the glyph opens the sentence naming the aged session (${staleSaid.slice(0, 160)})`);
}

{
  const sortState = () => page.evaluate(() => {
    const on = [...document.querySelectorAll("#bdHead [aria-sort]")]
      .filter((h) => h.getAttribute("aria-sort") !== "none").map((h) => h.dataset.col + ":" + h.getAttribute("aria-sort"));
    return { on, first: document.querySelector("#flowsBody .bd-row .bd-open").textContent, sel: document.querySelector("#fbSort").value };
  });
  await page.click('#bdHead [data-col="netPrem"] .bd-hs');
  const byPrem = await sortState();
  assert.deepEqual(byPrem.on, ["netPrem:descending"], "a header click sorts by that column and says so on the header"); checks++;
  eq(byPrem.first, "NVDA", "the largest net premium leads");
  eq(byPrem.sel, "netPrem:desc", "and the order menu follows the header, so the two controls never disagree");
  await page.click('#bdHead [data-col="netPrem"] .bd-hs');
  eq((await sortState()).on[0], "netPrem:ascending", "a second click reverses it");
  await page.click('#bdHead [data-col="netPrem"] .bd-hs');
  const back = await sortState();
  eq(back.on.length, 0, "a third click returns to the published rank, and no header claims a sort");
  eq(back.first, "NVDA", "with the rank-one name back on top");
}

await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);
const coldOptions = await page.evaluate(() => {
  const s = document.querySelector("#fbSort");
  return s ? Array.from(s.options).map((o) => o.value) : null;
});
ok(coldOptions !== null, "the control row is built on /flows/short/ too, not only on long");
ok(!coldOptions.includes("dr:desc"),
   "the cold board does NOT offer the climb order — no row carries dr, and an option that " +
   "silently leaves the board in the published order is a control that lies about having done something");
ok(!coldOptions.includes("nw:desc"), "nor the new-to-this-side order, for the same reason");
ok(coldOptions.includes("s:desc") && coldOptions.includes("t:asc"),
   "the orders the payload CAN produce are still offered — the gate is per option, not a " +
   "blanket refusal to build the select");
eq(warmOptions.length - coldOptions.length, 2,
   "exactly two orders are withheld on a cold memory, so a future column that quietly stops " +
   "being offered fails here rather than disappearing");

await page.selectOption("#fbSort", "t:asc");
await page.waitForFunction(() =>
  document.querySelector("#flowsBody .bd-open") &&
  document.querySelector("#flowsBody .bd-open").textContent === "AAPL");
const ordered = await page.$$eval("#flowsBody .bd-open", (a) => a.map((x) => x.textContent));
const alphabetical = TICKERS.slice().sort();
assert.deepEqual(ordered, alphabetical,
  "choosing “Ticker” actually reorders the list — the select is wired and not merely rendered"); checks++;

await page.setViewportSize({ width: 320, height: 800 });
await page.waitForTimeout(160);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1,
   `no horizontal overflow at 320px with the controls present (measured ${overflow}px). This is ` +
   "the measurement the wrapping tools row exists for, and the one that regressed to 352px when the " +
   "controls were a flex child");

await page.setViewportSize({ width: 1280, height: 1000 });

await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);
const railFull = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="long"]');
  const chip = [...document.querySelectorAll("#bdHero .ui-gchip")].find((c) => /Cleared/.test(c.textContent));
  return { text: el ? el.textContent : null, hidden: el ? el.hidden : null, chip: chip ? chip.querySelector(".ui-chip-v").textContent : null };
});
eq(railFull.text, "8",
   "the rail badge for this side is filled by the page — the nav is served with the slot empty " +
   "and hidden because filling it there would cost a D1 row read per page view for a number the " +
   "page is about to fetch anyway, so the controller holding the payload fills it. This board " +
   "publishes no `cleared`, so 8 here is also the FALLBACK arm");
eq(railFull.hidden, false, "and the slot is shown once it has a measurement in it");
eq(railFull.chip, railFull.text,
   "and the Cleared figure in the summary track is the same number as the badge: one population, one number");

await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(".bd-silent[data-empty]");
const railPending = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="long"]');
  const p = document.querySelector(".bd-silent[data-empty]");
  return { text: el ? el.textContent : null, hidden: el ? el.hidden : null, kind: p.getAttribute("data-empty") };
});
const pendingSaid = await readInfo(".bd-silent[data-empty] [data-info]");
eq(railPending.kind, "pending",
   "the absent-row envelope is tagged PENDING — “not published yet” — and not “unavailable”, which means " +
   "“published, and this field is not on it”");
ok(/No board has been published for this side yet/.test(pendingSaid),
   "the pending payload reaches the branch that says no board has been published, read from the silence's " +
   "own disclosure where the sentence now lives");
eq(railPending.hidden, true,
   "the badge stays HIDDEN on a pending board. A pending payload has rows.length 0 by construction, so an " +
   "unguarded String(rows.length) would put a “0” in the rail beside a page saying the pipeline may never " +
   "have published — a confident count of a market nobody measured");
eq(railPending.text, "",
   "and the slot holds no text at all: a hidden element carrying “0” prints that zero the moment " +
   "anything disagrees about `hidden`");

await put("board:short", {
  ...board("short", false), rows: [], deadBand: 1, scored: 130, neutral: 124,
});
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector('.bd-silent[data-empty="quiet"]');
const railQuiet = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="short"]');
  return { text: el ? el.textContent : null, hidden: el ? el.hidden : null };
});
const quietMsg = await readInfo('.bd-silent[data-empty="quiet"] [data-info]');
ok(/130 names were scored/.test(quietMsg),
   "the measured-empty payload reaches the quiet branch, the one silence of the four that is a " +
   "statement about the market rather than about the plumbing");
eq(railQuiet.text, "0",
   "a session that scored 130 names and placed none on this side badges “0”, because here the " +
   "zero IS the reading");
eq(railQuiet.hidden, false,
   "and that zero is VISIBLE: a rail that hides a measured emptiness collapses a quiet session " +
   "into an outage, the same error as the pending case with its sign reversed");

await put("board:long", {
  ...board("long", true), deadBand: 20, scored: 130, neutral: 118,
  cleared: 12, shed: 4,
});
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);
const capped = await page.evaluate((sel) => {
  const el = document.querySelector('[data-rail-count="long"]');
  return {
    text: el ? el.textContent : null,
    hidden: el ? el.hidden : null,
    rows: document.querySelectorAll(sel).length,
    status: document.getElementById("flowsStatus").textContent,
  };
}, ROWS);
eq(capped.rows, 8,
   "the page draws the eight rows the payload published, so it really is an excerpt of the " +
   "twelve names that payload says cleared the band");
eq(capped.text, "12",
   "and the rail badges TWELVE, the population the publisher measured, rather than the eight " +
   "this board had room for");
eq(capped.hidden, false, "shown, because there is a measured population behind it");

const said = /\((\d+) of (\d+) shown\)/.exec(capped.status);
ok(said, `the status line states the pool it is an excerpt of at all (${capped.status})`);
eq(said && said[2], capped.text,
   "the population in the sentence and the population in the badge are the SAME number — two elements " +
   "wording one quantity differently is how a reader concludes there are two quantities");
eq(said && said[1], String(capped.rows),
   "while the numerator in that sentence is the rows actually drawn");
const capInfo = await readInfo("#bdMod .ui-mod-h .ui-info");
ok(/Shown\s*8 of 12/.test(capInfo),
   `and the board's disclosure states the same excerpt as a fact, so a sighted reader gets it too (${capInfo.slice(0, 200)})`);

await put("board:short", {
  ...board("short", false), rows: [], deadBand: 1, scored: 130, neutral: 130,
  cleared: 0, shed: 0,
});
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector('.bd-silent[data-empty="quiet"]');
const railZero = await page.evaluate(() => {
  const el = document.querySelector('[data-rail-count="short"]');
  return { text: el ? el.textContent : null, hidden: el ? el.hidden : null };
});
eq(railZero.text, "0",
   "a side that scored 130 names and cleared none of them badges the published “0”");
eq(railZero.hidden, false, "and it is visible, for the reason the fallback arm already gives");

const readSilence = async () => {
  const shape = await page.evaluate(() => {
    const p = document.querySelector(".bd-silent[data-empty]");
    if (!p) return null;
    const use = p.querySelector("svg use");
    const status = document.getElementById("flowsStatus");
    return {
      kind: p.getAttribute("data-empty"),
      glyph: use ? use.getAttribute("href") : null,
      word: (p.querySelector(".ui-silent-t") || {}).textContent || null,
      label: p.getAttribute("aria-label"),
      statusKind: status.getAttribute("data-empty"),
      tableHidden: document.getElementById("bdTable").hidden,
    };
  });
  shape.text = await readInfo(".bd-silent[data-empty] [data-info]");
  return shape;
};
const silences = {};

const waitSilence = () => page.waitForSelector(".bd-silent[data-empty]");

await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await waitSilence();
silences.quiet = await readSilence();

await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitSilence();
silences.pending = await readSilence();

await put("board:long", { side: "long", rows: [], generatedAt: null, status: "pending", reason: "read-failed" });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitSilence();
silences.unreadable = await readSilence();

await put("board:long", { side: "long", generatedAt: new Date().toISOString(),
  sessionDate: "2026-09-03", status: "ok", rows: [] });
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitSilence();
silences.unavailable = await readSilence();

await page.route("**/api/flows/board*", (r) => r.abort());
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await waitSilence();
silences.failed = await readSilence();
await page.unroute("**/api/flows/board*");

const abortedAt = errors.findIndex((e) => /net::ERR_FAILED/.test(e));
ok(abortedAt >= 0, "the aborted board fetch was recorded as the request failure it is");
errors.splice(abortedAt, 1);
eq(errors.filter((e) => /net::ERR_FAILED/.test(e)).length, 0,
   "and it failed exactly once — the unroute took, so nothing after it is measured against a dead API");

const FOUR = ["quiet", "pending", "unreadable", "unavailable"];
for (const kind of FOUR) {
  eq(silences[kind].kind, kind, `the ${kind} fixture reaches the ${kind} branch and is tagged as such`);
  eq(silences[kind].statusKind, kind,
     `and the status line carries the same data-empty="${kind}", so the silence is marked where a ` +
     "screen reader is told about it first");
  eq(silences[kind].tableHidden, true,
     `the ${kind} stand-in replaces the table rather than sitting above an empty header row`);
  ok(new RegExp("^" + silences[kind].word + ": ").test(silences[kind].label || ""),
     `the ${kind} stand-in names its state in its accessible name (${silences[kind].label})`);
}
eq(new Set(FOUR.map((k) => silences[k].glyph)).size, 4,
   "the four silences resolve to four different GLYPHS — " + FOUR.map((k) => k + "=" + silences[k].glyph).join("; ") +
   " — so they stay apart with every colour removed: a shape carries no hue");
eq(new Set(FOUR.map((k) => silences[k].word)).size, 4, "and four different words beneath them");
eq(silences.pending.glyph, "#g-pending", "pending is the dotted ring the silence system names (still coming)");
eq(silences.unavailable.glyph, "#g-unavailable", "unavailable is the slashed circle (published, not on it)");
eq(silences.unreadable.glyph, "#g-stop", "unreadable is the crossed circle — the one silence whose remedy is “refresh”");
eq(silences.quiet.glyph, "#g-quiet", "quiet is the minus circle: a reading about the market, not an alarm");
eq(silences.failed.kind, "unreadable",
   "a fetch that did not come back is tagged UNREADABLE — never “unavailable”, which means “published, " +
   "and this field is not on it”, the opposite of what happened");
eq(silences.failed.glyph, silences.unreadable.glyph,
   "and so it wears the SAME glyph as a store read that threw: both are “nothing was read”");
eq(silences.failed.statusKind, "unreadable", "and the status line says so too on the failed fetch");

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

await put("board:long", board("long", true));
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);
await page.fill("#fbQ", "ZZZZ");
await page.waitForSelector('#flowsBody [data-empty="filtered"]');
const filteredMsg = await page.evaluate(() => {
  const n = document.querySelector('#flowsBody [data-empty="filtered"]');
  return {
    glyph: !!n.querySelector("svg use"),
    silent: !!document.querySelector(".bd-silent[data-empty]:not([hidden])") && !document.getElementById("bdEmpty").hidden,
    statusKind: document.getElementById("flowsStatus").getAttribute("data-empty"),
  };
});
eq(filteredMsg.glyph, false, "the filtered row carries no glyph — it is not one of the four silences");
eq(filteredMsg.silent, false, "and no silence stand-in replaces the board");
eq(filteredMsg.statusKind, null, "and the status line above it carries no silence either");

await put("board:long", {
  ...board("long", true), dispersion: 0.7076, horizonSessions: 10,
  rows: TICKERS.map((t, i) => ({ ...boardRow(t, i, true), hm: i === 0 ? null : 0.0931, hr: 0.0368 })),
});
await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);
const foot = await page.evaluate(() => {
  const rowOf = (t) => [...document.querySelectorAll("#flowsBody .bd-row")]
    .find((r) => r.querySelector(".bd-open").textContent === t);
  const unpriced = rowOf("NVDA").querySelector('[data-col="hm"] .bd-move');
  const priced = rowOf("NVAX").querySelector('[data-col="hm"] .bd-move');
  const g = rowOf("NVAX").querySelector('[data-col="g"] .bd-g');
  const down = document.querySelector('.bd-chg[data-tone="down"], .bd-n[data-tone="down"]');
  return {
    unpriced: {
      text: unpriced.textContent,
      empty: unpriced.getAttribute("data-empty"),
      title: unpriced.getAttribute("title") || "",
      aria: rowOf("NVDA").querySelector(".bd-open").getAttribute("aria-label") || "",
    },
    priced: { text: priced.textContent, title: priced.getAttribute("title") || "" },
    tones: [...document.querySelectorAll('[data-col="g"] .bd-g')].map((n) => n.dataset.tone),
    shortRegimes: document.querySelectorAll('[data-col="g"] .bd-g[data-regime="short"]').length,
    regime: { aria: g.getAttribute("aria-label"), color: getComputedStyle(g).color },
    downColor: down ? getComputedStyle(down).color : null,
    status: document.getElementById("flowsStatus").textContent,
    statusKind: document.getElementById("flowsStatus").getAttribute("data-empty"),
  };
});
eq(foot.unpriced.text, "±—",
   "a row with hm null prints “±—” in the priced-move slot, never “” — an unmeasured move and a " +
   "missing field must not render the same way");
eq(foot.unpriced.empty, "unavailable",
   "and the span is tagged unavailable: the board is published, and this field is not on this row");
ok(/no usable 30-day implied volatility/.test(foot.unpriced.title),
   `the title says why the slot is empty rather than leaving a dash to be guessed at (${foot.unpriced.title})`);
ok(/Priced move unavailable\./.test(foot.unpriced.aria),
   "and the row's accessible name says the same, where before a screen reader heard nothing in that position");
eq(foot.priced.text, "±9.3%", "while a measured move prints as the move");
ok(/over 10 trading sessions/.test(foot.priced.title), "with its horizon in the title");
ok(foot.tones.every((t) => t === "long" || t === "short"),
   `every gamma cell carries the dealer tones long or short and never up or down (${foot.tones.join(",")}): a short ` +
   "gamma regime is a hedging state, not a bearish lean — 36 of 44 tiles on an emitted BULLISH board once ended " +
   "in red “short Γ”");
ok(foot.downColor !== null && foot.regime.color !== foot.downColor,
   `and the short regime is not painted the bearish red (${foot.regime.color} vs ${foot.downColor})`);
eq(foot.shortRegimes, 4, "the regime is still drawn on every short-regime row (4 of 8 here)");
ok(/short gamma/.test(foot.regime.aria), `and named in words for assistive tech (${foot.regime.aria})`);
ok(/spread 0\.71 composite units \(95th pct of \|residual\|, not the score's scale\)/.test(foot.status),
   "the dispersion travels with its unit and its statistic: 0.71 is the 95th percentile of " +
   "|residual| in composite units, printed beside scores like +59 that are 100·tanh of a scaled " +
   `residual (${foot.status})`);
ok(/1 new to this side since the previously published board/.test(foot.status),
   "the warm board's memory clause is unchanged: one name new, against the row count this same line opens with");
eq(foot.statusKind, null, "a board with rows carries no silence mark on its status line");

{
  const strip = await page.evaluate(() => [...document.querySelectorAll('#flowsBody [data-col="strip"]')]
    .map((c) => ({ text: c.textContent.trim(), svg: !!c.querySelector("svg") })));
  ok(strip.every((c) => c.text === "—" && !c.svg),
     "with no score trace published, every five-session cell is an em dash and no strip is drawn — a strip of " +
     "zero-height bars would read as five flat sessions");
  const head = await page.evaluate(() => {
    const cell = (k) => document.querySelector(`#bdHead [data-col="${k}"]`);
    return {
      vrp: cell("vrpP").querySelector(".ui-state") ? cell("vrpP").querySelector(".ui-state").dataset.state : null,
      si: cell("siP").querySelector(".ui-state") ? cell("siP").querySelector(".ui-state").dataset.state : null,
      vrpCells: [...document.querySelectorAll('#flowsBody [data-col="vrpP"]')].map((c) => c.textContent.trim()),
    };
  });
  eq(head.vrp, "pending",
     "the cross-section columns carry ONE pending glyph in their header while the universe key is not published, " +
     "rather than a glyph in every cell");
  eq(head.si, "pending", "on both of them");
  ok(head.vrpCells.every((t) => t === "—"), "and their cells are em dashes, never zeros");
}

{
  await put("scoretrack", { v: 2, status: "ok", sessionDate: "2026-09-03",
    names: [{ t: "NVDA", s: [5, 20, null, 80, -40, 0] }, { t: "NVAX", s: [10, null, null, null, null, null] }] });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('#flowsBody [data-col="strip"] svg');
  const bars = await page.evaluate(() => {
    const cell = (t) => [...document.querySelectorAll("#flowsBody .bd-row")].find((r) => r.querySelector(".bd-open").textContent === t)
      .querySelector('[data-col="strip"]');
    const marks = [...cell("NVDA").querySelectorAll("svg rect, svg circle")].map((m) => ({
      tag: m.tagName, cls: m.getAttribute("class") || "", h: Number(m.getAttribute("height") || 0), y: Number(m.getAttribute("y") || m.getAttribute("cy")),
    }));
    return { marks, mid: Number(cell("NVDA").querySelector("line").getAttribute("y1")), label: cell("NVDA").querySelector("[role=img]").getAttribute("aria-label"),
      nvax: cell("NVAX").textContent.trim(), nvaxSvg: !!cell("NVAX").querySelector("svg") };
  });
  const [a, gap, b, c, z] = bars.marks;
  ok(a.tag === "rect" && /up/.test(a.cls) && b.tag === "rect" && /up/.test(b.cls), "two positive sessions are bars above the line");
  ok(Math.abs(b.h / a.h - 4) < 0.05,
     `and their heights keep the scores' own ratio, 80 to 20 is four to one (${(b.h / a.h).toFixed(2)}): a square-root ` +
     "scale would draw it two to one and make a strong session look like a mild one");
  eq(gap.tag, "circle", "a session the name was not scored is a dot on the line, never a zero-height bar");
  ok(/down/.test(c.cls) && c.y >= bars.mid - 0.01, "a negative session hangs below the line");
  ok(/zero/.test(z.cls) && !/up|down/.test(z.cls) && /last/.test(z.cls),
     "and a measured zero is its own neutral mark, neither side's colour — zero belongs to neither side");
  ok(/\+20, not scored, \+80, \u221240, 0/.test(bars.label), `the strip reads the five sessions in words (${bars.label})`);
  ok(bars.nvax === "—" && !bars.nvaxSvg,
     "a name whose last five sessions were all unscored gets an em dash, not a strip of five dots");
  await put("scoretrack", { v: 2, status: "pending", names: [] });
}

{
  await put("board:long", { ...board("long", true), rows: TICKERS.map((t, i) => ({ ...boardRow(t, i, true), hy: i < 3, edte: 3, t: i === 2 ? "GOOGL" : t })) });
  const readFlags = () => page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-nm-1")].flatMap((line) => {
    const box = line.getBoundingClientRect();
    return [...line.querySelectorAll(".bd-flag")].map((f) => {
      const r = f.getBoundingClientRect();
      const inside = r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
      const outside = r.top >= box.bottom - 0.5 || r.left >= box.right - 0.5;
      return { kind: f.dataset.kind, inside, outside };
    });
  }));
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(ROWS);
    const flags = await readFlags();
    ok(flags.length > 0 && flags.every((f) => f.inside || f.outside),
       `at ${width}px every flag beside a ticker is either whole or wrapped out of sight — never cut mid-word (` +
       flags.filter((f) => !f.inside && !f.outside).map((f) => f.kind).join(",") + ")");
    if (width === 390) ok(flags.some((f) => f.kind === "hold" && f.inside), "and the hold mark still fits on a phone, as its glyph");
  }
  await put("board:long", board("long", true));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(ROWS);
}

await put("board:short", board("short", false));
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector(ROWS);
const cold = await page.evaluate(() => {
  const chip = document.getElementById("bdMem");
  return {
    status: document.getElementById("flowsStatus").textContent,
    memory: chip ? chip.getAttribute("data-memory") : null,
    value: chip ? chip.querySelector(".ui-chip-v").textContent : null,
  };
});
const coldSaid = await readInfo("#bdMem");
eq(cold.memory, "pre-memory",
   "the cold board marks its New figure with the memory state — the one statement of the missing comparison");
eq(cold.value, "—", "and the figure is an em dash, not a zero: no comparison happened");
ok(/published before the board kept a memory/.test(coldSaid), `with the reason one tap away (${coldSaid.slice(0, 120)})`);
ok(!/no comparison/i.test(cold.status),
   `and the status line does not restate it in a second wording (${cold.status})`);

await put("board:short", { ...board("short", false), rows: [], deadBand: 1, scored: 100, neutral: 3 });
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector('.bd-silent[data-empty="quiet"]');
const quietSaid = await readInfo('.bd-silent[data-empty="quiet"] [data-info]');
ok(/cleared the ±1 band this session\. 100 names were scored, 3 of them inside the band; the other side may hold the rest\./.test(quietSaid),
   `the quiet sentence states the band, the scored population and the neutral count, each from its own field (${quietSaid})`);
ok(!/quiet session looks like/.test(quietSaid),
   "and characterises the session as nothing — 3 of 100 inside the band is not a quiet session");

await put("board:short", { ...board("short", false), rows: [], scored: 100 });
await page.goto(url("/flows/short/"), { waitUntil: "networkidle" });
await page.waitForSelector('.bd-silent[data-empty="quiet"]');
const quietBare = await readInfo('.bd-silent[data-empty="quiet"] [data-info]');
ok(/cleared the dead band this session\. 100 names were scored; the other side may hold the rest\./.test(quietBare),
   `with no band width and no neutral count published, the sentence names neither (${quietBare})`);
ok(!/all of them|inside the band|±/.test(quietBare),
   "and never fills the neutral count with “all” — an absent field is a silence, not a census");

{
  await put("board:long", board("long", true));
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForSelector(ROWS);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#flowsBody .bd-row[data-flip]")].map((r) => {
    const open = r.querySelector(".bd-open");
    return {
      t: open.textContent, tag: open.tagName, href: open.getAttribute("href"),
      pop: open.getAttribute("aria-haspopup"), dataT: open.dataset.t || null, anchors: r.querySelectorAll("a").length,
    };
  }));
  ok(rows.length > 0, `the list rendered rows (${rows.length})`);
  for (const o of rows) {
    eq(o.tag, "A", `row ${o.t}: its name is an anchor, not a button that opened a modal`);
    eq(o.href, "/flows/ticker/?t=" + o.t + "&s=signal&from=long",
       `row ${o.t}: links to its own reader, carrying the side (${o.href})`);
    eq(o.pop, null, `row ${o.t}: announces no dialog, because there is none`);
    eq(o.dataT, null, `row ${o.t}: carries no data-t for a delegation to find`);
    eq(o.anchors, 1,
       `row ${o.t}: the row offers ONE link and not two — the whole row is that link's target, so nothing ` +
       "else in it needs to be one");
  }
  const hit = await page.evaluate(() => {
    const r = document.querySelector("#flowsBody .bd-row[data-flip]");
    const b = r.getBoundingClientRect();
    const at = document.elementFromPoint(b.left + b.width * 0.55, b.top + b.height / 2);
    return at && at.closest("a") ? at.closest("a").getAttribute("href") : null;
  });
  ok(hit && /t=NVDA/.test(hit), `a tap anywhere across the row lands on its reader link (${hit})`);
}

{
  await page.goto(url("/flows/long/?view=map"), { waitUntil: "networkidle" });
  await page.waitForSelector(".bd-map-plot svg .tile");
  const map = await page.evaluate(() => ({
    tiles: document.querySelectorAll(".bd-map-plot svg .tile").length,
    tableHidden: document.getElementById("bdTable").hidden,
    selected: [...document.querySelectorAll("#bdMod .ui-seg-i")].map((b) => b.getAttribute("aria-selected")),
    sectors: [...document.querySelectorAll(".bd-map-plot svg .sec")].map((t) => t.textContent),
    viewBox: document.querySelector(".bd-map-plot svg").getAttribute("viewBox"),
    width: Math.round(document.querySelector(".bd-map-plot svg").getBoundingClientRect().width),
    par: document.querySelector(".bd-map-plot svg").getAttribute("preserveAspectRatio"),
  }));
  eq(map.tiles, 8, "?view=map draws one tile per published name");
  eq(map.tableHidden, true, "and hides the list rather than stacking both");
  assert.deepEqual(map.selected, ["false", "true"], "with Map selected in the segmented control"); checks++;
  ok(map.sectors.includes("Technology"), `tiles are grouped under sector headers (${map.sectors.join(", ")})`);
  eq(Number(map.viewBox.split(" ")[2]), map.width,
     "the map's viewBox is its own pixel width, so a tile's area means the same thing at every size");
  eq(map.par, null, "and it never stretches with preserveAspectRatio");
  eq(new Set(map.sectors).size, map.sectors.length,
     `no two sector headers read the same (${map.sectors.join(", ")}): a header shortened to its first word turned ` +
     "Consumer Cyclical and Consumer Defensive into two headers both reading Consumer");
  const tips = (await page.$$eval(".bd-map-plot svg .against", (ps) => ps.map((p) => p.getAttribute("d").match(/-?[\d.]+/g).map(Number))))
    .map((n) => Math.sign(n[5] - n[1]));
  ok(tips.length === 4 && tips.every((d) => d === 1),
     `on the bullish map the four names with premium against the board carry a triangle pointing DOWN, the way that premium leans (${tips})`);

  await page.focus(".bd-map-plot");
  await page.keyboard.press("Home");
  const ro = await page.evaluate(() => ({
    on: document.querySelector(".bd-map-plot .bd-readout").classList.contains("is-on"),
    text: document.querySelector(".bd-map-plot .bd-readout").textContent,
    live: (document.getElementById("fxLive") || {}).textContent || "",
  }));
  ok(ro.on && /NVDA/.test(ro.text), `Home on the focused map reads the rank-one name (${ro.text})`);
  ok(/NVDA/.test(ro.live), "and announces it to assistive tech");
  await page.keyboard.press("ArrowRight");
  ok(/NVAX/.test(await page.$eval(".bd-map-plot .bd-readout", (n) => n.textContent)),
     "ArrowRight walks the tiles in rank order, not in layout order");
  await Promise.all([page.waitForURL(/\/flows\/ticker\/\?t=NVAX/), page.keyboard.press("Enter")]);
  ok(true, "Enter opens that name's reader");

  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForSelector(ROWS);
  await page.click('#bdMod .ui-seg-i:nth-of-type(2)');
  await page.waitForSelector(".bd-map-plot svg .tile");
  ok(/view=map/.test(page.url()), "picking Map writes ?view=map, so the view survives a reload and a shared link");
  await page.fill("#fbQ", "NV");
  await page.waitForFunction(() => document.querySelectorAll(".bd-map-plot svg .tile").length === 2);
  ok(true, "the filter narrows the map exactly as it narrows the list");

  await put("board:short", board("short", false));
  await page.goto(url("/flows/short/?view=map"), { waitUntil: "networkidle" });
  await page.waitForSelector(".bd-map-plot svg .tile");
  const bearTips = (await page.$$eval(".bd-map-plot svg .against", (ps) => ps.map((p) => p.getAttribute("d").match(/-?[\d.]+/g).map(Number))))
    .map((n) => Math.sign(n[5] - n[1]));
  ok(bearTips.length === 4 && bearTips.every((d) => d === -1),
     `and on the bearish map the names carrying BOUGHT premium against it point UP (${bearTips}); one downward mark on ` +
     "both boards read as selling on the board where it meant buying");
}

{
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForSelector(ROWS);
  const sides = await page.evaluate(() => {
    const vw = window.innerWidth;
    const all = [...document.querySelectorAll("#flowsBody [data-info], .flows-main [data-info], main [data-info]")]
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top > 0 && r.bottom < window.innerHeight; });
    const mid = (b) => { const r = b.getBoundingClientRect(); return r.left + r.width / 2; };
    const left = all.filter((b) => mid(b) < vw / 2).sort((a, b) => mid(a) - mid(b))[0];
    const right = all.filter((b) => mid(b) >= vw / 2).sort((a, b) => mid(b) - mid(a))[0];
    if (left) left.dataset.probe = "left";
    if (right) right.dataset.probe = "right";
    return { left: Boolean(left), right: Boolean(right) };
  });
  ok(sides.left && sides.right, "the board has an info button in each half of the page to open");
  for (const side of ["left", "right"]) {
    await page.click(`[data-probe="${side}"]`);
    await page.waitForSelector("#fxPop:popover-open");
    await page.waitForTimeout(250);
    const g = await page.evaluate((sel) => {
      const t = document.querySelector(sel).getBoundingClientRect(), p = document.getElementById("fxPop").getBoundingClientRect();
      return { tl: t.left, tr: t.right, pl: p.left, pr: p.right, vw: window.innerWidth };
    }, `[data-probe="${side}"]`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#fxPop:popover-open"));
    if (side === "left") {
      ok(g.pl >= g.tl - 2 && g.pr <= g.vw,
         `a disclosure opened from the left half grows rightward from its button (button ${Math.round(g.tl)}px, ` +
         `popover ${Math.round(g.pl)}-${Math.round(g.pr)}px), not back over the sidebar`);
    } else {
      ok(g.pr <= g.tr + 2 && g.pl >= 0,
         `and one opened from the right half grows leftward and stays on screen (button ends ${Math.round(g.tr)}px, ` +
         `popover ${Math.round(g.pl)}-${Math.round(g.pr)}px)`);
    }
  }
}

{
  await put("board:long", board("long", true));
  const lead = (session) => ({ v: 1, status: "ok", sessionDate: session, n: 2, rows: [
    { t: "NVDA", id: "call-debit-spread", structure: "call debit spread", dir: "bull", grade: 3 },
    { t: "AMD", id: "iron-condor", structure: "iron condor", dir: "neutral", grade: 2 },
  ] });
  const ideaRead = () => page.evaluate(() => ({
    shown: document.getElementById("bdTable").dataset.idea,
    marks: [...document.querySelectorAll("#flowsBody .bd-row")].map((r) => {
      const g = r.querySelector(".bd-idea");
      return g ? (r.querySelector('[data-col="t"]') || r).textContent.replace(/\s+/g, " ").trim() + " :: " + g.getAttribute("aria-label") : null;
    }).filter(Boolean),
  }));

  await put("ideas", lead("2026-09-02"));
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForSelector(ROWS);
  const stale = await ideaRead();
  eq(stale.shown, "0",
     "ideas stamped with another session are not joined: yesterday's lead structure on today's board would sit " +
     "beside a score it was never computed from");

  await put("ideas", lead("2026-09-03"));
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForSelector(ROWS);
  const same = await ideaRead();
  eq(same.shown, "1", "the idea column appears once the engine's ideas carry the board's own session");
  eq(same.marks.length, 2, `on exactly the two names the engine led with a structure (${same.marks.join(" | ")})`);
  ok(same.marks.some((m) => /NVDA.* :: .*call debit spread/i.test(m)) && same.marks.some((m) => /AMD.* :: .*iron condor/i.test(m)),
     "each drawn as its own structure's payoff glyph, named for a screen reader");
  await put("ideas", { v: 1, status: "quiet", sessionDate: "2026-09-03", n: 0, rows: [] });
}

{
  const uni = (si) => ({ v: 1, status: "ok", sessionDate: "2026-09-03", t: TICKERS,
    cols: { vrp: TICKERS.map((_, i) => 1000 + i) }, units: { vrp: ["vol", 1000] },
    pct: { vrp: TICKERS.map((_, i) => 10 + i * 10), si } });
  const read = () => page.evaluate(() => {
    const shown = (n) => !!n && getComputedStyle(n).display !== "none";
    const right = (n) => n.offsetLeft + n.offsetWidth;
    const row = document.querySelector("#flowsBody .bd-row[data-flip]");
    const head = document.querySelector("#bdHead");
    return {
      si: document.getElementById("bdTable").dataset.si,
      siHead: shown(head.querySelector('[data-col="siP"]')),
      siCells: [...document.querySelectorAll('#flowsBody [data-col="siP"]')].filter(shown).length,
      vrpHead: shown(head.querySelector('[data-col="vrpP"]')),
      tracks: getComputedStyle(row).gridTemplateColumns.split(" ").length,
      visible: [...row.children].filter(shown).length,
      headVisible: [...head.children].filter(shown).length,
      vrpOff: Math.abs(right(head.querySelector('[data-col="vrpP"]')) - right(row.querySelector('[data-col="vrpP"]'))),
    };
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await put("universe", uni(TICKERS.map(() => null)));
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("bdTable").dataset.si === "0");
  const bare = await read();
  ok(!bare.siHead && bare.siCells === 0 && bare.vrpHead,
     "A CROSS-SECTION COLUMN NO ROW CAN FILL IS NOT DRAWN: with the universe published and short interest covering " +
     "none of this board's names, SI leaves the table rather than printing a column of em dashes, and VRP stays");
  ok(bare.tracks === bare.visible && bare.headVisible === bare.visible && bare.vrpOff <= 1.5,
     `and the grid drops its track with it (${bare.tracks} tracks, ${bare.visible} cells, ${bare.headVisible} headings), ` +
     `so every heading still sits on its own figures (VRP ${bare.vrpOff.toFixed(1)}px apart, measured in layout so a ` +
     "row still gliding into its new place is not read as a misaligned column)");

  await put("universe", uni(TICKERS.map((_, i) => (i === 3 ? 42 : null))));
  await page.goto(url("/flows/long/"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.getElementById("bdTable").dataset.si === "1");
  const one = await read();
  ok(one.siHead && one.siCells === TICKERS.length && one.tracks === one.visible,
     "one name with a reading brings the column back, whole, on every row");
  await page.setViewportSize({ width: 1280, height: 1000 });
}

eq(errors.length, 0,
   "no page error and no console error across both board routes: " + errors.join(" | "));

await browser.close();
await server.stop();

console.log(`✓ flows-board-render: ${checks} assertions — the control row exists at all, the ` +
  `library it depends on is named before its symptoms, a denominator that stays silent until ` +
  `it has something to say, a measured zero match distinguished from an empty board with a Clear ` +
  `beside it, orders withheld exactly when the payload cannot produce them, headers that sort and ` +
  `say so and sit on the edge of the figures they name, a gamma regime told apart without hue, a stale ` +
  `glyph that names its session, a five-session strip drawn to a linear scale with gaps as dots and zero ` +
  `as neither side, flags that are whole or out of sight on a phone, a rail badge that is silent on a pending board, prints its measured zero on a quiet one ` +
  `and its whole POOL on a board the length cap truncated — the same number the sentence and the ` +
  `summary track reconcile against — no overflow at 320px, four silences that are four glyphs in ` +
  `greyscale with their sentences one tap away and the Worker's failed read told apart from a ` +
  `never-published side, a priced move that prints its absence, a gamma regime no hue calls ` +
  `bearish, a dispersion that carries its unit, one statement of a cold memory, a quiet sentence ` +
  `that counts and passes no verdict, every row one anchor to that name's reader across its whole ` +
  `width, and a map that tiles every name at its own pixel size, never prints two sector headers alike, ` +
  `points each against-the-board triangle the way its premium leans, reads by keyboard in rank order ` +
  `and follows the filter`);
