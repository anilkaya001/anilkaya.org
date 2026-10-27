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
import { moneyShort, moneyOut, leanBounds } from "../shared/flows-sfc-display.js";
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
const COPY_TOTAL_ALL = "Total, all rows";
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
  for (const id of ["sf", "sfStatus", "sfStamp", "sfPeriod", "sfCrumbs", "sfScope", "sfHero", "sfLean", "sfLeanV", "sfLeanVerdict", "sfLeanBar", "sfLeanFig", "sfLeanLine", "sfCells", "sfChecks", "sfCheckLine", "sfNote", "sfTabs", "sfStage", "sfLedger", "sfSide", "sfRead", "sfMatrix", "sfGroups", "sfCellLine", "sfBody", "sfView", "sfReadBox", "sfStrip", "sfInfoDlg", "sfInfoBtn", "sfInfoX"]) ok(new RegExp('id="' + id + '"').test(HTML), "the page carries #" + id);
  const text = htmlToText(HTML.replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<header[\s\S]*?<\/header>/, ""));
  eq(lintText(text).map((h) => `${h.rule} ${JSON.stringify(h.match)} :: ${h.sentence.slice(0, 80)}`), [], "the served page text passes every copy rule: no unsided, no tape, no sector transfer, nothing leaving, no forecast word, sentences of at most fourteen words");
  const dialog = (HTML.match(STATIC_DIALOG) || []).join(" ");
  for (const line of COPY.INFO) ok(dialog.includes(line.replace(/&/g, "&amp;").replace(/'/g, "&#39;")), "the info dialog carries: " + line.slice(0, 50));
  for (const line of COPY.NOT_BUILT) ok(dialog.includes(line), "and the not-built line: " + line.slice(0, 40));
  ok(dialog.includes(COPY.BALANCING_DEFINITION), "and the definition of the balancing entry");
  ok(HTML.includes(COPY.KEY_LINE) && HTML.includes(COPY.ZERO_LINE), "the key and the zero line are in the served HTML");
  ok(!COLOUR_LITERAL.test(CSS), "the sheet holds no colour literal: tokens only");
  ok(!COLOUR_LITERAL.test(JS.replace(/&#39;/g, "")), "and neither does the script");
  ok(COLOUR_LITERAL.test(CSS + "\n.x { color: #fff; }") && COLOUR_LITERAL.test(CSS + "\n.x { background: rgb(1, 2, 3); }"), "and the scan catches a planted literal");
  ok(!/(^|[^-\w])transition\b/.test(CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "")), "every transition sits inside no-preference");
  ok(!/\bglobalThis\.|(?<![\w.])window\.[A-Za-z]+\s*=(?!=)/.test(JS.replace(/globalThis\.__LedgerTest/, "")), "no new global");
  ok(!/\/\*|(^|[^:"'`])\/\/\s/.test(CSS + JS), "no comment in the sheet or the script");
  const scrollers = (sheet) => /overflow(-y)?:\s*(auto|scroll)/.test(sheet.replace(/\n\.sf-dlg \{[^}]*\}/, "").replace(/\n\.sf-mat \{ overflow-x: hidden; overflow-y: auto; \}/, "").replace(/^\.flows-body\[data-flows-page="ledger"\] \.flows-main \{[^}]*\}/, ""));
  ok(!scrollers(CSS), "the sheet scrolls nothing but the info dialog, which can be taller than a phone, the ledger's own slot and the page's own area, which scroll only where a zoomed or tiny window leaves them less than their content needs");
  ok(scrollers(CSS + "\n.sf-st { overflow-y: auto; }") && scrollers(CSS + "\n.sf-body { overflow: scroll; }"), "and the scan catches a planted scroller elsewhere");
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
  const closed = await row.handler({ request: new Request("https://x.test/flows/ledger/"), env: {}, url: new URL("https://x.test/flows/ledger/") }).then(() => null, (e) => e.status);
  eq(closed, 404, "a member does not find the page while FLOWS_LEDGER is unset");
  const res = await row.handler({ request: new Request("https://x.test/flows/ledger/"), env: { FLOWS_LEDGER: "on" }, url: new URL("https://x.test/flows/ledger/") });
  eq(res.status, 200, "and is served it once the switch is on");
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
  for (const host of document.querySelectorAll(".sf-mat, .sf-body, .sf-fl")) {
    if (vis(host) && host.scrollHeight > host.clientHeight + 1) out.push("rows clipped in " + host.id + ": " + host.scrollHeight + " over " + host.clientHeight);
  }
  for (const pop of document.querySelectorAll(".sf-checks")) {
    const r = pop.getBoundingClientRect();
    if (vis(pop) && (r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) out.push("the checks leave the screen");
  }
  for (const panel of document.querySelectorAll(".sf-panel, .sf-hero, .sf-strip, .sf-checkrow")) {
    if (!vis(panel)) continue;
    const pr = panel.getBoundingClientRect();
    for (const el of panel.querySelectorAll("*")) {
      if (!vis(el) || (el.closest("svg") && el.tagName !== "svg") || el.closest(".visually-hidden, .vh")) continue;
      if (el.closest(".sf-checks") && matchMedia("(max-width:899px)").matches) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) out.push("outside " + panel.id + ": " + el.tagName + "." + el.className + " by " + Math.round(r.bottom - pr.bottom) + "," + Math.round(r.right - pr.right));
    }
  }
  for (const el of document.querySelectorAll(".sf *")) {
    if (!vis(el) || el.closest("svg") || el.closest(".visually-hidden") || el.closest("dialog") || el.clientWidth <= 4) continue;
    const s = getComputedStyle(el);
    if ((s.overflow !== "visible" || s.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth && el.textContent.trim() !== "") out.push("text cut: " + el.textContent.trim().slice(0, 40) + " [" + el.scrollWidth + ">" + el.clientWidth + "]");
  }
  return out;
});

const obscured = (page) => page.evaluate(() => {
  const out = [];
  const lift = document.createElement("style");
  lift.textContent = ".sf, .sf * { pointer-events: auto !important; }";
  document.head.append(lift);
  for (const el of document.querySelectorAll(".sf a[href], .sf button, .sf [tabindex='0']")) {
    const r = el.getBoundingClientRect();
    if (el.closest("dialog") || r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    const d = Math.min(5, r.width / 4, r.height / 4);
    const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d]];
    for (const [x, y] of pts) {
      const top = document.elementsFromPoint(x, y)[0];
      if (top && top !== el && !el.contains(top) && !top.contains(el)) { out.push((el.id ? "#" + el.id : el.tagName.toLowerCase()) + "." + String(el.className).split(" ")[0] + " under " + top.tagName.toLowerCase() + "." + String(top.className).split(" ")[0]); break; }
    }
  }
  lift.remove();
  return out;
});

const tableCells = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(sel + " tbody tr:not(.sub), " + sel + " tfoot tr")].filter((tr) => tr.getClientRects().length > 0).map((tr) => ({
  cls: tr.className, cells: [...tr.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => ({ t: (() => { const k = c.cloneNode(true); k.querySelectorAll(".pf, .visually-hidden").forEach((e) => e.remove()); return k.textContent.trim(); })(), s: c.dataset.s || null, x: c.dataset.x || c.title || null })),
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
    eq(await obscured(m.page), [], `${w}x${h}: nothing focusable is covered by the Ask dock, the shell bar or anything else (WCAG 2.4.11)`);
    const view = expected(world, "/api/flows/ledger?scope=all");
    eq(await m.page.textContent("#sfStamp"), view.period.label, `${w}x${h}: the stamp is the period label`);
    eq(await m.page.textContent("#sfScope"), view.scope.line, `${w}x${h}: and the scope line`);
    eq(await m.page.$$eval("#sfChecks .sf-chk", (a) => a.map((x) => [x.dataset.id, x.dataset.state])), view.checks.items.map((i) => [i.id, i.state]), `${w}x${h}: seven check chips with the view's states`);
    ok(/^(Internal checks|Checks) · \d+ pass( · \d+ fail)?( · \d+ not checked)?$/.test(await m.page.textContent("#sfCheckLine")), `${w}x${h}: the one-line summary of the checks`);
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
  eq(rows.map((r) => r.cells[0].t), [...L.rows.slice(0, 10).map((r) => r.short), L.net.label, L.rows[10].label], "row labels in order, net before balancing above the balancing entry");
  eq(await m.page.$$eval(".sf-lt tr.sub", (a) => a.map((r) => [r.cells[0].textContent, r.cells.length])), [[COPY.GROUP_ROWS.side.label, 7]], "the four rows whose side is unknown sit under one sub-heading that names them");
  eq(await m.page.$$eval(".sf-lt tbody tr", (a) => a.map((tr) => (tr.classList.contains("sub") ? "sub" : tr.classList.contains("in") ? "in" : ""))).then((a) => a.slice(4, 10)), ["sub", "in", "in", "in", "in", ""], "and the four rows are indented beneath it");
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
  eq(sect.map((r) => r.cells[0].t), [...view.sectors.rows.map((r) => r.short), "Total"], "sector rows in order, in the short names a 537 px panel can hold, then the total");
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
  const ledgerReads = () => m.asked.filter((u) => u.startsWith("/api/flows/ledger")).length;
  const before = ledgerReads();
  await m.page.waitForTimeout(100);
  eq(ledgerReads(), before, "a period that is not available makes no request");
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
  for (const [w, h] of SIZES) {
    const f = await mount(browser, w, h, { hash: "#w=flow" });
    if (w < 900) { await f.page.click('#sfTabs [data-v="side"]'); await f.page.waitForTimeout(300); }
    eq(await audit(f.page), [], `${w}x${h}: the flow view is one clean screen, every figure in full`);
    const labels = await f.page.$$eval(".fl-lab", (a) => a.map((e) => [e.textContent, e.scrollWidth <= e.clientWidth + 1]));
    ok(labels.length === 6 && labels.every(([t, whole]) => whole && /\$\d/.test(t)), `${w}x${h}: all six lane labels show their figure`);
    await f.ctx.close();
  }
  const re = await mount(browser, 1440, 820, { hash: "#scope=sector%3AEnergy&period=intraday&w=flow" });
  eq(await re.page.textContent("#sfSideT"), "Names", "a reload opens on the sector named in the address");
  ok(await re.page.$(".sf-fl") !== null, "in the flow view the address names");
  await re.ctx.close();
}

for (const [w, h, tab] of [[320, 568, null], [640, 360, "ledger"], [1000, 540, null]]) {
  const m = await mount(browser, w, h);
  if (tab) { await m.page.click(`#sfTabs [data-v="${tab}"]`); await m.page.waitForTimeout(250); }
  const label = `${w}x${h}`;
  const r = await m.page.evaluate(() => { const main = document.querySelector(".flows-main"); return { page: document.scrollingElement.scrollWidth - innerWidth, scrolls: main.scrollHeight > main.clientHeight + 1, stage: document.getElementById("sfStage").getBoundingClientRect().height, valve: [document.getElementById("sfMatrix").getAttribute("tabindex"), document.getElementById("sfMatrix").getAttribute("role")] }; });
  ok(r.page <= 0, `${label}: nothing scrolls sideways`);
  if (tab || w >= 900) ok(r.stage >= 260, `${label}: the panels keep a height a reader can use (${r.stage})`);
  ok(r.scrolls, `${label}: a window too short for the page scrolls the page's own area, it does not cut the page off`);
  eq(await m.page.evaluate(() => { const out = []; for (const el of document.querySelectorAll(".sf button, .sf [tabindex='0']")) { if (!el.getClientRects().length || el.closest("dialog")) continue; el.scrollIntoView({ block: "nearest" }); const b = el.getBoundingClientRect(); if (b.bottom > innerHeight + 1 || b.top < -1 || b.right > innerWidth + 1 || b.left < -1) out.push(el.id || el.className); } return out; }), [], `${label}: and every control can be scrolled into view`);
  eq((await audit(m.page)).filter((p) => !/^page scrolls vertically|^a container scrolls|^rows clipped in sfMatrix|^outside sfLedger/.test(p)), [], `${label}: with no text cut and nothing outside its panel`);
  if (tab || w >= 900) {
    const mat = await m.page.evaluate(() => { const e = document.getElementById("sfMatrix"); return { over: e.scrollHeight > e.clientHeight + 1, tab: e.getAttribute("tabindex"), role: e.getAttribute("role") }; });
    ok(!mat.over || (mat.tab === "0" && mat.role === "region"), `${label}: a ledger slot that has to scroll can be reached and scrolled by keyboard`);
    if (mat.over) {
      await m.page.focus("#sfMatrix");
      await m.page.keyboard.press("PageDown");
      await m.page.waitForTimeout(150);
      ok(await m.page.evaluate(() => document.getElementById("sfMatrix").scrollTop > 0), `${label}: PageDown scrolls it`);
    }
  }
  await m.ctx.close();
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
  await m.page.hover(".sf-lt tbody tr:nth-child(6) td.c:not(.b)");
  ok((await m.page.textContent("#sfCellLine")).includes("Side unknown"), "hovering a cell prints it too");
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
  eq(await m.page.$$eval("#sfTabs button", (a) => a.map((b) => [b.dataset.v, b.getAttribute("aria-selected")])), [["balance", "true"], ["ledger", "false"], ["side", "false"]], "three tabs, Balance first");
  eq(await m.page.$$eval(".sf-panel", (a) => a.map((p) => getComputedStyle(p).display)), ["none", "none", "flex"], "the Balance tab shows the reading under the hero and no table");
  eq(await m.page.$eval("#sfHero", (e) => getComputedStyle(e).display), "grid", "and the hero");
  eq(await audit(m.page), [], "the Balance tab is one clean screen");
  ok((await m.page.textContent("#sfLeanLine")).includes(expected(world, "/api/flows/ledger").lean.line.text), "and carries the lean sentence");
  await m.page.click('#sfTabs [data-v="ledger"]');
  eq(await m.page.$eval("#sfHero", (e) => getComputedStyle(e).display), "none", "the hero is shown on the Balance tab alone");
  eq(await m.page.$$eval(".sf-panel", (a) => a.map((p) => getComputedStyle(p).display)), ["flex", "none", "none"], "the Ledger tab shows the ledger");
  eq(await m.page.$$eval("#sfGroups button", (a) => a.map((b) => [b.textContent, b.getAttribute("aria-pressed")])), [["Held", "true"], ["Side unknown", "false"], ["Outside", "false"]], "three column groups, Held pressed");
  const held = await tableCells(m.page, ".sf-lt");
  eq(held.map((r) => r.cells.length), Array(held.length).fill(3), "two columns and a label in the held group");
  eq(held.map((r) => r.cells[0].t), ["Calls, ask side", "Calls, bid side", "Puts, ask side", "Puts, bid side", "Net before balancing", "Balancing entry, defined"], "the held group shows its four entries, net and balancing");
  eq(await audit(m.page), [], "the held group is one clean screen");
  await m.page.click('#sfGroups [data-g="noside"]');
  eq((await tableCells(m.page, ".sf-lt")).map((r) => r.cells[0].t), COPY.ROW_COPY.slice(4, 8).map((r) => r.short).concat(["Net before balancing", "Balancing entry, defined"]), "the side-unknown group shows its four reasons, net and balancing");
  eq(await audit(m.page), [], "and is still one clean screen");
  await m.page.click('#sfGroups [data-g="outside"]');
  eq((await tableCells(m.page, ".sf-lt")).length, 4, "the outside group shows two entries, net and balancing");
  eq(await audit(m.page), [], "and so is the outside group");
  await m.page.click('#sfTabs [data-v="side"]');
  eq(await m.page.$$eval(".sf-panel", (a) => a.map((p) => getComputedStyle(p).display)), ["none", "flex", "none"], "the Sectors tab shows the sectors");
  eq(await audit(m.page), [], "the sectors tab is one clean screen");
  eq(await m.page.$$eval(".sf-st tbody tr", (a) => a.length), 13, "all thirteen sectors are on screen");
  await m.page.click('#sfTabs [data-v="balance"]');
  eq(await m.page.$eval("#sfChecks", (e) => getComputedStyle(e).display), "none", "the chips are folded away on a phone");
  await m.page.click("#sfCheckLine");
  eq(await m.page.$eval("#sfChecks", (e) => getComputedStyle(e).display), "flex", "and open when the summary is pressed");
  eq(await audit(m.page), [], "with the chips open it is still one screen");
  await m.ctx.close();
  const t = await mount(browser, 390, 844, { context: { hasTouch: true, isMobile: true } });
  const small = await t.page.evaluate(() => [...document.querySelectorAll(".sf-seg button, .sf-tabs button, #sfInfoBtn, .sf-crumbs button")].filter((el) => el.getBoundingClientRect().width > 0).map((el) => [el.textContent.trim().slice(0, 12), Math.round(el.getBoundingClientRect().height)]).filter(([, h]) => h < 44));
  eq(small, [], "on a coarse pointer every control is at least 44 px tall");
  await t.page.click('#sfTabs [data-v="side"]');
  const rowsH = await t.page.$$eval(".sf-st tbody tr", (a) => a.filter((r) => r.getClientRects().length > 0).map((r) => r.getBoundingClientRect().height));
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
  eq(await flaky.page.$$eval("#sf [data-s=pending], #sf table, #sf .hr-v, #sf .hc-v b", (a) => a.filter((e) => e.getClientRects().length > 0).length), 0, "and no waiting cell, table or figure is left on the screen: nothing stays pending behind a failed read");
  eq(await audit(flaky.page), [], "and the failed screen is one clean screen");
  const strip = await flaky.page.$$eval("#sfStrip .sf-sc", (a) => a.map((c) => [c.dataset.k, c.dataset.s]));
  eq(strip.slice(0, 3), [["windows", "unavailable"], ["held", "withheld"], ["tide", "withheld"]], "the strip says the windows are unreadable and the held set and tide are withheld");
  await flaky.ctx.close();

  const gone = await mount(browser, 1440, 820, { input: { breadth: null } });
  const absent = await gone.page.$$eval(".sf-lt td.a", (a) => a.map((x) => [x.textContent.trim(), x.dataset.x]));
  ok(absent.length >= 6 && absent.every(([t, x]) => t === DASH && x && x.length > 5), `without a sector tide the outside cells are a dash with a reason, never zero (${absent.length})`);
  eq(await gone.page.$$eval(".sf-lt tbody tr:not(.sub)", (a) => a.length), 12, "and the rows stay");
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
  eq(await closed.page.$$eval("#sf table, #sf .hr-v, #sf .hc-v b, #sf .hr-fv, #sf .sf-bar", (a) => a.filter((e) => e.getClientRects().length > 0).length), 0, "and no table, bar or hero figure is on screen, so no figure at all");
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

const BUMPED = { ...world, rows: world.rows.map((r, i) => (i % 9 === 0 && r.prem ? { ...r, prem: r.prem + 4000, raw: { ...r.raw, prem: String(r.prem + 4000) } } : r)) };
let flipped = false;

const BARE = { ...world, rows: world.rows.map((r) => ({ ...r, askPrem: null, bidPrem: null, raw: { ...r.raw, askPrem: null, bidPrem: null } })) };

const heroCents = (view) => {
  const [callsAsk, putsAsk, callsBid, putsBid] = view.flow.arrows.map((a) => a.cents);
  const A = callsAsk + putsAsk, B = callsBid + putsBid, U = view.flow.noside.cents;
  return { A, B, U, T: A + B + U, callsNet: callsAsk - callsBid, putsNet: putsAsk - putsBid };
};

const heroDom = (page) => page.evaluate(() => {
  const svg = document.getElementById("sfLeanBar");
  const box = svg.getBoundingClientRect();
  const r = (cls) => { const b = svg.querySelector("." + cls).getBoundingClientRect(); return [b.left - box.left, b.width]; };
  return {
    v: document.getElementById("sfLeanV").textContent, verdict: document.getElementById("sfLeanVerdict").textContent, line: document.getElementById("sfLeanLine").textContent,
    width: box.width, a: r("a"), u: r("u"), b: r("b"), tick: getComputedStyle(svg.querySelector(".tk")).display === "none" ? null : r("tk")[0],
    figs: [...document.querySelectorAll("#sfLeanFig .hr-fv")].map((e) => e.textContent),
    cells: [...document.querySelectorAll("#sfCells .hc")].map((c) => ({ id: c.dataset.id, v: c.querySelector(".hc-v b").textContent, g: c.querySelector(".hc-v i").textContent, r: c.querySelector(".hc-r").textContent, s: c.querySelector(".hc-s").textContent, proof: c.dataset.proof })),
  };
});

{
  const printedPositive = (t) => t !== "$0" && !t.startsWith(MINUS);
  const proofOf = (n, U) => (U === 0 ? (n > 0 ? "up" : n < 0 ? "down" : "even") : printedPositive(moneyOut(n - U, "down")) ? "up" : moneyOut(n + U, "up").startsWith(MINUS) ? "down" : "open");
  const GLYPH_OF = { up: "▲", down: "▼", open: "◇", even: "=" };
  const cases = [["a day with side unknown larger than the stated net", world], ["a day whose sides are mostly stated", tight]];
  for (const [title, w] of cases) {
    const m = await mount(browser, 1440, 820, { world: w });
    const view = expected(w, "/api/flows/ledger?scope=all");
    const { A, B, U, T, callsNet, putsNet } = heroCents(view);
    eq([view.hero.lean.A, view.hero.lean.B, view.hero.lean.U, view.hero.lean.T], [A, B, U, T], `${title}: the hero's totals are the flow view's own arrows`);
    const d = await heroDom(m.page);
    eq(d.v, leanBounds(A, B, U).text, `${title}: the interval is A over T rounded down and (A + U) over T rounded up, written so it never contradicts the verdict`);
    const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg + ` (${a.toFixed(3)} against ${b.toFixed(3)})`);
    near(d.a[1] / d.width, A / T, 0.002, `${title}: the ask segment is A over T of the bar`);
    near(d.u[1] / d.width, U / T, 0.002, `${title}: the hatched span is U over T`);
    near(d.b[1] / d.width, B / T, 0.002, `${title}: the bid segment is B over T`);
    near(d.u[0] / d.width, A / T, 0.002, `${title}: the hatch starts where the ask ends`);
    near(d.b[0] / d.width, (A + U) / T, 0.002, `${title}: and ends where the bid begins`);
    ok(d.a[1] + d.u[1] + d.b[1] >= d.width - 1 && d.a[1] + d.u[1] + d.b[1] <= d.width + 1, `${title}: the three segments fill the bar and no more`);
    if (d.tick !== null) near(d.tick / d.width, A / (A + B), 0.004, `${title}: the stated-side tick stands at A over A + B`);
    const proven = 2 * A > T ? "paid" : 2 * B > T ? "received" : "open";
    const shown = ["paid", "received"].includes(proven) ? proven : view.hero.lean.verdict.id;
    ok(["paid", "received", "open", "noSides", "lowCoverage", "smallClassified"].includes(shown), `${title}: the verdict is one of the six the copy holds: ${shown}`);
    eq(d.verdict, COPY.HERO.lean.verdict[shown].short, `${title}: the verdict follows whether the interval clears 50%, in the copy's own words`);
    ok(!/\bProven\b/.test(d.verdict), `${title}: and no verdict says proven`);
    eq(d.figs, [moneyShort(A), moneyShort(U), moneyShort(B)], `${title}: the three figures under the bar are A, side unknown and B`);
    eq(d.cells.map((c) => c.v), [moneyShort(T), (callsNet < 0 ? "−" : "+") + moneyShort(Math.abs(callsNet)), (putsNet < 0 ? "−" : "+") + moneyShort(Math.abs(putsNet))], `${title}: the cells are held premium, net calls and net puts in the view's own money`);
    eq(d.cells.slice(1).map((c) => [c.proof, c.g]), [callsNet, putsNet].map((n) => [proofOf(n, U), GLYPH_OF[proofOf(n, U)]]), `${title}: a net is proven only when it is larger than side unknown`);
    ok(!/NaN|undefined|null/.test(JSON.stringify(d)), `${title}: no cell prints a null`);
    [callsNet, putsNet].forEach((n, i) => ok(d.cells[i + 1].r.endsWith(`${moneyOut(n - U, "down", { plus: true })} to ${moneyOut(n + U, "up", { plus: true })}`), `${title}: net ${["calls", "puts"][i]} names its outer bound, rounded outward: ${d.cells[i + 1].r}`));
    const sec = await m.page.$$eval(".sf-st tbody td.c-taker", (a) => a.map((td) => td.dataset.proof || null));
    eq(sec, view.sectors.rows.map((r) => (r.windows ? r.proof : null)), `${title}: every sector's taker net carries its own proof, from its own side unknown`);
    ok(view.sectors.rows.every((r) => !r.windows || r.proof === proofOf(r.takerC, r.uC)), `${title}: and the view's proof is the same rule`);
    const marks = await m.page.$$eval(".sf-st tbody td.c-taker", (a) => a.map((td) => ({ proof: td.dataset.proof || null, pf: [...td.querySelectorAll(".pf")].map((e) => e.textContent), say: [...td.querySelectorAll(".visually-hidden")].map((e) => e.textContent) })));
    view.sectors.rows.forEach((r, i) => {
      if (!r.windows) return;
      const k = marks[i];
      if (r.proof === "even") { ok(k.pf.length === 0, `${title} ${r.key}: a net of exactly zero carries no mark`); return; }
      eq(k.pf, [GLYPH_OF[r.proof]], `${title} ${r.key}: every sector row with windows has exactly one state mark, and a decided mark points the way the figure does`);
      ok(k.say.length === 1 && /undecided/.test(k.say[0]) === (r.proof === "open"), `${title} ${r.key}: and it is spoken: ${k.say[0]}`);
      ok(r.proof === "open" || (r.proof === "up") === (r.takerC > 0), `${title} ${r.key}: a triangle's direction is the sign of the net it stands beside`);
    });
    await m.ctx.close();
  }
  const none = await mount(browser, 1440, 820, { world: BARE });
  const nv = expected(BARE, "/api/flows/ledger?scope=all");
  const nd = await heroDom(none.page);
  eq([nv.hero.lean.A, nv.hero.lean.B], [0, 0], "a day with no stated side: nothing is booked to a side");
  eq(nd.v, "0–100%", "its interval is the whole bar, not a guess");
  eq(nd.tick, null, "it draws no stated-side tick");
  ok(nd.u[1] / nd.width > 0.99, "and the hatch covers the bar");
  eq(nd.verdict, COPY.HERO.lean.verdict.noSides.short, "and says every side is unknown");
  eq(nd.cells.slice(1).map((c) => c.proof), ["open", "open"], "and neither net is proven");
  eq(await audit(none.page), [], "and is one clean screen");
  await none.ctx.close();
}

{
  const m = await mount(browser, 1440, 820);
  const view = expected(world, "/api/flows/ledger?scope=all");
  const chips = await m.page.$$eval("#sfStrip .sf-sc", (a) => a.map((c) => [c.dataset.k, c.dataset.s, c.querySelector(".sc-t").textContent]));
  eq(chips.map((c) => c[0]), ["windows", "held", "tide", "poll"], "the strip names four sources: windows, the held set, the sector tide and the last poll");
  eq(chips[0][2], "as of " + view.period.asOfText, "the windows chip says when the windows are from, in TRT");
  const seen = view.scope.seen, held = view.scope.held;
  eq(chips[1], ["held", seen === null ? "withheld" : seen > held ? "partial" : "fresh", seen !== null && seen > held ? `${held} of ${seen} held` : seen === null ? `${held} held, shed count not recorded` : `${held} held`], "the held chip says how many of the seen windows are held");
  eq(chips[2][2], "as of " + view.tide.at, "the tide chip carries the tide's own time");
  ok(/^\d\d:\d\d:\d\d TRT$/.test(chips[3][2]) && chips[3][1] === "fresh", "the poll chip is a static TRT stamp to the second, fresh: " + chips[3][2]);
  ok(await m.page.$$eval("#sfStrip .sf-sc", (a) => a.every((c) => c.querySelector("i") && c.querySelector("b").textContent.length > 0)), "every chip carries a glyph and its name, so colour is never the only cue");
  eq(await m.page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest("#sf")).length), 0, "and nothing on the page animates at rest");
  await m.ctx.close();

  const c = await mount(browser, 1440, 820, { clock: "2026-10-23T14:50:00Z", phase: { phase: "rth", endsAt: "2026-10-23T20:00:00Z" }, settle: 200 });
  const poll = () => c.page.$eval('#sfStrip [data-k="poll"]', (e) => [e.dataset.s, e.querySelector(".sc-t").textContent]);
  eq((await poll())[0], "fresh", "the poll chip starts fresh");
  await c.page.route("**/api/flows/now*", (r) => r.abort());
  await c.page.route("**/api/flows/ledger*", (r) => r.abort());
  await c.page.clock.runFor(60000);
  eq((await poll())[0], "fresh", "and is still fresh a minute after the read");
  await c.page.clock.runFor(30000);
  const late = await poll();
  eq(late[0], "stale", "past 75 s with no read it says so");
  ok(late[1].startsWith("late, "), "in words: " + late[1]);
  await c.page.clock.runFor(240000);
  const stopped = await poll();
  eq(stopped[0], "unavailable", "past five minutes it says it stopped");
  ok(stopped[1].startsWith("no reply since "), "in words, and without claiming the data stopped: " + stopped[1]);
  await c.ctx.close();
}

{
  let second = false;
  const respond = (url) => respondWith(second ? BUMPED : world)(url);
  const m = await mount(browser, 1440, 820, { respond, context: { reducedMotion: "no-preference" } });
  eq(await m.page.$$eval(".sf-lt td.chg, .sf-st td.chg, .hc.chg, .hr-f.chg", (a) => a.length), 0, "nothing flashes on the first paint");
  const first = await m.page.$$eval(".sf-lt tbody td.c:not(.b)", (a) => a.map((e) => e.textContent));
  second = true;
  await m.page.click("#sfPeriod [data-p=intraday]");
  await m.page.waitForSelector("#sf[data-busy='false']");
  const next = await m.page.$$eval(".sf-lt tbody td.c:not(.b)", (a) => a.map((e) => [e.textContent, e.classList.contains("chg")]));
  const changed = next.filter(([t], i) => t !== first[i]).length;
  ok(changed > 0 && changed < next.length, "a bigger window changes some of the ledger's figures: " + changed);
  eq(next.filter(([, f]) => f).length, changed, "and the cells that flash are exactly the cells whose text changed");
  eq(await m.page.$$eval(".sf-lt td.chg", (a) => [...new Set(a.map((e) => getComputedStyle(e).animationName))]), ["sf-chg"], "by a paint-only background flash on the cell itself");
  eq(await m.page.$$eval(".sf-lt td.chg", (a) => [...new Set(a.map((e) => getComputedStyle(e, "::before").content + "|" + getComputedStyle(e).position + "|" + getComputedStyle(e).zIndex))]), ["none|static|auto"], "which adds no pseudo-element, no positioning and no stacking context, so a focus ring is never covered by the next cell");
  await m.page.waitForTimeout(2300);
  eq(await m.page.$$eval(".sf-lt td.chg, .sf-st td.chg, .hc.chg, .hr-f.chg", (a) => a.length), 0, "which leaves nothing behind");
  await m.page.focus('.sf-drill[data-scope="sector:Energy"]');
  const markupBefore = await m.page.$eval("#sfBody", (e) => e.innerHTML);
  second = false;
  await m.page.evaluate(() => { location.hash = ""; });
  await m.page.waitForFunction((b) => document.getElementById("sfBody").innerHTML !== b, markupBefore);
  await m.page.waitForTimeout(200);
  eq(await m.page.evaluate(() => document.activeElement && document.activeElement.dataset.scope), "sector:Energy", "a refresh that rebuilds the sector table hands focus back to the button that had it");
  await m.ctx.close();
}

const DEEP = realisticWorld(78, { tickers: 4, perName: 60 });
const BUSIEST = [...new Set(DEEP.rows.map((r) => r.t))].map((t) => [t, DEEP.rows.filter((r) => r.t === t).length]).sort((a, b) => b[1] - a[1])[0][0];
const DEEP_ROWS = respondWith(DEEP)(new URL("https://x.test/api/flows/ledger?scope=name%3A" + BUSIEST)).windows.rows.length;

{
  const crowded = realisticWorld(77, { tickers: 420, perName: 3 });
  const deep = DEEP;
  const rowsIn = (page, sel) => page.$$eval(sel, (a) => a.length);
  const seenIn = (page, sel) => page.$$eval(sel, (a) => a.filter((r) => getComputedStyle(r).display !== "none").length);
  const cutRows = (page) => page.$$eval(".sf-st tbody tr", (a) => a.filter((r) => getComputedStyle(r).display === "none").length);
  const phone = await mount(browser, 390, 664);
  await phone.page.click('#sfTabs [data-v="side"]');
  await phone.page.waitForTimeout(300);
  eq(await audit(phone.page), [], "390x664, Sectors tab: the short phone is one clean screen, with no row cut off silently");
  ok(await phone.page.$eval('.sf-drill[data-scope="sector:Communication Services"]', (b) => b.textContent === "Comm. services" && b.getAttribute("aria-label") === "Open Communication Services"), "a long sector name is shortened on a phone and still named in full for a screen reader");
  const hidden = await cutRows(phone.page);
  ok(hidden > 0 && await phone.page.$eval("#sfAll", (b) => !b.hidden && b.textContent === "Show all 13"), `rows that do not fit are set aside (${hidden}) and a button names all 13`);
  eq(await phone.page.$eval(".sf-st tfoot th", (e) => e.textContent), COPY_TOTAL_ALL, "and the total says it counts every row, not only the rows shown");
  await phone.page.click("#sfAll");
  eq(await seenIn(phone.page, "#sfAllBody .sf-st tbody tr"), 13, "the dialog lists all thirteen rows");
  eq(await phone.page.$eval("#sfAllBody .sf-st tfoot th", (e) => e.textContent), "Total", "and its total is the plain total");
  await phone.page.keyboard.press("Escape");
  eq(await phone.page.evaluate(() => document.activeElement && document.activeElement.id), "sfAll", "Escape returns focus to the button");
  await phone.ctx.close();

  const busiest = BUSIEST;
  for (const [w, h] of [[1440, 820], [1024, 768], [390, 844], [390, 664]]) {
    const names = await mount(browser, w, h, { world: crowded, hash: "#scope=sector%3ATechnology" });
    if (w < 900) { await names.page.click('#sfTabs [data-v="side"]'); await names.page.waitForTimeout(300); }
    eq(await audit(names.page), [], `${w}x${h}: the ten largest names of a sector are one clean screen`);
    await names.ctx.close();
    const win = await mount(browser, w, h, { world: deep, hash: "#scope=name%3A" + busiest });
    if (w < 900) { await win.page.click('#sfTabs [data-v="side"]'); await win.page.waitForTimeout(300); }
    const view = expected(deep, "/api/flows/ledger?scope=name%3A" + busiest);
    const total = view.windows.rows.length;
    eq(await audit(win.page), [], `${w}x${h}: a name with ${total} rows of windows is one clean screen`);
    const shown = (await rowsIn(win.page, ".sf-st tbody tr")) - (await cutRows(win.page));
    ok(total >= 12 && shown >= 3 && shown < total, `${w}x${h}: ${shown} of ${total} window rows are shown, the rest are behind Show all`);
    ok(await win.page.$eval("#sfAll", (b) => !b.hidden && /^Show all \d+$/.test(b.textContent)), `${w}x${h}: and the button names how many there are`);
    await win.page.click("#sfAll");
    eq(await seenIn(win.page, "#sfAllBody .sf-st tbody tr"), total, `${w}x${h}: and the dialog shows every window`);
    await win.page.keyboard.press("Escape");
    await win.ctx.close();
  }
}

{
  const plants = [
    ["a proven fill drawn to R instead of R minus W", "js", [["if (verdict === \"above\") fill = { x: 0, width: u(c - w) };", "if (verdict === \"above\") fill = { x: 0, width: u(c) };"]], async (page) => { const g = await page.evaluate(() => [...document.querySelectorAll(".sf-st tbody tr")].map((tr) => { const f = tr.querySelector(".sf-fo.up"); const b = tr.querySelector(".sf-bd"); const k = tr.querySelector(".sf-tk"); return f ? [Number(f.getAttribute("width")), Number(k.getAttribute("x1")), Number(b.getAttribute("x"))] : null; }).filter(Boolean)); return g.length > 0 && g.every(([w, tick, lo]) => Math.abs(w - lo) < 0.02); }],
    ["a fill under an undetermined verdict", "js", [["let fill = null;\n    if (verdict === \"above\")", "let fill = verdict === \"undetermined\" ? { x: 0, width: u(c) } : null;\n    if (verdict === \"above\")"]], async (page) => (await page.$$eval("td.tl[data-v=undetermined] .sf-fo", (a) => a.length)) === 0],
    ["the verdict glyph left out of the cell", "js", [["'</span><span class=\"vd\"><i aria-hidden=\"true\">' + esc(cell.glyph) + '</i><em> '", "'</span><span class=\"vd\"><i aria-hidden=\"true\"></i><em> '"]], async (page) => (await page.$$eval("td.tl .vd i", (a) => a.every((x) => x.textContent.length > 0)))],
    ["an absent figure drawn as a zero", "js", [["const text = absent ? DASH : cell.t;", 'const text = absent ? "0" : cell.t;']], async (page) => (await page.$$eval(".sf-lt td.a", (a) => a.length > 0 && a.every((x) => x.textContent.trim() === "—")))],
    ["net before balancing drawn without its sign flipped", "js", [["const body = L.rows.slice(0, 10).concat([{ ...L.net, always: true }", "const body = L.rows.slice(0, 10).concat([{ ...L.rows[10], label: L.net.label, hover: L.net.hover, always: true }"]], async (page) => { const rows = await page.$$eval(".sf-lt tbody tr", (a) => a.slice(-2).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()))); return rows[0].every((t, i) => t === rows[1][i] || (t === "0" && rows[1][i] === "0") || t === rows[1][i].replace("−", "").replace(/^(?!−)/, "−")) && rows[0].some((t, i) => t !== rows[1][i]); }],
    ["the period button loads even when it is unavailable", "js", [["if (period.getAttribute(\"aria-disabled\") === \"true\") { setNote(period.title || \"\", false); return; }", "if (false) { return; }"]], async (page, asked) => !asked.some((u) => u.includes("period=session"))],
    ["arrow widths not proportional", "js", [["return cents.map((c) => (max > 0 && c > 0 ? Math.max(ARROW_MIN, (cap * c) / max) : 0));", "return cents.map((c) => (max > 0 && c > 0 ? cap : 0));"]], async (page) => { const w = await page.$$eval(".fl-ar", (a) => a.map((x) => Number(x.dataset.w))); return new Set(w.filter((x) => x > 0)).size > 1; }, "#w=flow"],
    ["the summary line is a button even when empty or on a wide screen", "js", [["if (small() && el.textContent !== \"\") {", "if (true) {"]], async (page) => (await page.$eval("#sfCheckLine", (e) => e.getAttribute("role"))) === null],
    ["the sub-heading of the side-unknown rows left blank", "js", [["put(sub, L.groupRows.side.label);", 'put(sub, "");']], async (page) => (await page.$eval("tr.sub td", (e) => e.textContent)) === COPY.GROUP_ROWS.side.label],
    ["rows given padding they cannot fit, so the last ones are cut", "css", [[".sf-t th, .sf-t td { padding: 0 4px;", ".sf-t th, .sf-t td { padding: 12px 4px;"]], async (page) => (await audit(page)).length === 0],
    ["the row fitter switched off, so a long table is cut silently", "js", [["if (!table || !table.tBodies[0] || host.clientHeight === 0) return;", "return;"]], async (page) => (await audit(page)).length === 0, "#scope=name%3A" + BUSIEST, { mount: { world: DEEP } }],
    ["the total keeps its plain name when rows are set aside", "js", [["if (foot) foot.cells[0].textContent = WORDS.totalAll;", "if (foot) foot.cells[0].textContent = WORDS.total;"]], async (page) => { await page.click('#sfTabs [data-v="side"]'); await page.waitForTimeout(300); return (await page.$eval(".sf-st tfoot th", (e) => e.textContent)) === COPY_TOTAL_ALL; }, "", { w: 390, h: 664 }],
    ["the dialog holds only the rows that were shown", "js", [["$(\"sfAllBody\").innerHTML = S.sideHtml;", "$(\"sfAllBody\").innerHTML = $(\"sfBody\").innerHTML;"]], async (page) => { await page.click("#sfAll"); return (await page.$$eval("#sfAllBody .sf-st tbody tr", (a) => a.filter((r) => getComputedStyle(r).display !== "none").length)) === DEEP_ROWS; }, "#scope=name%3A" + BUSIEST, { mount: { world: DEEP } }],
    ["the flow view keeps its node boxes on a short phone, so the lanes are squeezed", "css", [[".fl-node { display: none; }", ".fl-node { display: flex; }"]], async (page) => { await page.click('#sfTabs [data-v="side"]'); await page.waitForTimeout(300); await page.click('#sfView [data-w="flow"]'); await page.waitForTimeout(300); return (await audit(page)).length === 0; }, "", { w: 390, h: 664 }],
    ["an old read overwriting a newer one", "js", [["if (seq !== S.seq) return null;\n        freshFrom(res, body);", "freshFrom(res, body);"]], null],
    ["the sheet lets the page scroll", "css", [[".flows-body[data-flows-page=\"ledger\"] .flows-main {\n  --sf-pad-b: var(--sp-4);\n  height: 100vh;\n  height: 100svh;\n  height: 100dvh;\n  padding-bottom: var(--sf-pad-b);\n  display: flex;\n  flex-direction: column;\n  overflow-x: hidden;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n}", ".flows-body[data-flows-page=\"ledger\"] .flows-main {\n  --sf-pad-b: var(--sp-4);\n  padding-bottom: var(--sf-pad-b);\n}"], [".sf { --sf-gap: 8px; flex: 1; min-height: 0; display: flex;", ".sf { --sf-gap: 8px; flex: 1; min-height: 130vh; display: flex;"]], async (page) => (await audit(page)).length === 0],
    ["the hatched span drawn out to the end of the interval instead of its width", "js", [['at("u", pc(lo), pc(hi - lo));', 'at("u", pc(lo), pc(hi));']], async (page) => { const d = await heroDom(page); const { U, T } = heroCents(expected(world, "/api/flows/ledger?scope=all")); return Math.abs(d.u[1] / d.width - U / T) < 0.002; }],
    ["a stated-side tick drawn when no side is stated", "js", [['tk.style.display = L.tick === null ? "none" : "";', 'tk.style.display = "";']], async (page) => (await heroDom(page)).tick === null, "", { mount: { world: BARE } }],
    ["the last poll never goes late", "js", [["if (age >= late) {", "if (false) {"]], async (page) => { await page.route("**/api/flows/now*", (r) => r.abort()); await page.route("**/api/flows/ledger*", (r) => r.abort()); await page.clock.runFor(100000); return (await page.$eval('#sfStrip [data-k="poll"]', (e) => e.dataset.s)) === "stale"; }, "", { mount: { clock: "2026-10-23T14:50:00Z", phase: { phase: "rth", endsAt: "2026-10-23T20:00:00Z" } } }],
    ["every figure flashes on the first read", "js", [["return put(td, text) && was !== undefined && was !== \"pending\";", "return put(td, text);"], ["const quiet = S.key !== key;", "const quiet = false;"]], async (page) => (await page.$$eval(".sf-lt td.chg", (a) => a.length)) === 0],
    ["a new view flashes like a refresh", "js", [["const quiet = S.key !== key;", "const quiet = false;"]], async (page) => { await page.click('.sf-drill[data-scope="sector:Energy"]'); await page.waitForFunction(() => document.getElementById("sfSideT").textContent === "Names"); return (await page.$$eval("td.chg", (a) => a.length)) === 0; }],
    ["a see-through strip floats over the panels and takes no clicks", "css", [[".sf-strip { display: flex; flex: none;", ".sf-strip { position: fixed; right: 12px; bottom: 140px; width: 70%; pointer-events: none; z-index: 4; display: flex; flex: none;"]], async (page) => (await obscured(page)).length === 0],
    ["the strip floats over the panels and covers what can take focus", "css", [[".sf-strip { display: flex; flex: none;", ".sf-strip { position: fixed; right: 12px; bottom: 140px; width: 70%; background: var(--mat-opaque); z-index: 4; display: flex; flex: none;"]], async (page) => (await obscured(page)).length === 0],
    ["a rebuilt sector table drops the keyboard's place", "js", [["if (back) back.focus({ preventScroll: true });", ""]], async (page) => { await page.focus('.sf-drill[data-scope="sector:Energy"]'); const before = await page.$eval("#sfBody", (e) => e.innerHTML); flipped = true; await page.evaluate(() => { location.hash = "#period=intraday"; }); await page.waitForFunction((b) => document.getElementById("sfBody").innerHTML !== b, before); await page.waitForTimeout(200); return (await page.evaluate(() => document.activeElement && document.activeElement.dataset.scope)) === "sector:Energy"; }, "", { mount: { respond: (u) => respondWith(flipped ? BUMPED : world)(u) } }],
    ["an undecided sign left silent for a screen reader", "js", [["'</span><span class=\"visually-hidden\">, ' + esc(pf[1].toLowerCase()) + \"</span>\" : \"\") + \"</td>\";", "'</span>' : \"\") + \"</td>\";"]], async (page) => (await page.$$eval(".sf-st td.c-taker .visually-hidden", (a) => a.length)) > 0],
    ["the ledger slot scrolls but tells no keyboard", "js", [['attr(mat, "tabindex", "0");', 'mat.removeAttribute("tabindex");']], async (page) => { await page.setViewportSize({ width: 1000, height: 540 }); await page.waitForTimeout(300); return (await page.$eval("#sfMatrix", (e) => e.scrollHeight > e.clientHeight + 1 && e.getAttribute("tabindex") === "0")); }],
    ["the label column squeezed", "css", [["@media (min-width: 1280.01px) {\n  .sf-lt .gr > td:first-child, .sf-lt .corner { width: 30%; }", "@media (min-width: 1280.01px) {\n  .sf-lt .gr > td:first-child, .sf-lt .corner { width: 6%; }"]], async (page) => (await audit(page)).length === 0],
    ["the sector column squeezed", "css", [[".sf-st th:first-child { width: 28%; }\n  .sf-st .h-taker, .sf-st .c-taker { width: 13%; }", ".sf-st th:first-child { width: 6%; }\n  .sf-st .h-taker, .sf-st .c-taker { width: 13%; }"]], async (page) => (await audit(page)).length === 0],
  ];
  for (const [title, kind, transforms, holds, hash, extra] of plants) {
    let js = JS, css = CSS;
    for (const [from, to] of transforms) {
      const target = kind === "js" ? js : css;
      eq(target.split(from).length - 1, 1, `planted build "${title}" applies exactly once`);
      if (kind === "js") js = js.replace(from, () => to); else css = css.replace(from, () => to);
    }
    const m = await mount(browser, (extra && extra.w) || 1440, (extra && extra.h) || 820, { js, css, hash: hash || "", settle: 150, ...((extra && extra.mount) || {}) }).catch((error) => { throw new Error(`planted build "${title}" did not load: ${error.message.split("\n")[0]}`); });
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
