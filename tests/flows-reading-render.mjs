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
  const r = document.querySelector("#ftVerdict .ft-read");
  if (!r) return null;
  const chips = [...r.querySelectorAll("button.ft-read-fn[data-id]")];
  const lead = [...r.querySelectorAll(".ft-read-lead")];
  const prose = [...r.querySelectorAll(".ft-read-lead, .ft-read-now, .ft-read-t")];
  return {
    status: r.dataset.status, generated: r.dataset.generated, text: r.innerText,
    headings: [...document.querySelectorAll("#ftVerdict h2, #ftVerdict h3, #ftVerdict h4")].map((h) => [Number(h.tagName[1]), h.textContent.trim()]),
    tags: [...r.querySelectorAll("button.ft-read-tag[data-code]")].map((b) => b.dataset.code),
    leads: lead.length, leadFont: lead[0] ? parseFloat(getComputedStyle(lead[0]).fontSize) : 0, bodyFont: parseFloat(getComputedStyle(r.querySelector(".ft-read-l") || r).fontSize),
    measure: Math.max(0, ...prose.map((p) => p.getBoundingClientRect().width / parseFloat(getComputedStyle(p).fontSize))), rootW: r.getBoundingClientRect().width,
    inlinePills: prose.reduce((n, p) => n + [...p.querySelectorAll("button, .ui-tag")].filter((x) => !x.closest(".ft-read-fns")).length, 0),
    marks: [...r.querySelectorAll(".ft-read-mk")].map((m) => [m.dataset.list, m.textContent, m.getAttribute("aria-hidden")]),
    unk: (() => { const d = r.querySelector("details.ft-read-unk"); return d ? { open: d.open, summary: d.querySelector("summary").textContent } : null; })(),
    tagRows: r.querySelectorAll(".ft-read-tagrow").length,
    chips: chips.map((b) => ({ id: b.dataset.id, aria: b.getAttribute("aria-label"), title: b.getAttribute("title"), text: b.textContent, expanded: b.getAttribute("aria-expanded"), quoted: b.dataset.quoted === "1", type: b.type, tag: b.tagName })),
    link: (() => { const a = r.querySelector("a.ft-read-link"); return a ? { href: a.getAttribute("href"), target: a.target, rel: a.rel, text: a.textContent } : null; })(),
    lists: [...r.querySelectorAll("ul[data-list]")].map((u) => [u.dataset.list, u.children.length]),
    labelled: r.getAttribute("aria-labelledby"), titleId: !!document.getElementById("ftReadT"),
    imgs: r.querySelectorAll("img, script, iframe, a[href^='javascript'], i, b:not(.ft-read-ev b), li li, li > li").length,
    pwned: window.__pwned,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    wide: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed").slice(0, 4).map((el) => el.tagName + "." + String(el.className).slice(0, 40) + ":" + Math.round(el.getBoundingClientRect().right)),
  };
});

