import assert from "node:assert/strict";
import { chromium, webkit, firefox } from "playwright";
import { launch } from "./lib/browser.mjs";
import { mount, SAMPLER, HTML, JS, CSS, realisticWorld, respondWith } from "./lib/sfc-render-world.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const SIZES = [[2560, 1440], [1920, 1080], [1440, 820], [1024, 768], [390, 844], [390, 664]];
const MOTION = { reducedMotion: "no-preference" };
const MAX_ROW = (w) => (w < 900 ? 44 : 36);
const HEAD = (w) => (w < 900 ? 28 : 44);

const engines = [["chromium", await launch()]];
for (const [name, type] of [["webkit", webkit], ["firefox", firefox]]) {
  try {
    engines.push([name, await type.launch()]);
  } catch (error) {
    if (process.env.SFC_ENGINES === "all") throw new Error(`${name} is required (SFC_ENGINES=all) and did not launch: ${String(error.message).split("\n")[0]}`);
    console.log(`  skipped ${name}: not installed (set SFC_ENGINES=all to require it)`);
  }
}

const sweep = process.env.SFC_PLANTS_ONLY === "1" ? [] : engines;

const drift = (a, b) => {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === null) !== (b[i] === null)) return Infinity;
    if (a[i] === null) continue;
    for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
  }
  return worst;
};

const trace = async (page) => page.evaluate(() => window.__fp.frames);

const judge = (frames, label) => {
  const before = frames.filter((f) => f.state !== "ok");
  const after = frames.filter((f) => f.state === "ok");
  ok(before.length >= 2, `${label}: the table is laid out in at least two frames before any data (${before.length})`);
  ok(after.length >= 2, `${label}: and drawn for at least two frames after it (${after.length})`);
  const t0 = after[0].t;
  ok(after[after.length - 1].t - t0 >= 1200, `${label}: and watched for 1.2 s past the first data frame`);
  const first = frames[0];
  const worst = { boxes: 0, ledger: 0, sectors: 0, slots: 0, spread: 0 };
  for (const f of frames) {
    for (const k of ["boxes", "ledger", "sectors", "slots"]) worst[k] = Math.max(worst[k], drift(first[k], f[k]));
    worst.spread = Math.max(worst.spread, ...f.spread);
  }
  return { worst, last: frames[frames.length - 1], before, after };
};

const sections = `(tb) => [...tb.children].filter((e) => /^(THEAD|TBODY|TFOOT)$/.test(e.tagName)).reduce((a, e) => a + e.getBoundingClientRect().height, 0)`;

const probeLedger = (page) => page.evaluate(`(() => {
  const sections = ${sections};
  const t = document.querySelector(".sf-lt");
  const m = document.querySelector(".sf-mat");
  const vis = (el) => el.getClientRects().length > 0;
  const rows = [...t.tBodies[0].rows].filter(vis);
  const hs = rows.map((r) => r.getBoundingClientRect().height);
  const head = t.tHead.getBoundingClientRect();
  const body = t.tBodies[0].getBoundingClientRect();
  const clipped = [...t.querySelectorAll("th, td")].filter((c) => vis(c) && (c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1)).length;
  return {
    seam: body.top - head.bottom, head: head.height, lo: Math.min(...hs), hi: Math.max(...hs), n: hs.length,
    over: t.getBoundingClientRect().bottom - m.getBoundingClientRect().bottom, clipped,
    scroll: document.scrollingElement.scrollHeight - innerHeight, top: body.top,
    spread: Math.abs(t.getBoundingClientRect().height - sections(t)),
  };
})()`);

const probeSector = (page) => page.evaluate(`(() => {
  const sections = ${sections};
  const vis = (el) => el.getClientRects().length > 0;
  const sector = document.querySelector(".sf-st");
  const srows = [...sector.tBodies[0].rows].filter(vis).map((r) => r.getBoundingClientRect().height);
  return { slo: Math.min(...srows), shi: Math.max(...srows), sn: srows.length, sspread: Math.abs(sector.getBoundingClientRect().height - sections(sector)) };
})()`);

