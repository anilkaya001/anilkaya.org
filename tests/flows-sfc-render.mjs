import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { flowsPageRows, FLOWS_PAGE_SLUGS } from "../server/routes/flows-pages.js";
import { ledgerView, parseScope } from "../shared/flows-sfc-view.js";
import * as COPY from "../shared/flows-sfc-copy.js";
import { moneyShort } from "../shared/flows-sfc-display.js";
import { lintText, htmlToText, stringLeaves, tooLong } from "./lib/copy-lint.mjs";
import { loadVariant } from "./lib/sfc-variant.mjs";
import { storedInput, NOW_INTRADAY } from "./lib/sfc-stored.mjs";
import { mount, HTML, JS, CSS, ROOT, realisticWorld, determinedWorld, inputFor, respondWith } from "./lib/sfc-render-world.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MINUS = "−", DASH = "—";
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const SIZES = [[1920, 1080], [1920, 940], [1440, 820], [1024, 768], [390, 844], [390, 664]];
const STATIC_DIALOG = /<dialog[\s\S]*?<\/dialog>/g;

{
  eq((HTML.match(/<h1[ >]/g) || []).length, 1, "one h1");
  ok(/<title>Flows — Premium ledger<\/title>/.test(HTML), "the title says Premium ledger");
  ok(/<h1 id="fxTitle">Premium ledger<\/h1>/.test(HTML) && /data-fx-hero/.test(HTML), "the heading and its hero hook");
  ok(/data-flows-page="ledger"/.test(HTML), "the page owns the one-screen shell hook");
  const nav = /<aside class="fx-side"[\s\S]*?<\/aside>/.exec(HTML)[0];
  ok(/href="\/flows\/ledger\/"[^>]*aria-current="page"/.test(nav) && nav.includes(">Ledger<"), "the rail names Ledger on its own page");
  ok(/href="\/flows\/ledger\/"/.test(PAGES.marketPage({ username: "test" })) && /href="\/flows\/ledger\/"/.test(PAGES.movesPage({ username: "test" })), "and every other page links it");
  ok(/\/assets\/js\/flows-sfc\.js\?v=\d+/.test(HTML) && /\/assets\/css\/flows-sfc\.css\?v=\d+/.test(HTML), "the controller and the sheet are versioned");
  ok(!/flows-chart\.js|flows-feeds\.css|flows-rt\.js/.test(HTML), "no chart library, feeds sheet or rail");
  for (const id of ["sf", "sfStatus", "sfStamp", "sfPeriod", "sfCrumbs", "sfScope", "sfChecks", "sfCheckLine", "sfNote", "sfTabs", "sfStage", "sfLedger", "sfSide", "sfRead", "sfMatrix", "sfGroups", "sfCellLine", "sfBody", "sfView", "sfReadBox", "sfInfoDlg", "sfInfoBtn", "sfInfoX"]) ok(new RegExp('id="' + id + '"').test(HTML), "the page carries #" + id);
  const text = htmlToText(HTML.replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<header[\s\S]*?<\/header>/, ""));
  eq(lintText(text).map((h) => `${h.rule} ${JSON.stringify(h.match)} :: ${h.sentence.slice(0, 80)}`), [], "the served page text passes every copy rule: no unsided, no tape, no sector transfer, nothing leaving, no forecast word, sentences of at most fourteen words");
  const dialog = (HTML.match(STATIC_DIALOG) || []).join(" ");
  for (const line of COPY.INFO) ok(dialog.includes(line.replace(/'/g, "&#39;")), "the info dialog carries: " + line.slice(0, 50));
  for (const line of COPY.NOT_BUILT) ok(dialog.includes(line), "and the not-built line: " + line.slice(0, 40));
  ok(dialog.includes(COPY.BALANCING_DEFINITION), "and the definition of the balancing entry");
  ok(HTML.includes(COPY.KEY_LINE) && HTML.includes(COPY.ZERO_LINE), "the key and the zero line are in the served HTML");
  ok(!COLOUR_LITERAL.test(CSS), "the sheet holds no colour literal: tokens only");
  ok(!COLOUR_LITERAL.test(JS.replace(/&#39;/g, "")), "and neither does the script");
  ok(COLOUR_LITERAL.test(CSS + "\n.x { color: #fff; }") && COLOUR_LITERAL.test(CSS + "\n.x { background: rgb(1, 2, 3); }"), "and the scan catches a planted literal");
  ok(!/(^|[^-\w])transition\b/.test(CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "")), "every transition sits inside no-preference");
  ok(!/\bglobalThis\.|(?<![\w.])window\.[A-Za-z]+\s*=(?!=)/.test(JS.replace(/globalThis\.__LedgerTest/, "")), "no new global");
  ok(!/\/\*|(^|[^:"'`])\/\/\s/.test(CSS + JS), "no comment in the sheet or the script");
  ok(!/overflow(-y)?:\s*(auto|scroll)/.test(CSS.replace(/\n\.sf-dlg \{[^}]*\}/, "")), "the sheet scrolls nothing but the info dialog, which can be taller than a phone");
  ok(!/\btape\b/i.test(JS + CSS), "the word tape is nowhere in the controller or the sheet");
  const literals = [...JS.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3])
    .filter((x) => x.split(/\s+/).filter((w) => /^[A-Za-z]{2,}/.test(w)).length >= 2 && !/[<>=;{}[\]#]/.test(x.replace(/\$\{[^}]*\}/g, "")));
  const jsHits = literals.flatMap((s) => lintText(s.replace(/\$\{[^}]*\}/g, "x")).map((h) => `${h.rule} ${JSON.stringify(h.match)} :: ${s.slice(0, 70)}`));
  eq(jsHits, [], "the controller's own sentences pass the copy rules");
  ok(literals.length >= 12, "and there are enough of them for that to mean something: " + literals.length);
}

{
  ok(FLOWS_PAGE_SLUGS.includes("ledger"), "the route table lists the page");
  const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => false });
  const row = rows.find((r) => r.id === "flows.pages.ledger");
  const res = await row.handler({ request: new Request("https://x.test/flows/ledger/"), env: {}, url: new URL("https://x.test/flows/ledger/") });
  eq(res.status, 200, "a member is served the page, with no switch in front of it");
  ok((await res.text()).includes('data-flows-page="ledger"'), "and it is the ledger");
  const bare = rows.find((r) => r.id === "flows.pages.ledger.bare");
  eq(bare.path, "/flows/ledger", "the bare path has a redirect row");
  const anon = flowsPageRows({ currentFlowsUser: async () => null, readFlowsSummary: async () => null, isOwner: () => false }).find((r) => r.id === "flows.pages.ledger");
  ok((await (await anon.handler({ request: new Request("https://x.test/flows/ledger/"), env: {}, url: new URL("https://x.test/flows/ledger/") })).text()).includes("login"), "an anonymous visitor is answered with the sign-in page");
}

const T = (() => {
  const sandbox = { globalThis: null, URLSearchParams };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(JS, sandbox);
  const raw = sandbox.__LedgerTest;
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "function" ? (...a) => plain(v(...a)) : v]));
})();

{
  ok(T && typeof T.tiltBar === "function", "the page exposes its pure functions only where there is no document");
  const u = (v, S) => (100 * v) / S;
  const over = T.tiltBar(500, 100, 1000, "above");
  eq([over.lo, over.hi, over.mid, over.fill], [u(400, 1000), u(600, 1000), u(500, 1000), { x: 0, width: u(400, 1000) }], "above: the fill runs from the axis to R minus the band, the proven part");
  const under = T.tiltBar(-500, 100, 1000, "below");
  eq([under.fill.x, under.fill.width], [u(-400, 1000), -u(-400, 1000)], "below: from R plus the band to the axis");
  eq(T.tiltBar(50, 200, 1000, "undetermined").fill, null, "within the band: no fill at all");
  eq(T.tiltBar(0, 0, 1000, "at").fill, null, "at share: no fill");
  eq(T.tiltBar(5000, 5000, 1000, "above").hi, 100, "a figure past the scale is held at the edge, never drawn outside");
  eq(T.tiltBar(-5000, 0, 1000, "below").lo, -100, "on the other side too");
  eq(T.nameBar(250, 1000), { x: 0, width: 25, mid: 25 }, "a name's bar is its figure on the same kind of scale");
  eq(T.nameBar(-250, 1000), { x: -25, width: 25, mid: -25 }, "and negative to the left");
  const w = T.arrowWidths([100, 50, 0, 25], 100);
  eq(w, [T.ARROW_MAX, T.ARROW_MAX / 2, 0, T.ARROW_MAX / 4], "arrow widths are one linear scale; a zero amount has no arrow");
  eq(T.arrowWidths([1, 100], 100)[0], T.ARROW_MIN, "a tiny amount keeps a visible arrow");
  eq(T.arrowWidths([5], 0), [0], "no maximum, no arrows");
  const groups = COPY.GROUPS.map((g) => ({ id: g.id, cols: [...g.cols] }));
  eq([T.groupColumns(groups, "held"), T.groupColumns(groups, "noside"), T.groupColumns(groups, "outside"), T.groupColumns(groups, "zzz")], [[0, 1], [2, 3], [4, 5], [0, 1, 2, 3, 4, 5]], "column groups, and all six for an unknown one");
  const mk = (blanks, always = false) => ({ always, cells: Array.from({ length: 6 }, (_, c) => ({ s: blanks.includes(c) ? "blank" : "ok" })) });
  const rows = [mk([2, 3, 4, 5]), mk([0, 1, 4, 5]), mk([0, 1, 2, 3]), mk([], true)];
  eq(T.rowsFor(rows, [0, 1]).length, 2, "the held group shows its rows and the always rows");
  eq(T.rowsFor(rows, [4, 5]).length, 2, "the outside group shows its rows and the always rows");
  const grid = [[true, true, false, false], [false, true, true, false], [true, false, false, true]];
  eq(T.nextCell(grid, 0, 1, "ArrowRight"), null, "right of the last non-blank cell of a row there is nothing, the blanks are skipped and the edge stops it");
  eq(T.nextCell(grid, 0, 0, "ArrowRight"), [0, 1], "right");
  eq(T.nextCell(grid, 0, 1, "ArrowDown"), [1, 1], "down");
  eq(T.nextCell(grid, 1, 1, "ArrowDown"), null, "down into a blank is no move");
  eq(T.nextCell(grid, 1, 2, "ArrowLeft"), [1, 1], "left");
  eq(T.nextCell(grid, 2, 0, "End"), [2, 3], "End goes to the last non-blank cell of the row");
  eq(T.nextCell(grid, 2, 3, "Home"), [2, 0], "Home to the first");
  eq(T.nextCell(grid, 0, 0, "x"), null, "any other key is no move");
  eq(T.nextCell([], 0, 0, "ArrowUp"), null, "an empty grid is no move");
  eq(T.parseHash("#scope=sector%3AEnergy&period=session&w=flow"), { scope: "sector:Energy", period: "session", w: "flow" }, "the address is read");
  eq(T.parseHash(""), { scope: "all", period: null, w: "table" }, "no address is the default view");
  eq(T.parseHash("#period=never&w=sideways"), { scope: "all", period: null, w: "table" }, "an unknown period or view is the default");
  eq(T.hashOf("sector:Index & ETF", "five", "flow"), "#scope=sector%3AIndex+%26+ETF&period=five&w=flow", "the address is written and encoded");
  eq(T.hashOf("all", null, "table"), "", "the default view has no address");
  eq(T.parseHash(T.hashOf("name:BRK.B", "intraday", "flow")), { scope: "name:BRK.B", period: "intraday", w: "flow" }, "and it round-trips");
}

const audit = (page) => page.evaluate(() => {
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  const se = document.scrollingElement;
  if (se.scrollHeight > innerHeight) out.push("page scrolls vertically " + se.scrollHeight + " over " + innerHeight);
  if (se.scrollWidth > innerWidth) out.push("page scrolls sideways " + se.scrollWidth + " over " + innerWidth);
  for (const scroller of [document.querySelector(".flows-main"), document.querySelector(".flows-shell, .flows-body")]) {
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1 && getComputedStyle(scroller).overflowY !== "visible") out.push("a container scrolls: " + scroller.className + " " + scroller.scrollHeight + " over " + scroller.clientHeight);
  }
  for (const panel of document.querySelectorAll(".sf-panel")) {
    if (!vis(panel)) continue;
    const pr = panel.getBoundingClientRect();
    for (const el of panel.querySelectorAll("*")) {
      if (!vis(el) || (el.closest("svg") && el.tagName !== "svg")) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) out.push("outside " + panel.id + ": " + el.tagName + "." + el.className + " by " + Math.round(r.bottom - pr.bottom) + "," + Math.round(r.right - pr.right));
      if (el.matches("th[scope=row], td.c, td.n, td.tl .tv, .sf-chk, .sf-seg button, .sf-crumbs button, .sf-tabs button, .sf-drill, .fl-lab") && el.scrollWidth > el.clientWidth + 1) out.push("text cut: " + el.textContent.trim().slice(0, 30));
    }
  }
  return out;
});

