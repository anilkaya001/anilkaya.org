/* =============================================================
   flows-sections-contract.mjs — the watch list and the track record.

   Two new pages, and the store change underneath them.

   THE STORE CHANGE IS THE PART THAT COULD LOSE DATA. flows_payload is
   keyed by id alone, so `board:long` overwrote `board:long` every
   morning and the product could never answer "what did this say last
   week" — which is why its own asserted hit rate had never been
   measured by anything. Dated keys fix that, and the key validator is
   what stands between "an authorised publisher writes one row a day"
   and "an authorised publisher mints unbounded primary keys". So the
   validator is tested from both sides: every shape that must be
   accepted, and a set that must not be.

   THE PAGES ARE TESTED EMPTY FIRST. Both ship into an empty store and
   will stay that way until the pipeline next runs, so the state they
   spend their first weeks in is the one most worth asserting. A page
   that renders a confident zero where it means "not yet measurable"
   is the exact failure the track record exists to stop making.
   ============================================================= */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const TOKEN = "sections-token-aaaaaaaaaaaa";
const server = await startWorker({ extraVars: [`FLOWS_INGEST_TOKEN:${TOKEN}`] });
const url = (p) => server.baseURL + p;

const token = await signSession(
  { sub: FLOWS_TEST_USER, aud: "flows", epoch: "1", exp: Date.now() + 600000 }, SESSION_SECRET);
const auth = { Cookie: "flows_session=" + token };

const put = (key, bodyObj) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
  body: JSON.stringify(bodyObj),
});

