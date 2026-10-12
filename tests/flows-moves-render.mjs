import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as M from "../shared/flows-moves0.js";
import { rarityText } from "../shared/flows-targets.js";
import { flowsPageRows, FLOWS_PAGE_SLUGS } from "../server/routes/flows-pages.js";
import { HttpError } from "../server/http.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const HTML = PAGES.movesPage({ username: "test" });
const FORBID = /\b(unusual|alert|alerts|screen|rare|radar)\b/i;

const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
ok(/^FLOWS_MOVES = "on"$/m.test(wrangler), "the switch ships on: the owner opened the Moves page to every member on 2026-10-12");

{
  const doc = HTML;
  eq((doc.match(/<h1[ >]/g) || []).length, 1, "one h1");
  ok(/<title>Flows — Moves<\/title>/.test(doc), "the title says Moves");
  ok(!FORBID.test(doc.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "")),
    "no forbidden word in the page's own text, title or description");
  const nav = /<aside class="fx-side"[\s\S]*?<\/aside>/.exec(doc)[0];
  ok(/href="\/flows\/moves\/"[^>]*aria-current="page"/.test(nav) && nav.includes(">Moves<"), "the rail names Moves on its own page");
  ok(/href="\/flows\/moves\/"/.test(PAGES.marketPage({ username: "test" })), "and every other page links it in the rail now that it is open to members");
  ok(/\/assets\/js\/flows-moves\.js\?v=\d+/.test(doc) && /\/assets\/css\/flows-moves\.css\?v=\d+/.test(doc), "the controller and the sheet are versioned");
  ok(!/flows-chart\.js/.test(doc), "no chart script: a ranked list needs none");
  for (const w of [M.LINE, M.CAPTION, M.APART, M.GRADE_NOTE]) ok(M.wordCount(w) <= M.HEADER_WORDS_MAX, "a header sentence stays inside fourteen words: " + w);
  ok(!FORBID.test(M.LINE + M.CAPTION + M.APART + M.GRADE_NOTE), "and uses none of the forbidden words");
}

{
  ok(FLOWS_PAGE_SLUGS.includes("moves"), "the route table lists the page");
  const mk = (mode, owner) => {
    const rows = flowsPageRows({
      currentFlowsUser: async () => ({ username: "u" }),
      readFlowsSummary: async () => null,
      isOwner: () => owner,
    });
    const row = rows.find((r) => r.id === "flows.pages.moves");
    return row.handler({ request: new Request("https://x.test/flows/moves/"), env: mode === undefined ? {} : { FLOWS_MOVES: mode }, url: new URL("https://x.test/flows/moves/") });
  };
  const status = async (mode, owner) => { try { return (await mk(mode, owner)).status; } catch (e) { ok(e instanceof HttpError, "a refusal is an HttpError"); return e.status; } };
  eq(await status(undefined, true), 200, "unset: the owner is served");
  eq(await status(undefined, false), 404, "unset: a member gets the 404 of an unknown page");
  eq(await status("owner", false), 404, "owner: a member gets 404");
  eq(await status("on", false), 200, "on: a member is served");
  eq(await status("off", true), 404, "off: even the owner gets 404");
  eq(await status("garbage", false), 404, "an unknown value fails closed for a member");
}

const NIGHT = "2026-10-09";
const NAMES = [
  ["UP1", 0.06, 0.30, 60, 0.02, 20, 4], ["UP2", 0.045, 0.45, 60, 0.015, 30, 7], ["UP3", 0.01, 0.20, 60], ["UP4", 0.002, 0.25, null],
  ["DN1", -0.07, 0.35, 60, 0.03, 12, 2], ["DN2", -0.02, 0.15, 60, 0.03, 12, 2], ["DN3", -0.005, 0.40, 60],
  ["ZH", 0.05, 0.30, 60, 0.01, 9, 0], ["ONE", 0.04, 0.30, 60, 0.01, 9, 1],
  ["EV1", 0.12, 0.30, 5], ["EV2", -0.09, 0.40, 21], ["NOIV", 0.2, null, 60], ["ZIV", -0.2, 0, 60],
];
const universe = (names, session = NIGHT) => ({
  status: "ok", sessionDate: session, t: names.map((n) => n[0]),
  cols: { chg: names.map((n) => Math.round(n[1] * 1e4)), iv30p: names.map((n) => (n[2] === null ? null : Math.round(n[2] * 1e4))), ed: names.map((n) => n[3]),
    sig: names.map((n) => (n[4] === undefined ? null : Math.round(n[4] * 1e5))), f2: names.map((n) => (n[5] === undefined ? null : n[5])), f3: names.map((n) => (n[6] === undefined ? null : n[6])) },
  units: { chg: ["frac", 1e4], iv30p: ["frac", 1e4], ed: ["sessions", 1], sig: ["fraction", 1e5], f2: ["days per 252", 1], f3: ["days per 252", 1] },
});

