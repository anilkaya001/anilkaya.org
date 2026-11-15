import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import * as M from "../shared/flows-voldesk.js";
import { FX, ROOT, DRY_SESSION } from "./lib/voldesk-world.mjs";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { cardX as fixtureCardX } from "./dossier-fixtures.mjs";
import { surfaceCard } from "./lib/surface-card.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const ORIGIN = "https://example.test";
const SCRIPTS = ["assets/js/flows-ui.js", "assets/js/flows-ticker-xcheck.js"];
const SHEETS = ["assets/css/base.css", "assets/css/flows.css", "assets/css/flows-ticker.css", "assets/css/flows-voldesk.css"];
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${SHEETS.map((f) => `<link rel="stylesheet" href="/${f}">`).join("")}</head><body><main style="padding:16px"><div id="ftGReset"></div><section id="ftXcheck" class="ftxc" hidden></section></main>${SCRIPTS.map((f) => `<script src="/${f}"></script>`).join("")}</body></html>`;

const VA = (world) => M.buildVa(M.auditName({ exposureSign: true, ...FX.worlds[world].input }), { at: DRY_SESSION + "T21:45:00.000Z", session: DRY_SESSION });
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
    ok(r.rows[0].text.includes("Spot"), `${world} ${vp[0]}: the first row is the spot check`);
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

const EMIT = nightlyEmit();
const baseCard = JSON.parse(fs.readFileSync(path.join(EMIT, "-card-AAPL.json"), "utf8"));
const REAL_CARD = surfaceCard(baseCard);
const RT = REAL_CARD.ticker;
const REAL_HTML = FLOWS_PAGES.tickerPage({ username: "u", scenes: true, xcheck: true });
const DAY = REAL_CARD.sessionDate;
const realVa = (world, session = DAY) => M.buildVa(M.auditName({ exposureSign: true, ...FX.worlds[world].input }), { at: session + "T21:45:00.000Z", session });

async function openReal(vp, { va = null, holdCardX = false, patch = null, mutate = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] } });
  const page = await ctx.newPage();
  page.__errors = [];
  page.__api = [];
  let release = () => {};
  const gate = holdCardX ? new Promise((r) => { release = r; }) : null;
  page.__release = release;
  page.on("pageerror", (e) => page.__errors.push(String(e)));
  const cx = { ...fixtureCardX(RT, { sessionDate: DAY }), ...(va ? { va } : {}) };
  const api = { card: REAL_CARD, summary: { status: "ok", scope: RT, summary: "x", ideas: [], tier: "priced", code: null, why: null, read: { status: "generating", sections: {}, version: 1, ticker: RT } }, "card-x": cx, hist: { status: "pending" }, tape: { status: "pending" }, meta: { status: "pending" }, events: { status: "pending", rows: [] },
    now: { serverNow: Date.parse(REAL_CARD.generatedAt || "2026-08-24T22:00:00Z"), phase: { phase: "closed", session: REAL_CARD.sessionDate, trading: false, endsAt: null }, keys: {} } };
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      let body = fs.readFileSync(f, "utf8");
      const edits = patch && patch[u.pathname];
      if (edits) for (const [from, to] of edits) { if (!body.includes(from)) throw new Error("mutant anchor missing: " + from); body = body.replaceAll(from, to); }
      return route.fulfill({ contentType: MIME[path.extname(f)] || "application/octet-stream", body });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      page.__api.push(key);
      if (key === "card-x" && gate) await gate;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(api[key] === undefined ? { status: "pending" } : api[key]) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: REAL_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.goto("https://example.test/flows/ticker/?t=" + RT);
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 15000 });
  await page.waitForSelector(".ftg-svg", { timeout: 10000 });
  await page.locator("#ftTabSurface").click();
  await page.waitForSelector(".ftsf", { timeout: 15000 });
  await page.waitForSelector("#ftXcheck[data-state]:not([hidden])", { timeout: 8000, state: "attached" }).catch(async (e) => {
    const dbg = await page.evaluate(() => ({ x: (document.getElementById("ftXcheck") || {}).outerHTML, flag: (document.getElementById("ftSurface") || {}).outerHTML, api: !!(window.FlowsUI && window.FlowsUI.xcheck) }));
    console.log(JSON.stringify(dbg).slice(0, 600), page.__errors);
    throw e;
  });
  await page.waitForTimeout(300);
  return { page, ctx };
}

const money = (x, dp) => Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const realAudit = (page, va) => page.evaluate((va) => {
  const host = document.getElementById("ftXcheck");
  const rows = Object.fromEntries([...host.querySelectorAll(".ftxc-g li")].map((li) => [li.querySelector("b").textContent, { v: li.dataset.v, text: li.textContent }]));
  const cover = [];
  for (const sel of ["#ftGReset button", ".ftsf-chips button", ".ftsf-tabs button", ".ftsf-cols canvas"]) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || el.closest("[hidden]")) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && host.contains(hit) && !el.contains(hit)) cover.push(sel);
    }
  }
  const hb = host.getBoundingClientRect();
  return { rows, cover, chip: (host.querySelector(".ftxc-v") || {}).textContent || "", host: [hb.left, hb.top, hb.right, hb.bottom], vw: innerWidth, scrollW: document.documentElement.scrollWidth, text: host.textContent, shown: getComputedStyle(host).display !== "none" };
}, va);
const figuresFault = (r, va) => {
  const faults = [];
  const by = Object.fromEntries(va.rows.map((x) => [x[0], x]));
  const label = { spot: "Spot", delta: "Delta", iv: "IV", oiExpiry: "OI expiry", oiAll: "OI all" };
  for (const [id, name] of Object.entries(label)) {
    const row = by[id];
    const li = r.rows[name];
    if (!row || !li) { faults.push("missing:" + id); continue; }
    if (row[5] === "nc") continue;
    const fmt = id === "spot" ? (x) => money(x, 2) : id === "delta" ? (x) => money(x, 3) : id === "iv" ? (x) => money(x, 1) : (x) => Math.round(x).toLocaleString("en-US");
    if (!li.text.includes(fmt(row[1])) || !li.text.includes(fmt(row[2]))) faults.push("figure:" + id);
    if (id === "delta" && row[3] !== 0 && !/[+−]/.test(li.text.replace(/Delta/, "").replace(/Engine .* gap/, ""))) faults.push("unsigned-gap");
  }
  for (const [id, name] of [["dexExpiry", "Delta exposure"], ["gexAll", "Gamma exposure"]]) {
    const li = r.rows[name];
    if (by[id] && by[id][5] === "nc" && li && !li.text.includes(window_nc(by[id][6]))) faults.push("nc-reason:" + id);
    if (by[id] && by[id][5] === "nc" && li && li.v !== "nc") faults.push("nc-as-" + li.v);
  }
  return faults;
};
const NCW = { sign: "the feed's exposure sign convention is not confirmed", units: "the gamma unit is not stated" };
function window_nc(why) { return NCW[why] || why; }

for (const vp of [[1920, 1080], [1440, 820], [1024, 768], [390, 844]]) {
  const va = realVa("differs");
  const { page, ctx } = await openReal(vp, { va });
  const r = await realAudit(page, va);
  eq(figuresFault(r, va), [], `${vp[0]} real ticker: strip figures equal the payload's, a gap carries a sign`);
  eq(r.cover, [], `${vp[0]} real ticker: the strip covers no surface control`);
  eq(r.shown, vp[0] >= 1024 && vp[1] >= 940, `${vp[0]}x${vp[1]} real ticker: the strip shows only where the scenes keep their room`);
  eq(await page.locator("#ftGReset .ftxc-b").count(), 1, `${vp[0]} real ticker: the button is always there`);
  ok(r.scrollW <= r.vw + 1, `${vp[0]} real ticker: no sideways scroll`);
  ok(/Differs/.test(r.chip), `${vp[0]} real ticker: the verdict is a word`);
  eq(page.__errors, [], `${vp[0]} real ticker: no page error`);
  ok(!page.__api.includes("voldesk"), `${vp[0]} real ticker: the strip makes no voldesk request`);
  await ctx.close();
}