const tableCells = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel + " tbody tr, " + sel + " tfoot tr")].map((tr) => ({
  cls: tr.className, cells: [...tr.children].map((c) => ({ t: c.textContent.trim(), s: c.dataset.s || null, x: c.dataset.x || c.title || null, hidden: getComputedStyle(c).display === "none" })),
})), selector);

const num = (t) => (t === "~0" || t === "0" || t === "" || t === DASH ? 0 : (t.startsWith(MINUS) ? -1 : 1) * Number(t.replace(MINUS, "").replace(/[,+]/g, "").replace(".", "")));

const browser = await launch();
const world = realisticWorld();
const tight = determinedWorld();
const expected = (w, url) => respondWith(w)(new URL("https://x.test" + url));

{
  for (const [w, h] of SIZES) {
    const m = await mount(browser, w, h);
    const problems = await audit(m.page);
    eq(problems, [], `${w}x${h}: the first paint is one screen, nothing clipped, nothing cut`);
    eq(m.errors, [], `${w}x${h}: no page error and no failed request`);
    const view = expected(world, "/api/flows/ledger?scope=all");
    eq(await m.page.textContent("#sfStamp"), view.period.label, `${w}x${h}: the stamp is the period label`);
    eq(await m.page.textContent("#sfScope"), view.scope.line, `${w}x${h}: and the scope line`);
    eq(await m.page.$$eval("#sfChecks .sf-chk", (a) => a.map((x) => [x.dataset.id, x.dataset.state])), view.checks.items.map((i) => [i.id, i.state]), `${w}x${h}: seven check chips with the view's states`);
    ok(/^\d+ pass( · \d+ fail)?( · \d+ not checked)?$/.test(await m.page.textContent("#sfCheckLine")), `${w}x${h}: the one-line summary of the checks`);
    eq(await m.page.$eval("#sfCheckLine", (e) => [e.getAttribute("role"), e.getAttribute("tabindex"), e.hasAttribute("aria-expanded")]), w < 900 ? ["button", "0", true] : [null, null, false], `${w}x${h}: the summary line is a button exactly where it opens the chips`);
    ok(await m.page.$eval("#sfPeriod [data-p=intraday]", (b) => b.getAttribute("aria-pressed") === "true"), `${w}x${h}: Intraday is pressed`);
    eq(await m.page.$$eval("#sfPeriod button", (a) => a.map((b) => b.getAttribute("aria-disabled"))), ["false", "true", "true"], `${w}x${h}: Session and 5 sessions are named unavailable`);
    await m.ctx.close();
  }
}