const expected = (names) => {
  const all = names.filter((n) => n[2] !== null && n[2] > 0).map((n) => ({ t: n[0], m: M.ivDays(n[1], n[2]), event: n[3] !== null && n[3] <= 21 }));
  const clean = all.filter((x) => !x.event);
  return {
    up: clean.filter((x) => x.m > 0).sort((a, b) => b.m - a.m).map((x) => x.t),
    down: clean.filter((x) => x.m < 0).sort((a, b) => a.m - b.m).map((x) => x.t),
    apart: all.filter((x) => x.event).sort((a, b) => Math.abs(b.m) - Math.abs(a.m)).map((x) => x.t),
    abs: clean.map((x) => Math.abs(x.m)),
    byT: Object.fromEntries(all.map((x) => [x.t, x.m])),
    rarity: Object.fromEntries(names.filter((n) => n[4] !== undefined).map((n) => {
      const k = Math.abs(n[1]) / n[4];
      const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;
      return [n[0], level ? rarityText({ k: level, sigmaRef: n[4], route: "empirical", hits: level === 3 ? n[6] : n[5] }) : null];
    })),
  };
};

const FAKE_RT = `(() => { const UI = window.FlowsUI; const cbs = {};
  window.__rtFire = () => (cbs.px || []).forEach((f) => f());
  window.__strips = null;
  window.FlowsUI = Object.freeze({ ...UI, rt: { connect: () => ({ on: (k, f) => { (cbs[k] = cbs[k] || []).push(f); } }), feeds: () => Boolean(window.__strips), strips: () => window.__strips } }); })();`;

async function mount(browser, width, names, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const asked = [];
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-rt.js") return r.fulfill({ contentType: "text/javascript", body: FAKE_RT });
    if (opts.mutate && u.pathname === "/assets/js/flows-moves.js") {
      const src = fs.readFileSync(path.join(ROOT, u.pathname), "utf8");
      assert.ok(src.includes(opts.mutate[0]), "the planted build must change the served module");
      return r.fulfill({ contentType: "text/javascript", body: src.replace(opts.mutate[0], opts.mutate[1]) });
    }
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      asked.push(u.pathname.slice(11) + u.search);
      if (u.pathname === "/api/flows/universe") return r.fulfill({ contentType: "application/json", status: opts.status || 200, body: JSON.stringify(opts.body || universe(names)) });
      return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/moves/");
  await page.waitForFunction(() => /Ranked|could not|not published/.test(document.getElementById("mvStatus").textContent), null, { timeout: 15000 });
  return { ctx, page, errors, asked };
}

const read = (page) => page.evaluate(() => {
  const col = (id) => Array.from(document.querySelectorAll("#" + id + " .mv-row"), (r) => ({
    t: r.querySelector(".mv-t").textContent, m: r.querySelector(".mv-m").textContent, c: r.querySelector(".mv-c").textContent,
    n: r.querySelector(".mv-n") ? r.querySelector(".mv-n").textContent : null,
    r: r.querySelector(".mv-r") ? r.querySelector(".mv-r").textContent : null,
  }));
  return { up: col("mvUp"), down: col("mvDown"), apart: col("mvApart"), line: document.getElementById("mvLine").textContent, ctx: document.getElementById("mvCtx").textContent,
    text: document.getElementById("flowsMain").innerText, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    heads: Array.from(document.querySelectorAll("h1,h2,h3"), (h) => h.tagName) };
});

const browser = await launch();
const exp = expected(NAMES);