{
  const src = TICKER_SRC.slice(TICKER_SRC.indexOf("const READ_LISTS"), TICKER_SRC.indexOf("function renderVerdictCard"));
  ok(src.length > 1500, "(setup) the reading renderer is " + src.length + " characters of source");
  ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write|createContextualFragment|DOMParser/.test(src), "NO INNERHTML OF MODEL TEXT: the renderer never sets markup, inserts adjacent HTML or writes a document");
  ok(/h\("button"/.test(src) && !/h\("div", \{ class: "ft-read".*innerHTML/.test(src), "footnotes are built with the page's own element builder, whose text goes in as text nodes");
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
  ok(/Dossier as of .* TRT/.test(b.text), "and the dossier's as-of time in TRT");
  ok(/Written .* TRT/.test(b.text), "and when it was written");
  ok(b.text.includes("Example Technologies sells software to mid-sized firms."), "the identity line");
  ok(b.text.includes("Now") && b.text.includes("The last price is $127.40"), "a Now paragraph");
  ok(["What is driving it", "Where the evidence disagrees", "What to watch", "Character"].every((h) => b.headings.some((x) => x[1] === h)), "and the driver, tension, watch and character headings: " + JSON.stringify(b.headings.map((h) => h[1])));
  same(b.lists.map((l) => l[0]), ["drivers", "tensions", "watch", "unknown"], "four lists");
  same(b.tags, ["dealer-pinned", "news-driven"], "TAGS in the model's order");
  eq(b.tagRows, 1, "TAGS ARE ONE QUIET ROW");
  eq(b.leads, 1, "HIERARCHY: exactly one lead sentence");
  ok(b.leadFont >= b.bodyFont + 2, "and it is set larger than the body (" + b.leadFont + " against " + b.bodyFont + ")");
  ok(b.measure <= 70, "MEASURE: no prose line is wider than 70 characters of its own font (" + b.measure.toFixed(1) + "em)");
  eq(b.inlinePills, 0, "NO INLINE PILLS in prose: the only controls inside a sentence are numbered footnotes");
  same(b.marks.map((m) => m[0]), ["drivers", "drivers", "tensions", "watch"], "SIGN MARKS on every list item");
  ok(b.marks.every((m) => m[1].length === 1 && m[2] === "true") && new Set(b.marks.map((m) => m[1])).size === 3, "each a printed glyph, different by list (colour is not the only cue), hidden from screen readers");
  same(b.unk, { open: false, summary: "What is not known (1)" }, "WHAT IS NOT KNOWN is a collapsed disclosure");
  eq(b.chips.length, 8, "EVERY CITED FACT IS A FOOTNOTE: eight cites, eight buttons (" + b.chips.map((c) => c.id).join(", ") + ")");
  ok(b.chips.every((c) => c.tag === "BUTTON" && c.type === "button" && c.expanded === "false"), "each a collapsed button that submits nothing");
  same(b.chips.map((c) => c.text), ["1", "2", "3", "4", "5", "6", "7", "8"], "numbered in reading order");
  const price = b.chips.find((c) => c.id === "price.last");
  ok(price.aria.includes("Last price") && price.aria.includes("$127.40"), "its accessible name carries the label and the value with its unit: " + price.aria);
  ok(/as of .* TRT, \d+ minutes before the dossier was read/.test(price.aria) && price.aria.includes("Last price: $127.40"), "its accessible name carries the age: " + price.aria);
  ok(/before the dossier was read/.test(price.title), "and its title does too");
  const desc = b.chips.find((c) => c.id === "identity.description");
  ok(desc.quoted && desc.aria.includes("quoted third-party text") && desc.aria.includes(String.fromCharCode(0x201c)), "a quotation is marked as third-party text and named in quotes");
  ok(b.link && b.link.href === "/api/flows/dossier?t=" + T + "&render=1" && b.link.text === "What the model saw" && b.link.target === "_blank" && /noopener/.test(b.link.rel), "THE LINK to what the model saw: " + JSON.stringify(b.link));
  eq(b.labelled, "ftReadT", "the section is labelled by its heading");
  ok(b.titleId, "and the heading exists");
  const levels = b.headings.map((h) => h[0]);
  ok(levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), "no heading level is skipped inside the panel: " + levels.join(" "));
  ok(!b.overflow, "no horizontal scroll at 390 px " + JSON.stringify(b.wide));

  if (process.env.READING_SHOT) await page.locator("#ftVerdict").screenshot({ path: process.env.READING_SHOT });
  const fn = (id) => page.locator("#ftVerdict .ft-read button.ft-read-fn[data-id='" + id + "']");
  const evOpen = page.locator("#ftVerdict .ft-read .ft-read-ev:not([hidden])");
  eq(await evOpen.count(), 0, "no evidence is open until asked for");
  await fn("price.last").click();
  eq(await fn("price.last").getAttribute("aria-expanded"), "true", "TAPPING a footnote opens it");
  const open = await evOpen.innerText();
  ok(open.includes("Last price") && open.includes("$127.40") && /as of .* TRT, \d+ minutes before the dossier was read/.test(open), "with its label, value, unit and source time: " + JSON.stringify(open));
  await fn("price.change").click();
  eq(await fn("price.last").getAttribute("aria-expanded"), "false", "opening a sibling closes the first");
  ok((await evOpen.innerText()).includes("+1.27%"), "and shows the sibling's figure");
  await page.keyboard.press("Escape");
  eq(await evOpen.count(), 0, "Escape closes it");
  await fn("identity.description").focus();
  await page.keyboard.press("Enter");
  const quote = await evOpen.innerText();
  ok(/no source time/.test(quote) && quote.includes("quoted third-party text") && quote.includes(String.fromCharCode(0x201c)), "KEYBOARD opens a quotation: marked as third-party text, with no source time: " + JSON.stringify(quote));
  await page.keyboard.press("Enter");
  eq(await evOpen.count(), 0, "and Enter again closes it");
  await page.locator("#ftVerdict .ft-read button.ft-read-tag").first().click();
  ok((await evOpen.innerText()).includes("dealers long calls, short puts"), "a tag opens its rule's sentence");
  await page.keyboard.press("Escape");
  await page.locator("#ftVerdict .ft-read details.ft-read-unk summary").click();
  ok(await page.locator("#ftVerdict .ft-read details.ft-read-unk").evaluate((d) => d.open) && (await page.locator("#ftVerdict .ft-read details.ft-read-unk").innerText()).includes("Fundamentals are withheld"), "the disclosure opens to what is not known");
  const order = await page.evaluate(() => [...document.querySelectorAll("#ftVerdict .ft-read button, #ftVerdict .ft-read a[href], #ftVerdict .ft-read summary")].map((el) => el.dataset.id || el.dataset.code || el.tagName));
  ok(order.length >= 12 && order.includes("price.last") && order.includes("dealer-pinned"), "every footnote, tag, the disclosure and the link are tabbable in reading order (" + order.length + " stops)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  ok(await page.evaluate(() => [...document.querySelectorAll("#ftVerdict .ft-read *")].every((e) => Math.max(...getComputedStyle(e).transitionDuration.split(",").map(parseFloat)) < 0.05)), "nothing in the block transitions under reduced motion");

  const templated = clone(READ);
  templated.sections.identity = { ...templated.sections.identity, template: true };
  await mount(page, templated);
  b = await block(page);
  ok(b.text.includes("not model wording"), "AN IDENTITY LINE THAT IS THE PROFILE'S OWN, not the model's, says so");

  await mount(page, HOSTILE);
  b = await block(page);
  ok(b, "A HOSTILE READING still draws");
  eq(b.imgs, 0, "NO ELEMENT WAS BUILT FROM MODEL TEXT: no img, script, iframe, javascript link, b or i from the stubbed strings");
  eq(b.pwned, undefined, "and no handler ran");
  ok(b.text.includes("<img src=x") && b.text.includes("<script>") && b.text.includes("**bold**"), "the markup is shown as the text it is");
  await fn("price.last").click();
  ok((await evOpen.innerText()).includes("<img src=x"), "inside an opened footnote too");

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

  const LATER = clone(READ);
  LATER.sections.now = { ...LATER.sections.now, text: "The last price is $128.10, +1.82% from the previous close." };
  LATER.generatedAt = "2026-10-02T15:31:00.000Z";
  const HELD = { ...clone(READ), held: "previous", refreshing: true, note: "This reading was written for an earlier dossier of " + T + " and is kept until a reading of the current one is written and passes the checks." };
  await mount(page, HELD, { queue: [HELD, LATER] });
  b = await block(page);
  ok(b.status === "ready" && b.text.includes("The last price is $127.40"), "A HELD PREVIOUS READING that is refreshing is drawn as it was written");
  const swapped = await page.waitForFunction(() => (document.querySelector("#ftVerdict .ft-read")?.innerText || "").includes("$128.10"), null, { timeout: 20000 }).then(() => true, () => false);
  ok(swapped, "THE PAGE KEEPS POLLING while held is previous and refreshing is true, and swaps in the new reading when it lands (" + stubs.calls.length + " summary requests)");
  eq(await page.locator("#ftVerdict .ft-read").count(), 1, "still exactly one reading block");

  await mount(page, { ...HELD, refreshing: false });
  await page.waitForTimeout(5000);
  eq(stubs.calls.length, 1, "while a held reading that is NOT refreshing (a refusal cooling down) is not polled: one summary request in five seconds");

  const neuronOld = { status: "ok", tier: "priced", summary: "The earlier card's reading of " + T + ".", llm: true, model: "@cf/zai-org/glm-4.7-flash", generatedAt: "2026-10-01T15:00:00.000Z" };
  await mount(page, READ, { neuron: { ...neuronOld, held: "previous", refreshing: true }, neurons: [{ ...neuronOld, held: "previous", refreshing: true }, { ...neuronOld, summary: "The current card's reading of " + T + ".", generatedAt: "2026-10-02T15:00:00.000Z", held: undefined, refreshing: undefined }] });
  ok((await page.locator("#ftVerdictT").textContent()).includes("earlier card"), "A HELD PREVIOUS NEURON OUTPUT that is refreshing is drawn");
  const neuronSwapped = await page.waitForFunction(() => (document.getElementById("ftVerdictT")?.textContent || "").includes("current card"), null, { timeout: 25000 }).then(() => true, () => false);
  ok(neuronSwapped, "THE PAGE POLLS THE NEURON while it is held and refreshing, and swaps in the new output when it lands (" + stubs.calls.length + " summary requests)");

  await mount(page, BOXED);
  b = await block(page);
  eq(b.status, "generating", "A DOSSIER STILL BEING ASSEMBLED: generating with no sections");
  ok(b.text.includes("still being assembled") && b.chips.length === 0, "says so and draws no chip");

  await mount(page, ABSENT);
  b = await block(page);
  eq(b.status, "absent", "AN ABSENT READING");
  ok(b.text.includes("Nothing is held for " + T), "says nothing is held");
  same(b.lists, [["unknown", 2]], "and names what is unknown");
  eq(b.unk.open, false, "behind the collapsed disclosure");
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
  for (const w of [768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await mount(page, READ);
    b = await block(page);
    ok(b && !b.overflow && b.measure <= 70, "no overflow and a held measure at " + w + " px " + JSON.stringify(b && b.wide));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
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