{
  const m = await mount(browser, 1440, 820);
  const view = expected(world, "/api/flows/ledger?scope=all");
  const rows = await tableCells(m.page, ".sf-lt");
  const L = view.ledger;
  eq(rows.length, 12, "the ledger shows ten entries, net before balancing and the balancing entry");
  eq(rows.map((r) => r.cells[0].t), [...L.rows.slice(0, 10).map((r) => r.label), L.net.label, L.rows[10].label], "row labels in order, net before balancing above the balancing entry");
  const flat = [...L.rows.slice(0, 10), L.net, L.rows[10]];
  rows.forEach((row, i) => row.cells.slice(1).forEach((cell, c) => {
    const want = flat[i].cells[c];
    eq([cell.t, cell.s === "absent" ? "absent" : want.s === "blank" ? null : cell.s], want.s === "blank" ? ["", null] : want.s === "absent" ? [DASH, "absent"] : [want.t, want.s], `ledger r${i + 1} c${c + 1} is the view's text`);
  }));
  const grid = rows.slice(0, 10).concat(rows.slice(11)).map((r) => r.cells.slice(1).map((c) => num(c.t)));
  grid.forEach((r, i) => eq(r.reduce((a, b) => a + b, 0), 0, `the displayed row ${i + 1} adds to zero`));
  for (let c = 0; c < 6; c++) eq(grid.reduce((a, r) => a + r[c], 0), 0, `the displayed column ${c + 1} adds to zero`);
  const net = rows[10].cells.slice(1).map((c) => num(c.t));
  const bal = rows[11].cells.slice(1).map((c) => num(c.t));
  eq(net.map((v, i) => v + bal[i]), [0, 0, 0, 0, 0, 0], "net before balancing and the balancing entry cancel on the page");
  eq(await m.page.$$eval(".sf-lt thead th[colspan]", (a) => a.map((x) => [x.textContent, x.colSpan])), COPY.GROUPS.map((g) => [g.label, 2]), "three column groups above the six columns");
  eq(await m.page.$$eval(".sf-lt thead th[scope=col]", (a) => a.map((x) => x.textContent)), COPY.COLUMN_COPY.map((c) => c.label + c.sub), "the six column heads");
  eq(await m.page.textContent("#sfCap"), L.caption, "the caption states the unit");
  const sect = await tableCells(m.page, ".sf-st");
  eq(sect.length, 14, "thirteen sectors and the total");
  eq(sect.map((r) => r.cells[0].t), [...view.sectors.rows.map((r) => r.label), "Total"], "sector rows in order, then the total");
  const taker = sect.slice(0, 13).map((r) => num(r.cells[1].t));
  const total = num(sect[13].cells[1].t);
  eq(taker.reduce((a, b) => a + b, 0), total, "the displayed taker net adds to its displayed total");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { world: tight });
  const view = expected(tight, "/api/flows/ledger?scope=all");
  const rows = await m.page.$$eval(".sf-st tbody tr", (a) => a.map((tr) => { const td = tr.querySelector("td.tl"); return td ? { key: tr.dataset.k, v: td.dataset.v || null, fill: td.querySelector(".sf-fo") ? td.querySelector(".sf-fo").getAttribute("class") : null, glyph: (td.querySelector(".vd i") || {}).textContent || null, tv: (td.querySelector(".tv") || {}).textContent || null, x: td.title } : null; }));
  const by = new Map(view.sectors.rows.map((r) => [r.key, r]));
  let over = 0, under = 0, within = 0;
  for (const r of rows) {
    if (!r || !by.get(r.key) || by.get(r.key).tilt.s === "absent") continue;
    const want = by.get(r.key).tilt;
    eq(r.v, want.verdict, `${r.key}: the cell carries its verdict`);
    eq(r.glyph, want.glyph, `${r.key}: and its glyph, so colour is never the only cue`);
    eq(r.tv, want.t, `${r.key}: and its figure`);
    eq(r.fill !== null, want.verdict === "above" || want.verdict === "below", `${r.key}: a fill is drawn only where the verdict is proven`);
    if (want.verdict === "above") { over++; ok(/\bup\b/.test(r.fill), `${r.key}: over takes the up token`); }
    if (want.verdict === "below") { under++; ok(/\bdn\b/.test(r.fill), `${r.key}: under takes the down token`); }
    if (want.verdict === "undetermined") within++;
  }
  ok(over >= 3 && under >= 3, `the determined world proves ${over} over and ${under} under`);
  const geom = await m.page.evaluate(() => [...document.querySelectorAll(".sf-st tbody tr")].map((tr) => { const svg = tr.querySelector("svg.sf-bar"); if (!svg) return null; const f = svg.querySelector(".sf-fo"); const b = svg.querySelector(".sf-bd"); const t = svg.querySelector(".sf-tk"); return { key: tr.dataset.k, fill: f ? [Number(f.getAttribute("x")), Number(f.getAttribute("width"))] : null, band: [Number(b.getAttribute("x")), Number(b.getAttribute("width"))], tick: Number(t.getAttribute("x1")) }; }));
  const S = view.sectors.tiltScale.cents;
  const tl = new Map(view.tilt.rows.map((r) => [r.key, r]));
  for (const g of geom) {
    if (!g) continue;
    const r = tl.get(g.key);
    const u = (v) => Math.max(-100, Math.min(100, (100 * v) / S));
    const close = (a, b) => Math.abs(a - b) < 0.01;
    ok(close(g.tick, u(r.r)), `${g.key}: the tick is at R on the shared scale`);
    ok(close(g.band[0], u(r.r - r.w)) && close(g.band[0] + g.band[1], u(r.r + r.w)), `${g.key}: the outlined band runs from R minus W to R plus W`);
    if (r.verdict === "above") ok(close(g.fill[0], 0) && close(g.fill[1], u(r.r - r.w)), `${g.key}: the proven fill runs from the axis to R minus W`);
    if (r.verdict === "below") ok(close(g.fill[0], u(r.r + r.w)) && close(g.fill[0] + g.fill[1], 0), `${g.key}: and from R plus W to the axis`);
  }
  ok(geom.filter(Boolean).length >= 8, "bars were measured for the weighted sectors");
  const head = await m.page.textContent(".sf-st .h-tilt");
  ok(head.includes(view.sectors.tiltScale.text) && head.includes(view.sectors.tiltScale.unit), "the tilt head prints the one shared scale and its unit");
  const colours = await m.page.evaluate(() => { const probe = (cls) => { const el = document.querySelector(".sf-fo." + cls); return el ? getComputedStyle(el).fill : null; }; const css = getComputedStyle(document.documentElement); return { up: probe("up"), dn: probe("dn"), tokUp: css.getPropertyValue("--up-mark").trim(), tokDn: css.getPropertyValue("--down-mark").trim() }; });
  ok(colours.up && colours.dn && colours.up !== colours.dn, "over and under are drawn in two different colours");
  eq(await audit(m.page), [], "the determined world is also one clean screen");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820);
  await m.page.click('#sfPeriod [data-p="session"]', { force: true });
  const before = m.asked.length;
  await m.page.waitForTimeout(100);
  eq(m.asked.length, before, "a period that is not available makes no request");
  ok((await m.page.textContent("#sfNote")).includes("Session of"), "and its reason is shown beside the control");
  await m.page.click("#sfPeriod [data-p=intraday]");
  await m.page.waitForSelector("#sf[data-busy='false']");
  ok(m.asked.some((u) => u.includes("period=intraday")), "an available period is requested");
  await m.page.click('.sf-drill[data-scope="sector:Energy"]');
  await m.page.waitForFunction(() => document.getElementById("sfSideT").textContent === "Names");
  const v = expected(world, "/api/flows/ledger?scope=sector%3AEnergy&period=intraday");
  eq(await m.page.textContent("#sfScope"), v.scope.line, "drilling into a sector shows that sector's scope line");
  eq(await m.page.$$eval("#sfCrumbs > *", (a) => a.map((x) => x.textContent)), ["All sectors", "›", "Energy"], "and a breadcrumb back");
  ok((await m.page.evaluate(() => location.hash)).includes("scope=sector%3AEnergy"), "the address holds the scope");
  eq(await m.page.$$eval("#sfChecks .sf-chk", (a) => a.map((x) => x.dataset.state)), v.checks.items.map((i) => i.state), "the checks are the sector's own");
  eq(await audit(m.page), [], "the sector view is one clean screen");
  const names = await tableCells(m.page, ".sf-nt");
  eq(names.map((r) => r.cells[0].t), [...v.names.rows.map((r) => r.label), "Total"], "the names table lists the sector's names then its total");
  const first = v.names.rows.find((r) => r.ticker && r.windows);
  await m.page.click(`.sf-drill[data-scope="name:${first.ticker}"]`);
  await m.page.waitForFunction(() => document.getElementById("sfSideT").textContent === "Windows");
  const nv = expected(world, "/api/flows/ledger?scope=name%3A" + first.ticker + "&period=intraday");
  eq((await tableCells(m.page, ".sf-wt")).map((r) => r.cells[0].t), nv.windows.rows.map((r) => r.label), "a name's windows are listed by time in TRT");
  ok(nv.windows.rows.every((r) => /^\d\d:\d\d TRT–\d\d:\d\d TRT/.test(r.label) || /^Other \d+ windows$/.test(r.label)), "every time is written in TRT");
  eq(await audit(m.page), [], "and the name view is one clean screen");
  await m.page.click('#sfCrumbs button[data-scope="all"]');
  await m.page.waitForFunction(() => document.getElementById("sfSideT").textContent === "Sectors");
  eq(await m.page.evaluate(() => location.hash), "#period=intraday", "back at all sectors the address holds only the period that was chosen");
  await m.page.click('#sfView [data-w="flow"]');
  await m.page.waitForSelector(".sf-fl");
  const fv = expected(world, "/api/flows/ledger?scope=all");
  eq(await m.page.$$eval(".fl-lane[data-id]", (a) => a.map((x) => x.dataset.id)), ["callsAsk", "putsAsk", "callsBid", "putsBid", "noside", "outside"], "the flow view draws the four held-window arrows, the no-side flow and the outside flow");
  eq(await m.page.textContent(".fl-net"), fv.flow.net.line, "and says who paid net");
  const widths = await m.page.$$eval(".fl-ar", (a) => a.map((x) => Number(x.dataset.w)));
  const cents = [...fv.flow.arrows.map((a) => a.cents), fv.flow.noside.cents, Math.abs(fv.flow.outside.cents)];
  const top = Math.max(...cents);
  widths.forEach((w, i) => ok(Math.abs(w - (cents[i] === 0 ? 0 : Math.max(T.ARROW_MIN, (T.ARROW_MAX * cents[i]) / top))) < 0.01, `arrow ${i + 1} is drawn on one linear scale`));
  eq(await audit(m.page), [], "the flow view is one clean screen");
  eq((await m.page.evaluate(() => location.hash)), "#period=intraday&w=flow", "and the address remembers the flow view");
  await m.ctx.close();
  const re = await mount(browser, 1440, 820, { hash: "#scope=sector%3AEnergy&period=intraday&w=flow" });
  eq(await re.page.textContent("#sfSideT"), "Names", "a reload opens on the sector named in the address");
  ok(await re.page.$(".sf-fl") !== null, "in the flow view the address names");
  await re.ctx.close();
}