for (const width of [1440, 390, 320]) {
  const { ctx, page, errors, asked } = await mount(browser, width, NAMES);
  const got = await read(page);
  eq(got.up.map((x) => x.t), exp.up, `${width}: risers are ranked by IV-days, largest first, from the definition worked independently`);
  eq(got.down.map((x) => x.t), exp.down, `${width}: fallers likewise, most negative first`);
  eq(got.apart.map((x) => x.t), exp.apart, `${width}: names with earnings inside 21 sessions are ranked apart, not in the lists`);
  ok(!got.up.concat(got.down).some((x) => ["NOIV", "ZIV", "EV1", "EV2"].includes(x.t)), `${width}: no iv30p, zero iv30p, or event name in the clean lists`);
  for (const x of got.up.concat(got.down)) {
    const want = M.signedIvDays(exp.byT[x.t]);
    eq(x.m, want + " IV-days", `${width}: ${x.t} prints its move in IV-days`);
    const k = exp.abs.filter((a) => a >= Math.abs(exp.byT[x.t])).length;
    eq(x.n, `${k} of ${exp.abs.length} names this far out today`, `${width}: ${x.t} prints how many names today were as far out, a count and not a probability`);
  }
  ok(got.apart.every((x) => x.n === null && x.r === null), `${width}: the event names print no cross-section count and no rarity`);
  let rarities = 0;
  for (const x of got.up.concat(got.down)) {
    eq(x.r, exp.rarity[x.t] === undefined ? null : exp.rarity[x.t], `${width}: ${x.t} prints the rarity the reader rule gives, or nothing when the published scale or the multiple is missing`);
    if (x.r !== null) rarities++;
  }
  ok(rarities >= 5, `${width}: at least five rows print a rarity (${rarities})`);
  ok(got.up.find((x) => x.t === "ZH").r.includes("rarer than 1 in 250") && got.up.find((x) => x.t === "ZH").r.includes("at 95%"), `${width}: a zero count is floored at 1 in 250 and says so`);
  ok(got.up.find((x) => x.t === "ONE").r.includes("rarer than 1 in 250 sessions") && !/about 1 in 252/.test(got.text), `${width}: the empirical route is floored at 1 in 250, never printed past it`);
  ok(got.down.find((x) => x.t === "DN2").r === null && got.up.find((x) => x.t === "UP3").r === null, `${width}: a sub-2x move or a name with no published scale prints no rarity`);
  ok(!/\bsigma\b/i.test(got.text) && !/probab|chance/i.test(got.text), `${width}: no sigma wording and no probability claim`);
  ok(got.line.includes(M.LINE) && got.line.includes(M.CAPTION), `${width}: the one-line statement and the IV caption are printed`);
  ok(got.ctx.includes("Nightly, session " + NIGHT) && got.ctx.includes("Median |m|") && got.ctx.includes("beyond 3"), `${width}: the context line names the population and the session`);
  ok(!FORBID.test(got.text), `${width}: no forbidden word in the rendered text`);
  eq(got.heads.filter((h) => h === "H1").length, 1, `${width}: one h1`);
  ok(got.scrollW <= got.innerW, `${width}: no horizontal overflow (${got.scrollW} <= ${got.innerW})`);
  eq(asked, ["universe?cols=t,sec,chg,iv30p,ed,sig,f2,f3"], `${width}: exactly one data request, the existing universe read, no new payload`);
  eq(errors, [], `${width}: no page error`);
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES);
  const strip = { status: "ok", session: "2026-10-12", fields: ["px", "chg", "iv30p"], rows: { LIVE1: [10, 0.05, 0.25], LIVE2: [10, -0.01, 0.2], EV1: [10, 0.5, 0.3], UP1: [10, 0.03, null] } };
  await page.evaluate((s) => { window.__strips = s; window.__rtFire(); }, strip);
  let got = await read(page);
  eq(got.up.map((x) => x.t), ["LIVE1"], "a newer live session replaces the population with the live roster alone");
  ok(got.ctx.includes("Live roster, session 2026-10-12"), "and the context line says so");
  eq(got.apart.map((x) => x.t), ["EV1"], "an earnings name stays apart on the live roster, its event flag taken from the nightly");
  ok(!got.up.concat(got.down).some((x) => x.t === "UP1"), "a live row without iv30p is absent, never zero");

  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES);
  const strip = { status: "ok", session: "2026-10-12", fields: ["px", "chg", "iv30p"], rows: { LIVE1: [10, 0.05, 0.25], LIVE2: [10, -0.01, 0.2] } };
  await page.hover("#mvUp");
  await page.evaluate((s) => { window.__strips = s; window.__rtFire(); }, strip);
  let got = await read(page);
  eq(got.up.map((x) => x.t), exp.up, "THE ORDER IS HELD while the pointer is on the list: a live arrival does not reorder it");
  ok(got.ctx.includes("Order held while you read."), "and says the order is held");
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector(".mv-held"));
  got = await read(page);
  eq(got.up.map((x) => x.t), ["LIVE1"], "when the pointer leaves, the waiting arrival is applied");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 390, NAMES, { body: { status: "pending" } });
  const got = await read(page);
  ok(/not published/.test(await page.textContent("#mvStatus")), "a pending universe says there is nothing to rank");
  eq(got.up, [], "and draws no row");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 390, NAMES, { status: 500, body: {} });
  ok(/could not be loaded/.test(await page.textContent("#mvStatus")), "a failed read says it failed");
  await ctx.close();
}

for (const [name, from, to] of [
  ["a floor of 1 in 1000", "const FLOOR_N = 250;", "const FLOOR_N = 1000;"],
  ["the 3x level taken at 2x", "const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;", "const level = k >= 2 ? 2 : 0;"],
  ["a rounded-up count", "Math.round(1 / p)", "Math.ceil(1 / p)"],
]) {
  const { ctx, page } = await mount(browser, 1440, NAMES, { mutate: [from, to] });
  const got = await read(page);
  const wrong = got.up.concat(got.down).some((x) => x.r !== (exp.rarity[x.t] === undefined ? null : exp.rarity[x.t]));
  ok(wrong, "planted wrong build is caught by the rarity comparison: " + name);
  await ctx.close();
}

await browser.close();
console.log(`✓ flows-moves-render: ${checks} assertions — the owner-only kill switch and its four modes, the page's static text, and the ranked lists in Chromium at 1440, 390 and 320 px against a stubbed universe: IV-days order and cross-section counts equal to an independent computation, earnings names apart, missing and zero implied volatility absent, the live roster replacing the nightly only when newer, the order held under the pointer, no overflow, one data request`);
