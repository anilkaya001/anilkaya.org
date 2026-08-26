/* =============================================================
   flows-motion.mjs — the one surface in this section that moves.

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

  console.log(`✓ flows-motion: ${checks} assertions — the deck card is the section's only ` +
    `moving surface, and under reduced motion BOTH halves stand down: the CSS does not ` +
    `transform and the JS does not attach, so neither can leak past the other`);
} finally {
  await browser.close();
  await server.stop();
}