{
  const m = await mount(browser, 1440, 820);
  const first = await m.page.$eval(".sf-lt td[tabindex='0']", (el) => el.getAttribute("aria-label"));
  ok(/Calls, ask side, Takers held:/.test(first), "the first non-blank cell is the one tab stop of the matrix: " + first);
  await m.page.focus(".sf-lt td[tabindex='0']");
  eq(await m.page.textContent("#sfCellLine"), (await m.page.$eval(".sf-lt td[tabindex='0']", (el) => el.getAttribute("aria-label"))).replace(/^(.*), (Takers|Providers) (held|outside|no side): (.*)$/, (all, r, c, s, x) => `${r} · ${c} ${s}: ${x}`), "focusing a cell prints its exact figure under the matrix");
  await m.page.keyboard.press("ArrowRight");
  ok(/Providers held/.test(await m.page.textContent("#sfCellLine")), "an arrow key moves to the next cell");
  await m.page.keyboard.press("ArrowDown");
  ok(/Calls, bid side/.test(await m.page.textContent("#sfCellLine")), "and down to the next row");
  for (let i = 0; i < 4; i++) await m.page.keyboard.press("ArrowDown");
  ok(/Net before balancing|Balancing entry/.test(await m.page.textContent("#sfCellLine")), "down the column ends on the balancing entry and stops there");
  const x = await m.page.$eval(".sf-lt td.c[data-s='ok']", (el) => el.dataset.x);
  ok(/^[−$0-9,.]+$/.test(x) && x.includes("$"), "the exact figure is dollars and cents: " + x);
  await m.page.hover(".sf-lt tbody tr:nth-child(5) td.c:not(.b)");
  ok((await m.page.textContent("#sfCellLine")).includes("No side"), "hovering a cell prints it too");
  await m.page.mouse.move(5, 5);
  await m.page.focus("#sfInfoBtn");
  await m.page.keyboard.press("Enter");
  ok(await m.page.$eval("#sfInfoDlg", (d) => d.open), "the info button opens the dialog");
  await m.page.keyboard.press("Escape");
  ok(!(await m.page.$eval("#sfInfoDlg", (d) => d.open)), "Escape closes it");
  await m.page.hover('#sfChecks [data-id="rows"]');
  eq(await m.page.textContent("#sfCheckLine"), expected(world, "/api/flows/ledger").checks.items[0].text, "hovering a check prints what it compared");
  await m.page.mouse.move(5, 5);
  ok(/pass/.test(await m.page.textContent("#sfCheckLine")), "and leaving restores the summary");
  const stock = await m.page.$eval('#sfChecks [data-id="stock"]', (b) => [b.dataset.state, getComputedStyle(b).color]);
  eq(stock[0], "absent", "the stock identity is not claimed as a pass");
  await m.page.addScriptTag({ content: AXE });
  const n = await m.page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast", "button-name", "aria-valid-attr-value", "aria-required-children", "aria-required-parent", "th-has-data-cells", "td-headers-attr", "scope-attr-valid", "aria-allowed-attr", "label", "tabindex", "svg-img-alt"] }, resultTypes: ["violations"] })).violations.map((v) => v.id + ":" + v.nodes.length));
  eq(n, [], "axe finds no contrast, name, table or aria violation at 1440x820");
  await m.ctx.close();
}

