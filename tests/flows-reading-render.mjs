import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import * as F from "./dossier-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const card = F.card(F.T);
const companion = () => ({ status: "pending" });

const TICKER_SRC = fs.readFileSync(path.join(ROOT, "assets/js/flows-ticker.js"), "utf8");
const PAGE_HTML = FLOWS_PAGES.tickerPage({ username: "test" });
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const T = card.ticker;
const AT = "2026-10-02T14:30:00.000Z";
const MINUS = String.fromCharCode(0x2212);

const cite = (id, label, display, o = {}) => ({ id, label, display, asOf: "2026-10-02T14:24:00.000Z", kind: id.split(".")[0], grade: 3, ...o });

const READ = {
  version: 1, status: "ready", ticker: T, generated: true, label: "Model wording", model: "@cf/zai-org/glm-4.7-flash", modelName: "Glm 4.7 Flash", neurons: 56, tokens: { in: 5400, out: 700 },
  provenance: "Model wording by Glm 4.7 Flash, checked sentence by sentence against the facts it cites; every figure was copied from them. It cost 56 neurons.", note: null, why: null,
  fingerprint: "d1.abc", asOf: AT, session: "2026-10-01", generatedAt: "2026-10-02T14:31:00.000Z", coverage: { ok: 10, partial: 1, withheld: 1, pending: 0 },
  tags: [
    { code: "dealer-pinned", label: "Dealers pinning", sentence: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", evidence: ["options.state"] },
    { code: "news-driven", label: "News driven", sentence: "4 headlines in the last 24 hours.", evidence: ["news.count24h"] },
  ],
  sections: {
    identity: { text: "Example Technologies sells software to mid-sized firms.", cites: [cite("identity.description", "Company description, UW stock info", "Example Technologies sells subscription software and cloud infrastructure services", { untrusted: true, asOf: null })] },
    now: { text: "The last price is $127.40, +1.27% from the previous close.", cites: [cite("price.last", "Last price", "$127.40"), cite("price.change", "Change from the previous close", "+1.27%")] },
    drivers: [
      { text: "News flow is steady, and Reuters reports a cloud contract win.", cites: [cite("news.count24h", "Headlines in the last 24 hours", "4"), cite("news.h1", "Headline, Reuters", "positive: wins a multi-year cloud contract", { untrusted: true })] },
      { text: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", cites: [cite("options.state", "Implied dealer state", "pinned", { asOf: "2026-10-02T00:10:00.000Z" })] },
    ],
    tensions: [{ text: "Flow leans to puts while price is stretched.", cites: [cite("flow.strip.lean", "Bullish against bearish premium", MINUS + "0.47")] }],
    unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
    watch: [{ text: "Below the gamma flip at $124.00 dealers are net short gamma on the vendor's convention (dealers long calls, short puts).", cites: [cite("options.engine.level.flip", "Gamma flip", "$124.00")] }],
  },
  refused: [],
};
const FALLBACK = { ...clone(READ), status: "fallback", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null, generatedAt: null, why: "cooldown",
  provenance: "Deterministic reading: assembled from templates over the dossier's facts. No model is configured for this site." };
const GENERATING = { ...clone(FALLBACK), status: "generating", why: "generating", provenance: "Deterministic reading: assembled from templates over the dossier's facts while a model writes its wording." };
const BOXED = { version: 1, status: "generating", ticker: T, generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null, provenance: "The dossier is being assembled.", note: "The dossier for " + T + " is still being assembled.",
  why: "assembling", fingerprint: null, asOf: null, session: null, generatedAt: null, coverage: { ok: 0, partial: 0, withheld: 0, pending: 0 }, tags: [], sections: { identity: null, now: null, drivers: [], tensions: [], unknown: [], watch: [] }, refused: [] };
const ABSENT = { ...clone(BOXED), status: "absent", why: "nothing", note: "Nothing is held for " + T + " that a reading can be written from.", provenance: "Deterministic reading: no packet of the dossier holds anything to read.",
  asOf: AT, sections: { identity: null, now: null, drivers: [], tensions: [], unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about it.", missing: ["fundamentals"] }, { text: "Headlines are pending, so nothing is claimed about it.", missing: ["news"] }], watch: [] } };
const HOSTILE = clone(READ);
HOSTILE.sections.now = { text: "Price <img src=x onerror=\"window.__pwned=1\"> is <script>window.__pwned=2</script> **bold** [a](http://evil.test)", cites: [cite("price.last", "<b>Last</b> price", "<img src=x onerror=\"window.__pwned=3\">")] };
HOSTILE.sections.drivers[0] = { text: "javascript:alert(1) &lt;b&gt;", cites: [cite("news.h1", "Headline, <i>Reuters</i>", "</li><li>injected", { untrusted: true })] };

const stubs = { summary: null, calls: [] };

async function mount(page, read_, o = {}) {
  const neuron = { status: "quiet", scope: T, summary: null, ideas: [], tier: "family", code: null, why: "x", ...(o.neuron || {}), read: read_ };
  stubs.calls = [];
  stubs.queue = (o.queue || []).slice();
  stubs.neurons = (o.neurons || []).slice();
  const api = {
    card, summary: neuron, "card-x": companion(), hist: companion(),
    tape: { status: "pending" }, meta: { status: "pending" }, events: { status: "pending", rows: [] },
    now: { serverNow: Date.parse(card.generatedAt || "2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} },
  };
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      if (key === "summary") {
        stubs.calls.push(Date.now());
        const next = stubs.queue.length ? stubs.queue.shift() : null;
        const nextNeuron = stubs.neurons.length ? stubs.neurons.shift() : null;
        const base = nextNeuron ? { ...neuron, ...nextNeuron } : neuron;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(next ? { ...base, read: next } : base) });
      }
      const body = key === "board" ? { status: "pending", rows: [] } : api[key] === undefined ? { status: "pending" } : api[key];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.goto("https://example.test/flows/ticker/?t=" + encodeURIComponent(T));
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name\u2026"; }, null, { timeout: 15000 });
  await page.waitForTimeout(150);
}

const block = (page) => page.evaluate(() => {
  const r = document.getElementById("ftReadRail");
  if (!r || r.hidden) return null;
  const c = r.cloneNode(true);
  c.querySelectorAll(".visually-hidden").forEach((n) => n.remove());
  return {
    status: r.dataset.status || null, text: c.textContent.replace(/\s+/g, " ").trim(), full: r.textContent,
    claims: [...r.querySelectorAll(".ft-claim")].map((b) => ({ id: b.dataset.claim, list: b.dataset.list, text: b.querySelector(".ft-claim-t").textContent })),
    lead: (r.querySelector(".ft-rail-lead") || r.querySelector(".ft-claim-t") || {}).textContent || null,
    headings: [...document.querySelectorAll("#ftGlance h1, #ftGlance h2, #ftVerdict h2")].map((h) => [Number(h.tagName[1]), h.textContent.trim()]),
    foot: (r.querySelector(".ft-foot") || {}).textContent || "",
    imgs: r.querySelectorAll("img, script, iframe, a[href^='javascript'], [onerror]").length,
    pwned: window.__pwned,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    wide: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed").slice(0, 4).map((el) => el.tagName + "." + String(el.className).slice(0, 40) + ":" + Math.round(el.getBoundingClientRect().right)),
  };
});

{
  const src = TICKER_SRC.slice(TICKER_SRC.indexOf("const arr = (v)"), TICKER_SRC.indexOf("function renderVerdict(card, neuron)"));
  ok(src.length > 4000, "(setup) the reading rail renderer is " + src.length + " characters of source");
  ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write|createContextualFragment|DOMParser/.test(src), "NO INNERHTML OF MODEL TEXT: the renderer never sets markup, inserts adjacent HTML or writes a document");
  ok(/h\("button"/.test(src), "claims are built with the page's own element builder, whose text goes in as text nodes");
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const ready = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById("ftReadRail")?.textContent || ""), re, { timeout: 20000 }).then(() => true, () => false);

  await mount(page, READ);
  let b = await block(page);
  ok(b, "A READY READING is drawn in the reading rail");
  eq(b.status, "ready", "status ready");
  ok(b.lead.startsWith("The last price is $127.40"), "the headline is the now section");
  same(b.claims.map((c) => [c.id, c.list]), [["1", "now"], ["2", "drivers"], ["3", "drivers"], ["4", "tensions"]], "four numbered claims, now then drivers then tensions then watch, as the chart numbers them");
  ok(/as of .* TRT/.test(b.text), "and the dossier's as-of time in TRT");
  ok(!/Glm|neurons|Model wording|Written/.test(b.text), "no model, cost or written-at line in the rail");
  const levels = b.headings.map((h) => h[0]);
  ok(levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), "no heading level is skipped: " + levels.join(" "));
  ok(!b.overflow, "no horizontal scroll at 1440 px " + JSON.stringify(b.wide));
  ok(await page.evaluate(() => /Model wording/.test(document.getElementById("ftReadSrc").textContent)), "the provenance is one visually hidden sentence for screen readers");

  const templated = clone(READ);
  templated.sections.identity = { ...templated.sections.identity, template: true };
  await mount(page, templated);
  b = await block(page);
  ok(b.lead.startsWith("The last price"), "an identity section never replaces the now headline");

  await mount(page, HOSTILE);
  b = await block(page);
  ok(b, "A HOSTILE READING still draws");
  eq(b.imgs, 0, "NO ELEMENT WAS BUILT FROM MODEL TEXT: no img, script, iframe, javascript link or handler from the stubbed strings");
  eq(b.pwned, undefined, "and no handler ran");
  ok(b.text.includes("<img src=x") && b.text.includes("<script>") && b.text.includes("**bold**"), "the markup is shown as the text it is");

  await mount(page, FALLBACK);
  b = await block(page);
  eq(b.status, "fallback", "A FALLBACK READING is drawn");
  ok(/Deterministic reading/.test(b.foot) && !/neurons|Model wording is being written/.test(b.text), "labelled deterministic in the footnote line, with no neuron cost");
  eq(b.claims.length, 4, "with all its claims");

  await mount(page, GENERATING, { queue: [GENERATING, READ] });
  b = await block(page);
  eq(b.status, "generating", "A GENERATING READING is drawn with its deterministic sections");
  ok(/being written/.test(b.text) && b.claims.length === 4, "and says the model's wording is coming");
  const polled = await page.waitForFunction(() => document.getElementById("ftReadRail")?.dataset.status === "ready", null, { timeout: 20000 }).then(() => true, () => false);
  ok(polled, "THE PAGE POLLS THE SUMMARY and swaps in the model's wording when it lands");
  ok(stubs.calls.length >= 2, "(" + stubs.calls.length + " summary requests in all)");
  eq(await page.locator("#ftReadRail").count(), 1, "and there is still exactly one reading rail");

  const LATER = clone(READ);
  LATER.sections.now = { ...LATER.sections.now, text: "The last price is $128.10, +1.82% from the previous close." };
  LATER.generatedAt = "2026-10-02T15:31:00.000Z";
  const HELD = { ...clone(READ), held: "previous", refreshing: true, note: "This reading was written for an earlier dossier of " + T + " and is kept until a reading of the current one is written and passes the checks." };
  await mount(page, HELD, { queue: [HELD, LATER] });
  b = await block(page);
  ok(b.status === "ready" && b.lead.includes("$127.40"), "A HELD PREVIOUS READING that is refreshing is drawn as it was written");
  ok(await ready("\\$128\\.10"), "THE PAGE KEEPS POLLING while held is previous and refreshing is true, and swaps in the new reading when it lands (" + stubs.calls.length + " summary requests)");

  await mount(page, { ...HELD, refreshing: false });
  await page.waitForTimeout(5000);
  eq(stubs.calls.length, 1, "while a held reading that is NOT refreshing (a refusal cooling down) is not polled: one summary request in five seconds");

  const neuronOld = { status: "ok", tier: "priced", summary: "The earlier card's reading of " + T + ".", llm: true, model: "@cf/zai-org/glm-4.7-flash", generatedAt: "2026-10-01T15:00:00.000Z" };
  await mount(page, READ, { neuron: { ...neuronOld, held: "previous", refreshing: true }, neurons: [{ ...neuronOld, held: "previous", refreshing: true }, { ...neuronOld, summary: "The current card's reading of " + T + ".", generatedAt: "2026-10-02T15:00:00.000Z", held: undefined, refreshing: undefined }] });
  ok((await page.locator("#ftVerdictT").textContent()).includes("earlier card"), "A HELD PREVIOUS NEURON OUTPUT that is refreshing is drawn");
  const neuronSwapped = await page.waitForFunction(() => (document.getElementById("ftVerdictT")?.textContent || "").includes("current card") && (document.querySelector(".ft-strip-line")?.textContent || "").includes("current card"), null, { timeout: 25000 }).then(() => true, () => false);
  ok(neuronSwapped, "THE PAGE POLLS THE NEURON while it is held and refreshing, and swaps in the new output into the card and the strip (" + stubs.calls.length + " summary requests)");

  await mount(page, BOXED);
  b = await block(page);
  eq(b.status, "generating", "A DOSSIER STILL BEING ASSEMBLED: generating with no sections");
  ok(b.text.includes("still being assembled") && b.claims.length === 0, "says so and draws no claim");

  await mount(page, ABSENT);
  b = await block(page);
  eq(b.status, "absent", "AN ABSENT READING");
  ok(b.text.includes("Nothing is held for " + T), "says nothing is held");
  ok(/What is not known/.test(b.foot) && b.claims.length === 0, "and keeps what is not known one button away");

  await mount(page, null);
  ok(/No reading is available/.test((await block(page)).text), "A SUMMARY WITH NO read FIELD (an older Worker) draws a quiet line and breaks nothing");
  await mount(page, { status: "weird", sections: 5 });
  ok(/No reading is available/.test((await block(page)).text), "and an unknown status draws the same");

  for (const w of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width: w, height: 900 });
    await mount(page, READ);
    b = await block(page);
    ok(b && !b.overflow, "no horizontal scroll at " + w + " px " + JSON.stringify(b && b.wide));
  }

  const mine = errors.filter((e) => !/flows-ticker: (buildGamma|buildFlow) failed/.test(e));
  eq(mine.length, 0, "no page error or console error through any of it, beyond the two modules the thin fixture card cannot feed (gamma and flow): " + mine.join(" | "));
} finally {
  await browser.close();
}

function same(a, b, m) { assert.deepEqual(a, b, m); checks++; }

console.log("flows-reading-render: " + checks + " checks");
