/* =============================================================
   flows-motion.mjs — the one surface in this section that moves,
   and the stylesheet contracts that need a real browser to assert.

   The deck card has carried a hover transform since it shipped and
   the `prefers-reduced-motion` block never covered it: a reader who
   asked for no motion got the lift anyway, for two years, and no
   test could have said so because none of them emulated the
   preference.

   Two states, asserted from a real browser: motion allowed, and
   motion declined. The second is the one that matters, and it is
   asserted on BOTH halves — the CSS must not animate and the JS
   must not even attach, because either alone leaves the other free
   to leak.

   THEN EVERYTHING ELSE THAT NEEDS A COMPUTED STYLE. This is the only
   suite that boots a real Worker, signs a real session and opens a
   real browser on a Flows page, which makes it the only place a
   claim about assets/css/flows.css can be checked against what a
   browser actually computes rather than against the text of the
   file. tests/regression.mjs asserts the 320px zero-overflow
   invariant on the eleven public pages and on NO Flows route, so
   base.css was covered and flows.css was not — which is how a
   `minmax(19rem, 1fr)` track floor overflowed the market page by
   three pixels with the whole battery green. That hole is closed
   below, along with the four silences, table leading, the ticker
   header and the footer's measured-rather-than-asserted hit rate.
   ============================================================= */
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
  /**
   * Hover the second deck card and report what moved, on both channels.
   */
  async function probe(reducedMotion) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion,                       // "reduce" | "no-preference"
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
    /* A real pointer path, not a synthetic event: the listener is delegated on
       the deck and reads clientX/clientY, so a dispatched event with no
       coordinates would pass a test the product would fail. */
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

  /* ---------- motion declined ---------- */
  {
    const s = await probe("reduce");
    eq(s.errors.length, 0, `the board threw nothing under reduced motion (${s.errors[0] || ""})`);

    /* THE CSS HALF. `transform: none` computes to the literal string "none";
       any lift at all computes to a matrix. */
    eq(s.transform, "none",
       `a reader who asked for no motion gets NO LIFT on hover (got ${s.transform})`);
    eq(s.transition, "0s", `and nothing transitions (got ${s.transition})`);

    /* THE JS HALF, which is the one a CSS-only fix would miss. The listener
       must not be attached at all — not attached and then ignored — so no
       custom property is ever written. */
    eq(s.mx, "", "the pointer listener never attached, so no --mx was written");
    eq(s.my, "", "nor --my");

    /* AND THE LAYER IS GONE, so a stale property from before a preference
       change could not paint either. */
    eq(s.afterDisplay, "none", "and the spotlight layer is not rendered at all");
  }

  /* ---------- motion allowed ----------
     The other side of the boundary. A test that only checked the reduce case
     would pass against a build that had removed the effect entirely, which is
     not the same product — the hover state is the deck's only affordance that
     a card is a control. */
  {
    const s = await probe("no-preference");
    eq(s.errors.length, 0, `the board threw nothing with motion allowed (${s.errors[0] || ""})`);
    ok(s.transform !== "none" && /matrix/.test(s.transform),
       `hover lifts the card (got ${s.transform})`);
    ok(parseFloat(s.transition) > 0, `with a real transition (got ${s.transition})`);

    ok(s.mx !== "" && s.my !== "",
       `and the pointer position reaches the card as custom properties (--mx ${s.mx}, --my ${s.my})`);
    /* THE SPOTLIGHT FOLLOWS THE POINTER rather than sitting at a fixed spot:
       the pointer ended at 70%/60% of the box, so a hardcoded 50/50 fails. */
    const mx = parseFloat(s.mx), my = parseFloat(s.my);
    ok(mx > 55 && mx < 85, `--mx tracks the pointer's x (${mx}, expected near 70)`);
    ok(my > 45 && my < 75, `--my tracks the pointer's y (${my}, expected near 60)`);
    ok(s.afterDisplay !== "none", "and the spotlight layer is rendered");
    ok(parseFloat(s.afterOpacity) > 0, "and visible while hovered");
  }


  /* ============================================================
     THE STYLESHEET'S OWN CONTRACTS.

     This suite already boots a signed session against a real Worker
     with a real board payload, which makes it the only place in the
     battery that can read a COMPUTED style off a Flows page. Motion
     was the first thing that needed that; it is not the last.

     tests/regression.mjs asserts the 320px zero-overflow invariant on
     the eleven PUBLIC pages and on no Flows route at all — base.css is
     covered and flows.css is not, which is how a 19rem grid floor
     overflowed the market page by three pixels with a green battery.
     The first block below closes that hole.
     ============================================================ */
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
    /* EVERY GATED ROUTE, not the two with a render suite. A route whose
       payload was never ingested still has a shell, a rail, a control bar and
       a footer — which is exactly the geometry this asserts. */
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

    /* ---------- the three silences, in pixels ----------

       Built with the REAL producer — window.FlowsUI.emptyState — rather than
       with a hand-written class string, so a rename in flows-ui.js fails here
       instead of quietly styling nothing. /flows/track/ is used because it is
       one of the two routes that loads flows-ui.js.

       THE ASSERTION IS DISTINCTNESS, not a list of colours. Four silences
       that all resolve to the same border and the same glyph are the defect
       being fixed, and a test that only checked "pending has a dotted border"
       would still pass if every other kind gained one too. */
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

    /* The four silences a reader has to tell apart. "failed" is the same
       silence as "unreadable" (the request did not come back) and "quiet" the
       same as "empty" (measured, nothing there), so those two PAIRS must
       match — a treatment that made them differ would be inventing a
       distinction the prose does not draw. */
    const shape = (k) => silences[k].style + " " + silences[k].width + " " + silences[k].glyph;
    eq(shape("unreadable"), shape("failed"),
       "unreadable and failed are one silence and get one treatment");
    eq(shape("empty"), shape("quiet"),
       "empty and quiet are one silence and get one treatment");

    const distinct = new Set(["pending", "unavailable", "unreadable", "empty"].map(shape));
    eq(distinct.size, 4,
       `the four silences resolve to four different treatments, not ${distinct.size} ` +
       `(${["pending", "unavailable", "unreadable", "empty"].map((k) => k + "=" + shape(k)).join("; ")})`);

    /* AND EACH SURVIVES GREYSCALE. Border STYLE and border WIDTH carry no
       hue at all, so asserting the four are separable on those two channels
       alone is the monochrome-printout test. Colour may repeat the reading;
       it may not be the reading. */
    const monochrome = new Set(["pending", "unavailable", "unreadable", "empty"]
      .map((k) => silences[k].style + " " + silences[k].width));
    eq(monochrome.size, 4,
       "and they are separable with every colour removed — style and width alone");

    /* The three that are NOT an ordinary reading carry a glyph; the measured
       -empty one does not, because it is a reading and must not wear an
       alarm. This is the assertion that fails if someone gives every kind the
       same dagger "for consistency". */
    for (const kind of ["pending", "unavailable", "unreadable"]) {
      ok(silences[kind].glyph && silences[kind].glyph !== "none",
         `"${kind}" carries a glyph as well as a shape (got ${silences[kind].glyph})`);
    }
    eq(silences.empty.glyph, "none",
       "a measured-empty region carries no glyph: it is a reading, not an alarm");

    /* ---------- tables are leaded for figures, not for prose ----------
       base.css sets line-height 1.65 for Latin Modern body copy and no table
       rule overrode it, so a board row cost ~43px for one line of 0.9rem
       mono. The failure case is the one that shipped: inheriting the body. */
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

    /* ---------- the ticker header stays on screen ----------
       21 panels and 5,729px of page; the one element naming the stock used to
       leave the viewport for good on the first scroll. */
    await page.goto(url("/flows/ticker/?t=AAA"), { waitUntil: "load" });
    const head = await page.evaluate(() => {
      const el = document.querySelector(".ft-head");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { position: cs.position, top: cs.top, bg: cs.backgroundColor };
    });
    ok(head, "the ticker page emits its identity block");
    eq(head.position, "sticky", "and it is pinned rather than scrolled away");
    eq(head.top, "0px", "at the top of the viewport");
    ok(!/rgba\(0, 0, 0, 0\)/.test(head.bg),
       `on an OPAQUE ground, or a chart's ink reads through it (got ${head.bg})`);

    await context.close();
  }

  /* ---------- the rail's slots, on every route ----------

     The events badge was queried by flows-events.js and emitted by nothing:
     the slot set covered long, short and watch, so the query matched no node
     and the badge could never appear — a silent no-op, which is why it lived
     for as long as it did. The assertion is that the set of emitted slots and
     the set of filled slots are the SAME set, checked against the served
     markup rather than against a list written twice. */
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

    /* The name block is emitted on the ticker route ONLY, and hidden until a
       controller fills it. A stat rail rendered as a frame of em dashes while
       a fetch is in flight is a set of readings that came back blank. */
    await page.goto(url("/flows/ticker/"), { waitUntil: "domcontentloaded" });
    const railStats = await page.evaluate(() => {
      const el = document.querySelector("#ftRail");
      return el ? { cls: el.className, hidden: el.hidden, text: el.textContent.trim() } : null;
    });
    ok(railStats, "/flows/ticker/ emits the rail's name block");
    eq(railStats.cls, "rail-stats", "under the class the stylesheet styles");
    eq(railStats.hidden, true, "hidden until a controller fills it");
    eq(railStats.text, "", "and empty, so it cannot render a frame of dashes");

    await page.goto(url("/flows/market/"), { waitUntil: "domcontentloaded" });
    eq(await page.evaluate(() => !!document.querySelector("#ftRail")), false,
       "and nowhere else: a name block on a route with no name is chrome for nothing");

    /* ---------- the footer stopped asserting a hit rate ----------
       The failure case IS the shipped one: a literal performance range in a
       renderer, on a product that now measures the real thing one rail-click
       away. */
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
    `that survives a scroll, and a footer that no longer asserts a hit rate it does not ` +
    `measure`);
} finally {
  await browser.close();
  await server.stop();
}
