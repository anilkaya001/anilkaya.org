import assert from "node:assert/strict";
import fs from "node:fs";
import { launch } from "./lib/browser.mjs";
import { openEvents, erPayload, NOW, SESSION } from "./lib/er-world.mjs";
import * as RT from "../shared/flows-rt.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const SIZES = [{ width: 1920, height: 1080 }, { width: 1440, height: 820 }, { width: 1024, height: 768 }, { width: 390, height: 844 }];
const TABS = ["risk", "issues", "policy", "halts"];
const SHOTS = process.env.ER_SHOTS || "";

const browser = await launch();

async function measure(page, tab) {
  await page.evaluate((t) => { document.querySelector('#fdTabs [data-tab="' + t + '"]').click(); }, tab);
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const de = document.documentElement;
    const stage = document.getElementById("fdStage");
    const on = stage.querySelector('.fd-mod[data-on]');
    const box = on ? on.getBoundingClientRect() : null;
    const cut = on ? [...on.querySelectorAll("*")].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden]") || el.closest(".fd-cut")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1) && !el.closest(".er-scroll");
    }).length : -1;
    const pane = on ? on.querySelector(".fd-body") : null;
    const pb = pane ? pane.getBoundingClientRect() : null;
    const overlaps = on ? [...on.querySelectorAll(".er-li")].filter((li) => {
      if (li.closest(".fd-cut") || li.closest("[hidden]") || getComputedStyle(li).display === "none" || li.getBoundingClientRect().height === 0) return false;
      const kids = [...li.children].map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      return kids.some((a, i) => kids.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5));
    }).length : 0;
    const spill = on ? [...on.querySelectorAll(".er-li > *")].filter((el) => {
      if (el.closest(".fd-cut") || el.closest("[hidden]") || el.getBoundingClientRect().width === 0) return false;
      const cs = getComputedStyle(el);
      return cs.overflowX === "visible" && cs.whiteSpace === "nowrap" && el.scrollWidth > el.clientWidth + 1;
    }).length : 0;
    const outside = on && pb ? [...on.querySelectorAll(".er-tickl, .er-dot")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && getComputedStyle(el).visibility !== "hidden" && (r.right > pb.right + 1 || r.left < pb.left - 1);
    }).length : 0;
    return { overlaps, spill, outside, vScroll: de.scrollHeight - innerHeight, hScroll: de.scrollWidth - innerWidth, shown: on ? on.id : null, cut, text: on ? on.textContent : "" };
  });
}

