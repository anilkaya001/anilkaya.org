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

const settled = async (route) => {
  const until = Date.now() + 60000;
  for (;;) {
    try {
      const r = await fetch(url(route), { headers: auth, signal: AbortSignal.timeout(15000) });
      if (r.status < 500 && (r.headers.get("content-type") || "").includes("json")) { await r.json(); return; }
    } catch (e) {
      if (Date.now() > until) throw e;
    }
    if (Date.now() > until) throw new Error("worker never answered " + route + " with JSON");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};
for (const route of ["/api/flows/board?side=watch", "/api/flows/record", "/api/flows/movers", "/api/flows/sectors"]) await settled(route);

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
                       "board:long:2026-08-26", "board:short:2026-08-26", "card:AAPL",
                       "ideas:2026-08-26", "ideas-out:2026-08-26", "ideas:2026-08-26:r1", "ideas-out:2026-08-26:r2"]) {
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
      ["ideas:2026-8-26", "an unpadded ideas date"],
      ["ideas:bad-date", "an ideas key whose date is not a date"],
      ["ideas:2026-08-26:r", "a revision with no number"],
      ["ideas:2026-08-26:r1:r2", "a revision of a revision"],
      ["ideas-out:2026-08-26x", "an outcomes key with a suffix"],
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

    for (const key of ["board:long", "board:short", "board:watch", "record", "meta",
                       "scoretrack", "flowalerts", "pulse", "universe", "focus", "roster",
                       "ideas:2026-08-26", "ideas-out:2026-08-26", "ideas:2026-08-26:r1", "ideas-out:2026-08-26:r2"]) {
      const res = await del(key);
      eq(res.status, 400, `the sweep cannot delete ${key}`);
    }
    for (const key of ["ideas:2026-08-26", "ideas:2026-08-26:r1", "ideas-out:2026-08-26"]) {
      const kept = await (await fetch(url("/api/flows/ingest?key=" + encodeURIComponent(key)), { headers: { Authorization: "Bearer " + TOKEN } })).json();
      ok(kept.status !== "pending", `and ${key} is still stored after the refused delete`);
    }
    const retired = await del("card:AAPL");
    eq(retired.status, 200, "a per-ticker card is the one other thing the nightly token may delete: the run retires " +
      "cards that stopped being rebuilt, and the live token is refused the same DELETE");
    const live = await (await fetch(url("/api/flows/ingest?key=board:long"), {
      headers: { Authorization: "Bearer " + TOKEN },
    })).json();
    ok(live.status !== "pending", "and the live board is still there after trying");

    const noAuth = await fetch(url("/api/flows/ingest?key=board:long:2026-01-02"), { method: "DELETE" });
    eq(noAuth.status, 401, "DELETE needs the same bearer as every other verb here");
  }

  {
    for (const route of ["/flows/watch/"]) {
      const inn = await fetch(url(route), { headers: auth, redirect: "manual" });
      eq(inn.status, 200, `${route} renders for a session`);
      const html = await inn.text();
      ok(html.includes('class="flows-rail"'), `${route} carries the rail`);

      ok(new RegExp('href="' + route + '"[^>]*aria-current="page"').test(html),
         `${route} marks ITSELF current in the rail, not merely something`);

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

  console.log(`✓ flows-sections: ${checks} assertions — a key validator tested from both ` +
    `sides, a dated board the side parameter cannot address, and a watch list ranked by ` +
    `distance to the band`);
} finally {
  await browser.close();
  await server.stop();
}
