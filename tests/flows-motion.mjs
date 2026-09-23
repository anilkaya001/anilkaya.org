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
    await page.waitForSelector(".fd-card", { timeout: 15000 });

    const card = page.locator(".fd-card").first();
    const box = await card.boundingBox();

    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const el = document.querySelector(".fd-card");
      const style = getComputedStyle(el);
      const after = getComputedStyle(el, "::after");
      return {
        transform: style.transform,
        transition: style.transitionDuration,
        mx: el.style.getPropertyValue("--mx"),
        my: el.style.getPropertyValue("--my"),
        afterDisplay: after.display,
        afterOpacity: after.opacity,
      };
    });
    await context.close();
    return { ...state, errors };
  }

  {
    const fs = await import("node:fs");
    const mins = new Map(), maxes = new Map();
    let queries = 0;
    for (const file of ["assets/css/base.css", "assets/css/flows.css"]) {
      const css = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
      for (const m of css.matchAll(/@media\s*\(\s*(min|max)-width:\s*([\d.]+)rem\s*\)/g)) {
        queries++;
        (m[1] === "min" ? mins : maxes).set(m[2], file);
      }
    }

    ok(queries > 15,
       `the width-query scan actually read the stylesheets (found ${queries})`);
    const both = [...maxes.keys()].filter((w) => mins.has(w));
    assert.deepEqual(both, [],
      "no width is written as both a min and a max: a 60/60 pair matches at " +
      "exactly 60rem and applies two tiers at once (write the max as X.99)");
    checks++;
  }

  {
    const s = await probe("reduce");
    eq(s.errors.length, 0, `the board threw nothing under reduced motion (${s.errors[0] || ""})`);

    eq(s.transform, "none",
       `a reader who asked for no motion gets NO LIFT on hover (got ${s.transform})`);
    eq(s.transition, "0s", `and nothing transitions (got ${s.transition})`);

    eq(s.mx, "", "the pointer listener never attached, so no --mx was written");
    eq(s.my, "", "nor --my");

    eq(s.afterDisplay, "none", "and the spotlight layer is not rendered at all");
  }

  {
    const s = await probe("no-preference");
    eq(s.errors.length, 0, `the board threw nothing with motion allowed (${s.errors[0] || ""})`);
    ok(s.transform !== "none" && /matrix/.test(s.transform),
       `hover lifts the card (got ${s.transform})`);
    ok(parseFloat(s.transition) > 0, `with a real transition (got ${s.transition})`);

    ok(s.mx !== "" && s.my !== "",
       `and the pointer position reaches the card as custom properties (--mx ${s.mx}, --my ${s.my})`);

    const mx = parseFloat(s.mx), my = parseFloat(s.my);
    ok(mx > 55 && mx < 85, `--mx tracks the pointer's x (${mx}, expected near 70)`);
    ok(my > 45 && my < 75, `--my tracks the pointer's y (${my}, expected near 60)`);
    ok(s.afterDisplay !== "none", "and the spotlight layer is rendered");
    ok(parseFloat(s.afterOpacity) > 0, "and visible while hovered");
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
    await page.waitForSelector(".fd-card", { timeout: 15000 });
    const leading = await page.evaluate(() => {
      const wrap = document.querySelector("#flowsTableWrap");
      if (wrap) wrap.hidden = false;
      const cell = document.querySelector(".flows-table thead th");
      const body = getComputedStyle(document.body);
      return cell ? {
        lh: getComputedStyle(cell).lineHeight,
        fs: getComputedStyle(cell).fontSize,
        bodyLh: body.lineHeight,
        bodyFs: body.fontSize,
      } : null;
    });
    ok(leading, "the board's table exists to measure");
    const ratio = parseFloat(leading.lh) / parseFloat(leading.fs);
    ok(ratio > 1.1 && ratio < 1.4,
       `a table cell is leaded at ${ratio.toFixed(2)}, not at the body's ` +
       `${(parseFloat(leading.bodyLh) / parseFloat(leading.bodyFs)).toFixed(2)}`);

    await page.goto(url("/flows/ticker/?t=AAA"), { waitUntil: "load" });
    await page.waitForSelector(".ft-bar", { state: "attached", timeout: 15000 });
    const head = await page.evaluate(async () => {
      const el = document.querySelector(".ft-head");
      if (!el) return null;
      const cs = getComputedStyle(el);
      const out = { position: cs.position, top: cs.top };

      const bar = el.closest(".ft-bar");
      const grid = document.getElementById("ftGrid");
      out.inBar = !!bar;
      if (!bar || !grid) return out;

      const measure = async (pinned) => {

        const sc = document.getElementById("ftScroll");
        const scrollBox = sc && sc.scrollHeight > sc.clientHeight ? sc : window;
        scrollBox.scrollTo({ top: 900, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 250));
        const nav = document.querySelector(".topbar").getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const bg = getComputedStyle(pinned).backgroundColor;
        scrollBox.scrollTo({ top: 0, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 250));
        return { headTop: box.top, height: box.height, navBottom: nav.bottom, bg };
      };

      grid.style.minHeight = "3000px";
      grid.hidden = false;

      el.hidden = false;
      bar.hidden = false;
      out.composed = await measure(bar);

      grid.parentNode.insertBefore(el, grid);
      bar.hidden = true;
      out.served = await measure(el);
      return out;
    });

    await page.goto(url("/flows/ticker/"), { waitUntil: "load" });
    const leaked = await page.evaluate(() => [...document.querySelectorAll("[hidden]")]
      .filter((n) => getComputedStyle(n).display !== "none")
      .map((n) => (n.id || n.className || n.tagName) + " → " + getComputedStyle(n).display));
    assert.deepEqual(leaked, [],
      "every element marked hidden is actually not laid out");
    checks++;

    ok(head, "the ticker page emits its identity block");
    eq(head.position, "sticky", "and it is pinned rather than scrolled away");
    ok(head.inBar, "the controller re-parents it into the sticky bar");
    ok(!/rgba\(0, 0, 0, 0\)/.test(head.composed.bg),
       `[composed] the pinned box has a ground once it is pinned, or a chart's ink reads ` +
       `through it (got ${head.composed.bg})`);
    ok(!/rgba\(0, 0, 0, 0\)/.test(head.served.bg),
       `[served] and so does the header when it is the pinned box itself ` +
       `(got ${head.served.bg})`);

    ok(head.composed.headTop >= 0 && head.composed.headTop < 400,
       `[composed] the header is still on screen 900px down (top ${head.composed.headTop})`);
    ok(head.served.headTop >= 0 && head.served.headTop < 400,
       `[served] and so is the header the HTML ships, before the bar exists ` +
       `(top ${head.served.headTop})`);

    ok(head.composed.headTop >= head.composed.navBottom - 1,
       `[composed] and it clears the fixed topbar (head ${head.composed.headTop} ` +
       `vs nav bottom ${head.composed.navBottom})`);
    ok(head.served.headTop >= head.served.navBottom - 1,
       `[served] and so does the served shape — a sticky offset on this site is ` +
       `never 0 (head ${head.served.headTop} vs nav bottom ${head.served.navBottom})`);

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

  console.log(`✓ flows-motion: ${checks} assertions — the deck card is the section's only ` +
    `moving surface, and under reduced motion BOTH halves stand down: the CSS does not ` +
    `transform and the JS does not attach, so neither can leak past the other. Plus the ` +
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
