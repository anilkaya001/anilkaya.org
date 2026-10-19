import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as PAGES from "../shared/flows-pages.js";
import { launch, open, settle, waitOracle, ROOT, harnessHtml } from "./lib/oracle-world.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/render-preview.fixtures.json"), "utf8"));
const HOME_BODY = `
<header class="flows-head hm-head" data-fx-hero><h1 id="fxTitle">Session</h1></header>
<p class="visually-hidden" id="flowsStatus" role="status"></p>
<div id="stub-focus"><button id="before" type="button">A control behind the sheet</button></div>`;
const PENDING_TOP = { v: 1, session: "2026-10-16", generatedAt: null, items: [], status: "pending" };
const EMPTY_TOP = { v: 1, session: "2026-10-16", generatedAt: "2026-10-16T21:52:00Z", items: [], status: "ok" };
const homeHtml = () => harnessHtml({ slug: "overview", body: HOME_BODY, active: "overview" });

async function boot(browser, o = {}) {
  const w = await open(browser, { url: "/flows/", slug: "overview", html: homeHtml(), records: {}, ...o });
  await waitOracle(w.page);
  await settle(w.page, 600);
  return w;
}

async function sheetText(page) {
  await page.click("#fxOracle .orc-orb");
  await settle(page, 400);
  const text = await page.evaluate(() => {
    const s = document.querySelector("#fxOracle .orc-sheet");
    const sec = (label) => { const n = s.querySelector(`[aria-label="${label}"]`); return n ? n.textContent : null; };
    return { now: sec("Right now"), top: sec("Strongest today"), links: [...s.querySelectorAll('[aria-label="Right now"] a')].map((a) => a.getAttribute("href")) };
  });
  await page.keyboard.press("Escape");
  await settle(page, 300);
  return text;
}

const browser = await launch();
try {
  {
    const w = await boot(browser, { topBody: PENDING_TOP });
    const home = await w.page.evaluate(() => { const el = document.getElementById("orcHome"); return { state: el.dataset.state, text: el.textContent }; });
    eq(home.state, "absent", "AN ORACLE RANKING THAT IS STILL PENDING IS RESTING ON HOME, not a ranking with nothing in it");
    ok(/Resting\. No view is published yet\./.test(home.text), `and Home says no view is published (${home.text})`);
    ok(!/clears the bar/.test(home.text), "never that no call cleared the bar, which claims an evaluation that never ran");
    const sheet = await sheetText(w.page);
    ok(/Neuron is resting\. No view is published yet\./.test(sheet.top), `the sheet's Strongest today says the same (${sheet.top})`);
    ok(!/tonight/.test(sheet.top + home.text), "and nothing says tonight");
    eq(w.state.oracle, "ok", "the route answered 200, so the resting state comes from the body's own pending status");
    await w.close();
  }

  {
    const w = await boot(browser, { topBody: EMPTY_TOP });
    const home = await w.page.evaluate(() => { const el = document.getElementById("orcHome"); return { state: el.dataset.state, text: el.textContent }; });
    eq(home.state, "ok", "A PUBLISHED RANKING WITH NO ITEM IS A REAL EVALUATION");
    ok(/No call clears the bar for the Oct 16 session\./.test(home.text), `and it names the session it was made for, not tonight (${home.text})`);
    const sheet = await sheetText(w.page);
    ok(/No call clears the bar for the Oct 16 session\./.test(sheet.top), `in the sheet too (${sheet.top})`);
    await w.close();
  }

  {
    const w = await boot(browser, { topBody: EMPTY_TOP, rt: false, time: "2026-10-14T15:30:00Z" });
    const sheet = await sheetText(w.page);
    ok(/This page does not stream flow\./.test(sheet.now), `IN THE REGULAR SESSION ON A PAGE THAT STREAMS NO FLOW, RIGHT NOW SAYS SO (${sheet.now})`);
    ok(!/or the session is closed/.test(sheet.now), "instead of guessing between two reasons");
    eq(sheet.links, ["/flows/unusual/"], "and points to the Flow page, which watches it live");
    await w.close();
  }

  {
    const w = await boot(browser, { topBody: EMPTY_TOP, rt: false, time: "2026-10-17T15:30:00Z" });
    const sheet = await sheetText(w.page);
    ok(/The regular session is closed\./.test(sheet.now), `ON A SATURDAY RIGHT NOW SAYS THE SESSION IS CLOSED (${sheet.now})`);
    eq(sheet.links, [], "with no link to a feed that is not running");
    await w.close();
  }

  {
    const w = await open(browser, { url: "/flows/unusual/", topBody: EMPTY_TOP, records: {}, time: "2026-10-14T15:30:00Z" });
    await waitOracle(w.page);
    await w.page.evaluate(() => { window.__flState = { state: "stale" }; });
    await settle(w.page, 400);
    const sheet = await sheetText(w.page);
    ok(/The flow feed is not live right now\./.test(sheet.now), `ON THE FLOW PAGE, WHICH STREAMS FLOW, A FEED THAT IS NOT LIVE IS SAID AS SUCH (${sheet.now})`);
    await w.page.evaluate(() => { window.__flState = { state: "live" }; });
    await settle(w.page, 400);
    const live = await sheetText(w.page);
    ok(/Watching live\./.test(live.now), `and a live feed is watched (${live.now})`);
    await w.close();
  }

  const base = FIX.overview["board?side=long"];
  const rows = [...base.rows];
  for (let i = 0; rows.length < 53; i++) rows.push({ ...base.rows[i % base.rows.length], t: "SYX" + String(100 + i), r: rows.length + 1 });
  const board = { ...base, rows, cleared: 64 };
  for (const [width, height] of [[1920, 1080], [1440, 820], [390, 844]]) {
    for (const side of ["long", "short"]) {
      const html = PAGES.oracleShell(PAGES.sidePage({ username: "test", side }), "on", side);
      const w = await open(browser, {
        width, height, url: `/flows/${side}/`, html, topBody: EMPTY_TOP, records: {}, reduced: true,
        extraRoutes: (route, u) => (u.pathname === "/api/flows/board" ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...board, side }) }) : false),
      });
      await waitOracle(w.page);
      await settle(w.page, 1200);
      await sleep(300);
      const g = await w.page.evaluate(() => {
        const orb = document.querySelector("#fxOracle .orc-orb").getBoundingClientRect();
        const hit = (b) => b.bottom > orb.top && b.top < orb.bottom && b.right > orb.left && b.left < orb.right;
        const cells = [...document.querySelectorAll("#flowsBody .bd-row:not([hidden]) .bd-c")].filter((c) => c.offsetWidth > 0 && c.textContent.trim());
        return { rows: document.querySelectorAll("#flowsBody .bd-row:not([hidden])").length, covered: cells.filter((c) => hit(c.getBoundingClientRect())).map((c) => c.textContent.trim().slice(0, 16)) };
      });
      ok(g.rows >= 3, `the ${side} board draws rows at ${width}x${height} (${g.rows})`);
      eq(g.covered, [], `THE ORB COVERS NO FIGURE OF A VISIBLE BOARD ROW at ${width}x${height} on ${side}`);
      await w.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`flows-oracle-home-render: ${checks} checks passed`);