{
  const va = M.buildVa(M.auditName(FX.worlds.agree.input), { at: DAY + "T21:45:00.000Z", session: DAY });
  const { page, ctx } = await openReal([1440, 820], { va });
  const r = await realAudit(page, va);
  eq(figuresFault(r, va), [], "the default audit prints the sign reason for both exposure rows");
  ok(r.text.includes(NCW.sign), "and the reason is in the strip");
  await ctx.close();
}

{
  const va = realVa("agree");
  const { page, ctx } = await openReal([1440, 820], { va: null, holdCardX: true });
  await page.waitForFunction(() => /loading|Not audited/.test(document.getElementById("ftXcheck").textContent), null, { timeout: 8000 });
  const before = await page.evaluate(() => document.getElementById("ftXcheck").textContent);
  ok(/still loading/.test(before), "while card-x is out, the strip says it is loading and not that the name was never audited");
  ok(!/Not audited/.test(before), "and does not say Not audited");
  page.__release();
  await ctx.close();
  const late = await openReal([1440, 820], { va, holdCardX: true });
  await late.page.waitForTimeout(300);
  late.page.__release();
  await late.page.waitForFunction(() => /Agrees|Differs/.test(document.getElementById("ftXcheck").textContent), null, { timeout: 15000 });
  ok(true, "a card-x that lands after the Surface tab mounted updates the strip in place");
  await late.ctx.close();
}