{
  const m = await mount(browser, 390, 844);
  eq(await m.page.$$eval("#sfTabs button", (a) => a.map((b) => [b.dataset.v, b.getAttribute("aria-selected")])), [["ledger", "true"], ["side", "false"], ["read", "false"]], "three tabs, Ledger first");
  eq(await m.page.$$eval(".sf-panel", (a) => a.map((p) => getComputedStyle(p).display)), ["flex", "none", "none"], "only the Ledger panel is shown");
  eq(await m.page.$$eval("#sfGroups button", (a) => a.map((b) => [b.textContent, b.getAttribute("aria-pressed")])), [["Held", "true"], ["No side", "false"], ["Outside", "false"]], "three column groups, Held pressed");
  const held = await tableCells(m.page, ".sf-lt");
  eq(held.map((r) => r.cells.length), Array(held.length).fill(3), "two columns and a label in the held group");
  eq(held.map((r) => r.cells[0].t), ["Calls, ask side", "Calls, bid side", "Puts, ask side", "Puts, bid side", "Net before balancing", "Balancing entry, defined"], "the held group shows its four entries, net and balancing");
  await m.page.click('#sfGroups [data-g="noside"]');
  eq((await tableCells(m.page, ".sf-lt")).map((r) => r.cells[0].t), COPY.ROW_COPY.slice(4, 8).map((r) => r.label).concat(["Net before balancing", "Balancing entry, defined"]), "the no-side group shows its four reasons, net and balancing");
  eq(await audit(m.page), [], "and is still one clean screen");
  await m.page.click('#sfGroups [data-g="outside"]');
  eq((await tableCells(m.page, ".sf-lt")).length, 4, "the outside group shows two entries, net and balancing");
  await m.page.click('#sfTabs [data-v="side"]');
  eq(await m.page.$$eval(".sf-panel", (a) => a.map((p) => getComputedStyle(p).display)), ["none", "flex", "none"], "the Sectors tab shows the sectors");
  eq(await audit(m.page), [], "the sectors tab is one clean screen");
  eq(await m.page.$$eval(".sf-st tbody tr", (a) => a.length), 13, "all thirteen sectors are on screen");
  await m.page.click('#sfTabs [data-v="read"]');
  eq(await audit(m.page), [], "the reading tab is one clean screen");
  ok((await m.page.textContent("#sfReadBox")).includes(expected(world, "/api/flows/ledger").lean.line.text), "and carries the lean sentence");
  eq(await m.page.$eval("#sfChecks", (e) => getComputedStyle(e).display), "none", "the chips are folded away on a phone");
  await m.page.click("#sfCheckLine");
  eq(await m.page.$eval("#sfChecks", (e) => getComputedStyle(e).display), "flex", "and open when the summary is pressed");
  eq(await audit(m.page), [], "with the chips open it is still one screen");
  await m.ctx.close();
  const t = await mount(browser, 390, 844, { context: { hasTouch: true, isMobile: true } });
  const small = await t.page.evaluate(() => [...document.querySelectorAll(".sf-seg button, .sf-tabs button, #sfInfoBtn, .sf-crumbs button")].filter((el) => el.getBoundingClientRect().width > 0).map((el) => [el.textContent.trim().slice(0, 12), Math.round(el.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
  eq(small, [], "on a coarse pointer every control is at least 44 px tall");
  await t.page.click('#sfTabs [data-v="side"]');
  const rowsH = await t.page.$$eval(".sf-st tbody tr", (a) => a.map((r) => r.getBoundingClientRect().height));
  ok(Math.min(...rowsH) >= 24, "and every sector row, the target of a drill, is at least 24 px: " + Math.round(Math.min(...rowsH)));
  eq(await audit(t.page), [], "the touch layout is one clean screen");
  await t.ctx.close();
}

{
  const none = await mount(browser, 1440, 820, { hash: "#period=five" });
  eq(await none.page.getAttribute("#sf", "data-state"), "unavailable", "five sessions is unavailable");
  ok((await none.page.textContent("#sfNote")).includes("not archived"), "and says why: " + await none.page.textContent("#sfNote"));
  eq(await none.page.$eval("#sfStage", (e) => getComputedStyle(e).display), "none", "with no figures drawn");
  eq(await audit(none.page), [], "the empty state is one clean screen");
  await none.ctx.close();

  const quiet = await mount(browser, 1440, 820, { world: { ...world, rows: [] } });
  eq(await quiet.page.getAttribute("#sf", "data-state"), "quiet", "a record with no windows is quiet");
  ok((await quiet.page.textContent("#sfNote")).includes("no windows"), "and says so: " + await quiet.page.textContent("#sfNote"));
  await quiet.ctx.close();

  let fail = 500;
  const flaky = await mount(browser, 1440, 820, { respond: (url) => { if (fail) throw new Error("down"); return respondWith(world)(url); }, fail: 500 });
  eq(await flaky.page.getAttribute("#sf", "data-state"), "error", "a refused read is an error state");
  ok((await flaky.page.textContent("#sfNote")).includes("No figures are shown rather than old ones"), "that shows no old figures");
  eq(await flaky.page.$("#sfRetry") !== null, true, "and offers Retry");
  eq(await flaky.page.$eval("#sfCheckLine", (e) => [e.textContent, e.getAttribute("role")]), ["", null], "and leaves no empty button behind");
  await flaky.ctx.close();

  const gone = await mount(browser, 1440, 820, { input: { breadth: null } });
  const absent = await gone.page.$$eval(".sf-lt td.a", (a) => a.map((x) => [x.textContent.trim(), x.dataset.x]));
  ok(absent.length >= 6 && absent.every(([t, x]) => t === DASH && x && x.length > 5), `without a sector tide the outside cells are a dash with a reason, never zero (${absent.length})`);
  eq(await gone.page.$$eval(".sf-lt tbody tr", (a) => a.length), 12, "and the rows stay");
  ok((await gone.page.$$eval(".sf-st tbody td.n.a", (a) => a.length)) >= 13, "the sector table marks the outside column absent for every sector");
  const cut = await gone.page.$eval(".sf-lt thead tr:last-child th:nth-child(6)", (e) => e.className);
  ok(/off/.test(cut), "and the unmeasured columns are dimmed in the head");
  eq(await audit(gone.page), [], "and is one clean screen");
  await gone.ctx.close();

  const V = await loadVariant({ file: "shared/flows-sfc.js", transforms: [["balancing[c] = s === 0n ? 0 : safe(-s);", "balancing[c] = s === 0n ? 0 : safe(-s) + 1;"]] }, "page-closure");
  const input = inputFor(world);
  const closed = await mount(browser, 1440, 820, { respond: (url) => V.view.ledgerView({ ...input, scope: V.view.parseScope(url.searchParams.get("scope")) || { kind: "all", key: "all" }, period: url.searchParams.get("period") || null }) });
  eq(await closed.page.getAttribute("#sf", "data-state"), "failed", "a ledger that does not close is a failed page");
  ok(/logged as [0-9a-f]{8}/.test(await closed.page.textContent("#sfNote")), "with the logged hash in words");
  eq(await closed.page.$$("table"), [], "and no table, so no figure at all");
  await closed.ctx.close();
}

{
  const m = await mount(browser, 1440, 820);
  await m.page.route("**/api/flows/ledger*", async (route) => {
    const u = new URL(route.request().url());
    const body = respondWith(world)(u);
    if (u.searchParams.get("scope") === "sector:Energy") await new Promise((r) => setTimeout(r, 600));
    route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await m.page.click('.sf-drill[data-scope="sector:Energy"]');
  await m.page.click('.sf-drill[data-scope="sector:Technology"]', { timeout: 500 }).catch(() => {});
  await m.page.evaluate(() => { location.hash = "#scope=sector%3ATechnology"; });
  await m.page.waitForTimeout(1200);
  eq(await m.page.textContent("#sfScope"), expected(world, "/api/flows/ledger?scope=sector%3ATechnology").scope.line, "when two reads overlap, the slower, older one never overwrites the newer");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { context: { forcedColors: "active", reducedMotion: "reduce" } });
  eq(await audit(m.page), [], "forced colours: one clean screen");
  const bars = await m.page.$$eval(".sf-bar .sf-bd", (a) => a.length);
  ok(bars >= 8, "and the bands are drawn");
  await m.ctx.close();
}

{
  const plants = [
    ["a proven fill drawn to R instead of R minus W", "js", [["if (verdict === \"above\") fill = { x: 0, width: u(c - w) };", "if (verdict === \"above\") fill = { x: 0, width: u(c) };"]], async (page) => { const g = await page.evaluate(() => [...document.querySelectorAll(".sf-st tbody tr")].map((tr) => { const f = tr.querySelector(".sf-fo.up"); const b = tr.querySelector(".sf-bd"); const k = tr.querySelector(".sf-tk"); return f ? [Number(f.getAttribute("width")), Number(k.getAttribute("x1")), Number(b.getAttribute("x"))] : null; }).filter(Boolean)); return g.length > 0 && g.every(([w, tick, lo]) => Math.abs(w - lo) < 0.02); }],
    ["a fill under an undetermined verdict", "js", [["let fill = null;\n    if (verdict === \"above\")", "let fill = verdict === \"undetermined\" ? { x: 0, width: u(c) } : null;\n    if (verdict === \"above\")"]], async (page) => (await page.$$eval("td.tl[data-v=undetermined] .sf-fo", (a) => a.length)) === 0],
    ["the verdict glyph left out of the cell", "js", [["'</span><span class=\"vd\"><i aria-hidden=\"true\">' + esc(cell.glyph) + '</i><em> '", "'</span><span class=\"vd\"><i aria-hidden=\"true\"></i><em> '"]], async (page) => (await page.$$eval("td.tl .vd i", (a) => a.every((x) => x.textContent.length > 0)))],
    ["an absent figure drawn as a zero", "js", [['+ DASH + "</span></td>"', '+ "0</span></td>"']], async (page) => (await page.$$eval(".sf-lt td.a", (a) => a.length > 0 && a.every((x) => x.textContent.trim() === "—")))],
    ["net before balancing drawn without its sign flipped", "js", [["const body = L.rows.slice(0, 10).concat([{ ...L.net, always: true, kind: \"net\" }", "const body = L.rows.slice(0, 10).concat([{ ...L.rows[10], label: L.net.label, hover: L.net.hover, always: true, kind: \"net\" }"]], async (page) => { const rows = await page.$$eval(".sf-lt tbody tr", (a) => a.slice(-2).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()))); return rows[0].every((t, i) => t === rows[1][i] || (t === "0" && rows[1][i] === "0") || t === rows[1][i].replace("−", "").replace(/^(?!−)/, "−")) && rows[0].some((t, i) => t !== rows[1][i]); }],
    ["the period button loads even when it is unavailable", "js", [["if (period.getAttribute(\"aria-disabled\") === \"true\") { setNote(period.title || \"\", false); return; }", "if (false) { return; }"]], async (page, asked) => !asked.some((u) => u.includes("period=session"))],
    ["arrow widths not proportional", "js", [["return cents.map((c) => (max > 0 && c > 0 ? Math.max(ARROW_MIN, (ARROW_MAX * c) / max) : 0));", "return cents.map((c) => (max > 0 && c > 0 ? ARROW_MAX : 0));"]], async (page) => { const w = await page.$$eval(".fl-ar", (a) => a.map((x) => Number(x.dataset.w))); return new Set(w.filter((x) => x > 0)).size > 1; }, "#w=flow"],
    ["the summary line is a button even when empty or on a wide screen", "js", [["if (small() && el.textContent !== \"\") {", "if (true) {"]], async (page) => (await page.$eval("#sfCheckLine", (e) => e.getAttribute("role"))) === null],
    ["an old read overwriting a newer one", "js", [["if (seq !== S.seq) return null;\n        freshFrom(res, body);", "freshFrom(res, body);"]], null],
    ["the sheet lets the page scroll", "css", [[".flows-body[data-flows-page=\"ledger\"] .flows-main {\n  --sf-pad-b: var(--sp-4);\n  height: 100vh;\n  height: 100dvh;\n  padding-bottom: var(--sf-pad-b);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}", ".flows-body[data-flows-page=\"ledger\"] .flows-main {\n  --sf-pad-b: var(--sp-4);\n  padding-bottom: var(--sf-pad-b);\n}"], [".sf { flex: 1; min-height: 0; display: flex;", ".sf { flex: 1; min-height: 130vh; display: flex;"]], async (page) => (await audit(page)).length === 0],
    ["the label column squeezed", "css", [["@media (min-width: 1280px) {\n  .sf-lt .gr > td:first-child, .sf-lt .corner { width: 30%; }", "@media (min-width: 1280px) {\n  .sf-lt .gr > td:first-child, .sf-lt .corner { width: 6%; }"]], async (page) => (await audit(page)).length === 0],
    ["the sector column squeezed", "css", [[".sf-st th:first-child { width: 32%; }\n  .sf-st .h-taker, .sf-st .c-taker { width: 10%; }", ".sf-st th:first-child { width: 6%; }\n  .sf-st .h-taker, .sf-st .c-taker { width: 10%; }"]], async (page) => (await audit(page)).length === 0],
  ];
  for (const [title, kind, transforms, holds, hash] of plants) {
    let js = JS, css = CSS;
    for (const [from, to] of transforms) {
      const target = kind === "js" ? js : css;
      eq(target.split(from).length - 1, 1, `planted build "${title}" applies exactly once`);
      if (kind === "js") js = js.replace(from, () => to); else css = css.replace(from, () => to);
    }
    const m = await mount(browser, 1440, 820, { js, css, hash: hash || "", settle: 150 }).catch((error) => { throw new Error(`planted build "${title}" did not load: ${error.message.split("\n")[0]}`); });
    if (holds === null) {
      await m.page.route("**/api/flows/ledger*", async (route) => {
        const u = new URL(route.request().url());
        const body = respondWith(world)(u);
        if (u.searchParams.get("scope") === "sector:Energy") await new Promise((r) => setTimeout(r, 500));
        route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      });
      await m.page.click('.sf-drill[data-scope="sector:Energy"]');
      await m.page.evaluate(() => { location.hash = "#scope=sector%3ATechnology"; });
      await m.page.waitForTimeout(1000);
      const line = await m.page.textContent("#sfScope");
      ok(line !== expected(world, "/api/flows/ledger?scope=sector%3ATechnology").scope.line, `planted build "${title}" is caught`);
    } else {
      if (title.startsWith("the period button")) { await m.page.click('#sfPeriod [data-p="session"]', { force: true }); await m.page.waitForTimeout(150); }
      ok(!(await holds(m.page, m.asked)), `planted build "${title}" is caught`);
    }
    await m.ctx.close();
  }
}

await browser.close();
console.log(`✓ flows-sfc-render: ${checks} assertions`);