const probe = async (page) => {
  const phone = await page.evaluate(() => matchMedia("(max-width:899px)").matches);
  if (phone) await page.click('#sfTabs [data-v="ledger"]');
  const ledger = await probeLedger(page);
  if (phone) await page.click('#sfTabs [data-v="side"]');
  const sector = await probeSector(page);
  if (phone) await page.click('#sfTabs [data-v="ledger"]');
  return { ...ledger, ...sector, spread: Math.max(ledger.spread, sector.sspread) };
};

const HOLD_MS = 700;

const hold = async (page) => {
  const t0 = Date.now();
  for (;;) {
    const n = await page.evaluate(() => (window.__fp ? window.__fp.frames.filter((f) => f.state === "loading").length : 0)).catch(() => 0);
    if ((n >= 4 && Date.now() - t0 >= HOLD_MS) || Date.now() - t0 > 20000) return;
    await new Promise((done) => setTimeout(done, 40));
  }
};

const run = async (name, browser, w, h, o = {}) => {
  const m = await mount(browser, w, h, { init: SAMPLER, hold, fontDelay: 600, settle: 100, context: MOTION, ...o });
  await m.page.waitForFunction(() => { const f = window.__fp.frames; const first = f.find((x) => x.state === "ok"); return first && f[f.length - 1].t - first.t >= 1300; }, null, { timeout: 30000 });
  const frames = await trace(m.page);
  return { m, frames, label: `${name} ${w}x${h}` };
};