for (const [name, edits, detect] of [
  ["a not-compared row drawn as agree", [["\"data-v\": row.v, title: cellText(row)", "\"data-v\": row.v === \"nc\" ? \"agree\" : row.v, title: cellText(row)"]], (r) => Object.values(r.rows).some((x) => x.v === "agree" && /Not compared/.test(x.text))],
  ["an unsigned gap", [["gap: (g) => F.signed(g, 3)", "gap: (g) => F.px(Math.abs(g), 3)"]], (r, va) => figuresFault(r, va).includes("unsigned-gap")],
  ["a stale audit shown as tonight's", [["if (m.stale) left.append", "if (false) left.append"]], (r) => !/Last audited/.test(r.text)],
  ["an added fetch", [["const m = model(cardX);", "const m = model(cardX); fetch(\"/api/flows/voldesk\");"]], (r, va, page) => page.__api.includes("voldesk")],
]) {
  const stale = name.startsWith("a stale");
  const va = stale ? realVa("differs", "2026-08-21") : name.includes("not-compared") ? M.buildVa(M.auditName(FX.worlds.agree.input), { at: DAY + "T21:45:00.000Z", session: DAY }) : realVa("differs");
  const { page, ctx } = await openReal([1440, 820], { va, patch: { "/assets/js/flows-ticker-xcheck.js": edits } });
  const r = await realAudit(page, va);
  ok(detect(r, va, page), `PLANTED ${name}: fails its check`);
  await ctx.close();
}

{
  const va = realVa("differs");
  const { page, ctx } = await openReal([390, 844], { va });
  const btn = page.locator("#ftGReset .ftxc-b");
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("dialog.ftxc-dlg[open]");
  await page.keyboard.press("Escape");
  const cls = await page.evaluate(() => document.activeElement.className);
  ok(/ftxc-b/.test(cls), "the dialog returns focus to its button on the real page");
  await ctx.close();
  const bad = await openReal([390, 844], { va, patch: { "/assets/js/flows-ticker-xcheck.js": [["if (opener && opener.isConnected) opener.focus();", ""], ["dlg.showModal();", "dlg.show();"]] } });
  await bad.page.locator("#ftGReset .ftxc-b").focus();
  await bad.page.keyboard.press("Enter");
  await bad.page.waitForSelector("dialog.ftxc-dlg[open]");
  await bad.page.keyboard.press("Escape");
  const cls2 = await bad.page.evaluate(() => document.activeElement.className);
  ok(!/ftxc-b/.test(cls2), "PLANTED a dialog without focus return: fails its check");
  await bad.ctx.close();
}

await browser.close();
console.log(`flows-xcheck-render: ${checks} assertions`);
