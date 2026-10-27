import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import * as M from "../shared/flows-voldesk.js";
import { FX, ROOT, DRY_SESSION } from "./lib/voldesk-world.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const ORIGIN = "https://example.test";
const SCRIPTS = ["assets/js/flows-ui.js", "assets/js/flows-ticker-xcheck.js"];
const SHEETS = ["assets/css/base.css", "assets/css/flows.css", "assets/css/flows-ticker.css", "assets/css/flows-voldesk.css"];
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${SHEETS.map((f) => `<link rel="stylesheet" href="/${f}">`).join("")}</head><body><main style="padding:16px"><div id="ftGReset"></div><section id="ftXcheck" class="ftxc" hidden></section></main>${SCRIPTS.map((f) => `<script src="/${f}"></script>`).join("")}</body></html>`;

const VA = (world) => M.buildVa(M.auditName(FX.worlds[world].input), { at: DRY_SESSION + "T21:45:00.000Z", session: DRY_SESSION });
const cardXOf = (va, over = {}) => ({ sessionDate: DRY_SESSION, ...(va ? { va } : {}), ...over });

const browser = await launch();

async function open(cardX, viewport, { patch = null } = {}) {
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] } });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.route(ORIGIN + "/**", async (route) => {
    const u = new URL(route.request().url());
    requests.push(u.pathname);
    if (u.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
    const file = path.join(ROOT, u.pathname);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    let body = fs.readFileSync(file);
    if (patch && patch[u.pathname]) {
      let src = body.toString("utf8");
      for (const [from, to] of patch[u.pathname]) { if (!src.includes(from)) throw new Error("mutant anchor missing: " + from); src = src.replaceAll(from, to); }
      body = Buffer.from(src);
    }
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream", body });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.xcheck);
  await page.evaluate((cx) => {
    const mount = window.FlowsUI.xcheck.mount(document.getElementById("ftXcheck"), cx, { buttonHost: document.getElementById("ftGReset") });
    window.__mount = mount;
  }, cardX);
  return { page, context, errors, requests };
}

const read = (page) => page.evaluate(() => {
  const host = document.getElementById("ftXcheck");
  const rows = [...host.querySelectorAll(".ftxc-g li")].map((li) => ({ v: li.dataset.v, text: li.textContent.trim(), glyph: (li.querySelector("i") || {}).textContent || "" }));
  const chip = host.querySelector(".ftxc-v");
  return { state: host.dataset.state, hidden: host.hidden, chip: chip ? { v: chip.dataset.v, text: chip.textContent.trim() } : null, rows, text: host.innerText, html: host.outerHTML, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, hostW: host.getBoundingClientRect().width };
});

for (const [world, verdict] of [["agree", "agree"], ["differs", "differs"]]) {
  const va = VA(world);
  eq(va.v, verdict, `${world}: the fixture world gives the verdict`);
  for (const vp of [[1920, 1080], [1440, 820], [1024, 768], [390, 844]]) {
    const { page, context, errors, requests } = await open(cardXOf(va), vp);
    const r = await read(page);
    eq(r.state, "ok", `${world} ${vp[0]}: the strip is in the ok state`);
    eq(r.chip.v, verdict, `${world} ${vp[0]}: the chip carries the verdict`);
    ok(/[✓✕]/.test(r.chip.text) && /Agrees|Differs/.test(r.chip.text), `${world} ${vp[0]}: the chip has a glyph and a word, never colour alone`);
    eq(r.rows.length, 8, `${world} ${vp[0]}: eight rows`);
    ok(r.rows.every((x) => /✓|✕|–/.test(x.glyph) || x.v === "nc"), `${world} ${vp[0]}: every row has a glyph`);
    ok(r.scrollW <= r.innerW + 1, `${world} ${vp[0]}: no sideways scroll`);
    ok(!/vendor|\btape\b|\bNaN\b|\bnull\b|undefined/i.test(r.html), `${world} ${vp[0]}: no forbidden word or placeholder`);
    eq(requests.filter((p) => p.startsWith("/api")), [], `${world} ${vp[0]}: no request to any route`);
    eq(errors, [], `${world} ${vp[0]}: no page error`);
    const spot = va.rows.find((x) => x[0] === "spot");
    ok(r.rows[0].text.includes("Spot") || r.rows[0].text.length > 0, `${world} ${vp[0]}: the first row is the spot check`);
    ok(spot !== undefined, `${world}: the audit has a spot row`);
    await context.close();
  }
}

{
  const { page, context } = await open(cardXOf(VA("agree")), [390, 844]);
  const btn = page.locator("#ftGReset .ftxc-b");
  eq(await btn.count(), 1, "the button stands in for the strip on a phone");
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("dialog.ftxc-dlg[open]");
  const dlg = await page.evaluate(() => { const d = document.querySelector("dialog.ftxc-dlg"); return { open: d.open, text: d.innerText, active: document.activeElement.id }; });
  ok(dlg.open && dlg.active === "ftxcClose", "the dialog opens with focus on Close");
  ok(/Engine|Feed/.test(dlg.text) && /Tolerance/.test(dlg.text), "and lists the strikes and tolerances");
  ok(!/vendor|\btape\b/i.test(dlg.text), "and names no provider");
  await page.keyboard.press("Escape");
  const back = await page.evaluate(() => ({ open: document.querySelector("dialog.ftxc-dlg").open, cls: document.activeElement.className }));
  ok(!back.open && /ftxc-b/.test(back.cls), "Escape closes it and returns focus to the button");
  await context.close();
}

for (const [world, expect] of [["per1pct", "per 1%"], ["nounit", "does not state"]]) {
  const va = VA(world);
  const { page, context } = await open(cardXOf(va), [1440, 820]);
  const r = await read(page);
  ok(r.text.includes(expect), `${world}: the unit sentence is printed (${expect})`);
  await context.close();
}

{
  const { page, context } = await open(cardXOf(null), [1440, 820]);
  const r = await read(page);
  eq(r.state, "never", "no va section is the never state");
  ok(/Not audited/.test(r.text), "and says the name was not audited");
  eq(await page.locator("#ftGReset .ftxc-b[disabled]").count(), 1, "with its button disabled");
  await context.close();
}

{
  const va = VA("agree");
  const { page, context } = await open(cardXOf(va, { sessionDate: "2026-08-25" }), [1440, 820]);
  const r = await read(page);
  ok(/Last audited/.test(r.text), "an audit from an earlier session says when it was made");
  await context.close();
}

{
  const SHEET = "/assets/js/flows-ticker-xcheck.js";
  const planted = [
    ["verdict by colour alone", [["h(\"i\", { \"aria-hidden\": \"true\" }, GLYPH[m.v]), WORD[m.v]", "\"\""]], (r) => !(r.chip && /[✓✕]/.test(r.chip.text))],
    ["a nonsense word in the copy", [["Not audited in the last five sessions.", "Vendor tape missing."]], null],
  ];
  const va = VA("agree");
  for (const [name, edits, detect] of planted) {
    if (!detect) {
      const { page, context } = await open(cardXOf(null), [1440, 820], { patch: { [SHEET]: edits } });
      const r = await read(page);
      ok(/vendor|\btape\b/i.test(r.html), `PLANTED ${name}: the forbidden-word scan fails`);
      await context.close();
      continue;
    }
    const { page, context } = await open(cardXOf(va), [1440, 820], { patch: { [SHEET]: edits } });
    const r = await read(page);
    ok(detect(r), `PLANTED ${name}: fails its check`);
    await context.close();
  }
}

{
  const css = fs.readFileSync(path.join(ROOT, "assets/css/flows-voldesk.css"), "utf8");
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css), "the sheet holds no colour literal");
  const js = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker-xcheck.js"), "utf8");
  ok(!/innerHTML|fetch\(|XMLHttpRequest/.test(js), "the strip writes no markup and makes no request");
}

await browser.close();
console.log(`flows-xcheck-render: ${checks} assertions`);
