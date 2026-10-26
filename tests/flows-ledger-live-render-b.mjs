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
  const m = await mount(browser, 1440, 820, { settle: 200, reduced: false });
  const sim = new Sim(m);
  const read = () => m.page.evaluate(() => { const b = document.querySelector("#sfScope b.lv-n"); return b ? [b.textContent, b.dataset.c] : null; });
  const first = await read();
  ok(first && first[1] && first[0] === moneyShort(Number(first[1])), "the scope total is a number the page can count: " + JSON.stringify(first));
  await m.page.evaluate(() => { window.__seen = []; const b = document.querySelector("#sfScope b.lv-n"); const step = () => { const el = document.querySelector("#sfScope b.lv-n"); if (el) window.__seen.push(el.textContent); window.__raf = requestAnimationFrame(step); }; step(); });
  await sim.send(sim.rows(4, { prem: 900000, askPrem: 400000, bidPrem: 300000 }));
  await m.page.waitForTimeout(700);
  const seen = await m.page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__seen; });
  const mirror = sim.mirror();
  const view = mirror.view({ now: sim.readAt + 50, aligned: true });
  const cents = [...mirror.engine().snapshot().books.values()].reduce((a, b) => a + b.T, 0);
  const last = await read();
  eq(last, [moneyShort(cents), String(cents)], "the count lands on the exact total");
  ok(view.scope.line.includes(last[0]), "which is the figure in the sentence");
  const distinct = [...new Set(seen)];
  ok(distinct.length >= 3, "and it counted through other values on the way: " + distinct.join(", "));
  const mid = distinct.filter((x) => x !== last[0] && x !== first[0]);
  ok(mid.length >= 1, "the values between are neither the start nor the end");
  await m.ctx.close();
  const r = await mount(browser, 1440, 820, { settle: 200, reduced: true });
  const s2 = new Sim(r);
  await r.page.evaluate(() => { window.__seen = []; const step = () => { const el = document.querySelector("#sfScope b.lv-n"); if (el) window.__seen.push(el.textContent); window.__raf = requestAnimationFrame(step); }; step(); });
  await s2.send(s2.rows(4, { prem: 900000, askPrem: 400000, bidPrem: 300000 }));
  await r.page.waitForTimeout(500);
  const flat = await r.page.evaluate(() => { cancelAnimationFrame(window.__raf); return [...new Set(window.__seen)]; });
  ok(flat.length <= 2, "under reduced motion the figure changes once and does not count: " + flat.join(", "));
  await r.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(3));
  const asked = m.asked.length;
  await m.page.click("#sfBody .sf-drill");
  await m.page.waitForTimeout(200);
  const hash = await m.page.evaluate(() => location.hash);
  ok(/^#scope=(sector|name)%3A/.test(hash), "drilling a row writes the address: " + hash);
  eq(m.asked.slice(asked).filter((u) => u.startsWith("/api/flows/ledger?scope")), [], "and asks the server for nothing: the books already hold the sector");
  const mirror = sim.mirror();
  const scope = parseScope(new URLSearchParams(hash.slice(1)).get("scope"));
  const view = mirror.view({ now: sim.readAt + 50, scope, aligned: true });
  eq(await m.page.textContent("#sfScope"), view.scope.line, "the sector's scope line is the live view's");
  await sim.send(sim.rows(2));
  const mine = await m.page.textContent("#sfScope");
  ok(mine.length > 0 && (await m.page.$("#sfBody .sf-nt")) !== null, "a window arriving while a sector is open repaints that sector's names");
  await m.page.click("#sfCrumbs button");
  await m.page.waitForTimeout(150);
  eq(await m.page.evaluate(() => location.hash), "", "the breadcrumb returns to all sectors");
  const grid = await m.page.evaluate(() => document.activeElement && document.activeElement.tagName);
  ok(typeof grid === "string", "focus is somewhere sensible");
  eq(m.errors, [], "with a clean console");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  await m.page.focus("#sfMatrix td.c:not(.b)");
  await m.page.keyboard.press("ArrowDown");
  const sim = new Sim(m);
  const where = await m.page.evaluate(() => { const a = document.activeElement; return [a.tagName, a.dataset.x || null, [...a.parentElement.parentElement.children].indexOf(a.parentElement), [...a.parentElement.children].indexOf(a)]; });
  await sim.send(sim.rows(3));
  const after = await m.page.evaluate(() => { const a = document.activeElement; return [a.tagName, [...a.parentElement.parentElement.children].indexOf(a.parentElement), [...a.parentElement.children].indexOf(a)]; });
  eq([after[0], after[1], after[2]], [where[0], where[2], where[3]], "a live repaint keeps keyboard focus on the same cell");
  const line = await m.page.textContent("#sfCellLine");
  const cell = await m.page.evaluate(() => document.activeElement.dataset.x);
  ok(line.endsWith(cell), "and the exact figure line follows the focused cell's new value");
  await m.page.keyboard.press("ArrowRight");
  ok(await m.page.evaluate(() => document.activeElement.matches("td.c")), "arrow keys still move between cells");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { rail: "off", waitLive: false, settle: 100 });
  await m.page.waitForFunction(() => window.FlowsUI.ledgerLive && window.FlowsUI.ledgerLive.status().counts.bases >= 1 && !window.FlowsUI.ledgerLive.status().active, null, { timeout: 15000 });
  await m.page.waitForTimeout(300);
  const st = await statusOf(m.page);
  eq([st.active, st.paused], [false, null], "with the rail refused the live view stands down: the server view is the page");
  const v = await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip());
  eq(v.verdict.state, "server", "the strip names the server copy");
  ok(/^as of \d\d:\d\d:\d\d TRT$/.test(v.chips[0].value), "with the time of its copy: " + v.chips[0].value);
  eq(v.chips[2].value, "— rail off", "and no vendor lag it cannot measure");
  eq(m.errors.filter((e) => !/404/.test(e)), [], "and nothing but the rail's own refused snapshot request is logged");
  eq(await m.page.getAttribute("#sf", "data-state"), "ok", "the page shows the server's ledger");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { bookStatus: 404, waitLive: false, settle: 800 });
  const st = await statusOf(m.page);
  eq([st.active, st.paused, m.R.conns], [false, null, 0], "a 404 for the book means live is off for this account: no rail, the server view stands");
  eq(m.errors.filter((e) => !/404/.test(e)), [], "and nothing but the refused request is logged");
  await m.ctx.close();
}