for (const size of SIZES) {
  const { context, page, world } = await openEvents(browser, size, { halts: false });
  ok(world.errors.length === 0, `no page error at ${size.width}x${size.height}: ${world.errors.join("; ")}`);
  for (const tab of TABS) {
    const m = await measure(page, tab);
    ok(m.vScroll <= 1, `${tab} at ${size.width}x${size.height}: no page scroll (${m.vScroll})`);
    ok(m.hScroll <= 1, `${tab} at ${size.width}x${size.height}: no sideways scroll (${m.hScroll})`);
    ok(m.overlaps === 0, `${tab} at ${size.width}x${size.height}: no two cells of a row overlap (${m.overlaps})`);
    ok(m.spill === 0, `${tab} at ${size.width}x${size.height}: no cell's unwrapped text runs past its own box into the next (${m.spill})`);
    ok(m.outside === 0, `${tab} at ${size.width}x${size.height}: no axis label or mark leaves its pane (${m.outside})`);
    ok(m.shown && m.shown.startsWith("er"), `${tab}: its module is the one shown (${m.shown})`);
    ok(!/\bET\b/.test(m.text) && !/\bEST\b|\bEDT\b/.test(m.text), `${tab}: no Eastern time is printed`);
    ok(!/vendor|unusual whales|tape/i.test(m.text), `${tab}: no provider name in the copy`);
    ok(!/\bnull\b|undefined|NaN|\[object/.test(m.text), `${tab}: no null, undefined or NaN is printed`);
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/${tab}-${size.width}x${size.height}.png` });
    }
  }
  const halts = await measure(page, "halts");
  ok(!/Live/.test(await page.evaluate(() => document.querySelector("#erHalts .er-switch") ? "Live" : "")), `halts at ${size.width}: with the channel off, no live pane or switch is shown`);
  ok(/14 days/.test(halts.text) || /Halts/.test(halts.text), "and the 14-day record stands");
  await context.close();
}

{
  const { context, page, world } = await openEvents(browser, { width: 1440, height: 820 }, { halts: true });
  const m = await measure(page, "halts");
  ok(/not connected/.test(m.text), "with the channel switched on and no socket topic, the view says it is not connected and not that there were none");
  ok(!/No halt has been streamed/.test(m.text), "and never claims silence");
  ok(world.errors.length === 0, "no page error with the halts view on");
  await context.close();
}

{
  const EP = 9100;
  const since = new Date(NOW - 3600000).toISOString();
  const live = RT.streamEntry({ k: "ht", readAt: NOW, session: SESSION, now: NOW, updatedAt: NOW });
  const down = RT.socketOnlyStream("ht", SESSION);
  const T = NOW - 7 * 60000;
  const halted = { id: "SYE001|" + T + "|halted", ts: T, t: "SYE001", state: "halted", reason: "LUDP" };
  const hello = RT.ctlFrame("hello", { ep: EP, at: NOW, meta: { transport: "ws", upstream: "socket", mode: "on", audience: "members", topics: ["ht"], hbS: 5, cold: false, phase: "rth", session: SESSION, f: null },
    rows: [RT.frame("ht", { ep: EP, sq: 0, at: NOW, snap: true, fresh: live, meta: { since, dropped: 0 }, rows: [] })] });
  const frame = (sq, rows, fresh = live) => RT.frame("ht", { ep: EP, sq, at: NOW, fresh, meta: { since, dropped: 0 }, rows });
  for (const size of SIZES) {
    let sock = null;
    const rt = (ws) => { sock = ws; ws.send(JSON.stringify(hello)); ws.send(JSON.stringify(frame(1, [halted]))); };
    const { context, page, world } = await openEvents(browser, size, { halts: true, rt });
    const m = await measure(page, "halts");
    const sinceText = new Date(Date.parse(since) + 3 * 3600000).toISOString().slice(11, 16) + " TRT";
    ok(m.text.includes("Since " + sinceText) && /1 open/.test(m.text), `HALTS STREAMED at ${size.width}: the live pane says since when the channel has been watched, in TRT, and that one halt is open (${m.text.slice(0, 160)})`);
    ok(/SYE001/.test(m.text) && /open 7 min/.test(m.text), "the halted name is listed with how long it has been open, counted from the halt's own time");
    ok(m.vScroll <= 1 && m.hScroll <= 1 && m.overlaps === 0, `and the pane holds one screen with no scroll and no overlap (${m.vScroll}, ${m.hScroll}, ${m.overlaps})`);
    ok(!/vendor|unusual whales|tape/i.test(m.text) && !/\bnull\b|undefined|NaN/.test(m.text), "with no provider name and no null printed");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/halts-live-${size.width}x${size.height}.png` });
    if (size.width === 1440) {
      sock.send(JSON.stringify(frame(2, [halted])));
      sock.send(JSON.stringify(frame(3, [{ id: "SYE001|" + (T + 60000) + "|resumed", ts: T + 60000, t: "SYE001", state: "resumed", reason: null }])));
      await page.waitForTimeout(300);
      const after = await measure(page, "halts");
      ok(/0 open/.test(after.text), "a later resumption of the same name closes it");
      ok((after.text.match(/SYE001/g) || []).length === 2, "and a halt sent twice is listed once beside its resumption");
      sock.send(JSON.stringify(RT.ctlFrame("hb", { ep: EP, at: NOW, meta: { upstream: "up", phase: "rth", sockets: 1, degraded: null, topics: { ht: { sq: 3, readAt: null, lagMs: null, fresh: down } } } })));
      await page.waitForTimeout(300);
      const gone = await measure(page, "halts");
      ok(/not connected/.test(gone.text) && !/No halt has been streamed/.test(gone.text), "when the channel goes down the pane says it is not connected, never that there were none");
      ok(world.requests.filter((r) => r.startsWith("/api/rt/")).length === 0 || world.requests.every((r) => !r.startsWith("/api/rt/snap") || /k=ht/.test(r)), "and the page asks the rail for the halts channel alone");
    }
    ok(world.errors.length === 0, `no page error with the halts streamed at ${size.width} (${world.errors.join("; ")})`);
    await context.close();
  }
}

{
  const payload = erPayload();
  const evil = "<img src=x onerror=window.__pwned=1>";
  const row = payload.risk && payload.risk.rows && payload.risk.rows[0];
  if (row) row.name = evil;
  if (payload.issues && payload.issues.ipos && payload.issues.ipos.rows[0]) payload.issues.ipos.rows[0].name = evil;
  if (payload.policy && payload.policy.posts && payload.policy.posts.rows[0]) payload.policy.posts.rows[0].text = evil;
  const { context, page, world } = await openEvents(browser, { width: 1440, height: 820 }, { payload });
  for (const tab of TABS) await measure(page, tab);
  const res = await page.evaluate(() => ({ pwned: window.__pwned === 1, imgs: document.querySelectorAll('.fd-mod img[src="x"]').length }));
  ok(!res.pwned && res.imgs === 0, "hostile text from the payload never reaches innerHTML");
  ok(world.errors.length === 0, "and raises no page error");
  await context.close();
}

{
  const { context, page, world } = await openEvents(browser, { width: 1440, height: 820 }, { eventrisk: false });
  ok(await page.evaluate(() => !document.getElementById("erDefer") && !document.querySelector('[data-tab="risk"]')), "with the switch closed the page carries neither the tabs nor the group");
  ok(!world.requests.some((r) => r.includes("flows-er") || r.includes("/api/flows/eventrisk")), "and requests neither the script, the sheet nor the route");
  await context.close();
}

{
  const { context, page, world } = await openEvents(browser, { width: 1440, height: 820 });
  const loadAt = world.requests.findIndex((r) => r.includes("flows-events.js"));
  const erAt = world.requests.findIndex((r) => r.includes("flows-er.js"));
  ok(erAt > loadAt && loadAt >= 0, "the event-risk script is requested after the page's own script");
  const before = world.requests.filter((r) => r.startsWith("/api/flows/eventrisk")).length;
  await page.waitForTimeout(300);
  ok(world.requests.filter((r) => r.startsWith("/api/flows/eventrisk")).length === before, "and the route is read once and not polled");
  await context.close();
}

await browser.close();
console.log(`flows-er-render: ${checks} checks`);
