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
import { toWatchRows } from "../scripts/flows-pipeline.mjs";

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

    /* THE SAME ORDERING TRAP, TWICE. These were written down in the
       market-wide block below and failed there for exactly the reason the
       comment above this block records: the key validator POSTs to every key
       it proves is accepted, `movers` and `sector:trix` among them. An
       empty-store assertion has to be taken before the file writes anything,
       or it is an assertion about the test's own writes. */
    for (const route of ["/api/flows/movers", "/api/flows/sectors"]) {
      const anon = await fetch(url(route), { redirect: "manual" });
      eq(anon.status, 401, `${route} is gated like every other flows API`);
      const pending = await (await fetch(url(route), { headers: auth })).json();
      eq(pending.status, "pending", `${route} reports pending before the pipeline has run`);
      assert.deepEqual(pending.rows, [], `and ${route} invents no rows`); checks++;
    }

    /* THE PENDING STATE, RENDERED — not just served. The watch page has two
       empty states ("never published" vs "published empty, likely a fault")
       and only the second was ever put in front of a browser; a renderer
       that showed the fault copy for a store that was simply never written
       would have passed every assertion in this file. Has to happen HERE:
       the key-validator block below writes board:watch to prove the key is
       accepted, and after that the store is never empty again. */
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      await context.addCookies([{
        name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
        httpOnly: true, sameSite: "Lax",
      }]);
      const page = await context.newPage();
      await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".flows-empty", { timeout: 15000 });
      const pendingText = await page.locator(".flows-empty").textContent();
      ok(/has been published yet/.test(pendingText) && !/publishing fault/.test(pendingText),
         `an unwritten store renders the never-published copy, not the fault copy (${pendingText})`);
      /* And the rail badge stays hidden: "0" over a store that has never been
         written is a confident reading of nothing. */
      eq(await page.locator('[data-rail-count="watch"]').isHidden(), true,
         "the watch badge stays hidden on a pending payload");

      /* A SORT CLICK ON AN EMPTY BOARD MUST NOT EAT THE EXPLANATION. The
         tbody of an unpublished board holds one full-width row saying WHY it
         is empty; paintRows() redraws the tbody from currentRows, and with
         nothing loaded a header click used to replace the explanation with a
         silent zero-row table. Same reason as the badge: this has to run
         against the never-written store. */
      await page.goto(url("/flows/long/"), { waitUntil: "domcontentloaded" });
      await page.click('.flows-view[data-view="table"]');
      await page.waitForSelector("#flowsBody .fb-empty", { timeout: 15000 });
      const sortBtn = page.locator(".fb-sort:enabled").first();
      if (await sortBtn.count()) await sortBtn.click();
      eq(await page.locator("#flowsBody .fb-empty").count(), 1,
         "a header click on an empty board leaves the explanation standing");
      await context.close();
    }
  }

  /* ---------- the key validator, from both sides ------------------ */
  {
    /* ACCEPTED. Each of these is a key the pipeline actually writes; a
       validator that rejected one would present as a silently missing
       section rather than as an error anyone would see. */
    for (const key of ["board:long", "board:short", "board:watch", "meta", "record",
                       "movers", "sector:trix",
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
      ["sector:momentum", "a sector reading nothing publishes"],
      ["sector:trix:2026-08-26", "a dated sector reading, which nothing publishes"],
      ["movers:long", "a sided movers list, which nothing publishes"],
    ];
    for (const [key, why] of bad) {
      const res = await put(key, { ok: true });
      eq(res.status, 400, `the store refuses ${why} (${key})`);
    }
  }

  /* ---------- the two market-wide readings -----------------------

     Everything else in this section is a residual WITHIN the day's
     cross-section — sector and log-cap are neutralised out of the score by
     construction — so the board could report twelve bullish names and never
     say whether that was breadth or one sector. These two are the top-down
     layer, and both are precomputed: the Worker serves bytes because it has
     10ms of CPU and parsing is the one cost this architecture exists to
     avoid. */
  {
    for (const [route, key] of [["/api/flows/movers", "movers"], ["/api/flows/sectors", "sector:trix"]]) {
      await put(key, { marker: key, rows: [{ t: "AAA" }] });
      const got = await (await fetch(url(route), { headers: auth })).json();
      eq(got.marker, key, `${route} reads ${key} and not some other blob`);
    }

    /* THE TWO ROUTES MUST NOT BE THE SAME ROUTE. They are matched by two
       different path tests against one handler, and a handler that picked its
       key by anything looser than an exact suffix would serve one payload
       under both names — which renders perfectly and is silently wrong. */
    const m = await (await fetch(url("/api/flows/movers"), { headers: auth })).json();
    const sct = await (await fetch(url("/api/flows/sectors"), { headers: auth })).json();
    ok(m.marker !== sct.marker, "and the two routes serve different payloads");
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
      /* ANCHORED TO THE ROUTE. A bare /aria-current/ test passes when the
         rail marks the WRONG page current; the item template emits the
         attribute inside the same tag as its href, so the adjacency is what
         proves the self-link is the one marked. */
      ok(new RegExp('href="' + route + '"[^>]*aria-current="page"').test(html),
         `${route} marks ITSELF current in the rail, not merely something`);

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

    /* THE FIXTURE CROSSES THE WIRE BOUNDARY. The first version of this test
       hand-wrote row objects with its own field names (sur/rv/pcr) while the
       pipeline emitted surpriseTilt/relVolume/putCallRatio — each side's test
       validated its own vocabulary and every live cell rendered a dash or,
       worse, a confident 0.00. So the rows here are built by the pipeline's
       OWN exported toWatchRows: the renderer is driven by the real payload
       shape, and the two ends cannot diverge silently again. */
    const mkPool = (ticker, score, extra = {}) => ({
      ticker, score, residual: score / 100,
      conviction: 50, spot: 100, purity: 0.5, gRegime: "long", flipDist: 0.1,
      fam: { F: score, P: 0, D: 0, O: 50, V: 40 },
      closes: Array.from({ length: 60 }, (_, i) => 100 + i),
      r5: 0.01, r21: 0.02, r42: 0.03,
      week52Pos: 0.42, vrp: 0.03, ivRank: 0.61,
      impliedMovePerc: 0.05, iv30: 0.4, rv30: 0.3,
      ...extra,
    });
    const screener = new Map([
      ["AAA", { close: "51.2" }], ["BBB", { close: "12.7" }],
      ["CCC", { close: "240.5" }], ["DDD", { close: "77.0" }],
    ]);
    /* DDD has NO tilt entry and no 52-week position: the exact live shape of
       a name the vendor said nothing about, and the row on which a coercion
       bug renders "0.00" where the truth is "unmeasured". */
    const tilts = new Map([
      ["AAA", { surpriseTilt: 0.1, relVolume: 1.1, putCallRatio: 0.8 }],
      ["BBB", { surpriseTilt: 1.386, relVolume: 2.1, putCallRatio: 1.9 }],
      ["CCC", { surpriseTilt: -0.51, relVolume: 1.4, putCallRatio: 0.6 }],
    ]);
    const watchRows = toWatchRows(
      [mkPool("AAA", 4), mkPool("BBB", -19), mkPool("CCC", 18),
       mkPool("DDD", 9, { week52Pos: null })],
      screener, tilts);
    /* THE ARRIVAL ORDER MUST INTERLEAVE. toWatchRows emits rows already in
       distance order, so publishing them as returned could not tell a
       renderer that sorts from one that trusts the wire. The renderer owns
       the ordering claim, so the payload is shuffled to alphabetical:
         arrival  AAA, BBB, CCC, DDD
         correct  BBB(1), CCC(2), DDD(11), AAA(16)   [distance to band 20]
         score ↓  CCC, DDD, AAA, BBB;  score ↑  BBB, AAA, DDD, CCC
       All four orders differ. */
    watchRows.sort((a, b) => a.t.localeCompare(b.t));
    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok",
      rows: watchRows,
    });

    await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#watchBody tr", { timeout: 15000 });

    const order = (await page.locator("#watchBody th").allTextContents()).map((t) => t.trim());
    assert.deepEqual(order, ["BBB", "CCC", "DDD", "AAA"],
      "the watch list is ranked by distance to the band, not by score"); checks++;

    /* Distance is DERIVED here, not trusted from the payload — a third
       serialised field that must agree with two others eventually disagrees. */
    const dist = (await page.locator("#watchBody td.c-toband").allTextContents()).map((t) => t.trim());
    assert.deepEqual(dist, ["1", "2", "11", "16"],
      "and the distance shown is the band minus the absolute score"); checks++;

    const near = await page.locator("#watchBody td.c-toband.is-near").count();
    eq(near, 2, "rows within three of the edge are marked");

    const surprised = await page.locator("#watchBody td.is-surprise").count();
    eq(surprised, 1, "and only a tilt past log 3 — one side surprising 3× the other — is marked");

    /* A SIGNED TILT, NOT A MULTIPLE. surpriseTilt is log(callSurprise over
       putSurprise); dressing it in "×" sold a log ratio as a volume multiple. */
    const surTexts = await page.locator("#watchBody tr").first().locator("td").nth(4).textContent();
    ok(/^\+1\.39$/.test(surTexts.trim()), `surprise renders as a signed tilt (${surTexts})`);
    const negTilt = await page.locator("#watchBody tr").nth(1).locator("td").nth(4).textContent();
    ok(/^\u22120\.51$/.test(negTilt.trim()),
       `a put-side tilt carries a real minus, U+2212 (${negTilt})`);

    /* THE UNMEASURED ROW IS THE REGRESSION TEST. Number(null) is 0 and 0 is
       finite, so an unguarded coercion renders DDD's absent tilt as a
       confident "0.00" — a real reading of this field meaning "balanced" —
       and its absent 52-week position as "0%", which the header defines as
       the 52-week low. Every unmeasured cell must be the em dash. */
    const dddCells = await page.locator("#watchBody tr").nth(2).locator("td").allTextContents();
    assert.deepEqual(dddCells.slice(4).map((t) => t.trim()), ["—", "—", "—", "—"],
      `DDD's surprise, rel vol, P/C and 52w are all withheld, never zero (${dddCells.join("|")})`); checks++;

    eq(await page.locator('[data-rail-count="watch"]').textContent(), "4",
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
      /* NOT "any row" — the empty state renders a full-width explanation row,
         so a tr-count floor is true in every reachable state. The session row
         is the only thing that can put the session's own date in a row header
         and two measurement-styled leg cells beside it. */
      eq(await page.locator("#recBody th").first().textContent(), "2026-08-20",
         "though the per-session table still shows the session that was measured");
      eq(await page.locator("#recBody td.c-leg").count(), 2,
         "with both legs rendered as measurements");
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
          /* MEASURED n, UNMEASURED MEAN. Number(null) is 0, so an unguarded
             coercion sails this through the plot filter and draws a dot ON
             the zero line — a confident "flat at 42 sessions" the store never
             said. It must simply not be plotted. */
          { k: 42, ls: null, n: 28 },
        ],
        sessions: [
          { d: "2026-08-24", long: 0.021, short: -0.010, ls: 0.031, hit: 0.61, lost: 1, names: 24 },
          { d: "2026-08-21", long: -0.008, short: 0.004, ls: -0.012, hit: null, lost: 9, names: 22 },
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
      eq(plot.dots, 3,
         "only horizons past the session floor AND with a measured mean are plotted");
      eq(plot.negs, 1, "and a negative horizon is drawn as negative");

      /* A NULL HIT RATE IS A DASH, NOT "0%". Zero percent is a real reading —
         "every long-short call this session was wrong" — and the second row's
         store value is null. */
      const hitCell = await page.evaluate(() =>
        document.querySelectorAll("#recBody tr")[1].querySelectorAll("td")[3].textContent.trim());
      eq(hitCell, "\u2014", "a session with no hit rate shows the em dash, never a confident 0%");

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

    /* THE CHART IS DRAWN AT ITS HOST'S WIDTH, not scaled to it. A fixed
       720-unit viewBox at width:100% "fits" any phone by shrinking — 9px axis
       type becomes 5px — which is the defect every card panel documents. On a
       390px viewport the host is ~350px, so the drawn-vs-rendered ratio is
       the assertion a letterboxed chart cannot pass. */
    /* The redraw is debounced, so WAIT for it rather than racing it — the
       assertion is about the settled state, not the animation frame. */
    await page.waitForFunction(() => {
      const svg = document.querySelector("#recCurve svg");
      if (!svg) return false;
      const drawn = Number(svg.getAttribute("viewBox").split(/\s+/)[2]);
      const shown = svg.getBoundingClientRect().width;
      return shown > 0 && drawn / shown > 0.85 && drawn / shown < 1.15;
    }, { timeout: 10000 }).catch(() => {});
    const chart = await page.evaluate(() => {
      const svg = document.querySelector("#recCurve svg");
      if (!svg) return null;
      const vb = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      return { drawn: vb[2], shown: svg.getBoundingClientRect().width,
               fits: Math.round(svg.getBoundingClientRect().width) <= window.innerWidth };
    });
    ok(chart && chart.fits, "its chart stays inside the viewport");
    ok(chart && chart.shown > 0 && chart.drawn / chart.shown > 0.85 && chart.drawn / chart.shown < 1.15,
       `and one viewBox unit is one CSS pixel (drew ${chart && chart.drawn} for ${chart && chart.shown})`);

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