{
  const tamper = (mut) => () => { const b = JSON.parse(JSON.stringify(serverBook(liveWorld()))); mut(b); return b; };
  const saidCtx = await browser.newContext({ viewport: { width: 1440, height: 820 }, reducedMotion: "reduce" });
  await saidCtx.addInitScript(`window.__said = []; document.addEventListener("DOMContentLoaded", () => { const el = document.getElementById("sfStatus"); if (el) new MutationObserver(() => window.__said.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }); });`);
  const m = await mount(browser, 1440, 820, { newContext: saidCtx, book: tamper((b) => { b.viewHash = "00000000"; }), waitLive: false, settle: 800 });
  const st = await statusOf(m.page);
  eq([st.active, typeof st.paused, st.parity.state], [false, "string", "mismatch"], "a book whose hash is not the browser's build pauses the live ledger");
  ok(/^Live ledger paused\. This browser built a different ledger than the server\. Showing the server ledger as of \d\d:\d\d:\d\d TRT\.$/.test(st.paused), "with a plain sentence: " + st.paused);
  ok((await m.page.evaluate(() => window.__said)).includes(st.paused), "which is announced in the status region");
  eq(await m.page.getAttribute("#sf", "data-state"), "ok", "the server's ledger is on the screen");
  ok(!(await m.page.textContent("#sfLive")).includes("Socket"), "and the strip does not claim a socket");
  await m.page.waitForTimeout(300);
  eq(m.R.ws, null, "the rail is closed");
  await m.ctx.close();
  const d = await mount(browser, 1440, 820, { book: tamper((b) => { b.rows[2].dm = (b.rows[2].dm || 0) + 1; }), waitLive: false, settle: 800 });
  const sd = await statusOf(d.page);
  ok(/different delta for 1 window than the server/.test(sd.paused || ""), "a delta that differs by one micro unit names the window count: " + sd.paused);
  await d.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { liveJs: once(LIVE_JS, "const VERIFY_MS = 15000;", "const VERIFY_MS = 250;"), settle: 100 });
  await m.page.waitForTimeout(1300);
  const st = await statusOf(m.page);
  ok(st.drift.runs >= 4 && st.drift.count === 0, "the full recompute runs on its schedule and finds nothing: " + st.drift.runs);
  await m.page.evaluate(() => { const b = window.FlowsUI.ledgerLive.hold().snapshot().books.values().next().value; b.T += 1; });
  await m.page.waitForFunction(() => window.FlowsUI.ledgerLive.status().drift.events >= 1, null, { timeout: 4000 });
  await m.page.waitForTimeout(900);
  const single = await statusOf(m.page);
  eq([single.drift.events, single.active, single.paused], [1, true, null], "one drift is counted and the books are rebuilt from the held rows: the next three checks find nothing and the page stays live");
  ok(single.drift.count >= 1 && single.drift.rebuiltAt > 0 && (await m.page.evaluate(() => window.FlowsUI.ledgerLive.hold().verify().ok)), "with the rebuild's time kept and the books equal to a full recompute");
  const chip = (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips.find((c) => c.id === "check");
  ok(chip.tone === "bad" && /^drift 1 · rebuilt \d\d:\d\d:\d\d TRT$/.test(chip.value), "and the strip keeps the event in view, in the failing tone: " + chip.value);
  await m.page.evaluate(() => { window.__tamper = setInterval(() => { const b = window.FlowsUI.ledgerLive.hold().snapshot().books.values().next().value; if (b) b.T += 1; }, 90); });
  await m.page.waitForFunction(() => window.FlowsUI.ledgerLive.status().paused, null, { timeout: 5000 });
  const bad = await statusOf(m.page);
  ok(bad.drift.events >= 3 && !bad.active && /drifted from a full recompute/.test(bad.paused), "a drift that keeps coming back pauses the live ledger at the third and says why: " + bad.paused);
  eq(await m.page.getAttribute("#sf", "data-state"), "ok", "the server's ledger takes over");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(2));
  const before = m.state.books;
  await m.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  await m.page.waitForTimeout(300);
  eq(m.state.books, before, "a page shown from the network is not a page shown from the back-forward cache: nothing is refetched");
  await m.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await m.page.waitForFunction(() => /caught up/.test(document.getElementById("sfLive").textContent), null, { timeout: 8000 });
  eq(m.state.books, before + 1, "a page restored from the back-forward cache refetches the book and says when it caught up");
  eq((await statusOf(m.page)).active, true, "and is live again");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(2));
  const before = m.state.books;
  await m.page.clock.setFixedTime(new Date(sim.readAt + 90000));
  await m.page.waitForFunction(() => /caught up/.test(document.getElementById("sfLive").textContent), null, { timeout: 8000 });
  eq(m.state.books, before + 1, "when the wall clock runs a minute ahead of the monotonic one, as after a sleep, the page refetches the book and says when it caught up");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(2));
  await m.page.evaluate(() => { getSelection().selectAllChildren(document.querySelector("#sfMatrix td.c:not(.b)")); });
  await m.page.waitForTimeout(80);
  const matrix = () => m.page.evaluate(() => document.getElementById("sfMatrix").innerHTML);
  const before = await matrix();
  await sim.send(sim.rows(3));
  eq(await matrix(), before, "the matrix is not written while the reader has text selected in the page");
  const chip = (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips[0].value;
  ok(/ · held while you select text$/.test(chip), "and the strip says the repaint is held: " + chip);
  eq((await statusOf(m.page)).hold, "selection", "the status names the hold");
  await m.page.evaluate(() => getSelection().removeAllRanges());
  await m.page.waitForFunction(() => window.FlowsUI.ledgerLive.status().hold === null, null, { timeout: 4000 });
  await m.page.waitForTimeout(150);
  const mirror = sim.mirror();
  const got = (await shownLedger(m.page)).map((r) => [r[0].t, ...r.slice(1).map((c) => c.t)]);
  eq(got, expectedLedger(mirror.view({ now: sim.readAt + 50, aligned: true })), "when the selection is gone the matrix is the one built from scratch for everything that arrived meanwhile");
  await m.ctx.close();
}

