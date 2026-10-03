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
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(next ? { ...neuron, read: next } : neuron) });
      }
      const body = key === "board" ? { status: "pending", rows: [] } : api[key] === undefined ? { status: "pending" } : api[key];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/ticker/?t=" + encodeURIComponent(T));
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name\u2026"; }, null, { timeout: 15000 });
  await page.waitForTimeout(150);
}

const block = (page) => page.evaluate(() => {
  const r = document.querySelector("#ftVerdict .ft-read");
  if (!r) return null;
  const chips = [...r.querySelectorAll("button.ft-read-chip[data-id]")];
  return {
    status: r.dataset.status, generated: r.dataset.generated, text: r.innerText,
    headings: [...document.querySelectorAll("#ftVerdict h2, #ftVerdict h3, #ftVerdict h4")].map((h) => [Number(h.tagName[1]), h.textContent.trim()]),
    tags: [...r.querySelectorAll("button.ft-read-chip[data-code]")].map((b) => b.dataset.code),
    chips: chips.map((b) => ({ id: b.dataset.id, aria: b.getAttribute("aria-label"), title: b.getAttribute("title"), text: b.textContent, quoted: b.dataset.quoted === "1", type: b.type, tag: b.tagName })),
    link: (() => { const a = r.querySelector("a.ft-read-link"); return a ? { href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent } : null; })(),
    lists: [...r.querySelectorAll("ul[data-list]")].map((u) => [u.dataset.list, u.children.length]),
    labelled: r.getAttribute("aria-labelledby"), titleId: !!document.getElementById("ftReadT"),
    imgs: r.querySelectorAll("img, script, iframe, a[href^='javascript'], i, b:not(.ft-read-chip b), li li, li > li").length,
    pwned: window.__pwned,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    wide: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed").slice(0, 4).map((el) => el.tagName + "." + String(el.className).slice(0, 40) + ":" + Math.round(el.getBoundingClientRect().right)),
  };
});

