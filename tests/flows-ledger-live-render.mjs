import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { createLiveLedger } from "../shared/flows-ledger-live.js";
import { moneyShort } from "../shared/flows-sfc-display.js";
import { fingerprintOf } from "../shared/flows-ledger-book.js";
import { parseScope } from "../shared/flows-sfc-view.js";
import { mulberry32, between } from "./lib/sfc-rng.mjs";
import { expectedHeld, project } from "./lib/ledger-stream.mjs";
import { mountLive, liveWorld, serverBook, streamRow, HTML, HTML_OFF, NOW, ROOT } from "./lib/ledger-live-world.mjs";
import { lintText, htmlToText } from "./lib/copy-lint.mjs";
import { MINUS, DASH, SIZES, COLOUR_LITERAL, LIVE_JS, CTL_JS, LIVE_CSS, once, PERF_HOOK, statusOf, mount, mountHooked, shownLedger, expectedLedger, num, audit, expected, Sim } from "./lib/ledger-live-rig.mjs";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const browser = await launch();

{
  ok(/<i hidden data-defer="ledger-live" data-src="\/assets\/js\/flows-rt\.js\?v=\d+" data-css="\/assets\/css\/flows-sfc-live\.css\?v=\d+"><\/i>/.test(HTML), "a live page declares the rail first, with the strip's sheet riding on it");
  const order = [...HTML.matchAll(/data-defer="ledger-live" data-src="([^"?]+)/g)].map((x) => x[1]);
  eq(order, ["/assets/js/flows-rt.js", "/assets/js/flows-ledger.bundle.js", "/assets/js/flows-sfc-live.js"], "then the bundle, then the glue: the group runs in this order");
  ok(!/ledger-live/.test(HTML_OFF) && HTML_OFF === PAGES.ledgerPage({ username: "test" }), "a page with the switch off carries none of it and is the page it always was");
  ok(!COLOUR_LITERAL.test(LIVE_CSS), "the live sheet holds no colour literal: tokens only");
  ok(!/\/\*|(^|[^:"'`])\/\/\s/.test(LIVE_CSS + LIVE_JS), "and no comment in the sheet or the script");
  ok(!/\btape\b/i.test(LIVE_JS + LIVE_CSS), "the word tape is nowhere in them");
  ok(!/(^|[^-\w])transition\b/.test(LIVE_CSS) && !/animation|@keyframes|data-flash/.test(LIVE_CSS), "the live sheet moves nothing itself: the change highlight is the controller's");
  const literals = [...LIVE_JS.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1] ?? m[2])
    .filter((x) => x.split(/\s+/).filter((w) => /^[A-Za-z]{2,}/.test(w)).length >= 3 && !/[<>=;{}[\]#]/.test(x));
  eq(literals.flatMap((s) => lintText(s).map((h) => `${h.rule} ${JSON.stringify(h.match)} :: ${s.slice(0, 70)}`)), [], "the glue's own sentences pass the copy rules");
}

{
  const m = await mount(browser, 1440, 820, { html: HTML_OFF, waitLive: false, settle: 1500 });
  eq(m.errors, [], "a page with the switch off loads clean");
  ok(!m.asked.some((u) => u.includes("part=book")), "it never asks for the book");
  eq(m.R.conns, 0, "and never opens the rail");
  eq(await m.page.evaluate(() => typeof window.FlowsUI.ledgerLive), "undefined", "no live module is loaded");
  eq(await m.page.evaluate(() => typeof window.FlowsUI.rt), "undefined", "no rail client either");
  await m.ctx.close();
}

{
  for (const [w, h] of SIZES) {
    const m = await mount(browser, w, h, { settle: 300 });
    eq(m.errors, [], `${w}x${h}: no page error and no failed request`);
    eq(await audit(m.page), [], `${w}x${h}: one screen with the live strip, nothing clipped, nothing cut`);
    const st = await statusOf(m.page);
    eq([st.active, st.paused, st.parity.state, st.drift.count], [true, null, "ok", 0], `${w}x${h}: live, not paused, the server's hash matched and no drift`);
    eq(m.asked.filter((u) => u.includes("part=book")).length, 1, `${w}x${h}: one book read`);
    ok(/part=book&v=\d+/.test(m.asked.find((u) => u.includes("part=book"))), `${w}x${h}: stamped with the heartbeat's update time`);
    eq(m.R.conns, 1, `${w}x${h}: one socket`);
    const text = await m.page.textContent("#sfLive");
    ok(/Live/.test(text) && /Socket/.test(text), `${w}x${h}: the strip says Live and the transport: ${text.trim().slice(0, 60)}`);
    await m.ctx.close();
  }
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  eq(await m.page.getAttribute("#fxFresh", "data-state"), "live", "the pill says Live: the rail's flow entry is primary and inside its window");
  const failures = [];
  for (let step = 0; step < 24; step++) {
    const n = between(sim.rnd, 1, 7);
    await sim.send(sim.rows(n));
    const mirror = sim.mirror();
    const view = mirror.view({ now: sim.readAt + 50, aligned: true });
    const rows = await shownLedger(m.page);
    const want = expectedLedger(view);
    const got = rows.map((r) => [r[0].t, ...r.slice(1).map((c) => c.t)]);
    if (JSON.stringify(got) !== JSON.stringify(want)) failures.push("step " + step + " cells differ");
    const grid = rows.slice(0, 10).concat(rows.slice(11)).map((r) => r.slice(1).map((c) => num(c.t)));
    if (!grid.every((r) => r.reduce((a, b) => a + b, 0) === 0)) failures.push("step " + step + " a row does not foot");
    for (let c = 0; c < 6; c++) if (grid.reduce((a, r) => a + r[c], 0) !== 0) failures.push("step " + step + " column " + c + " does not foot");
    const st = await statusOf(m.page);
    if (st.fingerprint !== mirror.fingerprint()) failures.push("step " + step + " fingerprint");
    const scratch = fingerprintOf(expectedHeld([...sim.base.rows.map((r) => ({ row: r, at: r.la ?? sim.base.readAt })), ...sim.steps.flatMap((s) => s.rows.map((row) => ({ row, at: s.readAt })))], 180));
    if (st.fingerprint !== scratch) failures.push("step " + step + " from-scratch fingerprint");
    if (st.drift.count !== 0) failures.push("step " + step + " drift");
    const scope = await m.page.textContent("#sfScope");
    if (scope.trim() !== view.scope.line.trim()) failures.push("step " + step + " scope line: " + scope);
    const checks = await m.page.$$eval("#sfChecks .sf-chk", (a) => a.map((x) => [x.dataset.id, x.dataset.state]));
    if (JSON.stringify(checks) !== JSON.stringify(view.checks.items.map((i) => [i.id, i.state]))) failures.push("step " + step + " checks");
  }
  eq(failures, [], "after each of 24 batches of arriving windows the displayed ledger is the one built from scratch, every row and column foots, the fingerprint equals an independent recompute, the scope line and the check chips agree, and drift stays zero");
  const st = await statusOf(m.page);
  ok(st.held.held === 180 && st.held.seen > 180, "the held set is the largest 180 of what the page has seen: " + st.held.seen);
  ok(st.counts.paints >= 12 && st.counts.rows > 60, "and the page painted for the batches that changed it: " + JSON.stringify(st.counts));
  eq(m.errors, [], "with a clean console");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  const rows = sim.rows(6);
  rows.forEach((r, i) => { r.ts = sim.readAt + 1000 - (1500 + i * 700); });
  await sim.send(rows);
  const readAt = sim.readAt;
  const lags = rows.map((r) => readAt - r.ts).sort((a, b) => a - b);
  const at = (q) => lags[Math.min(lags.length - 1, Math.max(0, Math.ceil(q * lags.length) - 1))];
  const st = await statusOf(m.page);
  eq([st.lag.n, st.lag.p50, st.lag.p95], [rows.length, at(0.5), at(0.95)], "vendor to hub is the hub's read time less each window's own stamp, p50 and p95 by nearest rank");
  const strip = await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip());
  const lagChip = strip.chips.find((c) => c.id === "lag").value;
  ok(new RegExp("^" + (at(0.5) / 1000).toFixed(1).replace(".", "\\.") + " s p50").test(lagChip) && /n 6$/.test(lagChip) && !/p95/.test(lagChip), "and the strip prints it, without a spread from six samples: " + lagChip);
  for (let i = 0; i < 4; i++) await sim.send(sim.rows(5));
  const wide = (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips.find((c) => c.id === "lag").value;
  ok(/ s p50 · [\d.]+ s p95 · n \d+$/.test(wide) && Number(/n (\d+)$/.exec(wide)[1]) >= 20, "and the spread once there are twenty: " + wide);
  await sim.send(sim.rows(2));
  await sim.send(sim.rows(2));
  const t = (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips.find((c) => c.id === "transit").value;
  ok(/^\+\d+\.\d s over best seen · n \d+ · estimate$/.test(t), "hub to screen is the excess over the best seen and says it is an estimate: " + t);
  const before = (await statusOf(m.page)).lag.n;
  m.R.send(m.R.hello(sim.rows(3)));
  await m.page.waitForTimeout(200);
  eq((await statusOf(m.page)).lag.n, before, "a snapshot's backlog is not a latency sample");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(3));
  const base = sim.readAt;
  const verdict = async () => (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).verdict.state;
  const beat = async (at, readAt) => {
    m.R.now = at;
    m.R.send(m.R.hb(readAt));
    await m.page.waitForTimeout(120);
  };
  eq(await verdict(), "live", "a hub read a moment ago is live");
  await beat(base + 10000, base + 9700);
  eq(await verdict(), "live", "ten seconds on, a heartbeat says the hub read again and found no window: still live, a quiet market is not a dead connection");
  await beat(base + 26000, base + 25800);
  eq(await verdict(), "live", "and so it stays for as long as the hub keeps reading");
  await beat(base + 45000, base + 25800);
  eq(await verdict(), "delayed", "a hub that has not read for twenty seconds is delayed, past the live window of 15 s");
  const text = (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips[0].value;
  ok(/hub read 19(\.\d)? s ago · live under 15 s$|hub read 2\d s ago · live under 15 s$/.test(text), "and says what the live window is: " + text);
  await beat(base + 100000, base + 25800);
  eq(await verdict(), "stale", "seventy-five seconds without a read is stale");
  ok(/figures to \d\d:\d\d:\d\d TRT$/.test((await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips[0].value), "with the time the figures are to");
  await beat(base + 101000, base + 100600);
  eq(await verdict(), "live", "a heartbeat that carries a fresh hub read makes it live again with no new window");
  await m.ctx.close();
}

{
  const m = await mountHooked(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(2));
  await m.page.waitForFunction(() => !document.querySelector("#sf .chg"), null, { timeout: 6000 });
  const before = await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip().verdict.state);
  const heldAtOnce = await m.page.evaluate(() => { window.__setHidden(true); return window.FlowsUI.ledgerLive.status().timers; });
  const st = await statusOf(m.page);
  eq([heldAtOnce, st.timers, st.hidden], [0, 0, true], "a hidden tab holds no timer of the live module, at the moment it is hidden and after");
  await m.page.evaluate(() => window.__watch(["#sfLive"]));
  await m.page.waitForTimeout(700);
  eq(await m.page.evaluate(() => { window.__unwatch(); return window.__muts.length; }), 0, "and the strip, whose age text ticks four times a second while the tab is shown, is not written once while it is hidden");
  eq((await statusOf(m.page)).timers, 0, "and none is armed afterwards");
  await m.page.evaluate(() => window.__watch(["#sf"]));
  m.R.now += 1000;
  m.R.send(m.R.delta(sim.rows(3), { readAt: sim.readAt + 500 }));
  await m.page.waitForTimeout(1500);
  const muts = await m.page.evaluate(() => { window.__unwatch(); return window.__muts.length; });
  eq(muts, 0, "frames that arrive while hidden write nothing: the browser does not run animation frames, and the page keeps no timer");
  await m.page.clock.setFixedTime(new Date(NOW + 40000));
  const asked = m.state.books;
  await m.page.evaluate(() => window.__setHidden(false));
  await m.page.waitForFunction(() => /caught up/.test(document.getElementById("sfLive").textContent), null, { timeout: 8000 });
  eq(m.state.books, asked + 1, "on return after more than twenty seconds the page refetches the book");
  const txt = await m.page.textContent("#sfLive");
  ok(/caught up \d\d:\d\d:\d\d TRT/.test(txt), "and says when it caught up: " + txt.trim());
  eq((await statusOf(m.page)).timers >= 1, true, "the timers are armed again");
  ok(before === "live", "it was live before");
  const held = (await statusOf(m.page)).held.entered;
  ok(held > 0, "and the rows that arrived while hidden were applied");
  await m.ctx.close();
}

{
  const m = await mountHooked(browser, 1440, 820, { settle: 300 });
  const sim = new Sim(m);
  await sim.send(sim.rows(2));
  await m.page.waitForFunction(() => !document.querySelector("#sf .chg"), null, { timeout: 6000 });
  await m.page.evaluate(() => window.__watch(["#sf"]));
  await m.page.waitForTimeout(3000);
  const quiet = await m.page.evaluate(() => { window.__unwatch(); const out = { live: 0, other: 0 }; for (const mu of window.__muts) { const t = mu.target.nodeType === 1 ? mu.target : mu.target.parentElement; if (t && t.closest("#sfLive")) out.live++; else out.other++; } return out; });
  eq(quiet.other, 0, "three seconds with no window: nothing outside the strip is written");
  ok(quiet.live <= 16, "and the strip is written at most four times a second: " + quiet.live);
  m.R.now = sim.readAt + 200000;
  m.R.send(m.R.hb(sim.readAt + 20000));
  await m.page.waitForTimeout(700);
  await m.page.evaluate(() => window.__watch(["#sf"]));
  await m.page.waitForTimeout(3000);
  const rest = await m.page.evaluate(() => { window.__unwatch(); return window.__muts.length; });
  ok(rest <= 2, "with the hub's last read minutes old the strip is written once a minute: " + rest);
  await m.ctx.close();
}

{
  const h = await mountHooked(browser, 1440, 820, { settle: 200 });
  const sim2 = new Sim(h);
  await sim2.send(sim2.rows(2));
  const snapshot = () => h.page.evaluate(() => [...document.querySelectorAll("#sfMatrix td, #sfMatrix th, #sfBody td, #sfBody th")].map((c) => c.innerHTML + "|" + (c.dataset.x || "") + "|" + (c.dataset.s || "") + "|" + (c.getAttribute("title") || "") + "|" + (c.getAttribute("aria-label") || "")));
  let worst = 0;
  const wrong = [];
  for (let i = 0; i < 8; i++) {
    const before = await snapshot();
    await h.page.evaluate(() => window.__watch(["#sfMatrix", "#sfBody"]));
    const rows = sim2.rows(between(sim2.rnd, 1, 3));
    await sim2.send(rows);
    await h.page.waitForTimeout(80);
    const after = await snapshot();
    const report = await h.page.evaluate(() => {
      window.__unwatch();
      const cells = new Set();
      let structural = 0;
      for (const mu of window.__muts) {
        if (mu.type === "attributes" && mu.attributeName === "data-flash") continue;
        if (mu.type === "childList") structural += mu.addedNodes.length + mu.removedNodes.length;
        const el = mu.target.nodeType === 1 ? mu.target : mu.target.parentElement;
        const cell = el && el.closest("td, th");
        if (cell) cells.add([...document.querySelectorAll("#sfMatrix td, #sfMatrix th, #sfBody td, #sfBody th")].indexOf(cell));
      }
      return { cells: [...cells].sort((a, b) => a - b), structural };
    });
    const changed = [];
    before.forEach((t, j) => { if (t !== after[j]) changed.push(j); });
    if (before.length !== after.length) wrong.push("the number of cells moved");
    if (JSON.stringify(changed) !== JSON.stringify(report.cells)) wrong.push(`step ${i}: changed ${JSON.stringify(changed)} against written ${JSON.stringify(report.cells)}`);
    worst = Math.max(worst, changed.length);
  }
  eq(wrong, [], "the cells the page writes are exactly the cells whose figure changed: no other cell is touched");
  ok(worst > 0, "and some cells did change: " + worst);
  await h.ctx.close();
}

await browser.close();
console.log(`✓ flows-ledger-live-render: ${checks} assertions`);
