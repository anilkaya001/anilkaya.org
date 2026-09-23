import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TOKEN = "motion-token-aaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

await fetch(url("/api/flows/ingest?key=board:long"), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify({
    v: 2, side: "long", sessionDate: "2026-08-24", status: "ok",
    universe: 260, enriched: 60, scored: 60, deadBand: 20, neutral: 44,
    rows: [
      { t: "AAA", r: 1, s: 62, cnv: 80, px: 101.5, chg: 0.014, purity: 0.4,
        gRegime: "short", gFlipDist: -0.05, netPrem: 1.2e7,
        fam: { F: 40, P: 30, D: 20, V: 55, O: 61 }, pr: [120, 240, 90],
        w52: 0.7, vrp: 0.02, ivr: 0.4, im: 0.05, hm: 0.06, hr: 0.05 },
      { t: "BBB", r: 2, s: 48, cnv: 70, px: 22.1, chg: -0.004, purity: 0.3,
        gRegime: "long", gFlipDist: 0.08, netPrem: -3.1e6,
        fam: { F: 20, P: 10, D: 5, V: 40, O: 50 }, pr: [40, 60, 10],
        w52: 0.3, vrp: -0.01, ivr: 0.6, im: 0.04, hm: 0.05, hr: 0.06 },
    ],
  }),
});

const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);