{
  const src = TICKER_SRC.slice(TICKER_SRC.indexOf("const READ_LISTS"), TICKER_SRC.indexOf("function renderVerdictCard"));
  ok(src.length > 1500, "(setup) the reading renderer is " + src.length + " characters of source");
  ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write|createContextualFragment|DOMParser/.test(src), "NO INNERHTML OF MODEL TEXT: the renderer never sets markup, inserts adjacent HTML or writes a document");
  ok(/h\("button"/.test(src) && !/h\("div", \{ class: "ft-read".*innerHTML/.test(src), "chips are built with the page's own element builder, whose text goes in as text nodes");
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: false });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await mount(page, READ);
  let b = await block(page);
  ok(b, "A READY READING is drawn inside the Neuron panel");
  eq(b.status, "ready", "status ready");
  eq(b.generated, "1", "generated");
  ok(b.text.includes("Model wording") && b.text.includes("Glm 4.7 Flash") && b.text.includes("56 neurons"), "the label, the model and the neuron cost are visible: " + JSON.stringify(b.text.slice(0, 160)));
  ok(/Dossier as of/.test(b.text), "and the dossier's as-of time");
  ok(/Written/.test(b.text), "and when it was written");
  ok(b.text.includes("Example Technologies sells software to mid-sized firms."), "the identity line");
  ok(b.text.includes("Now") && b.text.includes("The last price is $127.40"), "a Now paragraph");
  ok(["What is driving it", "Where the evidence disagrees", "What to watch", "Not known", "Character"].every((h) => b.headings.some((x) => x[1] === h)), "and the driver, tension, watch, unknown and character headings: " + JSON.stringify(b.headings.map((h) => h[1])));
  same(b.lists.map((l) => l[0]), ["drivers", "tensions", "watch", "unknown"], "four lists");
  same(b.tags, ["dealer-pinned", "news-driven"], "TAG CHIPS in the model's order");
  eq(b.chips.length, 8, "EVERY CITED FACT IS A CHIP: eight cites, eight chips (" + b.chips.map((c) => c.id).join(", ") + ")");
  ok(b.chips.every((c) => c.tag === "BUTTON" && c.type === "button"), "each a button that submits nothing");
  const price = b.chips.find((c) => c.id === "price.last");
  ok(price.text.includes("Last price") && price.text.includes("$127.40"), "a chip shows the label and the value with its unit: " + price.text);
  ok(/as of .* ET, \d+ minutes before the dossier was read/.test(price.aria) && price.aria.includes("Last price: $127.40"), "its accessible name carries the age: " + price.aria);
  ok(/before the dossier was read/.test(price.title), "and its title does too");
  const desc = b.chips.find((c) => c.id === "identity.description");
  ok(desc.quoted && desc.aria.includes("quoted third-party text") && desc.text.includes(String.fromCharCode(0x201c)), "a quotation is marked as third-party text and drawn in quotes");
  ok(b.link && b.link.href === "/api/flows/dossier?t=" + T + "&render=1" && b.link.text === "What the model saw" && b.link.target === "_blank" && /noopener/.test(b.link.rel), "THE LINK to what the model saw: " + JSON.stringify(b.link));
  eq(b.labelled, "ftReadT", "the section is labelled by its heading");
  ok(b.titleId, "and the heading exists");
  const levels = b.headings.map((h) => h[0]);
  ok(levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), "no heading level is skipped inside the panel: " + levels.join(" "));
  ok(!b.overflow, "no horizontal scroll at 390 px " + JSON.stringify(b.wide));

  if (process.env.READING_SHOT) await page.locator("#ftVerdict").screenshot({ path: process.env.READING_SHOT });
  const chip = page.locator("#ftVerdict .ft-read button.ft-read-chip[data-id='price.last']");
  await chip.hover();
  ok(await page.locator("#ftVerdict .ft-read button[data-id='price.last'] .ft-read-age").count() === 1, "HOVER shows the age on the chip");
  await page.mouse.move(5, 5);
  eq(await page.locator("#ftVerdict .ft-read .ft-read-age").count(), 0, "and moving away hides it");
  await page.locator("#ftVerdict .ft-read button.ft-read-chip[data-id]").first().focus();
  eq(await page.locator("#ftVerdict .ft-read .ft-read-age").count(), 1, "KEYBOARD FOCUS shows the age too");
  const shown = await page.locator("#ftVerdict .ft-read .ft-read-age").first().textContent();
  ok(/no source time/.test(shown), "the age text of a vendor profile that carries no time: " + shown);
  await page.locator("#ftVerdict .ft-read button.ft-read-chip[data-id='price.last']").focus();
  ok(/as of .* ET/.test(await page.locator("#ftVerdict .ft-read .ft-read-age").first().textContent()), "and of a priced fact, its source time");
  await page.keyboard.press("Escape");
  eq(await page.locator("#ftVerdict .ft-read .ft-read-age").count(), 0, "Escape hides it");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => (document.activeElement.dataset.id || document.activeElement.dataset.code || document.activeElement.tagName));
  ok(typeof focused === "string" && focused.length > 0, "Tab moves to the next chip (" + focused + ")");
  eq(await page.locator("#ftVerdict .ft-read .ft-read-age").count(), 1, "which shows its age as it takes focus");
  const order = await page.evaluate(async () => {
    const ids = [];
    const r = document.querySelector("#ftVerdict .ft-read");
    r.querySelector("button.ft-read-chip").focus();
    for (let i = 0; i < 40; i++) {
      const el = document.activeElement;
      if (!r.contains(el)) break;
      ids.push(el.dataset.id || el.dataset.code || el.tagName);
      const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
      el.dispatchEvent(ev);
      const all = [...r.querySelectorAll("button, a[href]")];
      const next = all[all.indexOf(el) + 1];
      if (!next) break;
      next.focus();
    }
    return ids;
  });
  ok(order.length >= 10 && order.includes("price.last") && order.includes("dealer-pinned"), "every chip, tag and the link is reachable in reading order (" + order.length + " stops)");

  await mount(page, HOSTILE);
  b = await block(page);
  ok(b, "A HOSTILE READING still draws");
  eq(b.imgs, 0, "NO ELEMENT WAS BUILT FROM MODEL TEXT: no img, script, iframe, javascript link, b or i from the stubbed strings");
  eq(b.pwned, undefined, "and no handler ran");
  ok(b.text.includes("<img src=x") && b.text.includes("<script>") && b.text.includes("**bold**"), "the markup is shown as the text it is");
  ok(b.chips.some((c) => c.text.includes("<img src=x")), "inside a chip too");

  await mount(page, FALLBACK);
  b = await block(page);
  eq(b.status, "fallback", "A FALLBACK READING is drawn");
  eq(b.generated, "0", "not generated");
  ok(b.text.includes("Deterministic reading") && !b.text.includes("neurons") && !b.text.includes("Model wording is being written"), "labelled deterministic, with no neuron cost");
  ok(b.text.includes("No model is configured for this site."), "and the reason");
  eq(b.chips.length, 8, "with all its chips");

  await mount(page, GENERATING, { queue: [GENERATING, READ] });
  b = await block(page);
  eq(b.status, "generating", "A GENERATING READING is drawn with its deterministic sections");
  ok(b.text.includes("Model wording is being written") && b.text.includes("Deterministic reading") && b.chips.length === 8, "and says the model's wording is coming");
  const polled = await page.waitForFunction(() => document.querySelector("#ftVerdict .ft-read")?.dataset.status === "ready", null, { timeout: 20000 }).then(() => true, () => false);
  ok(polled, "THE PAGE POLLS THE SUMMARY and swaps in the model's wording when it lands");
  ok(stubs.calls.length >= 2, "(" + stubs.calls.length + " summary requests in all)");
  b = await block(page);
  ok(b.text.includes("Model wording") && b.text.includes("56 neurons") && b.generated === "1", "the swapped block is the model's, with its cost");
  eq(await page.locator("#ftVerdict .ft-read").count(), 1, "and there is still exactly one reading block");

  await mount(page, BOXED);
  b = await block(page);
  eq(b.status, "generating", "A DOSSIER STILL BEING ASSEMBLED: generating with no sections");
  ok(b.text.includes("still being assembled") && b.chips.length === 0, "says so and draws no chip");

  await mount(page, ABSENT);
  b = await block(page);
  eq(b.status, "absent", "AN ABSENT READING");
  ok(b.text.includes("Nothing is held for " + T), "says nothing is held");
  same(b.lists, [["unknown", 2]], "and names what is unknown");
  eq(b.link.href, "/api/flows/dossier?t=" + T + "&render=1", "with the link to the dossier text");
  eq(b.chips.length, 0, "no chip");

  await mount(page, null);
  eq(await page.locator("#ftVerdict .ft-read").count(), 0, "A SUMMARY WITH NO read FIELD (an older Worker) draws no block and breaks nothing");
  await mount(page, { status: "weird", sections: 5 });
  eq(await page.locator("#ftVerdict .ft-read").count(), 0, "and an unknown status draws none");

  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(page, READ);
  b = await block(page);
  ok(b && !b.overflow, "NO HORIZONTAL SCROLL at 1280 px either " + JSON.stringify(b && b.wide));
  await page.setViewportSize({ width: 320, height: 900 });
  await mount(page, READ);
  b = await block(page);
  ok(b && !b.overflow, "nor at 320 px " + JSON.stringify(b && b.wide));

  const mine = errors.filter((e) => !/flows-ticker: (buildGamma|buildFlow) failed/.test(e));
  eq(mine.length, 0, "no page error or console error through any of it, beyond the two modules the thin fixture card cannot feed (gamma and flow): " + mine.join(" | "));
} finally {
  await browser.close();
}

function same(a, b, m) { assert.deepEqual(a, b, m); checks++; }

console.log("flows-reading-render: " + checks + " checks");
