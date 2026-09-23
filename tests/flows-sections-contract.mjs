import assert from "node:assert/strict";
import { chromium } from "playwright";
import { signSession } from "../shared/session.js";
import { startWorker, SESSION_SECRET, FLOWS_TEST_USER } from "./worker-server.mjs";
import { toWatchRows } from "../scripts/flows-pipeline.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const RAIL_OFF = new Set();
const RAIL_LISTS = (route) => !RAIL_OFF.has(route);
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

const WROW = "#watchBody .bd-row[data-flip]";
const readWhy = async (page) => {
  await page.click(".bd-silent[data-empty] [data-info]");
  await page.waitForSelector("#fxPop:popover-open");
  const text = await page.$eval("#fxPop", (el) => el.innerText);
  await page.keyboard.press("Escape");
  return text;
};

const browser = await chromium.launch();
try {

  {
    const watch = await (await fetch(url("/api/flows/board?side=watch"), { headers: auth })).json();
    eq(watch.status, "pending", "an unpublished watch list reports pending, not an error");
    assert.deepEqual(watch.rows, [], "with no rows invented"); checks++;

    const anonRec = await fetch(url("/api/flows/record"), { redirect: "manual" });
    eq(anonRec.status, 401, "the record needs a session like every other flows API");

    const rec = await (await fetch(url("/api/flows/record"), { headers: auth })).json();
    eq(rec.status, "pending", "an unscored record reports pending");
    assert.deepEqual(rec.horizons, [], "with no horizons invented"); checks++;

    for (const route of ["/api/flows/movers", "/api/flows/sectors"]) {
      const anon = await fetch(url(route), { redirect: "manual" });
      eq(anon.status, 401, `${route} is gated like every other flows API`);
      const pending = await (await fetch(url(route), { headers: auth })).json();
      eq(pending.status, "pending", `${route} reports pending before the pipeline has run`);
      assert.deepEqual(pending.rows, [], `and ${route} invents no rows`); checks++;
    }

    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      await context.addCookies([{
        name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
        httpOnly: true, sameSite: "Lax",
      }]);
      const page = await context.newPage();
      await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector('.bd-silent[data-empty="pending"]', { timeout: 15000 });
      const pendingText = await readWhy(page);
      ok(/has been published yet/.test(pendingText) && !/publishing fault/.test(pendingText),
         `an unwritten store renders the never-published copy behind its pending glyph, not the fault copy (${pendingText})`);

      eq(await page.locator('[data-rail-count="watch"]').isHidden(), true,
         "the watch badge stays hidden on a pending payload");

      await page.goto(url("/flows/long/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".bd-silent[data-empty]", { timeout: 15000 });
      const sortBtn = page.locator("#bdHead .bd-hs:enabled").first();
      if (await sortBtn.count()) await sortBtn.click();
      const sortSel = page.locator("#fbSort");
      if (await sortSel.count()) await sortSel.selectOption({ index: 0 });
      eq(await page.locator(".bd-silent[data-empty]").count(), 1,
         "a sort on an empty board leaves the explanation standing");
      eq(await page.locator("#bdEmpty").isHidden(), false, "and visible");
      await context.close();
    }
  }

  {

    for (const key of ["board:long", "board:short", "board:watch", "meta", "record",
                       "movers", "sector:trix",
                       "board:long:2026-08-26", "board:short:2026-08-26", "card:AAPL"]) {
      const res = await put(key, { ok: true });
      eq(res.status, 200, `the store accepts ${key}`);
    }

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

  {
    for (const [route, key] of [["/api/flows/movers", "movers"], ["/api/flows/sectors", "sector:trix"]]) {
      await put(key, { marker: key, rows: [{ t: "AAA" }] });
      const got = await (await fetch(url(route), { headers: auth })).json();
      eq(got.marker, key, `${route} reads ${key} and not some other blob`);
    }

    const m = await (await fetch(url("/api/flows/movers"), { headers: auth })).json();
    const sct = await (await fetch(url("/api/flows/sectors"), { headers: auth })).json();
    ok(m.marker !== sct.marker, "and the two routes serve different payloads");
  }

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

    const miss = await del("board:short:2026-01-03");
    eq(miss.status, 404, "a day that was never written answers 404, not an error");
    eq((await miss.json()).removed, 0, "having removed nothing, and saying so");

    await put("scores:2026-01-02", { rows: [{ t: "TEST", s: 0 }] });
    const sHit = await del("scores:2026-01-02");
    eq(sHit.status, 200, "a dated scores pool can be swept");
    eq((await sHit.json()).removed, 1, "and reports what it removed");

    for (const key of ["board:long", "board:short", "board:watch", "record", "meta", "card:AAPL",
                       "scoretrack", "flowalerts", "pulse"]) {
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

  {
    for (const route of ["/flows/watch/", "/flows/history/"]) {
      const inn = await fetch(url(route), { headers: auth, redirect: "manual" });
      eq(inn.status, 200, `${route} renders for a session`);
      const html = await inn.text();
      ok(html.includes('class="flows-rail"'), `${route} carries the rail`);

      if (RAIL_LISTS(route)) {
        ok(new RegExp('href="' + route + '"[^>]*aria-current="page"').test(html),
           `${route} marks ITSELF current in the rail, not merely something`);
      } else {
        const rail = (/<nav class="flows-rail"[\s\S]*?<\/nav>/.exec(html) || [""])[0];
        ok(rail.includes("flows-rail"), `${route}: the rail markup is found before it is read`);
        ok(!/aria-current="page"/.test(rail),
           `${route} is not in the rail, so the rail marks NOTHING current — a page ` +
           "that lit up a neighbour would tell a reader they are somewhere they are not");
      }

      const anon = await fetch(url(route), { redirect: "manual" });
      eq(anon.status, 200, `${route} answers an anonymous visitor`);
      const anonHtml = await anon.text();
      ok(!anonHtml.includes('class="flows-rail"'),
         `${route} leaks no rail to an anonymous visitor`);

      ok(anonHtml.includes('action="/flows/login"'),
         `${route} offers sign-in at the path asked for`);

      const bare = await fetch(url(route.replace(/\/$/, "")), { redirect: "manual" });
      eq(bare.status, 308, `${route} without its trailing slash redirects`);
    }

    const html = await (await fetch(url("/flows/"), { headers: auth })).text();
    for (const dest of ["/flows/", "/flows/long/", "/flows/short/", "/flows/watch/",
                        "/flows/desk/"]) {
      ok(html.includes(`href="${dest}"`), `the rail links to ${dest}`);
    }
  }

  {
    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok",
      rows: [{ t: "AAA", s: 19, cnv: 40, px: 10 }],
    });
    const got = await (await fetch(url("/api/flows/board?side=watch"), { headers: auth })).json();
    eq(got.rows[0].t, "AAA", "and a published one is served");

    await put("board:long", { side: "long", rows: [{ t: "LONGMARK" }] });
    const canonical = await (await fetch(url("/api/flows/board?side=long"), { headers: auth })).text();
    ok(canonical.includes("LONGMARK"), "the long board is what it was published as");
    for (const raw of ["watchlist", "../record", "WATCH", "long:2026-08-24", ""]) {
      const res = await fetch(url("/api/flows/board?side=" + encodeURIComponent(raw)), { headers: auth });
      eq(res.status, 200, `an unrecognised side (${raw || "empty"}) is answered, not errored`);
      eq(await res.text(), canonical,
         `and serves exactly the long board rather than reaching for ${raw || "empty"}`);
    }

    await put("board:long:2026-08-24", { side: "long", rows: [{ t: "ZZZ", s: 80 }] });
    const dated = await (await fetch(
      url("/api/flows/board?side=" + encodeURIComponent("long:2026-08-24")), { headers: auth })).json();
    ok(!JSON.stringify(dated).includes("ZZZ"),
       "the side parameter cannot address a dated board");
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const SCORE_SCALE = Math.atanh(0.80) / 2.0;
    const mkPool = (ticker, score, extra = {}) => ({
      ticker, score, residual: SCORE_SCALE * Math.atanh(score / 100),
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

    const tilts = new Map([
      ["AAA", { surpriseTilt: 0.1, relVolume: 1.1, putCallRatio: 0.8 }],
      ["BBB", { surpriseTilt: 1.386, relVolume: 2.1, putCallRatio: 1.9 }],
      ["CCC", { surpriseTilt: -0.51, relVolume: 1.4, putCallRatio: 0.6 }],
    ]);
    const watchRows = toWatchRows(
      [mkPool("AAA", 4), mkPool("BBB", -19), mkPool("CCC", 18),
       mkPool("DDD", 9, { week52Pos: null })],
      screener, tilts);

    watchRows.sort((a, b) => a.t.localeCompare(b.t));
    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok",
      rows: watchRows,
    });

    await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(WROW, { timeout: 15000 });

    const order = (await page.locator(WROW + " .bd-open").allTextContents()).map((t) => t.trim());
    assert.deepEqual(order, ["BBB", "CCC", "DDD", "AAA"],
      "the watch list is ranked by distance to the band, not by score"); checks++;

    const dist = (await page.locator("#watchBody .c-toband").allTextContents()).map((t) => t.trim());
    assert.deepEqual(dist, ["0.99", "1.99", "10.99", "16.00"],
      "and the distance is the band minus the UNROUNDED score. The hundredth " +
      "below each integer is the tanh/atanh round-trip through the fixture's " +
      "residual, not a modelling choice — the fixture picks integer scores, " +
      "inverts them to residuals, and the renderer inverts them back. Pinned " +
      "at the precision actually printed rather than at the ideal, because a " +
      "tolerance here would hide the day the two inverses stop agreeing"); checks++;

    const near = await page.locator("#watchBody .c-toband.is-near").count();
    eq(near, 2, "rows within a fifth of the band's half-width of the edge are marked");

    const surprised = await page.locator("#watchBody .is-surprise").count();
    eq(surprised, 1, "and only a tilt past log 3 — one side surprising 3× the other — is marked");

    const surTexts = await page.locator(WROW).first().locator('[data-col="sur"]').textContent();
    ok(/^\+1\.39$/.test(surTexts.trim()), `surprise renders as a signed tilt (${surTexts})`);
    const negTilt = await page.locator(WROW).nth(1).locator('[data-col="sur"]').textContent();
    ok(/^\u22120\.51$/.test(negTilt.trim()),
       `a put-side tilt carries a real minus, U+2212 (${negTilt})`);

    const dddCells = await Promise.all(["sur", "rvol", "pcr", "w52"].map((k) =>
      page.locator(WROW).nth(2).locator(`[data-col="${k}"]`).textContent()));
    assert.deepEqual(dddCells.map((t) => t.trim()), ["—", "—", "—", "—"],
      `DDD's surprise, rel vol, P/C and 52w are all withheld, never zero (${dddCells.join("|")})`); checks++;

    eq(await page.locator('[data-rail-count="watch"]').textContent(), "4",
       "the rail badges the watch count");

    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 1, scored: 130, status: "ok",
      rows: [
        { t: "FAR", r: 1, s: 0, cnv: 70, px: 10, resid: 0.0002 },
        { t: "MID", r: 2, s: 0, cnv: 71, px: 11, resid: -0.0030 },
        { t: "EDGE", r: 3, s: 0, cnv: 72, px: 12, resid: 0.0052 },
      ],
    });
    await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector(WROW, { timeout: 15000 });

    const bandOrder = (await page.locator(WROW + " .bd-open").allTextContents()).map((t) => t.trim());
    assert.deepEqual(bandOrder, ["EDGE", "MID", "FAR"],
      "AT THE LIVE BAND THE ORDERING IS RECOVERED. All three rows score 0, so " +
      "on the score this sort had nothing to work with and returned input " +
      "order — which was alphabetical here and would have read as a ranking"); checks++;

    const bandDist = (await page.locator("#watchBody .c-toband").allTextContents()).map((t) => t.trim());
    ok(new Set(bandDist).size === 3,
      `and the distance column carries three distinct values rather than one ` +
      `constant (${bandDist.join(", ")}) — at this band the old column was ` +
      `identically "1" on every row`);
    ok(/^\d+\.\d{2}$/.test(bandDist[0]),
      `still in SCORE POINTS (${bandDist[0]}), comparable to the score column ` +
      "beside it — an earlier attempt reported residual units here and, at the " +
      "±20 band above, collapsed its two closest rows onto one printed value");

    const bandNear = await page.locator("#watchBody .c-toband.is-near").count();
    ok(bandNear >= 1 && bandNear < 3,
      `the near mark selects some rows but not all (${bandNear} of 3) — ` +
      "hard-coded at three score units it selected every row at this band, " +
      "and a mark on everything marks nothing");

    const unitTitle = await page.locator("#watchBody .c-toband").first().getAttribute("title");
    ok(/unrounded score/.test(unitTitle || ""),
      "AND THE ROW SAYS WHERE ITS PRECISION CAME FROM: the score printed beside " +
      "this column is an integer that would place the name at the edge exactly, " +
      `so the difference has to be attributable (${unitTitle})`);

    await put("board:watch", {
      side: "watch", sessionDate: "2026-08-24", deadBand: 20, scored: 60, status: "ok", rows: [],
    });
    await page.goto(url("/flows/watch/"), { waitUntil: "domcontentloaded" });
    await page.waitForSelector('.bd-silent[data-empty="unavailable"]', { timeout: 15000 });
    const emptyText = await readWhy(page);
    ok(/publishing fault/.test(emptyText),
       `an empty band is flagged as a likely fault, not reported as a quiet session (${emptyText})`);

    eq(errors.length, 0, `the watch page threw nothing (${errors[0] || ""})`);
    await context.close();
  }

  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{
      name: "flows_session", value: token, domain: "127.0.0.1", path: "/",
      httpOnly: true, sameSite: "Lax",
    }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const popOf = (sel) => page.evaluate((sel) => {
      const t = document.querySelector(sel);
      if (!t) return null;
      t.click();
      const pop = document.getElementById("fxPop");
      const text = pop ? pop.textContent : null;
      window.FlowsUI.closeInfo();
      return text;
    }, sel);

    {
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#recCurve .rec-empty", { timeout: 15000 });
      const note = await popOf("#recCurve .rec-empty [data-info]");
      ok(/first pipeline run|No session has been scored/.test(note || ""),
         `an empty record explains WHY it is empty, one tap away on its silent state (${note})`);
      const status = await page.locator("#recStatus").textContent();
      ok(/retained|empty/.test(status), `and the status says so too (${status})`);

      eq(await page.locator("#recCurve svg.rc").count(), 0,
         "nothing is plotted when nothing has been measured");

      eq(await page.locator("#recFeatWrap .rf-row").count(), 0,
         "and no evidence rows are framed around zero columns");
      eq(await page.locator("#recFeatWrap").getAttribute("data-empty"), "pending",
         "the evidence module wears the pending state instead");
      const featEmpty = await popOf("#recFeatNotes [data-info]");
      ok(/not been measured yet/.test(featEmpty || ""),
         `and its disclosure says it has not been measured (${featEmpty})`);
    }

    {
      await put("record", {
        status: "ok", retained: 3, firstSession: "2026-08-20", lastSession: "2026-08-24",
        horizons: [{ k: 5, ls: 0.031, n: 3 }, { k: 10, ls: -0.004, n: 2 }],
        sessions: [
          { d: "2026-08-20", long: 0.012, short: -0.004, ls: 0.016, hit: 0.55, lost: 1, names: 20 },
        ],
      });
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#recCurve .rec-empty, #recCurve svg.rc", { timeout: 15000 });

      eq(await page.locator("#recCurve svg.rc").count(), 0,
         "a horizon below the stated session floor is not plotted");
      const note = await popOf("#recCurve .rec-empty [data-info]");
      ok(/3/.test(note || ""), `and the note names how many sessions there actually are (${note})`);

      eq(await page.locator(".rc-sess").first().getAttribute("data-d"), "2026-08-20",
         "though the session list still shows the session that was measured");
      eq(await page.locator(".rc-sess").first().locator(".c-leg").count(), 2,
         "with both legs rendered as measurements");
    }

    {
      await put("record", {
        status: "ok", retained: 40, firstSession: "2026-07-01", lastSession: "2026-08-24",
        horizons: [
          { k: 1, ls: 0.002, n: 39 },
          { k: 5, ls: -0.011, n: 35 },
          { k: 10, ls: 0.024, n: 30 },
          { k: 21, ls: 0.041, n: 2 },

          { k: 42, ls: null, n: 28 },
        ],
        sessions: [
          { d: "2026-08-24", long: 0.021, short: -0.010, ls: 0.031, hit: 0.61, lost: 1, names: 24 },
          { d: "2026-08-21", long: -0.008, short: 0.004, ls: -0.012, hit: null, lost: 9, names: 22 },
        ],
        features: {
          k: 10, minN: 20,
          method: "spearman = pearson(percentileRank(feature), percentileRank(forward return)); " +
            "returns are close-to-close price returns from each row's published px, raw, not side-signed",
          selection: "archived rows are the published extremes only, so these are ICs conditional " +
            "on selection, not universe ICs",
          overlap: "consecutive sessions share most of a multi-session window, so n counts rows, " +
            "not independent observations",
          calendar: "the trading calendar is the union of observed close dates",
          perSession: "one rank correlation pooled across sessions scores a volatility feature on " +
            "which way the market went",
          sessionMinN: 20, rankedFrom: 30, through: "2026-08-24",
          cols: [
            { key: "s", ic: 0.031, n: 640, icMean: 0.042, icSd: 0.12, icSessions: 32, icPos: 0.625,
              icMkt: 0.21, icT: 0.63, ranked: true, rankedFrom: 30 },
            { key: "cnv", ic: 0.018, n: 640, icMean: -0.011, icSd: 0.2, icSessions: 12, icPos: 0.417,
              icMkt: 0.88, icT: null, ranked: false, rankedFrom: 30,
              rankReason: "12 scored sessions against the 30 a 10-session horizon needs before a mean is ranked" },

            { key: "purity", ic: null, n: 640, reason: "no variation to rank",
              icMean: null, icSessions: 0, ranked: false, icReason: "no variation to rank in any session" },
            { key: "vrp", ic: null, n: 3, reason: "fewer than 20 measured pairs",
              icMean: null, icSessions: 0, ranked: false, icReason: "no session reached 20 measured names" },
          ],
        },
      });
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#recCurve svg.rc", { timeout: 15000 });

      const plot = await page.evaluate(() => {
        const svg = document.querySelector("#recCurve svg.rc");
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

      eq(plot.dots, 3,
         "only horizons past the session floor AND with a measured mean are plotted");
      eq(plot.negs, 1, "and a negative horizon is drawn as negative");

      const hitCell = await page.locator(".rc-sess").nth(1).locator(".c-hit").textContent();
      eq(hitCell.trim(), "—", "a session with no hit rate shows the em dash, never a confident 0%");

      ok(plot.zeroY !== null && plot.zeroY > 0 && plot.zeroY < plot.height,
         `the zero line is drawn inside the plot (${plot.zeroY} of ${plot.height})`);

      assert.deepEqual(plot.nLabels, ["n=39", "n=35", "n=30"],
        "every plotted point carries the sample size it came from"); checks++;
      ok(plot.titles.every((t) => /scored session/.test(t)),
         "and each point names its n in its accessible title");
      ok(/long minus short|Long-minus-short/i.test(plot.aria || ""),
         `the chart states what it measures to a screen reader (${plot.aria})`);

      const attrition = await page.locator(".rc-sess .c-lost.is-attrition").count();
      eq(attrition, 1, "a session that lost more than a fifth of its names is marked");
      const marked = await page.locator(".rc-sess .c-lost.is-attrition").getAttribute("title");
      ok(marked && /not a random sample/.test(marked),
         "and says why that makes the row unreliable rather than noisy");

      const status = await page.locator("#recStatus").textContent();
      ok(/40 sessions retained/.test(status), `the status leads with the sample (${status})`);

      const legTones = await page.evaluate(() => {
        const row = document.querySelector(".rc-sess");
        return ["c-long", "c-short", "c-ls"].map((c) => {
          const n = row.querySelector("." + c);
          return { cls: n.className, tone: n.getAttribute("data-tone") };
        });
      });
      ok(/c-leg/.test(legTones[0].cls) && !legTones[0].tone,
         `the long leg is a measurement, not a verdict (${JSON.stringify(legTones[0])})`);
      ok(/c-leg/.test(legTones[1].cls) && !legTones[1].tone,
         `and so is the short leg (${JSON.stringify(legTones[1])})`);
      ok(legTones[2].tone === "up" || legTones[2].tone === "down",
         `while the spread, which IS a result, carries its sign (${JSON.stringify(legTones[2])})`);

      const axis = await page.evaluate(() =>
        Array.from(document.querySelectorAll("#recCurve .rc-axislabel")).map((t) => t.textContent));
      ok(axis.length >= 3, `the y axis is labelled at more than one point (${axis.join(", ")})`);
      ok(axis.includes("0"), "including zero");
      ok(axis.some((t) => /%/.test(t)),
         `and the extremes carry a magnitude (${axis.join(", ")})`);

      const feat = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#recFeatBody .rf-row")).map((b) => {
          b.click();
          const pop = document.getElementById("fxPop");
          const facts = {};
          for (const dt of pop.querySelectorAll("dt")) facts[dt.textContent] = dt.nextElementSibling ? dt.nextElementSibling.textContent : null;
          const text = pop.textContent;
          window.FlowsUI.closeInfo();
          const state = b.querySelector(".rf-state.is-pending");
          return {
            key: b.getAttribute("data-key"),
            mean: b.querySelector(".c-icm").textContent.trim(),
            unranked: state ? state.getAttribute("title") : null,
            facts, text,
          };
        });
        const about = document.querySelector("#recFeatWrap .ui-mod-h .ui-info");
        about.click();
        const notes = document.getElementById("fxPop").textContent;
        window.FlowsUI.closeInfo();
        return { rows, notes, hidden: document.getElementById("recFeatWrap").hidden };
      });
      eq(feat.hidden, false, "the evidence module is shown once the record carries one");
      eq(feat.rows.length, 4, "every published column gets a row");

      const byKey = Object.fromEntries(feat.rows.map((r) => [r.key, r]));
      ok(feat.rows.every((r) => ["Mean IC", "SD", "Positive", "t", "Market tie", "Pooled IC", "Pairs"].every((k) => k in r.facts)),
         "every row carries the session mean, its spread, its sign count, t, the market tie, " +
         "the pooled figure and its pairs, one tap away on the row");
      eq(byKey.s.mean, "+0.042", "a positive session-mean IC carries its sign explicitly");
      eq(byKey.cnv.mean, "−0.011", "and a negative one carries a real minus, U+2212");
      eq(byKey.s.unranked, null, "a ranked column wears no unranked mark");
      ok(/unranked/.test(byKey.cnv.unranked || "") && /12 of 30/.test(byKey.cnv.unranked || ""),
         `an unranked column says so, with its sessions against the floor (${byKey.cnv.unranked})`);
      eq(byKey.s.facts.Positive, "20 of 32", "the positive sessions are counted against the sessions scored");
      eq(byKey.s.facts.t, "+0.63", "a ranked column prints its t");
      eq(byKey.cnv.facts.t, "—", "an unranked one prints none rather than a t it cannot support");
      eq(byKey.cnv.facts["Market tie"], "+0.88", "and the market tie is printed where a reader can see the bet");
      eq(byKey.s.facts["Pooled IC"], "+0.031", "the pooled figure is still printed, as the secondary figure");
      eq(byKey.s.facts.Pairs, "640", "with the pairs it was measured on beside it");

      eq(byKey.purity.facts["Pooled IC"], "—", "a constant column shows the em dash, never 0.000");
      ok(/no variation to rank/.test(byKey.purity.text),
         `and names its reason (${byKey.purity.text.slice(0, 160)})`);
      eq(byKey.purity.mean, "—", "in the session figure too");
      ok(/no variation to rank in any session/i.test(byKey.purity.text),
         "with the session reason beside it");
      eq(byKey.vrp.facts["Pooled IC"], "—", "so does a column below the sample floor");
      ok(/fewer than 20/i.test(byKey.vrp.text),
         "with the floor named rather than the variance");

      ok(/composite|claim/.test(byKey.s.text),
         `the score's row states what it is testing, in its disclosure (${byKey.s.text.slice(0, 120)})`);
      ok(/agreement|conviction/.test(byKey.cnv.text),
         "and so does conviction's");

      const notes = feat.notes;
      ok(/10 sessions/.test(notes), `the horizon is stated (${notes.slice(0, 80)})`);
      ok(/percentileRank/.test(notes), "the method is printed as the payload states it");
      ok(/conditional on selection/.test(notes), "including the selection caveat");
      ok(/not independent observations|effective sample/.test(notes), "and the overlap deflation");
      ok(/which way the market went/.test(notes), "and why the table is measured per session");
      ok(/ranked from 30 scored sessions/.test(notes) && /through 2026-08-24/.test(notes),
         `and the ranking floor and the exit cut are stated (${notes.slice(0, 160)})`);
    }

    {
      await put("record", {
        status: "ok", retained: 40, firstSession: "2026-07-01", lastSession: "2026-08-24",
        horizons: [
          { k: 1, ls: -0.004, n: 39, sd: 0.01, hit: 0.44, hitN: 900, hitSessions: 39 },
          { k: 5, ls: -0.012, n: 35, sd: 0.02 },
          { k: 10, ls: -0.021, n: 30, sd: 0.05 },
        ],
        sessions: [{ d: "2026-08-24", long: -0.01, short: 0.011, ls: -0.021, hit: 0.38, lost: 0, names: 24 }],
      });
      await page.goto(url("/flows/history/"), { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#recCurve svg.rc", { timeout: 15000 });

      const neg = await page.evaluate(() => {
        const svg = document.querySelector("#recCurve svg.rc");
        const zero = Number(svg.querySelector(".rc-zero").getAttribute("y1"));
        const ys = Array.from(svg.querySelectorAll(".rc-dot")).map((d) => Number(d.getAttribute("cy")));
        return {
          zero, ys,
          plotTop: Number(svg.getAttribute("data-plot-top")),
          plotHeight: Number(svg.getAttribute("data-plot-height")),
          negs: svg.querySelectorAll(".rc-dot.is-neg").length,
          clear: [...svg.querySelectorAll(".rc-dot")].map((d) => d.classList.contains("is-clear")),
          whiskers: [...svg.querySelectorAll(".rc-wh")].map((l) => ({ open: l.classList.contains("is-open"), y1: +l.getAttribute("y1"), y2: +l.getAttribute("y2") })),
          capsules: svg.querySelectorAll(".rc-ci").length,
        };
      });

      eq(neg.negs, 3, "every horizon of a losing record is drawn as negative");

      ok(neg.zero >= neg.plotTop && neg.zero <= neg.plotTop + neg.plotHeight,
         `the zero line sits in the plot region, not the margin ` +
         `(y=${neg.zero.toFixed(1)}, region ${neg.plotTop}..${neg.plotTop + neg.plotHeight})`);

      ok(neg.ys.every((y) => y > neg.zero),
         `and every point sits below it rather than being rescaled above it ` +
         `(zero at ${neg.zero}, points at ${neg.ys.map((y) => y.toFixed(0)).join(", ")})`);

      eq(neg.capsules, 3, "each measured spread carries its naive interval, drawn");
      ok(neg.whiskers.length === 3 && neg.whiskers.every((w) => !w.open),
         "and its adjusted interval: at 39, 35 and 30 sessions each horizon keeps at least two " +
         "independent windows (30 / 10 = 3), so none of the three is unbounded");
      const w10 = neg.whiskers[2], w1 = neg.whiskers[0];
      ok(Math.abs(w10.y2 - w10.y1) > Math.abs(w1.y2 - w1.y1),
         "and the 10-session interval is drawn wider than the 1-session one: overlapping " +
         "windows divide the sample by the horizon, and a wider whisker is that honesty made visible");
      eq(neg.clear[0], true,
         "a mean whose adjusted interval clears zero is drawn in colour (−0.4% ± 0.3% at 39 sessions)");
      eq(neg.clear[2], false,
         "while one whose interval spans zero is grey: −2.1% with a 5% spread over three " +
         "independent windows cannot be told apart from chance, and the chart says so without a word");

      const hit = await page.evaluate(() => {
        const svg = document.querySelector("#recHit svg.rc");
        return svg ? { dots: svg.querySelectorAll(".rc-dot").length, clear: svg.querySelector(".rc-dot").classList.contains("is-clear") } : null;
      });
      ok(hit && hit.dots === 1,
         "the hit-rate chart draws the one horizon that published a hit rate with its sessions, and no other");
      eq(hit && hit.clear, false,
         "and 44% over 39 sessions is grey: counted as one call a session its interval reaches past 50%, " +
         "even though 900 names would make the naive interval look decisive");
    }

    eq(errors.length, 0, `the track record threw nothing (${errors[0] || ""})`);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    eq(overflow, false, "and the track record overflows nothing at 390px");

    await page.waitForFunction(() => {
      const svg = document.querySelector("#recCurve svg.rc");
      if (!svg) return false;
      const drawn = Number(svg.getAttribute("viewBox").split(/\s+/)[2]);
      const shown = svg.getBoundingClientRect().width;
      return shown > 0 && drawn / shown > 0.85 && drawn / shown < 1.15;
    }, { timeout: 10000 }).catch(() => {});
    const chart = await page.evaluate(() => {
      const svg = document.querySelector("#recCurve svg.rc");
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