const browser = await chromium.launch();
try {
  /* ---------- the empty store, asserted BEFORE anything is written -

     Order is part of this file's correctness. A first version put these after
     the key-validator block, which POSTs to `board:watch` and `record` to
     prove they are accepted — so by the time "reports pending" ran, the test
     had published to both and was asserting against its own writes. The
     empty-store states have to be taken first or they cannot be taken at all. */
  {
    const watch = await (await fetch(url("/api/flows/board?side=watch"), { headers: auth })).json();
    eq(watch.status, "pending", "an unpublished watch list reports pending, not an error");
    assert.deepEqual(watch.rows, [], "with no rows invented"); checks++;

    const anonRec = await fetch(url("/api/flows/record"), { redirect: "manual" });
    eq(anonRec.status, 401, "the record needs a session like every other flows API");

    const rec = await (await fetch(url("/api/flows/record"), { headers: auth })).json();
    eq(rec.status, "pending", "an unscored record reports pending");
    assert.deepEqual(rec.horizons, [], "with no horizons invented"); checks++;
  }

  /* ---------- the key validator, from both sides ------------------ */
  {
    /* ACCEPTED. Each of these is a key the pipeline actually writes; a
       validator that rejected one would present as a silently missing
       section rather than as an error anyone would see. */
    for (const key of ["board:long", "board:short", "board:watch", "meta", "record",
                       "board:long:2026-08-26", "board:short:2026-08-26", "card:AAPL"]) {
      const res = await put(key, { ok: true });
      eq(res.status, 200, `the store accepts ${key}`);
    }

    /* REJECTED. This string becomes a PRIMARY KEY, so a loose pattern hands
       an authorised publisher unbounded distinct rows in a table whose write
       budget is shared with a live learning app. */
    const bad = [
      ["board:sideways", "an invented side"],
      ["board:long:26-08-26", "a two-digit year"],
      ["board:long:2026-8-6", "an unpadded date"],
      ["board:long:2026-08-26extra", "a date with a suffix"],
      ["board:watch:2026-08-26", "a dated watch list, which nothing publishes"],
      ["record:2026-08-26", "a dated record, which nothing publishes"],
      ["", "an empty key"],
      ["../etc", "a traversal-shaped key"],
      ["card:lowercase", "a lowercase ticker the read path would uppercase"],
    ];
    for (const [key, why] of bad) {
      const res = await put(key, { ok: true });
      eq(res.status, 400, `the store refuses ${why} (${key})`);
    }
  }

  /* ---------- the prune route, which the archive depends on ------

     The pipeline retains a dated copy of every board so the track record can
     be measured at all, and sweeps its own old keys through this route. Until
     it existed the sweep 405'd, gave up after three refusals and logged that
     the archive would grow untended — loudly, but forever.

     ITS BLAST RADIUS IS THE POINT. The bearer reaching here can already
     overwrite the live board, so narrowing DELETE is not a privilege boundary
     but a damage one: a sweep with an off-by-one in its date arithmetic that
     could name `board:long` would take the section down in a way that reads
     as "the pipeline has never run" rather than as an error. */
  {
    const del = (key) => fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), {
      method: "DELETE", headers: { Authorization: "Bearer " + TOKEN },
    });

    await put("board:long:2026-01-02", { side: "long", rows: [] });
    const hit = await del("board:long:2026-01-02");
    eq(hit.status, 200, "a dated board can be swept");
    eq((await hit.json()).removed, 1, "and reports what it removed");

    const gone = await (await fetch(url("/api/flows/ingest?key=board:long:2026-01-02"), {
      headers: { Authorization: "Bearer " + TOKEN },
    })).json();
    eq(gone.status, "pending", "and it is actually gone from the store");

    /* 404 IS AN ORDINARY EMPTY DAY. The sweep names a fixed skirt of dates
       past the retention edge so a month of downtime self-heals, which means
       almost every name it tries in steady state was never written. Treating
       that as a refusal would trip the caller's circuit breaker on a healthy run. */
    const miss = await del("board:short:2026-01-03");
    eq(miss.status, 404, "a day that was never written answers 404, not an error");
    eq((await miss.json()).removed, 0, "having removed nothing, and saying so");

    /* WHAT IT MUST NEVER REMOVE. Each of these is either the live product or
       a payload no sweep has any business naming. */
    for (const key of ["board:long", "board:short", "board:watch", "record", "meta", "card:AAPL"]) {
      const res = await del(key);
      eq(res.status, 400, `the sweep cannot delete ${key}`);
    }
    const live = await (await fetch(url("/api/flows/ingest?key=board:long"), {
      headers: { Authorization: "Bearer " + TOKEN },
    })).json();
    ok(live.status !== "pending", "and the live board is still there after trying");

    const noAuth = await fetch(url("/api/flows/ingest?key=board:long:2026-01-02"), { method: "DELETE" });
    eq(noAuth.status, 401, "DELETE needs the same bearer as every other verb here");
  }

  /* ---------- both pages are gated, and gated IN PLACE ------------ */
  {
    for (const route of ["/flows/watch/", "/flows/history/"]) {
      const inn = await fetch(url(route), { headers: auth, redirect: "manual" });
      eq(inn.status, 200, `${route} renders for a session`);
      const html = await inn.text();
      ok(html.includes('class="flows-rail"'), `${route} carries the rail`);
      ok(/aria-current="page"/.test(html), `${route} marks itself current in the rail`);

      const anon = await fetch(url(route), { redirect: "manual" });
      eq(anon.status, 200, `${route} answers an anonymous visitor`);
      const anonHtml = await anon.text();
      ok(!anonHtml.includes('class="flows-rail"'),
         `${route} leaks no rail to an anonymous visitor`);
      /* IN PLACE, not a redirect. Bouncing a signed-out reader to /flows/
         loses the page they asked for, and the section's existence is not
         the secret. */
      ok(anonHtml.includes('action="/flows/login"'),
         `${route} offers sign-in at the path asked for`);

      const bare = await fetch(url(route.replace(/\/$/, "")), { redirect: "manual" });
      eq(bare.status, 308, `${route} without its trailing slash redirects`);
    }

    /* The rail reaches every destination. A nav that omits a route is a
       route nobody finds. */
    const html = await (await fetch(url("/flows/"), { headers: auth })).text();
    for (const dest of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/",
                        "/flows/desk/", "/flows/history/"]) {
      ok(html.includes(`href="${dest}"`), `the rail links to ${dest}`);
    }
  }

  /* ---------- the watch board is a third side of one route -------- */
  {
    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok",
      rows: [{ t: "AAA", s: 19, cnv: 40, px: 10 }],
    });
    const got = await (await fetch(url("/api/flows/board?side=watch"), { headers: auth })).json();
    eq(got.rows[0].t, "AAA", "and a published one is served");

    /* AN UNKNOWN SIDE MUST NOT MINT A KEY. The parameter is concatenated into
       a primary key, so anything unrecognised has to fall back rather than
       reach the store.

       ASSERTED AS BYTE IDENTITY WITH ?side=long, not by inspecting the body
       for a shape. A first version checked `side === "long" || rows !== undefined`,
       which is a guess about the payload rather than a statement about the
       fallback — and it failed against a store this very file had filled with
       a stub. What is actually claimed is "these serve the long board", and
       comparing them to the long board says exactly that, whatever it holds. */
    await put("board:long", { side: "long", rows: [{ t: "LONGMARK" }] });
    const canonical = await (await fetch(url("/api/flows/board?side=long"), { headers: auth })).text();
    ok(canonical.includes("LONGMARK"), "the long board is what it was published as");
    for (const raw of ["watchlist", "../record", "WATCH", "long:2026-08-24", ""]) {
      const res = await fetch(url("/api/flows/board?side=" + encodeURIComponent(raw)), { headers: auth });
      eq(res.status, 200, `an unrecognised side (${raw || "empty"}) is answered, not errored`);
      eq(await res.text(), canonical,
         `and serves exactly the long board rather than reaching for ${raw || "empty"}`);
    }

    /* THE DATED COPY IS READABLE BUT NOT REACHABLE FROM THE SIDE PARAMETER.
       It exists for the pipeline to score later, not for the board route to
       serve, and a reader who could ask for an arbitrary date could walk the
       whole retained history through a route that was built to serve one row. */
    await put("board:long:2026-08-24", { side: "long", rows: [{ t: "ZZZ", s: 80 }] });
    const dated = await (await fetch(
      url("/api/flows/board?side=" + encodeURIComponent("long:2026-08-24")), { headers: auth })).json();
    ok(!JSON.stringify(dated).includes("ZZZ"),
       "the side parameter cannot address a dated board");
  }

  /* ---------- the watch page, in a browser ------------------------ */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    /* THE FIXTURE IS ORDERED SO THE CORRECT ANSWER INTERLEAVES.

       Sorting is by DISTANCE TO THE BAND, not by score. With band 20:
         BBB  s=-19  -> distance 1
         CCC  s= 18  -> distance 2
         AAA  s=  4  -> distance 16
       So the correct order is BBB, CCC, AAA. A score sort descending gives
       CCC, AAA, BBB; ascending gives BBB, AAA, CCC; and arrival order is
       AAA, BBB, CCC. All four differ, so this fixture can tell them apart —
       which a fixture already in the right order could not. */
    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok",
      rows: [
        { t: "AAA", s: 4, cnv: 30, px: 51.2, sur: 1.1, rv: 0.9, pcr: 0.8, w52: 0.42 },
        { t: "BBB", s: -19, cnv: 55, px: 12.7, sur: 4.4, rv: 2.1, pcr: 1.9, w52: 0.08 },
        { t: "CCC", s: 18, cnv: 48, px: 240.5, sur: 2.0, rv: 1.4, pcr: 0.6, w52: 0.97 },
      ],
    });

    await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#watchBody tr", { timeout: 15000 });

    const order = (await page.locator("#watchBody th").allTextContents()).map((t) => t.trim());
    assert.deepEqual(order, ["BBB", "CCC", "AAA"],
      "the watch list is ranked by distance to the band, not by score"); checks++;

    /* Distance is DERIVED here, not trusted from the payload — a third
       serialised field that must agree with two others eventually disagrees. */
    const dist = (await page.locator("#watchBody td.c-toband").allTextContents()).map((t) => t.trim());
    assert.deepEqual(dist, ["1", "2", "16"],
      "and the distance shown is the band minus the absolute score"); checks++;

    const near = await page.locator("#watchBody td.c-toband.is-near").count();
    eq(near, 2, "rows within three of the edge are marked");

    const surprised = await page.locator("#watchBody td.is-surprise").count();
    eq(surprised, 1, "and a name at three times its own options-volume norm is marked");

    /* A MULTIPLE, NOT A PERCENTAGE. Rendering 4.4x as "+340%" invites reading
       an activity ratio as a return. */
    const surTexts = await page.locator("#watchBody tr").first().locator("td").nth(4).textContent();
    ok(/×/.test(surTexts), `surprise renders as a multiple (${surTexts})`);

    eq(await page.locator('[data-rail-count="watch"]').textContent(), "3",
       "the rail badges the watch count");

    /* THE TWO EMPTY STATES ARE DIFFERENT FACTS. "The pipeline has not run
       since this shipped" and "the pipeline ran and put nobody in the band"
       are not the same, and the band holds most of the universe — so the
       second would be extraordinary and is called out as a likely fault. */
    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok", rows: [],
    });
    await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".flows-empty", { timeout: 15000 });
    const emptyText = await page.locator(".flows-empty").textContent();
    ok(/publishing fault/.test(emptyText),
       `an empty band is flagged as a likely fault, not reported as a quiet session (${emptyText})`);

    eq(errors.length, 0, `the watch page threw nothing (${errors[0] || ""})`);
    await context.close();
  }

  /* ---------- the track record, in a browser ---------------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    /* ---- empty, which is the state it ships in ---- */
    {
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".rec-empty", { timeout: 15000 });
      const note = await page.locator(".rec-empty").textContent();
      ok(/first pipeline run|No session has been scored/.test(note),
         `an empty record explains WHY it is empty (${note})`);
      const status = await page.locator("#recStatus").textContent();
      ok(/retained|empty/.test(status), `and the status says so too (${status})`);
      /* THE THING THAT MUST NOT HAPPEN: a chart drawn from nothing. */
      eq(await page.locator("#recCurve svg").count(), 0,
         "nothing is plotted when nothing has been measured");
    }

    /* ---- below the floor: measured, but not enough to plot ---- */
    {
      await put("record", {
        status: "ok", retained: 3, firstSession: "2026-08-20", lastSession: "2026-08-24",
        horizons: [{ k: 5, ls: 0.031, n: 3 }, { k: 10, ls: -0.004, n: 2 }],
        sessions: [
          { d: "2026-08-20", long: 0.012, short: -0.004, ls: 0.016, hit: 0.55, lost: 1, names: 20 },
        ],
      });
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".rec-empty, #recCurve svg", { timeout: 15000 });
      /* A THREE-SESSION MEAN IS MOSTLY ITS OWN SAMPLING ERROR. Plotting it
         invites a reading the number cannot support, so the floor holds and
         the page says what the longest horizon actually has. */
      eq(await page.locator("#recCurve svg").count(), 0,
         "a horizon below the stated session floor is not plotted");
      const note = await page.locator(".rec-empty").textContent();
      ok(/3/.test(note), `and the note names how many sessions there actually are (${note})`);
      ok(await page.locator("#recBody tr").count() >= 1,
         "though the per-session table still shows what was measured");
    }

    /* ---- above the floor: the curve draws ---- */
    {
      await put("record", {
        status: "ok", retained: 40, firstSession: "2026-07-01", lastSession: "2026-08-24",
        horizons: [
          { k: 1, ls: 0.002, n: 39 },
          { k: 5, ls: -0.011, n: 35 },
          { k: 10, ls: 0.024, n: 30 },
          { k: 21, ls: 0.041, n: 2 },
        ],
        sessions: [
          { d: "2026-08-24", long: 0.021, short: -0.010, ls: 0.031, hit: 0.61, lost: 1, names: 24 },
          { d: "2026-08-21", long: -0.008, short: 0.004, ls: -0.012, hit: 0.44, lost: 9, names: 22 },
        ],
      });
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#recCurve svg", { timeout: 15000 });

      const plot = await page.evaluate(() => {
        const svg = document.querySelector("#recCurve svg");
        const dots = Array.from(svg.querySelectorAll(".rc-dot"));
        const zero = svg.querySelector(".rc-zero");
        const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
        return {
          dots: dots.length,
          negs: svg.querySelectorAll(".rc-dot.is-neg").length,
          zeroY: zero ? Number(zero.getAttribute("y1")) : null,
          height: vb[3],
          nLabels: Array.from(svg.querySelectorAll(".rc-nlabel")).map((t) => t.textContent),
          titles: Array.from(svg.querySelectorAll(".rc-dot title")).map((t) => t.textContent),
          aria: svg.getAttribute("aria-label"),
        };
      });

      /* The 21-session horizon has n=2, below the floor, so three of four plot. */
      eq(plot.dots, 3, "only horizons past the session floor are plotted");
      eq(plot.negs, 1, "and a negative horizon is drawn as negative");

      /* THE ZERO LINE IS AT ZERO AND INSIDE THE FRAME. A returns chart whose
         baseline floats to the data's minimum turns a uniformly negative
         record into a rising line — the commonest way this plot lies. */
      ok(plot.zeroY !== null && plot.zeroY > 0 && plot.zeroY < plot.height,
         `the zero line is drawn inside the plot (${plot.zeroY} of ${plot.height})`);

      /* n RIDES EVERY POINT. A percentage without its sample size is the one
         thing this page exists to stop printing. */
      assert.deepEqual(plot.nLabels, ["n=39", "n=35", "n=30"],
        "every plotted point carries the sample size it came from"); checks++;
      ok(plot.titles.every((t) => /scored session/.test(t)),
         "and each point names its n in its accessible title");
      ok(/long minus short|Long-minus-short/i.test(plot.aria || ""),
         `the chart states what it measures to a screen reader (${plot.aria})`);

      /* ATTRITION IS A DATA-QUALITY COLUMN. Names leaving the universe are
         not a random sample, so a session losing many of them is close to no
         measurement rather than a noisy one. */
      const attrition = await page.locator("#recBody td.is-attrition").count();
      eq(attrition, 1, "a session that lost more than a fifth of its names is marked");
      const marked = await page.locator("#recBody td.is-attrition").getAttribute("title");
      ok(marked && /not a random sample/.test(marked),
         "and says why that makes the row unreliable rather than noisy");

      const status = await page.locator("#recStatus").textContent();
      ok(/40 sessions retained/.test(status), `the status leads with the sample (${status})`);

      /* THE LEGS CARRY NO SIGN COLOUR. Green-for-positive is a claim that up
         is good, and it is false for the short leg: a positive number there
         means the names the board leaned against rose. Beside a green long leg
         it reads as two wins where there is one of each. Only the difference
         is a result, so only the difference is coloured. */
      const legClasses = await page.evaluate(() => {
        const tr = document.querySelector("#recBody tr");
        return Array.from(tr.querySelectorAll("td")).slice(0, 3).map((td) => td.className);
      });
      ok(/c-leg/.test(legClasses[0]) && !/fb-pos|fb-neg/.test(legClasses[0]),
         `the long leg is a measurement, not a verdict (${legClasses[0]})`);
      ok(/c-leg/.test(legClasses[1]) && !/fb-pos|fb-neg/.test(legClasses[1]),
         `and so is the short leg (${legClasses[1]})`);
      ok(/fb-pos|fb-neg/.test(legClasses[2]),
         `while the spread, which IS a result, carries its sign (${legClasses[2]})`);

      /* A SINGLE "0" IS NOT A SCALE. Without the extremes labelled, +0.2% and
         +20% draw identically and the reader sees a shape with no size. */
      const axis = await page.evaluate(() =>
        Array.from(document.querySelectorAll("#recCurve .rc-axislabel")).map((t) => t.textContent));
      ok(axis.length >= 3, `the y axis is labelled at more than one point (${axis.join(", ")})`);
      ok(axis.includes("0"), "including zero");
      ok(axis.some((t) => /%/.test(t)),
         `and the extremes carry a magnitude (${axis.join(", ")})`);
    }

    /* ---- a uniformly NEGATIVE record, which is the case the zero line is for ----

       The mixed fixture above cannot test this. Its values straddle zero, so
       the domain contains zero whether or not the code puts it there, and
       removing `Math.min(0, ...)` from the domain leaves every assertion
       passing — verified by mutation, which is how this block came to exist.

       A record that is negative at every horizon is the case that matters: a
       chart scaled to its own data draws it as a confident rising line with
       the zero line cropped out of frame entirely, and the reader sees
       improvement where there is only less loss. */
    {
      await put("record", {
        status: "ok", retained: 40, firstSession: "2026-07-01", lastSession: "2026-08-24",
        horizons: [
          { k: 1, ls: -0.004, n: 39 },
          { k: 5, ls: -0.012, n: 35 },
          { k: 10, ls: -0.021, n: 30 },
        ],
        sessions: [{ d: "2026-08-24", long: -0.01, short: 0.011, ls: -0.021, hit: 0.38, lost: 0, names: 24 }],
      });
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#recCurve svg", { timeout: 15000 });

      const neg = await page.evaluate(() => {
        const svg = document.querySelector("#recCurve svg");
        const zero = Number(svg.querySelector(".rc-zero").getAttribute("y1"));
        const ys = Array.from(svg.querySelectorAll(".rc-dot")).map((d) => Number(d.getAttribute("cy")));
        return {
          zero, ys,
          plotTop: Number(svg.getAttribute("data-plot-top")),
          plotHeight: Number(svg.getAttribute("data-plot-height")),
          negs: svg.querySelectorAll(".rc-dot.is-neg").length,
        };
      });

      eq(neg.negs, 3, "every horizon of a losing record is drawn as negative");
      /* INSIDE THE REGION RESERVED FOR DATA, not merely somewhere on the
         canvas. Removing zero from the domain leaves it at y≈7 on this
         fixture — above the plot's top edge, in the margin — which still
         satisfies "on the canvas" and is exactly the crop this guards
         against. The looser assertion was written first and survived the
         mutation; this is what replaced it. */
      ok(neg.zero >= neg.plotTop && neg.zero <= neg.plotTop + neg.plotHeight,
         `the zero line sits in the plot region, not the margin ` +
         `(y=${neg.zero.toFixed(1)}, region ${neg.plotTop}..${neg.plotTop + neg.plotHeight})`);
      /* SVG y grows downward, so "below zero" means a LARGER y. Every point of
         a uniformly negative record must sit under the zero line — which is
         only true if the domain was forced to include zero. */
      ok(neg.ys.every((y) => y > neg.zero),
         `and every point sits below it rather than being rescaled above it ` +
         `(zero at ${neg.zero}, points at ${neg.ys.map((y) => y.toFixed(0)).join(", ")})`);
    }

    eq(errors.length, 0, `the track record threw nothing (${errors[0] || ""})`);

    /* A REAL VIEWPORT, not a styled root element. A first version set
       documentElement.style.width = "390px" and measured scrollWidth against
       it, which does not resize the layout viewport at all — media queries
       never fire, the rail stays a desktop column, and the number it compared
       was meaningless in both directions. */
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    eq(overflow, false, "and the track record overflows nothing at 390px");

    /* The chart is the thing most likely to break the promise: it is drawn at
       a fixed 720-unit viewBox and has to scale down rather than push the page. */
    const chartFits = await page.evaluate(() => {
      const svg = document.querySelector("#recCurve svg");
      return !svg || Math.round(svg.getBoundingClientRect().width) <= window.innerWidth;
    });
    eq(chartFits, true, "and its chart scales to the viewport instead of widening it");

    await context.close();
  }

  console.log(`✓ flows-sections: ${checks} assertions — a key validator tested from both ` +
    `sides, a dated board the side parameter cannot address, a watch list ranked by ` +
    `distance to the band, and a track record that refuses to plot a mean it has too ` +
    `few sessions for`);
} finally {
  await browser.close();
  await server.stop();
}
