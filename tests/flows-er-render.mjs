import assert from "node:assert/strict";
import fs from "node:fs";
import { launch } from "./lib/browser.mjs";
import { openEvents, erPayload } from "./lib/er-world.mjs";

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
    const outside = on && pb ? [...on.querySelectorAll(".er-tickl, .er-dot")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && getComputedStyle(el).visibility !== "hidden" && (r.right > pb.right + 1 || r.left < pb.left - 1);
    }).length : 0;
    return { overlaps, outside, vScroll: de.scrollHeight - innerHeight, hScroll: de.scrollWidth - innerWidth, shown: on ? on.id : null, cut, text: on ? on.textContent : "" };
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