{
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  const walk = (src) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
      const head = src.slice(i, open).trim();
      const body = src.slice(open + 1, j - 1);
      if (/^@(media|supports|container|layer)/.test(head)) walk(body); else blocks.push([head, body]);
      i = j;
    }
  };
  walk(css);
  const BOX = /(^|[\s>+~,])(?:table|thead|tbody|tfoot|\.sf-t|\.sf-lt|\.sf-st)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*\s*$/;
  const bad = (sheet) => sheet.filter(([head, body]) => head.split(",").some((s) => BOX.test(s.trim())) && /(?:^|[;\s])(?:min-|max-)?height\s*:\s*(?!\s|auto\b|0\b)/.test(body)).map(([head]) => head);
  eq(bad(blocks), [], "no table, section or table class has a height other than auto: that is what leaves a blank band in WebKit and stretches rows in Chromium");
  ok(bad([...blocks, [".sf-lt", "height: 100%;"]]).length === 1 && bad([...blocks, ["tbody", "min-height: 20px;"]]).length === 1, "and the scan catches a planted percentage and a planted minimum");
  ok(blocks.some(([head, body]) => /\.sf-lt tbody tr/.test(head) && /cqh/.test(body)), "the ledger's row height comes from the slot it sits in, in container units");
  ok(/\.sf-mat[^{]*\{[^}]*container-type:\s*size/.test(css), "and that slot is a size container");
  const writesHeight = (src) => /\.style\.(?:min|max)?[hH]eight\s*=|setProperty\(\s*["'](?:min-|max-)?height["']/.test(src);
  ok(!writesHeight(JS), "the controller never writes a height onto any node: no table, row or slot is sized from script");
  ok(writesHeight(JS + '\ntable.style.height = "100%";') && writesHeight(JS + '\nrow.style.setProperty("height", "20px");'), "and the scan catches a planted write of either kind");
}

for (const [name, browser] of sweep) {
  for (const [w, h] of SIZES) {
    const { m, frames, label } = await run(name, browser, w, h);
    const j = judge(frames, label);
    ok(j.worst.boxes <= 1, `${label}: no panel, row or strip moves by more than 1 px from the first paint to 1.2 s after the data (${j.worst.boxes.toFixed(2)})`);
    ok(j.worst.ledger <= 1, `${label}: no row of the ledger moves by more than 1 px, and its height holds (${j.worst.ledger.toFixed(2)})`);
    ok(j.worst.sectors <= 1, `${label}: nor a row of the sector table (${j.worst.sectors.toFixed(2)})`);
    eq(await m.page.evaluate(() => window.__fp.styled), [], `${label}: no node is ever given a height, a minimum or a maximum in an inline style`);
    ok(j.worst.slots <= 0.01, `${label}: the slot that holds each table keeps its exact size from the first frame to 1.2 s after the data (${j.worst.slots.toFixed(3)} px), because a row height cut from it flips whole rows when it moves by one pixel`);
    ok(j.worst.spread <= 0.5, `${label}: no table's height is spread into a band beyond the sum of its head, body and foot (${j.worst.spread.toFixed(2)} px)`);
    ok(frames.every((f) => f.scroll <= 0), `${label}: the page never scrolls`);
    eq(j.last.anim, 0, `${label}: no animation is still running 1.2 s after the data`);
    const g = await probe(m.page);
    ok(g.seam <= 0.5 && g.seam >= -0.5, `${label}: no gap between the head and the first row (${g.seam.toFixed(2)} px)`);
    ok(Math.abs(g.head - HEAD(w)) <= 1, `${label}: the head keeps its ${HEAD(w)} px (${g.head.toFixed(1)})`);
    ok(g.hi - g.lo <= 1.01, `${label}: the ledger's rows are one height (${g.lo.toFixed(1)} to ${g.hi.toFixed(1)})`);
    ok(g.hi <= MAX_ROW(w) + 0.01, `${label}: and none is taller than ${MAX_ROW(w)} px (${g.hi.toFixed(1)})`);
    ok(g.over <= 0.5, `${label}: the table ends inside its slot (${g.over.toFixed(1)})`);
    eq(g.clipped, 0, `${label}: no cell is cut`);
    ok(g.spread <= 0.5, `${label}: and no table has a height beyond its sections (${g.spread.toFixed(2)})`);
    ok(g.shi <= MAX_ROW(w) + 0.01, `${label}: no sector row is taller than ${MAX_ROW(w)} px (${g.shi.toFixed(1)})`);
    await m.ctx.close();
  }
}

for (const [name, browser] of sweep) {
  for (const [w, h] of [[1920, 1080], [1440, 820], [390, 844]]) {
    const m = await mount(browser, w, h, { context: MOTION, settle: 600 });
    const label = `${name} ${w}x${h}`;
    const g0 = await probe(m.page);
    for (let i = 0; i < 5; i++) {
      await m.page.setViewportSize({ width: w, height: h + 3 });
      await m.page.setViewportSize({ width: w, height: h });
    }
    await m.page.evaluate(() => { const t = document.querySelector(".sf-lt"); t.style.display = "none"; void t.offsetHeight; t.style.display = ""; });
    const g1 = await probe(m.page);
    ok(Math.abs(g1.top - g0.top) <= 0.5 && Math.abs(g1.seam - g0.seam) <= 0.5 && Math.abs(g1.hi - g0.hi) <= 0.5, `${label}: five viewport nudges and a display toggle leave the table where it was (${g0.top.toFixed(1)} to ${g1.top.toFixed(1)})`);
    ok(g1.seam <= 0.5, `${label}: and still no gap under the head (${g1.seam.toFixed(2)})`);
    await m.ctx.close();
  }
}

for (const [name, browser] of sweep) {
  const label = `${name} 1440x820`;
  const m = await mount(browser, 1440, 820, { context: MOTION, settle: 500 });
  await m.page.evaluate(() => {
    const tds = [...document.querySelectorAll(".sf-lt td.c:not(.b)")];
    window.__keep = { td: tds[3], th: document.querySelector(".sf-lt tbody th"), tr: document.querySelector(".sf-lt tbody tr"), table: document.querySelector(".sf-lt"), side: document.querySelector(".sf-st tbody tr") };
    tds[3].focus();
    window.__writes = 0;
    new MutationObserver((list) => { window.__writes += list.length; }).observe(document.getElementById("sfMatrix"), { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const rect0 = await m.page.evaluate(() => { const r = window.__keep.td.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const asked = m.asked.length;
  await m.page.evaluate(() => { location.hash = "#period=intraday"; });
  for (let i = 0; i < 100 && !m.asked.slice(asked).some((u) => u.startsWith("/api/flows/ledger")); i++) await m.page.waitForTimeout(50);
  await m.page.waitForSelector("#sf[data-busy='false']");
  await m.page.waitForTimeout(300);
  const after = await m.page.evaluate(() => ({
    connected: [window.__keep.td, window.__keep.th, window.__keep.tr, window.__keep.table].map((e) => e.isConnected),
    focused: document.activeElement === window.__keep.td,
    writes: window.__writes,
    rect: (() => { const r = window.__keep.td.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })(),
  }));
  eq(after.connected, [true, true, true, true], `${label}: a refresh keeps the very cells, rows and table it started with`);
  ok(after.focused, `${label}: and the focused cell keeps focus`);
  eq(after.writes, 0, `${label}: an unchanged refresh writes nothing into the ledger`);
  ok(drift([rect0], [after.rect]) <= 0.01, `${label}: and moves nothing`);
  await m.ctx.close();
}

{
  const [name, browser] = engines[0];
  const big = realisticWorld(20261023, { magnitude: 6.4 });
  const m = await mount(browser, 1440, 820, { context: MOTION, settle: 400 });
  const cols0 = await m.page.$$eval(".sf-lt tbody tr:not(.sub):last-child td", (a) => a.map((td) => { const r = td.getBoundingClientRect(); return [r.left, r.width]; }));
  await m.page.route("**/api/flows/ledger*", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(respondWith(big)(new URL(route.request().url()))) }));
  await m.page.click("#sfPeriod [data-p=intraday]");
  await m.page.waitForSelector("#sf[data-busy='false']");
  await m.page.waitForTimeout(300);
  const cols1 = await m.page.$$eval(".sf-lt tbody tr:not(.sub):last-child td", (a) => a.map((td) => { const r = td.getBoundingClientRect(); return [r.left, r.width]; }));
  const text = await m.page.$$eval(".sf-lt tbody tr:not(.sub):last-child td", (a) => a.map((td) => td.textContent));
  ok(cols0.every(([l, wd], i) => Math.abs(l - cols1[i][0]) <= 0.5 && Math.abs(wd - cols1[i][1]) <= 0.5), `${name}: a second poll with larger figures leaves every column where it was: ${text.join(" ")}`);
  await m.ctx.close();
}

const plants = [
  ["height:100% restored on the ledger table", "css", [["line-height: 16px; height: auto; }", "line-height: 16px; height: 100%; }"]], (g) => g.hi > MAX_ROW(2560) + 0.01 || g.seam > 0.5, 2560, 1440],
  ["the slot is no size container", "css", [[".sf-mat, .sf-body { flex: 1 1 0; min-height: 0; position: relative; padding: 0 10px; overflow: hidden; container-type: size; }", ".sf-mat, .sf-body { flex: 1 1 0; min-height: 0; position: relative; padding: 0 10px; overflow: hidden; }"]], (g) => g.over > 0.5 || g.clipped > 0 || g.hi > MAX_ROW(1440)],
  ["the row cap removed", "css", [["--lt-max: 36px;", "--lt-max: 400px;"]], (g) => g.hi > MAX_ROW(1440) + 0.01, 2560, 1440],
  ["the head given the height of a row", "css", [[".sf-lt thead tr:last-child :is(th, td) { height: 28px; }\n.sf-lt .gr th {", ".sf-lt thead tr:last-child :is(th, td) { height: 60px; }\n.sf-lt .gr th {"]], (g) => Math.abs(g.head - 44) > 1],
];
{
  const [name, browser] = engines[0];
  for (const [title, kind, transforms, holds, pw, ph] of plants) {
    let js = JS, css = CSS;
    for (const [from, to] of transforms) {
      const target = kind === "js" ? js : css;
      eq(target.split(from).length - 1, 1, `planted build "${title}" applies exactly once`);
      if (kind === "js") js = js.replace(from, () => to); else css = css.replace(from, () => to);
    }
    const m = await mount(browser, pw || 1440, ph || 820, { js, css, context: MOTION, settle: 400 });
    const g = await probe(m.page);
    ok(holds(g), `planted build "${title}" is caught (${JSON.stringify({ hi: +g.hi.toFixed(1), seam: +g.seam.toFixed(1), over: +g.over.toFixed(1), head: +g.head.toFixed(1) })})`);
    await m.ctx.close();
  }
}

{
  const [name, browser] = engines[0];
  const anchor = 'if (S.cell && S.cell.isConnected && line.dataset.on && S.cell.dataset.m) put(line, S.cell.dataset.m + ": " + S.cell.dataset.x);\n    armGrid(table);';
  eq(JS.split(anchor).length - 1, 1, 'planted build "the controller sizes the table from script" applies exactly once');
  const { m } = await run(name, browser, 1440, 820, { js: JS.replace(anchor, () => anchor + '\n    table.style.height = "100%";') });
  const styled = await m.page.evaluate(() => window.__fp.styled);
  ok(styled.length > 0, `planted build "the controller sizes the table from script" is caught: ${styled[0]}`);
  await m.ctx.close();
}

{
  const [name, browser] = engines[0];
  const from = ".sf-read { display: flex; height: 64px; }";
  eq(CSS.split(from).length - 1, 1, 'planted build "a panel whose height follows its text" applies exactly once');
  const { frames, m } = await run(name, browser, 1920, 1080, { css: CSS.replace(from, () => ".sf-read { display: flex; min-height: 24px; }") });
  const j = judge(frames, "planted panel");
  ok(j.worst.slots > 0.01 || j.worst.sectors > 1 || j.worst.boxes > 1, `planted build "a panel whose height follows its text" is caught: the slot moved ${j.worst.slots.toFixed(2)} px when the data arrived`);
  await m.ctx.close();
}

{
  const [name, browser] = engines[0];
  const planted = [
    ["no table in the served page: it appears only with the data", HTML.replace(/<div class="sf-mat" id="sfMatrix">[\s\S]*?<\/table><\/div>/, '<div class="sf-mat" id="sfMatrix"></div>'), (frames) => frames.length === 0 || frames.filter((f) => f.state !== "ok").length < 3],
    ["the check chips are drawn only when the data arrives", HTML, (frames) => frames.length === 0 || drift(frames[0].boxes, frames[frames.length - 1].boxes) > 1, [".sf-checkrow { display: flex; align-items: center; gap: 4px 12px; flex: none; min-width: 0; min-height: 26px; }", ".sf-checkrow { display: flex; align-items: center; gap: 4px 12px; flex: none; min-width: 0; }\n.sf[data-state=\"loading\"] .sf-checks { display: none; }"]],
    ["the sector table is a stub with one row", HTML.replace(/(<table class="sf-t sf-st"[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/, '$1<tr data-k="x"><th scope="row">x</th><td>—</td></tr>$2'), (frames) => frames.length === 0 || drift(frames[0].sectors, frames[frames.length - 1].sectors) > 1],
  ];
  for (const [title, html, caught, sheet] of planted) {
    if (sheet) eq(CSS.split(sheet[0]).length - 1, 1, `planted build "${title}" changes the sheet exactly once`);
    const m = await mount(browser, 1440, 820, { init: SAMPLER, delay: 1200, fontDelay: 600, settle: 2500, context: MOTION, html, css: sheet ? CSS.replace(sheet[0], () => sheet[1]) : undefined }).catch(() => null);
    const frames = m ? await trace(m.page).catch(() => []) : [];
    ok(caught(frames), `planted build "${title}" is caught`);
    if (m) await m.ctx.close();
  }
}

for (const [, browser] of engines) await browser.close();
console.log(`✓ flows-sfc-firstpaint: ${checks} assertions on ${engines.map(([n]) => n).join(", ")}`);