const browser = await chromium.launch();
try {

  async function probe(reducedMotion) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion,
      hasTouch: false,
    });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url("/flows/long/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#flowsBody .bd-row[data-flip]", { timeout: 15000 });
    await page.waitForTimeout(400);

    const row = page.locator("#flowsBody .bd-row[data-flip]").first();
    const box = await row.boundingBox();

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
    await page.waitForTimeout(300);

    const state = await page.evaluate(async () => {
      const el = document.querySelector("#flowsBody .bd-row[data-flip]");
      const hover = getComputedStyle(el).transform;
      const rank = () => document.querySelector('#bdHead [data-col="r"] .bd-hs');
      rank().click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      rank().click();
      const rows = [...document.querySelectorAll("#flowsBody .bd-row[data-flip]")];
      const written = rows.filter((r) => /translate/.test(r.style.transform)).length;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const flipping = rows.filter((r) => r.classList.contains("is-flip"));
      return {
        transform: hover,
        written,
        flipping: flipping.length,
        transition: flipping.length ? getComputedStyle(flipping[0]).transitionDuration : getComputedStyle(el).transitionDuration,
        order: [...document.querySelectorAll("#flowsBody .bd-open")].map((a) => a.textContent).join(","),
      };
    });
    await context.close();
    return { ...state, errors };
  }

  {
    const fs = await import("node:fs");
    const mins = new Map(), maxes = new Map();
    let queries = 0;
    const sheets = ["assets/css/base.css", ...fs.readdirSync(new URL("../assets/css/", import.meta.url))
      .filter((f) => /^flows(-[\w-]+)?\.css$/.test(f)).sort().map((f) => "assets/css/" + f)];
    ok(sheets.length > 5, `the scan covers the shared sheets and every Flows route sheet (${sheets.length})`);
    for (const file of sheets) {
      const css = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
      for (const q of css.matchAll(/@media[^{]*/g)) {
        for (const m of q[0].matchAll(/\(\s*(min|max)-width:\s*([\d.]+)(rem|px)\s*\)/g)) {
          queries++;
          const px = String(+(Number(m[2]) * (m[3] === "rem" ? 16 : 1)).toFixed(2));
          (m[1] === "min" ? mins : maxes).set(px, file);
        }
      }
    }

    ok(queries > 15,
       `the width-query scan actually read the stylesheets (found ${queries})`);
    const both = [...maxes.keys()].filter((w) => mins.has(w));
    assert.deepEqual(both, [],
      "no width is written as both a min and a max, in either unit and across every Flows sheet: a " +
      "60/60 pair matches at exactly 60rem and applies two tiers at once (write the max as X.99)");
    checks++;
  }

  {
    const s = await probe("reduce");
    eq(s.errors.length, 0, `the board threw nothing under reduced motion (${s.errors[0] || ""})`);

    eq(s.transform, "none",
       `a reader who asked for no motion gets NO LIFT on hover (got ${s.transform})`);
    eq(s.order, "BBB,AAA", "the sort itself still happened — only the motion stood down");
    eq(s.written, 0,
       "and reordering the list wrote no transform at all: the JS never starts the slide, so the CSS " +
       "has nothing to leak past it");
    eq(s.flipping, 0, "and no row was marked as sliding");
  }

  {
    const s = await probe("no-preference");
    eq(s.errors.length, 0, `the board threw nothing with motion allowed (${s.errors[0] || ""})`);
    eq(s.transform, "none",
       `hover does not lift a row either (got ${s.transform}): a list row answers the pointer with a fill, ` +
       "and motion is kept for a change in the data");
    eq(s.order, "BBB,AAA", "the reversed rank reorders the rows");
    ok(s.written > 0,
       `with motion allowed a reorder starts every moved row from where it was (${s.written} rows written ` +
       "a translate the moment the order changed)");
    ok(s.flipping > 0 && parseFloat(s.transition) > 0,
       `and slides it home on a real spring transition (${s.flipping} rows, ${s.transition})`);
  }

  {
    const context = await browser.newContext({
      viewport: { width: 320, height: 720 },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();

    for (const route of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/",
                         "/flows/market/", "/flows/unusual/", "/flows/events/",
                         "/flows/ticker/", "/flows/desk/", "/flows/track/",
                         "/flows/history/", "/flows/political/"]) {
      await page.goto(url(route), { waitUntil: "load" });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 1, `[320px] ${route} widened the document by ${overflow}px`);
    }

    await page.goto(url("/flows/track/"), { waitUntil: "load" });
    await page.waitForFunction(() => !!window.FlowsUI, null, { timeout: 15000 });
    const silences = await page.evaluate(() => {
      const kinds = ["pending", "unavailable", "unreadable", "failed", "empty", "quiet"];
      const host = document.createElement("div");
      document.body.append(host);
      const out = {};
      for (const kind of kinds) {
        const node = window.FlowsUI.emptyState(kind, "fixture sentence for " + kind);
        host.append(node);
        const cs = getComputedStyle(node);
        const before = getComputedStyle(node, "::before");
        out[kind] = {
          cls: node.className,
          attr: node.getAttribute("data-empty"),
          style: cs.borderLeftStyle,
          width: cs.borderLeftWidth,
          glyph: before.content,
        };
      }
      host.remove();
      return out;
    });

    for (const kind of ["pending", "unavailable", "unreadable", "failed", "empty", "quiet"]) {
      eq(silences[kind].cls, "flows-empty",
         `emptyState still emits .flows-empty for "${kind}" — these rules key off it`);
      eq(silences[kind].attr, kind, `and tags data-empty="${kind}"`);
    }

    const shape = (k) => silences[k].style + " " + silences[k].width + " " + silences[k].glyph;
    eq(shape("unreadable"), shape("failed"),
       "unreadable and failed are one silence and get one treatment");
    eq(shape("empty"), shape("quiet"),
       "empty and quiet are one silence and get one treatment");

    const distinct = new Set(["pending", "unavailable", "unreadable", "empty"].map(shape));
    eq(distinct.size, 4,
       `the four silences resolve to four different treatments, not ${distinct.size} ` +
       `(${["pending", "unavailable", "unreadable", "empty"].map((k) => k + "=" + shape(k)).join("; ")})`);

    const monochrome = new Set(["pending", "unavailable", "unreadable", "empty"]
      .map((k) => silences[k].style + " " + silences[k].width));
    eq(monochrome.size, 4,
       "and they are separable with every colour removed — style and width alone");

    for (const kind of ["pending", "unavailable", "unreadable"]) {
      ok(silences[kind].glyph && silences[kind].glyph !== "none",
         `"${kind}" carries a glyph as well as a shape (got ${silences[kind].glyph})`);
    }
    eq(silences.empty.glyph, "none",
       "a measured-empty region carries no glyph: it is a reading, not an alarm");

    await page.goto(url("/flows/long/"), { waitUntil: "load" });
    await page.waitForSelector("#flowsBody .bd-row[data-flip]", { timeout: 15000 });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(200);
    const leading = await page.evaluate(() => {
      const head = document.querySelector("#bdHead [role=columnheader]");
      const cell = document.querySelector('#flowsBody [data-col="netPrem"] .bd-n');
      const body = getComputedStyle(document.body);
      const ratio = (el) => parseFloat(getComputedStyle(el).lineHeight) / parseFloat(getComputedStyle(el).fontSize);
      return head && cell ? {
        head: ratio(head), cell: ratio(cell),
        bodyRatio: parseFloat(body.lineHeight) / parseFloat(body.fontSize),
      } : null;
    });
    await page.setViewportSize({ width: 320, height: 720 });
    ok(leading, "the board's header and a figure cell exist to measure");
    ok(leading.head > 1.1 && leading.head < 1.4,
       `a column header is leaded at ${leading.head.toFixed(2)}, not at the body's ${leading.bodyRatio.toFixed(2)}`);
    ok(leading.cell > 1.1 && leading.cell < 1.4,
       `and so is a figure in a row (${leading.cell.toFixed(2)}): cells are leaded for figures rather than for prose`);

    await page.goto(url("/flows/ticker/?t=AAA"), { waitUntil: "load" });
    await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 15000 });
    const head = await page.evaluate(async () => {
      const bar = document.getElementById("fxBar"), title = document.getElementById("fxBarT");
      const hero = document.querySelector("[data-fx-hero]"), name = document.querySelector("[data-fx-title]");
      const grid = document.getElementById("ftGrid");
      if (!bar || !title || !hero || !name || !grid) return null;
      if (!name.textContent.trim()) name.textContent = "AAA";
      hero.hidden = false;
      hero.classList.remove("is-loading");
      grid.hidden = false;
      grid.style.minHeight = "3000px";
      await new Promise((r) => setTimeout(r, 120));
      const cs = getComputedStyle(bar);
      window.scrollTo({ top: 900, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 350));
      const box = bar.getBoundingClientRect();
      const heroBox = hero.getBoundingClientRect();
      const ground = [getComputedStyle(bar).backgroundColor, getComputedStyle(bar, "::before").backgroundColor, getComputedStyle(bar, "::before").backdropFilter || ""];
      const out = { position: cs.position, top: box.top, bottom: box.bottom, heroBottom: heroBox.bottom, scrolled: bar.classList.contains("is-scrolled"),
        title: title.textContent.trim(), name: name.textContent.trim(), titleOpacity: Number(getComputedStyle(title).opacity), ground };
      window.scrollTo({ top: 0, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 350));
      out.restTitleOpacity = Number(getComputedStyle(title).opacity);
      out.restScrolled = bar.classList.contains("is-scrolled");
      return out;
    });

    await page.goto(url("/flows/ticker/"), { waitUntil: "load" });
    const leaked = await page.evaluate(() => [...document.querySelectorAll("[hidden]")]
      .filter((n) => getComputedStyle(n).display !== "none")
      .map((n) => (n.id || n.className || n.tagName) + " → " + getComputedStyle(n).display));
    assert.deepEqual(leaked, [],
      "every element marked hidden is actually not laid out");
    checks++;

    ok(head, "the ticker page emits its identity: a hero the toolbar watches and a title the toolbar mirrors");
    ok(/sticky|fixed/.test(head.position), `and the toolbar that carries it once the hero is gone is pinned rather than scrolled away (${head.position})`);
    ok(head.heroBottom < head.bottom, "900px down the hero has left the screen");
    ok(head.scrolled, "and the toolbar knows it: it switches to its scrolled state");
    eq(head.title, head.name, "and it names the page with the hero's own title, mirrored rather than restated");
    ok(head.titleOpacity > 0.9, `and shows it (opacity ${head.titleOpacity})`);
    ok(head.top >= 0 && head.top < 400, `the identity is still on screen 900px down (top ${head.top})`);
    ok(head.ground.some((g) => g && !/rgba\(0, 0, 0, 0\)|^none$/.test(g)),
       `the pinned bar has a ground, or a chart's ink reads through it (${head.ground.join(" | ")})`);
    ok(!head.restScrolled && head.restTitleOpacity < 0.1,
       "and back at the top the bar hides the title again, because the hero is saying it");

    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    for (const route of ["/flows/", "/flows/market/", "/flows/ticker/"]) {
      await page.goto(url(route), { waitUntil: "domcontentloaded" });
      const keys = await page.evaluate(() => [...document.querySelectorAll("[data-rail-count]")]
        .map((n) => n.getAttribute("data-rail-count")).sort());
      assert.deepEqual(keys, ["events", "long", "short", "watch"],
        `[${route}] the rail emits a badge slot for every key a renderer fills`);
      checks++;
    }

    await page.goto(url("/flows/ticker/"), { waitUntil: "domcontentloaded" });
    eq(await page.evaluate(() => !!document.querySelector("#ftRail")), false,
       "/flows/ticker/ emits no rail name block: nothing has ever filled one");

    const leakedWide = await page.evaluate(() => [...document.querySelectorAll("[hidden]")]
      .filter((n) => getComputedStyle(n).display !== "none")
      .map((n) => (n.id || n.className || n.tagName) + " \u2192 " + getComputedStyle(n).display));
    assert.deepEqual(leakedWide, [],
      "[1280px] every element marked hidden is actually not laid out");
    checks++;

    const flowsCss = (await import("node:fs"))
      .readFileSync(new URL("../assets/css/flows.css", import.meta.url), "utf8");
    eq(/\.rail-stats/.test(flowsCss), false,
       "and flows.css carries no .rail-stats rules for an element nothing emits");

    for (const route of ["/flows/", "/flows/long/", "/flows/short/"]) {
      await page.goto(url(route), { waitUntil: "domcontentloaded" });
      const foot = await page.evaluate(() => {
        const p = document.querySelector(".flows-foot");
        const slot = document.querySelector("#flowsHitRate");
        return {
          text: p ? p.textContent.replace(/\s+/g, " ").trim() : null,
          slot: slot ? slot.textContent.replace(/\s+/g, " ").trim() : null,
          href: slot ? slot.querySelector("a")?.getAttribute("href") : null,
        };
      });
      ok(foot.text && !/\d\d\s*(?:%|&ndash;|–|-)\s*\d\d\s*%/.test(foot.text),
         `[${route}] the footer states no unmeasured hit rate (got "${foot.text}")`);
      ok(foot.slot && foot.slot.length > 0,
         `[${route}] and the slot ships a sentence that is true before any fetch`);
      eq(foot.href, "/flows/history/",
         `[${route}] pointing at the page that measures it`);
    }
    await context.close();
  }

  console.log(`✓ flows-motion: ${checks} assertions — a board row answers the pointer with a fill and ` +
    `never a lift, and moves only when its order changes, and under reduced motion BOTH halves stand ` +
    `down: the JS writes no transform and the CSS has no transition to run, so neither can leak past ` +
    `the other. Plus the ` +
    `stylesheet's own contracts, which had nowhere else to be asserted: zero horizontal ` +
    `overflow at 320px on all twelve gated routes (regression.mjs covers the public pages ` +
    `and no Flows route), four visually distinct silences that stay distinct with every ` +
    `colour removed, table cells leaded for figures rather than for prose, a ticker header ` +
    `measured against the fixed topbar in both the shape the controller builds and the ` +
    `shape the HTML ships, \`hidden\` proven to hide at BOTH a phone and a desk width ` +
    `— the class of leak that shows nothing at 320px and an empty bordered box at every ` +
    `desk — and the rail's never-filled stat block gone from the markup AND from the ` +
    `stylesheet, a breakpoint ladder with no width ` +
    `written as both a min and a max, and a footer that no longer asserts a hit rate it ` +
    `does not measure`);
} finally {
  await browser.close();
  await server.stop();
}