{
  const m = await mount(browser, 1440, 820, { settle: 200 });
  const sim = new Sim(m);
  await sim.send(sim.rows(2));
  await m.page.click("#sfBody .sf-drill");
  await m.page.waitForTimeout(200);
  await m.page.mouse.move(2, 2);
  await m.page.waitForTimeout(100);
  const order = () => m.page.$$eval("#sfBody tbody tr[data-scope]", (a) => a.map((x) => x.dataset.scope));
  const before = await order();
  const capped = await m.page.$$eval("#sfBody tbody tr[data-scope]", (a) => a.filter((x) => !/No market cap/.test(x.textContent)).map((x) => x.dataset.scope));
  ok(before.length >= 2 && capped.length >= 2, "a sector lists its names, at least two with a market cap to rank by: " + capped.length + " of " + before.length);
  const last = capped[capped.length - 1];
  await m.page.focus(`#sfBody tr[data-scope="${last}"] .sf-drill`);
  const name = last.split(":")[1];
  await sim.send(sim.rows(1, { t: name, oc: name + "261120C00400000", cp: "C", k: 400, px: 400, size: 4000000, prem: 90000000, askPrem: 40000000, bidPrem: 30000000 }));
  eq(await order(), before, "a name the keyboard is on keeps its place when a window would move it to the top");
  const chip = (await m.page.evaluate(() => window.FlowsUI.ledgerLive.strip())).chips[0].value;
  ok(/ · list held while you point at it$/.test(chip), "and the strip says the list is held: " + chip);
  await m.page.evaluate(() => document.activeElement.blur());
  await m.page.waitForFunction(() => window.FlowsUI.ledgerLive.status().hold === null, null, { timeout: 4000 });
  await m.page.waitForTimeout(150);
  const after = await order();
  eq(after[0], last, "when focus leaves, the list is repainted in its new order and the name is first");
  await m.ctx.close();
}

{
  for (const [w, h] of [[1440, 820], [390, 844]]) {
    const m = await mount(browser, w, h, { settle: 300 });
    const sim = new Sim(m);
    await sim.send(sim.rows(3));
    await m.page.addScriptTag({ content: AXE });
    const res = await m.page.evaluate(() => window.axe.run(document.body, { rules: { "color-contrast": { enabled: true } } }));
    eq(res.violations.map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).join(",")), [], `${w}x${h}: axe finds nothing on the live page`);
    await m.page.click("#sfLive button");
    await m.page.waitForSelector("#fxPop:popover-open", { timeout: 3000 });
    const facts = await m.page.$$eval("#fxPopB dt", (a) => a.map((x) => x.textContent));
    ok(facts.includes("Vendor to hub") && facts.includes("Hub to screen") && facts.includes("Recompute") && facts.includes("Sector tide"), `${w}x${h}: the strip opens the latency facts: ${facts.join(", ")}`);
    await m.page.keyboard.press("Escape");
    await m.ctx.close();
  }
}

await browser.close();
console.log(`✓ flows-ledger-live-render-b: ${checks} assertions`);
